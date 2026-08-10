import { z } from 'zod';
import { EXAMINER_INSTRUCTIONS } from '@/lib/instructions';
import { TOOL_DEFS } from '@/lib/tools';

export const dynamic = 'force-dynamic';

const CLIENT_SECRETS_URL = 'https://api.openai.com/v1/realtime/client_secrets';

const clientSecretSchema = z.object({
  value: z.string(),
  expires_at: z.number(),
});

export async function GET(): Promise<Response> {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.REALTIME_MODEL || 'gpt-realtime-2.1';

  if (!apiKey) {
    return Response.json({ error: 'OpenAI realtime configuration is missing' }, { status: 500 });
  }

  try {
    const response = await fetch(CLIENT_SECRETS_URL, {
      method: 'POST',
      signal: AbortSignal.timeout(30_000),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        session: {
          type: 'realtime',
          model,
          instructions: EXAMINER_INSTRUCTIONS,
          tools: TOOL_DEFS,
          audio: {
            input: {
              turn_detection: {
                type: 'semantic_vad',
                eagerness: 'low',
                create_response: true,
                interrupt_response: true,
              },
              // Per docs/research/realtime-api-reference.md §6: without this, the model still
              // understands audio directly but no
              // conversation.item.input_audio_transcription.* events fire, so the UI transcript
              // (handleServerEvent's user_transcript action) never populates.
              transcription: { model: 'whisper-1', language: 'en' },
            },
            output: { voice: 'marin' },
          },
        },
      }),
    });

    if (!response.ok) {
      return Response.json(
        { error: `OpenAI client secret request failed with status ${response.status}` },
        { status: 502 }
      );
    }

    const { value, expires_at } = clientSecretSchema.parse(await response.json());
    return Response.json({ value, expires_at });
  } catch {
    return Response.json({ error: 'Unable to mint OpenAI client secret' }, { status: 502 });
  }
}
