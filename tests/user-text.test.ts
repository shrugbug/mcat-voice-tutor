import { describe, expect, test } from 'vitest';
import { buildUserTextItem, MAX_USER_TEXT_LENGTH } from '../lib/realtime-client';

describe('buildUserTextItem', () => {
  test('builds the same shape the reconnect resume path already uses', () => {
    expect(buildUserTextItem('why is it B?')).toEqual({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'why is it B?' }],
      },
    });
  });

  test('trims surrounding whitespace', () => {
    expect(buildUserTextItem('  hi  ')).toMatchObject({
      item: { content: [{ type: 'input_text', text: 'hi' }] },
    });
  });

  test('rejects empty or whitespace-only input', () => {
    expect(() => buildUserTextItem('')).toThrow();
    expect(() => buildUserTextItem('   ')).toThrow();
  });

  test('rejects input beyond the length cap', () => {
    expect(() => buildUserTextItem('x'.repeat(MAX_USER_TEXT_LENGTH + 1))).toThrow();
    expect(() => buildUserTextItem('x'.repeat(MAX_USER_TEXT_LENGTH))).not.toThrow();
  });
});
