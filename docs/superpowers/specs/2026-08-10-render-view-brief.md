# render_view — component-registry generative UI (approved design)

Goal: the voice agent reshapes the interface mid-session via a typed tool call.
Pattern: fixed component registry + typed tool call (per docs/research/generative-ui-landscape.md #1).
`show_content` stays as fallback.

## 1. lib/views.ts — registry schemas (zod, strict)

Discriminated union `ViewSpec` on `component`:
- `flashcard_deck`: { cards: [{front: string, back: string}] (1-50), title?: string }
- `answer_grid`: { options: string[] (exactly 4), revealed: boolean, correctIndex?: 0|1|2|3 (required when revealed) }
- `timer`: { seconds: int >0 <=7200, label?: string, running: boolean }
- `mastery_chart`: { categories: [{id: string, name: string, mastery: number 0..1}] (1-40) }
- `data_table`: { headers: string[] (1-8), rows: string[][] (each row same length as headers, <=30 rows), title?: string }
- `passage`: { html: string, title?: string } — html goes through the existing sanitizeHtml from lib/sanitize.ts at render time

Export `ViewSpecSchema` (the union), `ViewSpec` type, and `VIEW_COMPONENT_NAMES` const array.

## 2. app/components/views/ — one file per component + index

Simple, laptop-width, match existing styles in globals.css (add classes there as needed).
- FlashcardDeck: card counter, front shown, click/press to flip, prev/next buttons.
- AnswerGrid: A-D lettered options; when revealed, correct one highlighted green, others muted.
- TimerView: mm:ss countdown from seconds when running (client-side interval), stops at 0, label above.
- MasteryChart: horizontal bars (name + mastery %), sorted ascending by mastery.
- DataTable: plain table, header row styled.
- PassageView: title + sanitized html body (reuse sanitizeHtml).
- index.tsx: `renderView(spec: ViewSpec): ReactNode` switch.

## 3. Wire-up

- lib/tools.ts TOOL_DEFS: add `render_view` — description tells the model it REPLACES the main panel; parameters: { component: enum of VIEW_COMPONENT_NAMES, props: object (loose in the realtime schema; strict zod validation happens client-side) }. NOT added to dispatchTool (client-side tool like show_content — dispatcher must still throw on it).
- app/page.tsx: handle action name 'render_view' client-side: ViewSpecSchema.safeParse({component, ...props shape}) — on success setView(spec) (a new state that takes precedence over show_content content in ContentPanel area; latest of the two wins), sendToolOutput({ok:true}); on failure sendToolOutput({error: zod message}) so the model can retry. Keep batching semantics (outputs then single requestResponse) intact.
- ContentPanel area: render active ViewSpec via renderView, else legacy show_content html.
- lib/instructions.ts: add guidance — use render_view for flashcard drills (flashcard_deck), displaying MCQ options (answer_grid, revealed=false while answering, re-render revealed=true with correctIndex at post-mortem), timed passages (timer), progress recaps (mastery_chart), comparisons/data (data_table), passages (passage). show_content only when nothing fits.

## 4. Tests (vitest, no jsdom)

tests/views.test.ts: each component schema accepts a valid example; rejects: answer_grid with 3 options, revealed=true without correctIndex; timer seconds 0 and >7200; data_table ragged row; flashcard_deck empty cards; unknown component name. renderView is React — do NOT unit test rendering; `npm run build` is the render gate.

## 5. Definition of done

`npx vitest run` green (existing 86 + new), `npx tsc --noEmit` clean, `npm run build` green. Commit(s) on branch feature/render-view with footer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. Never commit .env, data/, resources/, .superpowers/.
