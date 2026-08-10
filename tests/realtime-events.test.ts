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
});
