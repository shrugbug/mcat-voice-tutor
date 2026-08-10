import { z } from 'zod';
import { openDb } from '@/lib/db';
import { dispatchTool } from '@/lib/tools';

export const dynamic = 'force-dynamic';

const requestSchema = z.strictObject({
  name: z.string(),
  args: z.unknown(),
});

export async function POST(request: Request): Promise<Response> {
  try {
    const { name, args } = requestSchema.parse(await request.json());
    const db = openDb();

    try {
      return Response.json({ result: await dispatchTool(db, name, args) });
    } finally {
      db.close();
    }
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unknown tool error' });
  }
}
