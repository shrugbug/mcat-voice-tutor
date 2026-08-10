import { z } from 'zod';
import { openDb } from '../../../lib/db';

export const dynamic = 'force-dynamic';

export const transcriptLineSchema = z.strictObject({
  role: z.enum(['user', 'bot', 'system']),
  text: z.string().min(1).max(4000),
});

export const transcriptRequestSchema = z.strictObject({
  lines: z.array(transcriptLineSchema).min(1).max(200),
});

export async function POST(request: Request): Promise<Response> {
  try {
    const { lines } = transcriptRequestSchema.parse(await request.json());
    const db = openDb();

    try {
      const insert = db.prepare('INSERT INTO transcripts (role, text) VALUES (?, ?)');
      const insertAll = db.transaction((rows: typeof lines) => {
        for (const row of rows) insert.run(row.role, row.text);
      });
      insertAll(lines);
      return Response.json({ ok: true, inserted: lines.length });
    } finally {
      db.close();
    }
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unknown transcript error' });
  }
}
