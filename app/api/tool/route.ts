import { z } from 'zod';
import { openDb } from '@/lib/db';
import type { DB } from '@/lib/db';
import { dispatchTool } from '@/lib/tools';
import { argKeys, recordToolError, sanitizeToolError } from '@/lib/tool-errors';

export const dynamic = 'force-dynamic';

const requestSchema = z.strictObject({
  name: z.string(),
  args: z.unknown(),
});

export async function handleToolRequest(db: DB, request: Request): Promise<Response> {
  let name = 'unknown';
  let args: unknown = null;

  try {
    ({ name, args } = requestSchema.parse(await request.json()));
  } catch (error) {
    const { logMessage, responseMessage } = sanitizeToolError(error, name, args);
    console.error(`[tool] ${name} request rejected: ${logMessage}`);
    return Response.json({ error: responseMessage });
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
