import { describe, expect, test } from 'vitest';
import { handleServerEvent } from '../lib/realtime-client';

// Fixtures copied verbatim from docs/research/realtime-event-fixtures.md
// (project rule: fixtures come from documented reality, never from implementation).

// Fixture 1: response.done with a function_call output item (VERBATIM,
// source: developers.openai.com/api/docs/guides/realtime-function-calling)
const responseDoneWithFunctionCall = {
  type: 'response.done',
  event_id: 'event_AeqLA8iR6FK20L4XZs2P6',
  response: {
    object: 'realtime.response',
    id: 'resp_AeqL8XwMUOri9OhcQJIu9',
    status: 'completed',
    status_details: null,
    output: [
      {
        object: 'realtime.item',
        id: 'item_AeqL8gmRWDn9bIsUM2T35',
        type: 'function_call',
        status: 'completed',
        name: 'generate_horoscope',
        call_id: 'call_sHlR7iaFwQ2YQOqm',
        arguments: '{"sign":"Aquarius"}',
      },
    ],
  },
};

// Fixture 3: conversation.item.input_audio_transcription.completed (VERBATIM,
// source: developers.openai.com/api/docs/guides/realtime-transcription)
const userTranscriptCompleted = {
  type: 'conversation.item.input_audio_transcription.completed',
  item_id: 'item_003',
  content_index: 0,
  transcript: 'Hello, how are you?',
};

// Fixture 4: response.output_audio_transcript.done. Event name VERIFIED
// verbatim against the realtime-conversations guide; the docs publish no
// complete example payload for this event, so this object is CONSTRUCTED
// from the documented field list (event_id, response_id, item_id,
// output_index, content_index, transcript) per realtime-event-fixtures.md —
// the type string and field names are authoritative, the values are
// placeholders.
const botTranscriptDone = {
  type: 'response.output_audio_transcript.done',
  event_id: 'event_5152',
  response_id: 'resp_001',
  item_id: 'item_002',
  output_index: 0,
  content_index: 0,
  transcript: "Sure — let's begin with a question on enzyme kinetics.",
};

describe('handleServerEvent', () => {
  test('response.done with a function_call output item -> tool_call action(s)', () => {
    const result = handleServerEvent(responseDoneWithFunctionCall);
    expect(result).toEqual([
      {
        kind: 'tool_call',
        callId: 'call_sHlR7iaFwQ2YQOqm',
        name: 'generate_horoscope',
        args: { sign: 'Aquarius' },
      },
    ]);
  });

  test('response.done with multiple function_call output items -> one tool_call action per item', () => {
    const multi = {
      type: 'response.done',
      event_id: 'event_multi',
      response: {
        object: 'realtime.response',
        id: 'resp_multi',
        status: 'completed',
        status_details: null,
        output: [
          {
            object: 'realtime.item',
            id: 'item_1',
            type: 'function_call',
            status: 'completed',
            name: 'generate_horoscope',
            call_id: 'call_1',
            arguments: '{"sign":"Aquarius"}',
          },
          {
            object: 'realtime.item',
            id: 'item_2',
            type: 'function_call',
            status: 'completed',
            name: 'get_flashcard',
            call_id: 'call_2',
            arguments: '{"topic":"amino acids"}',
          },
        ],
      },
    };

    const result = handleServerEvent(multi);
    expect(result).toEqual([
      { kind: 'tool_call', callId: 'call_1', name: 'generate_horoscope', args: { sign: 'Aquarius' } },
      { kind: 'tool_call', callId: 'call_2', name: 'get_flashcard', args: { topic: 'amino acids' } },
    ]);
  });

  test('response.done with no function_call output items -> null', () => {
    const noCalls = {
      type: 'response.done',
      event_id: 'event_none',
      response: {
        object: 'realtime.response',
        id: 'resp_none',
        status: 'completed',
        status_details: null,
        output: [
          {
            object: 'realtime.item',
            id: 'item_x',
            type: 'message',
            status: 'completed',
          },
        ],
      },
    };

    expect(handleServerEvent(noCalls)).toBeNull();
  });

  test('conversation.item.input_audio_transcription.completed -> user_transcript action', () => {
    const result = handleServerEvent(userTranscriptCompleted);
    expect(result).toEqual({ kind: 'user_transcript', text: 'Hello, how are you?' });
  });

  test('response.output_audio_transcript.done -> bot_transcript action', () => {
    const result = handleServerEvent(botTranscriptDone);
    expect(result).toEqual({
      kind: 'bot_transcript',
      text: "Sure — let's begin with a question on enzyme kinetics.",
    });
  });

  test('unrecognized event type -> null', () => {
    expect(handleServerEvent({ type: 'session.created' })).toBeNull();
  });

  // Regression: live session 2026-08-10 — the model emitted a function_call
  // whose `arguments` string was truncated mid-string ("Unterminated string in
  // JSON at position 504"), crashing the data-channel handler. Malformed
  // arguments must yield a tool_call action carrying parseError, not a throw.
  test('response.done with truncated arguments JSON -> tool_call with parseError, no throw', () => {
    const truncated = {
      type: 'response.done',
      event_id: 'event_regress_1',
      response: {
        object: 'realtime.response',
        id: 'resp_regress_1',
        status: 'completed',
        status_details: null,
        output: [
          {
            object: 'realtime.item',
            id: 'item_regress_1',
            type: 'function_call',
            status: 'completed',
            name: 'record_result',
            call_id: 'call_regress_1',
            arguments: '{"categoryId":"4A","difficulty":2,"correct":true,"mode":"drill","note":"truncat',
          },
        ],
      },
    };
    const result = handleServerEvent(truncated);
    expect(Array.isArray(result)).toBe(true);
    const [call] = result as Extract<import('../lib/realtime-client').Action, { kind: 'tool_call' }>[];
    expect(call.kind).toBe('tool_call');
    expect(call.callId).toBe('call_regress_1');
    expect(call.name).toBe('record_result');
    expect(call.args).toBeNull();
    expect(call.parseError).toMatch(/JSON|string/i);
  });

  test('mixed batch: one valid + one truncated call both surface, valid one parsed', () => {
    const mixed = {
      type: 'response.done',
      event_id: 'event_regress_2',
      response: {
        object: 'realtime.response',
        id: 'resp_regress_2',
        status: 'completed',
        status_details: null,
        output: [
          {
            object: 'realtime.item',
            id: 'item_ok',
            type: 'function_call',
            status: 'completed',
            name: 'get_student_profile',
            call_id: 'call_ok',
            arguments: '{}',
          },
          {
            object: 'realtime.item',
            id: 'item_bad',
            type: 'function_call',
            status: 'completed',
            name: 'generate_question',
            call_id: 'call_bad',
            arguments: '{"categoryId":"5A","diffic',
          },
        ],
      },
    };
    const result = handleServerEvent(mixed) as Extract<
      import('../lib/realtime-client').Action,
      { kind: 'tool_call' }
    >[];
    expect(result).toHaveLength(2);
    expect(result[0].args).toEqual({});
    expect(result[0].parseError).toBeUndefined();
    expect(result[1].args).toBeNull();
    expect(result[1].parseError).toBeTruthy();
  });
});
