import { describe, expect, test } from 'vitest';
import { transcriptLineSchema, transcriptRequestSchema } from '../app/api/transcript/route';

describe('transcriptRequestSchema (pure validation, no network/db)', () => {
  test('accepts a well-formed batch of lines', () => {
    const parsed = transcriptRequestSchema.parse({
      lines: [
        { role: 'user', text: 'What is impulse?' },
        { role: 'bot', text: 'Impulse is force times time.' },
        { role: 'system', text: '[photo sent]' },
      ],
    });
    expect(parsed.lines).toHaveLength(3);
  });

  test('rejects an empty lines array', () => {
    expect(() => transcriptRequestSchema.parse({ lines: [] })).toThrow();
  });

  test('rejects more than 200 lines', () => {
    const lines = Array.from({ length: 201 }, () => ({ role: 'user' as const, text: 'hi' }));
    expect(() => transcriptRequestSchema.parse({ lines })).toThrow();
  });

  test('accepts exactly 200 lines', () => {
    const lines = Array.from({ length: 200 }, () => ({ role: 'user' as const, text: 'hi' }));
    expect(() => transcriptRequestSchema.parse({ lines })).not.toThrow();
  });

  test('rejects an unknown role', () => {
    expect(() => transcriptLineSchema.parse({ role: 'narrator', text: 'hi' })).toThrow();
  });

  test('rejects empty text', () => {
    expect(() => transcriptLineSchema.parse({ role: 'user', text: '' })).toThrow();
  });

  test('rejects text over 4000 characters', () => {
    expect(() => transcriptLineSchema.parse({ role: 'user', text: 'a'.repeat(4001) })).toThrow();
  });

  test('accepts text at exactly 4000 characters', () => {
    expect(() => transcriptLineSchema.parse({ role: 'user', text: 'a'.repeat(4000) })).not.toThrow();
  });

  test('rejects unknown top-level keys (strict object)', () => {
    expect(() =>
      transcriptRequestSchema.parse({ lines: [{ role: 'user', text: 'hi' }], extra: true })
    ).toThrow();
  });
});
