# Pricing Recommendation

**Basis:** `market-pricing-research.md` (prices verified against live vendor pages 2026-08-10) + our measured unit economics.
**Unit cost floor:** realtime voice ≈ **$2–6/hour** of active conversation (gpt-realtime-2.1; the wide range is talk-density). Question-brain + embeddings + images add ≈10%.

## Positioning: sell tutoring, not software

The product substitutes **oral tutoring hours** ($150–330/hr effective at Blueprint/Princeton, $150–250 typical independent) — not app subscriptions. Every pricing surface should say "examiner" and "session," never "AI chat." The trap to avoid: consumer voice-AI apps anchor at $8–20/mo unlimited; at our COGS an unlimited $20 tier is underwater for any real studier (10 hrs/mo = $20–60 cost). UWorld and Blueprint now bundle *text* AI tutors free, so the moat line is **voice + episodic memory of your mistakes + graded oral-exam format** — priced against tutoring, differentiated against QBanks.

## Recommended structure (three SKUs, no unlimited anything)

| SKU | Price | Includes | Anchor logic |
|---|---|---|---|
| **Examiner Pass 90** (flagship) | **$299 / 90 days** | 60 min/day fair-use cap (soft-warn 45; at 60 no NEW session mints until the daily reset — a live session always runs to its natural end, per the metering spec's grace rule, bounded by the provider's own 60-min session cap; unused ≠ rollover) | Priced 1:1 against UWorld's $339/90-day QBank — the known "serious tool" number. At median use (~25 min/day) ≈ **81% gross margin**; the daily cap bounds a max-usage student near breakeven, never negative. |
| **Monthly** (entry/trial ramp) | **$79 / month** | 500 min/mo included | Below one human tutoring hour; ~2.5–5× the COGS of a typical month. Converts to Pass 90 via prorated credit. |
| **Minute top-up** | **$10 / 100 min** | applies to either plan | ~2–5× marginal cost; keeps heavy finishers (last 2 weeks pre-exam) revenue-positive instead of cap-frustrated. |

**Free trial: 30 minutes, card-free.** Enough for one full oral drill + the memory callback "wow" on day two; small enough that trial-farming new emails costs us ≤$3 each (plus the W3 rate limits).

## Margin protection built into product, not just pricing

- Route routine drills to **gpt-realtime-mini** (~3× cheaper); reserve the full model for graded mock orals and teach-back sessions. Research estimates ~+15 margin points; also a natural premium feature ("full examiner" sessions).
- The metering spec (W3) hard-gates at mint time; the margin dashboard is a launch requirement, not a nice-to-have.
- Re-price trigger: OpenAI realtime prices have moved twice in 12 months; the entitlements design keeps minute buckets abstract so COGS changes don't require SKU changes.

## What we deliberately reject

- **Unlimited flat tier at any price** — adverse selection guarantees the heaviest users define margin.
- **Per-session pricing** — punishes the daily-habit behavior that drives outcomes and retention.
- **$1,500+ course-tier pricing** — we don't carry content/live-instruction costs and shouldn't invite that comparison until outcome data exists.

## Launch-phase modifiers

- Founding cohort (first 100): Pass 90 at $199 with public "founding" framing — buys testimonials and usage data; sunset by date, not quietly.
- Student-hardship rate on request (norm in this category; trivial volume, large goodwill).
- Referral: give 60 min / get 60 min — minutes are the natural currency of the product.

## The one number to watch

**Median active minutes per paying user per day.** Every assumption above holds at ≤30 and the model degrades gracefully to ~breakeven at the 60 cap. If real usage clusters near the cap, raise Pass 90 to $349 (still under UWorld) before touching the cap.
