# Free MCAT Resources Survey — RAG Ingestion Candidates

**Context:** 93rd-percentile student (~515-516) targeting 520+, final 2 weeks before a late-Aug 2026 exam. High-scorer gaps skew toward Psych/Soc term precision and Bio/Biochem detail. Survey date: 2026-08-09. Nothing downloaded yet.

---

## 1. Indexable content resources (legal to download + index for personal study)

### Khan Academy MCAT Collection — STILL AVAILABLE (retirement postponed)
- **Status:** Slated for retirement multiple times; AAMC-funded extension kept it live "through 2026." As of mid-2025 Khan Academy stated it has *no plans to sunset MCAT content in 2026* but cannot guarantee timelines beyond that. **It is live today — if we want it, ingest soon.** ([KA Help Center](https://support.khanacademy.org/hc/en-us/community/posts/4411586016909-Update-MCAT-is-staying-on-Khan-Academy-for-5-more-years), [AAMC notice](https://cloud.email.aamc.org/mcat-khan-academy))
- **URL:** https://www.khanacademy.org/test-prep/mcat (~1,100 videos, ~3,000 review questions; articles + video transcripts are the indexable text)
- **Format:** HTML articles + on-page video transcripts
- **License:** CC BY-NC-SA 4.0 — explicitly permits downloading and offline/noncommercial reuse with attribution ("All Khan Academy content is available for free at www.khanacademy.org"). Personal RAG indexing is clearly within license. ([TOS](https://www.khanacademy.org/about/tos), [reuse FAQ](https://support.khanacademy.org/hc/en-us/articles/202262954))
- **Bulk download:** Feasible but non-trivial — no official text dump; scrape article pages + transcripts per unit, or use the KA API/KA Lite-style tooling. Psych/Soc unit alone is high value and a manageable scope.

### OpenStax textbooks
- **URLs:** https://openstax.org/subjects — relevant titles: *Psychology 2e*, *Biology 2e*, *Anatomy & Physiology 2e*, *Chemistry 2e / Atoms First*, *College Physics 2e*, *Concepts of Biology*, *Microbiology*, *Behavioral Neuroscience*
- **Format:** Single-file PDF download per book (also HTML web view)
- **License:** Mostly CC BY 4.0 (e.g., Biology 2e); a few CC BY-NC-SA. Either way, personal indexing is unambiguously fine. ([OpenStax licensing](https://help.openstax.org/s/article/Openstax-textbook-licensing-and-customization))
- **Bulk download:** Trivial — one click per PDF, no auth. Best legal-clarity-to-effort ratio of anything on this list. Caveat: college-course depth, not MCAT-curated; use for gap-filling lookups (esp. Psychology 2e glossary/terms), not linear review.

### LibreTexts (Bio/Biochem/Chem/Psych libraries)
- **URL:** https://bio.libretexts.org, https://chem.libretexts.org, https://socialsci.libretexts.org
- **Format:** HTML; per-book compiled PDF export available
- **License:** Page-level CC licenses, predominantly CC BY-NC-SA; each page states its license. Personal indexing fine.
- **Bulk download:** Feasible (PDF export per book), but content is heterogeneous and less curated than OpenStax. Second-choice textbook source.

### AAMC free planning tools (reference, mostly not worth indexing)
- **What Content Is Covered on the MCAT** outline (the official content-category list, e.g., 7A/7B/9A codes): HTML/PDF on students-residents.aamc.org. AAMC copyright, no open license — fine to download for personal use, and the *category outline* is the single best scaffold for organizing a RAG store / tagging weaknesses. Small enough to index as one document.
- Free Online Study Plan Guide + flashcard tool in the MCAT Official Prep Hub — interactive, behind AAMC login; link-only. ([AAMC prep page](https://students-residents.aamc.org/prepare-mcat-exam/prepare-mcat-exam))

### Jack Westin free tier (use live, don't scrape)
- ~6,700 free questions, daily CARS passage, 7 free digital textbooks. ([jackwestin.com](https://jackwestin.com/daily/jw-content-based-passages)) Proprietary/account-gated — TOS does not permit bulk export. **Link-only**; valuable as a practice source, not an index source.

---

## 2. Free official AAMC practice material (list only — do NOT index; AAMC copyright)

- **Free Practice Exam 1** (full-length, scored, with answer explanations) — free in the MCAT Official Prep Hub ([announcement](https://offers.aamc.org/free-practice-exam))
- **MCAT Sample Question Guide** (12 sample questions, free PDF) ([AAMC](https://students-residents.aamc.org/prepare-mcat-exam/mcat-sample-question-guide))
- **Practice with Exam Features tool** (12 questions in the real exam interface, free)
- Free Online Study Plan Guide + flashcards in the Prep Hub
- Everything else (FLs 2-5, Section Bank, Question Packs, CARS Diagnostic) is paid/low-cost. ([official prep updates](https://students-residents.aamc.org/prepare-mcat-exam/aamc-mcat-official-prep-updates))

For a 93rd-percentile student, remaining unused AAMC material (esp. Section Bank) is the consensus highest-yield paid spend; the free FL should be a timed baseline if not yet burned.

## 3. Community-vetted final-2-weeks resources (r/MCAT canon) — copyright triage

| Resource | What it is | Copyright status | Verdict |
|---|---|---|---|
| **300-page KA Psych/Soc doc** ("Khan Academy doc") | Community-written notes summarizing all KA P/S videos; the single most-recommended P/S resource on r/MCAT | Derivative of CC BY-NC-SA KA content, community-shared with that intent (Google Drive mirrors; Anki companions on [AnkiWeb](https://ankiweb.net/shared/info/921195297)) | **Safe to index** for personal use — the top P/S term-coverage document in existence |
| **86-page "MCATBros" P/S doc** | Condensed cousin of the 300-pager | Same posture | Safe to index (personal use) |
| **MileDown review sheets + Anki deck** | ~90 pages of condensed all-subject review sheets by u/MileDown, released free on r/MCAT | Original community work, freely shared by the author | **Safe to index**; the classic final-two-weeks full-content sweep |
| **Mr. Pankow P/S deck** | P/S Anki deck keyed to KA review blocks ([mcatresources.com](https://mcatresources.com/resource/1142)) | Community-original | Safe to use/index card text (personal) |
| **AnKing MCAT / Aidan deck** | Comprehensive decks; Aidan is built around AAMC-outline content | Community-original, freely shared on AnkiWeb | Safe for personal use; Anki .apkg → extract notes to text if indexing |
| **Jack Sparrow deck, "Kaplan chapter" decks** | Decks transcribing Kaplan book content | **Derivative of copyrighted Kaplan books** | **Link-only / avoid indexing** — do not redistribute or bake into any shared store |
| Scanned Kaplan/TPR/UWorld PDFs circulating on Drive | Pirated | Infringing | Do not touch |

Note: "safe to index" above means personal-study RAG on a local machine. None of the community docs should be re-published or served to other students from your index without checking with authors.

## 4. Question-writing / distractor-analysis guides (for generating MCAT-style questions)

- **NBME Item-Writing Guide** (*Constructing Written Test Questions for the Basic and Clinical Sciences*, 2020/2021 rev.) — the gold standard; freely published PDF by NBME. Covers stem construction, option homogeneity, cover-the-options test, flawed-item taxonomy, and distractor/option analysis. **Index this** — it is the best available spec for generating exam-realistic distractors. [NBME PDF](https://www.nbme.org/sites/default/files/2021-02/NBME_Item%20Writing%20Guide_R_6.pdf) (mirror: [Rowan CMSRU](https://cmsru.rowan.edu/documents/education-documents/assessment-forms-documents/faculty-and-staff/nbme-item-writing-guide-2020.pdf))
- **UW School of Medicine MCQ-writing guidelines** — short practical distillation with examples. [PDF](https://clime.washington.edu/wp-content/uploads/2020/07/WritingMultipleChoiceQuestions.pdf)
- **Non-functional distractor analysis** (open-access paper, PMC7372664) — empirical basis for judging distractor quality. [PMC](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7372664/)
- AAMC's own item-writing internals are not published; the MCAT Sample Question Guide's answer explanations are the closest public window into official distractor logic (read, don't index).

---

## Top 3 to actually ingest (ranked for a 520+ target)

1. **300-page KA Psych/Soc doc (+ MileDown P/S sheets as companion)** — P/S is the highest-variance section for high scorers and is won on obscure-term recognition; this doc is the densest legal term-coverage corpus and maps 1:1 to how AAMC tests P/S.
2. **Khan Academy MCAT articles/transcripts — Psych/Soc and Bio/Biochem units** — CC-licensed, AAMC-aligned, and the source of truth behind the 300-pager; ingesting the underlying units adds the detail layer (and hedges against the still-pending retirement).
3. **NBME Item-Writing Guide + UW MCQ guidelines** — small, free, and the enabling asset for the actual plateau-breaking activity: generating fresh AAMC-style questions with realistic distractors instead of re-reading content.

(Runner-up: OpenStax Psychology 2e + Biology 2e PDFs — cleanest licensing and one-click bulk download; use as the lookup/gap-fill layer rather than a primary index.)
