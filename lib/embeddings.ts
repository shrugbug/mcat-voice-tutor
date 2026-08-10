const ENDPOINT = 'https://api.openai.com/v1/embeddings';
const MODEL = 'text-embedding-3-small';
const BATCH_SIZE = 100;

type EmbeddingResponse = { data: { index: number; embedding: number[] }[] };

export async function embed(texts: string[]): Promise<Float32Array[]> {
  if (texts.length === 0) return [];

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set');

  const vectors: Float32Array[] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model: MODEL, input: batch }),
    });
    if (!res.ok) {
      throw new Error(`OpenAI embeddings request failed: ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as EmbeddingResponse;
    for (const item of [...json.data].sort((a, b) => a.index - b.index)) {
      vectors.push(new Float32Array(item.embedding));
    }
  }
  return vectors;
}
