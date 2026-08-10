# Realtime API — verbatim server/client event fixtures

Fetched 2026-08-09 from live OpenAI docs (developers.openai.com). These are the
canonical fixtures for `tests/realtime-events.test.ts` — copy them exactly.

## 1. `response.done` with a function_call output item (VERBATIM)

Source: developers.openai.com/api/docs/guides/realtime-function-calling

```json
{
    "type": "response.done",
    "event_id": "event_AeqLA8iR6FK20L4XZs2P6",
    "response": {
        "object": "realtime.response",
        "id": "resp_AeqL8XwMUOri9OhcQJIu9",
        "status": "completed",
        "status_details": null,
        "output": [
            {
                "object": "realtime.item",
                "id": "item_AeqL8gmRWDn9bIsUM2T35",
                "type": "function_call",
                "status": "completed",
                "name": "generate_horoscope",
                "call_id": "call_sHlR7iaFwQ2YQOqm",
                "arguments": "{\"sign\":\"Aquarius\"}"
            }
        ]
    }
}
```

Note: `arguments` is a JSON **string**, not an object — parse it.

## 2. Client event: return function result (VERBATIM)

Source: same page.

```json
{
  "type": "conversation.item.create",
  "item": {
    "type": "function_call_output",
    "call_id": "call_sHlR7iaFwQ2YQOqm",
    "output": "{\"horoscope\": \"You will soon meet a new friend.\"}"
  }
}
```

Then trigger response generation (VERBATIM):

```json
{
  "type": "response.create"
}
```

## 3. `conversation.item.input_audio_transcription.completed` (VERBATIM)

Source: developers.openai.com/api/docs/guides/realtime-transcription

```json
{
  "type": "conversation.item.input_audio_transcription.completed",
  "item_id": "item_003",
  "content_index": 0,
  "transcript": "Hello, how are you?"
}
```

## 4. `response.output_audio_transcript.done`

Event name VERIFIED verbatim (developers.openai.com/api/docs/guides/realtime-conversations
names both `response.output_audio_transcript.delta` and `.done`). The docs
publish no complete example payload for this event; the example below is
CONSTRUCTED from the documented field list (event_id, response_id, item_id,
output_index, content_index, transcript) — the type string and field names are
authoritative, the values are placeholders:

```json
{
  "type": "response.output_audio_transcript.done",
  "event_id": "event_5152",
  "response_id": "resp_001",
  "item_id": "item_002",
  "output_index": 0,
  "content_index": 0,
  "transcript": "Sure — let's begin with a question on enzyme kinetics."
}
```

## 5. Tool definition format in session config (VERBATIM)

Source: realtime-function-calling guide (shown inside `session.update`; the
same flat `tools` array shape is used in `/v1/realtime/client_secrets`
session config):

```json
{
  "type": "function",
  "name": "generate_horoscope",
  "description": "Give today's horoscope for an astrological sign.",
  "parameters": {
    "type": "object",
    "properties": {
      "sign": { "type": "string", "description": "The sign for the horoscope." }
    },
    "required": ["sign"]
  }
}
```
