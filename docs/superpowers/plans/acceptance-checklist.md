# Live voice acceptance checklist

Human-in-the-loop checklist for a real voice session against the running app
(`npm run dev`, mic-enabled browser, `OPENAI_API_KEY` set). Run after
`scripts/acceptance.ts` passes. Walk each item live with the user; fix
anything that fails (see Task 9 brief Step 3 — likely instructions tuning in
`lib/instructions.ts`, not code) before checking it off.

- [ ] Connect: mic permission prompt, bot greets and announces mode + reason
- [ ] Bot fetched profile (mode matches actual weakest areas)
- [ ] First question: stem read aloud, options appear on screen, NOT read aloud
- [ ] Answer wrong on purpose: bot probes error type, records, escalates follow-up
- [ ] Barge-in: interrupt bot mid-sentence, it stops and yields
- [ ] Teach-back: say "let me explain X" — bot interrupts an imprecise claim
- [ ] "I'm done": summary written (check sqlite sessions table), verbal debrief
- [ ] Reconnect works after killing the tab
