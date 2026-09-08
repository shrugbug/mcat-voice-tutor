import { BodyTooLarge, readRequestJson } from '@/lib/request-json';
import { z } from 'zod';
import { openDb } from '@/lib/db';
import type { DB } from '@/lib/db';
import { dispatchTool } from '@/lib/tools';
import { argKeys, recordToolError, sanitizeToolError } from '@/lib/tool-errors';
import { createFixedWindowRateLimit, rateLimitSetting, type RateLimitCheck } from '@/lib/rate-limit';

import { toolClient } from '@/lib/client-identity';

export const dynamic = 'force-dynamic';

const requestSchema = z.strictObject({
  name: z.string().max(64),
  args: z.unknown(),
});
const checkToolRateLimit = createFixedWindowRateLimit(rateLimitSetting('TOOL_RATE_LIMIT', 30), 60_000);

export async function handleToolRequest(
  db: DB,
  request: Request,
  checkRateLimit: RateLimitCheck = checkToolRateLimit
): Promise<Response> {
  const limit = checkRateLimit(toolClient(request));
  if (!limit.allowed) {
    return Response.json(
      { error: 'Too many tool requests' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }
    );
  }

  let name = 'unknown';
  let args: unknown = null;

  try {
    ({ name, args } = requestSchema.parse(await readRequestJson(request)));
  } catch (error) {
    if (error instanceof BodyTooLarge) return Response.json({ error: 'Request body too large' }, { status: 413 });
    const { logMessage } = sanitizeToolError(error, name, args);
    console.error(`[tool] ${name} request rejected: ${logMessage}`);
    return Response.json({ error: 'Invalid request' });
  }

  try {
    return Response.json({ result: await dispatchTool(db, name, args) });
  } catch (error) {
    const { logMessage, responseMessage } = sanitizeToolError(error, name, args);
    console.error(`[tool] ${name} failed: ${logMessage} (args: ${argKeys(args)})`);
    recordToolError(db, name, logMessage, args);
    return Response.json({ error: responseMessage });
  }
}

export async function POST(request: Request): Promise<Response> {
  const db = openDb();
  try {
    return await handleToolRequest(db, request);
  } finally {
    db.close();
  }
}
