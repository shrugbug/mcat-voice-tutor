import { describe, expect, test, vi } from 'vitest';
import { RealtimeClient } from '../lib/realtime-client';

/**
 * Unit tests for the tool-result batch flow (CRITICAL 2 fix): sendToolOutput queues a
 * function_call_output WITHOUT sending response.create, and requestResponse sends exactly one
 * response.create. This is exercised without any real WebRTC machinery -- we construct a
 * RealtimeClient with a stub audio element and inject a fake open data channel directly, the
 * same way the class's own sendEvent() checks readyState.
 */

type FakeDataChannel = { readyState: 'open'; send: ReturnType<typeof vi.fn> };

function makeClientWithFakeChannel(): { client: RealtimeClient; channel: FakeDataChannel } {
  const audioElement = {} as HTMLAudioElement;
  const client = new RealtimeClient(audioElement);
  const channel: FakeDataChannel = { readyState: 'open', send: vi.fn() };
  // dataChannel is a private field; tests inject it directly to exercise sendEvent/sendToolOutput
  // /requestResponse without going through the full WebRTC connect() flow.
  (client as unknown as { dataChannel: FakeDataChannel }).dataChannel = channel;
  return { client, channel };
}

function sentEvents(channel: FakeDataChannel): unknown[] {
  return channel.send.mock.calls.map((call) => JSON.parse(call[0] as string) as unknown);
}

describe('RealtimeClient tool-result batch flow', () => {
  test('sendToolOutput queues a function_call_output and does NOT send response.create', () => {
    const { client, channel } = makeClientWithFakeChannel();

    client.sendToolOutput('call_1', { ok: true });

    const events = sentEvents(channel);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'conversation.item.create',
      item: { type: 'function_call_output', call_id: 'call_1', output: JSON.stringify({ ok: true }) },
    });
    expect(events.some((e) => (e as { type: string }).type === 'response.create')).toBe(false);
  });

  test('requestResponse sends exactly one response.create', () => {
    const { client, channel } = makeClientWithFakeChannel();

    client.requestResponse();

    expect(sentEvents(channel)).toEqual([{ type: 'response.create' }]);
  });

  test('a batch of parallel tool calls sends one function_call_output per call, then exactly one response.create', () => {
    const { client, channel } = makeClientWithFakeChannel();

    // Simulate the page-level batch handler: every call in the batch gets its output queued
    // first, then a single response.create is sent for the whole batch.
    client.sendToolOutput('call_1', { ok: true });
    client.sendToolOutput('call_2', { error: 'boom' });
    client.sendToolOutput('call_3', { newMastery: 0.6 });
    client.requestResponse();

    const events = sentEvents(channel);
    expect(events).toHaveLength(4);
    const outputs = events.slice(0, 3) as { item: { call_id: string } }[];
    expect(outputs.map((e) => e.item.call_id)).toEqual(['call_1', 'call_2', 'call_3']);
    expect(events[3]).toEqual({ type: 'response.create' });
  });

  test('a failed tool call still gets a function_call_output with an {error} payload', () => {
    const { client, channel } = makeClientWithFakeChannel();

    client.sendToolOutput('call_err', { error: 'fetch failed' });
    client.requestResponse();

    const events = sentEvents(channel);
    expect(events[0]).toMatchObject({
      item: { call_id: 'call_err', output: JSON.stringify({ error: 'fetch failed' }) },
    });
  });

  test('sendEvent throws when the data channel is not open', () => {
    const audioElement = {} as HTMLAudioElement;
    const client = new RealtimeClient(audioElement);
    expect(() => client.sendToolOutput('call_1', { ok: true })).toThrow(/not open/);
  });
});

describe('RealtimeClient image input flow', () => {
  test('sendImage sends the documented image message followed by one response.create', () => {
    const { client, channel } = makeClientWithFakeChannel();

    client.sendImage(
      'data:image/jpeg;base64,cGhvdG8=',
      'Photo of a practice question I want to review.'
    );

    expect(sentEvents(channel)).toEqual([
      {
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [
            { type: 'input_image', image_url: 'data:image/jpeg;base64,cGhvdG8=' },
            { type: 'input_text', text: 'Photo of a practice question I want to review.' },
          ],
        },
      },
      { type: 'response.create' },
    ]);
  });

  test('sendImage omits the text content part when no note is provided', () => {
    const { client, channel } = makeClientWithFakeChannel();

    client.sendImage('data:image/webp;base64,cGhvdG8=');

    expect(sentEvents(channel)).toEqual([
      {
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_image', image_url: 'data:image/webp;base64,cGhvdG8=' }],
        },
      },
      { type: 'response.create' },
    ]);
  });

  test('sendImage throws before sending when the data channel is not open', () => {
    const client = new RealtimeClient({} as HTMLAudioElement);

    expect(() => client.sendImage('data:image/png;base64,cGhvdG8=')).toThrow(/not open/);
  });
});
