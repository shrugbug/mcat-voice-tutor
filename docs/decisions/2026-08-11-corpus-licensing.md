# Corpus licensing decision for a paid multi-user launch

**Date:** 2026-08-11

**Status:** Recommended decision, pending a source-level audit and counsel review

**Scope:** The study corpus, the AAMC-derived taxonomy, and the ways either can reach a user or an AI provider

## Executive decision

**Headline finding — FACT:** This repository does **not** establish that the 7,485-row local corpus is Khan Academy-derived. It establishes only that a local, ignored SQLite database was reported to contain 7,485 chunks, while the original files, a manifest, author/license data, and even the source-name inventory are absent from this worktree. The launch spec's more specific statement that the corpus contains Khan Academy, the 300-page P/S document, OpenStax, and other named material is therefore an **ASSUMPTION**, not a verified inventory.

**Headline finding — FACT:** The known deployed prod and demo databases were documented as having empty `chunks` tables (`docs/superpowers/specs/2026-08-10-tuning-loop-and-interfaces-design.md:68-71`). A separate read-only preflight in the launch spec reported 7,485 chunks in local `data/mcat.db` (`feature/multi-user-launch:docs/specs-multiuser/01-auth-tenancy-metering-billing.md:909-921`). These statements concern different databases and can both be true.

**Decision — RECOMMENDATION:** Launch the paid multi-user product with **no migrated corpus**. Keep the AAMC category identifiers as a navigation scaffold, replace copied descriptive wording with independently written minimal labels before launch, and generate questions without RAG grounding. In parallel, quarantine and inventory the 7,485 local chunks, then admit only sources with documented commercial rights into a new corpus. This avoids making the paid launch depend on an unverified content collection while preserving the app's core examiner loop.

**Is the blocker real? — CONCLUSION:** **Yes for migrating or using the current 7,485-row local corpus in the paid service; no for the paid launch itself if the corpus is omitted.** The repo does not prove that the local corpus is Khan-derived, so “Khan Academy blocks the whole launch” is too strong. The real blocker is missing provenance and commercial-use permission for every current source.

This is an options analysis, not legal advice. A copyright lawyer is needed before (1) using any current chunk in the paid product, (2) relying on a “non-commercial tier,” (3) treating model output grounded in restricted text as non-infringing, or (4) deciding how much AAMC wording can remain in the taxonomy.

## 1. What the corpus actually consists of and where it came from

### What can be established

- **FACT:** The original design called for user-provided textbook and sample-exam PDFs to be extracted, chunked, embedded, and stored in SQLite; supplementary resources could be added the same way (`docs/superpowers/specs/2026-08-09-mcat-study-bot-design.md:41-49`). That is a design description, not an acquisition record.
- **FACT:** The research survey said “Nothing downloaded yet” on 2026-08-09 (`docs/research/free-resources.md:1-4`). It recommended the 300-page Khan-derived P/S notes, Khan Academy articles/transcripts, NBME/UW item-writing guides, and OpenStax as possible future inputs (`docs/research/free-resources.md:61-76`). A recommendation is not proof of ingestion.
- **FACT:** The PDF ingestion implementation records only the input file's base name as `source`; it stores page, text, and embedding, but no author, URL, acquisition date, license, license version, attribution, checksum, or permission evidence (`scripts/ingest.ts:101-121`, `scripts/ingest.ts:133-136`). The `chunks` table likewise has no license or provenance fields beyond `source` and `page` (`lib/db.ts:21-23`).
- **FACT:** `data/mcat.db`, `pdfs/`, and `resources/` are deliberately ignored (`.gitignore:44-54`). None of those paths, and no corpus manifest, exists in this worktree. Git history also records the PDF/RAG feature commit (`4a5940446ac6adb6a67b308aace1c8f85bcf84d6`) as having real-PDF embedding acceptance still pending because the study PDFs were not then present; the implementation plan defined that acceptance as conditional on PDFs being supplied (`docs/superpowers/plans/2026-08-09-mcat-study-bot.md:147-166`).
- **FACT:** A later launch-spec preflight reports 7,485 rows in local `data/mcat.db` and says all chunk embeddings had the expected 1,536 dimensions (`feature/multi-user-launch:docs/specs-multiuser/01-auth-tenancy-metering-billing.md:909-921`). It does not list the `source` values or connect any row to a license.
- **FACT:** A separate operational design says the remote prod and demo databases both had empty `chunks` tables (`docs/superpowers/specs/2026-08-10-tuning-loop-and-interfaces-design.md:68-71`). On the repository evidence, the deployed instances were not using the 7,485-row local corpus at that point.
- **FACT:** The committed taxonomy is not Khan-derived. Its metadata identifies AAMC's *What's on the MCAT Exam?* as its source (`data/taxonomy.json:2-8`), and the design spec says a research agent fetched the AAMC outline (`docs/superpowers/specs/2026-08-09-mcat-study-bot-design.md:34-38`).

### What remains unverified

- **ASSUMPTION:** The local 7,485 chunks contain Khan Academy text, the 300-page P/S document, MileDown, OpenStax, NBME, or UW material. The launch master spec asserts that mix (`feature/multi-user-launch:docs/specs-multiuser/00-launch-master-spec.md:39-46`), but this worktree has no source inventory with which to verify it.
- **ASSUMPTION:** A file described as “OpenStax” is commercially reusable. License terms vary by title and version. For example, the current official pages label *Psychology 2e*, *Biology 2e*, and *Chemistry 2e* CC BY-NC-SA, while an older first-edition *Psychology* page says CC BY. Each exact asset and revision must be checked; “OpenStax” is not a sufficient license record. See [OpenStax Psychology 2e](https://openstax.org/books/psychology-2e/pages/preface) and [OpenStax Psychology, first edition](https://openstax.org/books/psychology/pages/2-introduction).
- **ASSUMPTION:** Community material that was freely posted was licensed for commercial reuse. Free access is not commercial permission, and the repo's own survey limits its “safe to index” conclusion to personal use (`docs/research/free-resources.md:47-59`).

### Premise verdict

**FACT:** “The corpus is Khan Academy-derived” is **not verified** by the available artifacts.

**FACT:** “There is a 7,485-row local corpus proposed for migration with no adequate provenance record” **is verified by the launch spec and schema**.

**CONCLUSION:** The named-Khan premise is unproven, but the commercial-launch risk remains because unknown provenance is itself disqualifying for migration into a paid product.

## 2. What the app actually redistributes or transmits

The three possible uses are materially different. The labels below separate observable behavior from legal conclusions.

### A. Shipping source text to users

- **FACT:** `searchMaterials` loads `source`, `page`, and full `text` from every chunk and returns the top matches with the text intact (`lib/rag.ts:85-98`).
- **FACT:** The voice agent has a `search_materials` tool explicitly described as searching indexed study materials (`lib/tools.ts:174-186`). Its result is returned by the server (`lib/tools.ts:355-359`; `app/api/tool/route.ts:12-20`), sent as a `function_call_output` to the Realtime model (`app/page.tsx:336-348`, `app/page.tsx:376-387`; `lib/realtime-client.ts:214-232`), and can then inform the model's spoken or displayed response.
- **FACT:** The current examiner instructions do not require `search_materials`; they require `generate_question` for multiple-choice questions (`lib/instructions.ts:7-11`). Therefore raw chunk retrieval is possible, but not mandatory in every session.
- **LEGAL INTERPRETATION:** Returning a chunk verbatim to a user is the clearest reproduction/distribution risk. Sending it first to the Realtime provider rather than directly rendering it does not make the source text disappear; whether a particular transient transmission or model-mediated answer is legally a public “Share,” a reproduction, or covered by an exception requires counsel.

### B. Grounding generated questions through RAG

- **FACT:** If the voice agent sets `useGrounding`, the app retrieves the top three chunks, strips their source/page metadata, concatenates their full text, and passes that text into the question generator (`lib/tools.ts:326-351`).
- **FACT:** The generator tells the model to “ground the question in this text” and includes the source text in its prompt (`lib/questions.ts:36-64`). The generated passage, question, answers, rationales, and explanation are then returned to the voice agent (`lib/questions.ts:106-149`, `lib/tools.ts:344-352`).
- **FACT:** Grounding is optional. `useGrounding` is not a required tool argument (`lib/tools.ts:153-171`), and without it the generator uses category name and topic strings only (`lib/tools.ts:326-350`).
- **LEGAL INTERPRETATION:** RAG is not a reliable licensing workaround. A generated question may contain no protectable expression from the source, may paraphrase it closely, or may reproduce it. Whether a particular output is an adaptation or infringement is fact-specific. Counsel must review the intended workflow and representative outputs; product policy should not assume “model-generated” means commercially clear.

### C. Using material only to seed a taxonomy

- **FACT:** The taxonomy is a separate committed JSON artifact sourced from AAMC, not from the chunk store (`data/taxonomy.json:2-13`). It contains category codes plus copied section names, foundational-concept sentences, category descriptions, topic selections, and skill labels—for example `4A` and its descriptive text (`data/taxonomy.json:14-29`) and the SIRS labels (`data/taxonomy.json:444-460`).
- **FACT:** The question generator can operate from the taxonomy alone: it reads category `name` and `topics`, and fetches chunks only when grounding is requested (`lib/tools.ts:326-350`). Thus the application can ship and generate questions with an empty `chunks` table.
- **LEGAL INTERPRETATION:** Scientific facts, concepts, systems, identifiers, and short phrases generally receive less or no copyright protection, while the author's particular expression and potentially creative selection/arrangement can. The U.S. Copyright Office summarizes the distinction: copyright does not protect facts, ideas, systems, or methods, but may protect how they are expressed ([Copyright Office FAQ](https://www.copyright.gov/help/faq/faq-general.html)).
- **LEGAL INTERPRETATION:** Keeping only necessary category identifiers and independently written minimal topic labels is materially lower risk than copying the AAMC outline's explanatory prose and full arrangement. It is not possible from repository inspection alone to declare the present taxonomy commercially safe. Counsel should review the cleaned taxonomy, the AAMC terms, and trademark/branding use. The AAMC describes its outline as a framework of foundational concepts, content categories, and skills ([AAMC outline page](https://students-residents.aamc.org/prepare-mcat-exam/whats-mcat-exam-pdf-outline)); that public availability is not itself an open license.

## 3. The license rule that matters if Khan content is present

- **FACT (external license text):** CC BY-NC-SA 4.0, Section 2(a)(1)(A), grants permission to **“reproduce and Share the Licensed Material, in whole or in part, for NonCommercial purposes only.”** The license defines NonCommercial by reference to whether the use is primarily intended for commercial advantage or monetary compensation. See the [CC BY-NC-SA 4.0 Legal Code](https://creativecommons.org/licenses/by-nc-sa/4.0/legalcode.en).
- **FACT (current Khan terms):** Khan Academy's current terms say CC references mean CC BY-NC-SA 4.0 unless an item says otherwise, restrict educational content to personal non-commercial use, identify fee-connected access as commercial, and require written agreement for commercial use. They also contain restrictions on scraping and use of site content in AI/ML development. See [Khan Academy Terms of Service](https://www.khanacademy.org/about/docs/khan-academy-terms-of-service) and its [reuse guidance](https://support.khanacademy.org/hc/en-us/articles/202262954-Can-I-use-Khan-Academy-s-videos-name-materials-links-in-my-project).
- **LEGAL INTERPRETATION:** If Khan text or a Khan-derived document is among the chunks, using those chunks to enhance a paid MCAT service is likely outside the ordinary NC grant. The exact acquisition date, item-level license, contract terms accepted at acquisition, nature of the output, and any copyright exception still matter. A lawyer should make the final determination; the operational decision should be to exclude the material unless written commercial permission is documented.

## 4. Options and tradeoffs

The table's descriptions and tradeoffs are **ANALYSIS**; its final column is **RECOMMENDATION**. Any legal outcome mentioned remains a **LEGAL INTERPRETATION** requiring counsel, not a fact established by this repo.

| Option | What it means | Advantages | Costs and risks | Decision view |
|---|---|---|---|---|
| **Replace with permissively licensed or public-domain material** | Build an allowlisted corpus from exact editions whose terms permit commercial reuse and RAG transmission; retain license text, source URL, revision, attribution, checksum, and exceptions per item. | Preserves grounded generation; auditable; can grow incrementally. | Research and curation burden; licenses can differ by edition and embedded figure; “open” does not always mean commercial or AI-ingestion permission. Current OpenStax 2e examples show why title/version checks are essential. | **Good medium-term path**, provided each asset passes source-level review. Prefer CC0/public domain/CC BY over NC/SA sources. |
| **Use AAMC content categories only** | Retain minimal category codes and independently authored topic labels; remove copied explanatory sentences and unnecessary outline wording. Do not ingest AAMC questions, passages, explanations, or the outline as corpus text. | Keeps exam alignment with little content surface; already sufficient for ungrounded generation. | The current JSON contains more than bare facts/codes; line-drawing and AAMC trademark/terms questions remain. | **Recommended as the launch taxonomy**, after a clean rewrite and lawyer review. |
| **License content commercially** | Obtain written commercial/RAG rights from Khan Academy, community authors, publishers, or a commercial MCAT content supplier. | Could retain high-value curated material and reduce authoring time. | Negotiation time, fees, scope limits, attribution, audit duties, and possible refusal. Community compilations may require permissions from multiple upstream owners. | **Pursue only for uniquely valuable sources**, not as a launch dependency. |
| **Offer a non-commercial tier** | Keep restricted corpus in a separate free or personal/self-hosted mode; paid mode never accesses it. | Preserves personal-study utility; creates a clean technical boundary if truly separate. | A free tier can still support commercial advantage or funnel paid conversions; Khan's current guidance expressly rejects incorporation into a paid offering. Requires separate storage, credentials, routes, telemetry, and marketing. | **Not a safe shortcut.** Personal self-hosted use may be viable; any company-operated free tier needs counsel and likely permission. |
| **Generate a clean original corpus** | Subject-matter experts write explanations, examples, and question-grounding notes from unprotectable scientific facts and independently selected references; keep author assignments, drafts, sources, similarity checks, and review records. | Strong control, product-specific depth, defensible provenance, no dependence on a single publisher. | Slow and expensive; quality assurance is critical; model assistance can reproduce source language and does not automatically create clear ownership. | **Best long-term differentiator**, built in reviewed modules after launch. |
| **Ship with no corpus** | Migrate no `chunks`; disable `search_materials` and production grounding; generate from the cleaned taxonomy and model knowledge. | Fastest, lowest content-license exposure, and consistent with the documented empty deployed chunk stores. Core question generation already supports it. | Less factual grounding; potentially more hallucination and variable coverage; needs evaluation, refusal behavior, and expert spot checks. | **Recommended for launch.** It removes the corpus migration blocker without pretending the corpus is cleared. |

## 5. Recommended path and why

### Launch gate

1. **RECOMMENDATION:** Do not copy any of the 7,485 local rows into the commercial database. Treat the source database and files as quarantined personal-use material until audited.
2. **RECOMMENDATION:** In paid production, keep `chunks` empty, do not expose `search_materials`, and do not permit `useGrounding=true`. This is a product rule, not merely a UI convention.
3. **RECOMMENDATION:** Replace the committed taxonomy's copied AAMC sentences and descriptions with a minimal, independently worded scaffold. Preserve only identifiers and factual/topic labels that are necessary for product operation. Have copyright/trademark counsel review the result.
4. **RECOMMENDATION:** Validate ungrounded question quality before launch with a representative category matrix, expert review, similarity checks against known prep questions, and a rule that uncertain factual claims are not presented as authoritative.

### Parallel corpus work

5. **RECOMMENDATION:** Run a source inventory where the ignored local database and original files actually reside. Export at minimum distinct `source`, chunk count, page range, and a checksum; map every source to an original file and acquisition record. Do not infer rights from a filename.
6. **RECOMMENDATION:** Create an admission record for each future source: owner/author, exact title and edition, canonical URL, acquisition date and method, license name/version, commercial-use permission, AI/RAG permission, attribution text, excluded components, checksum, reviewer, and counsel decision where needed.
7. **RECOMMENDATION:** Admit sources one at a time to a fresh commercial corpus. Never “clean” the existing database by deleting only obvious Khan filenames; absent a complete manifest, that would leave unknown material behind.
8. **RECOMMENDATION:** Build the durable corpus from either verified CC0/public-domain/CC BY assets or commissioned original modules. Re-run legal and quality review when a source edition or website terms change.

### Why this recommendation is supported

- **FACT:** The paid launch does not technically require chunks; grounding is optional and the generator already works from taxonomy fields (`lib/tools.ts:326-350`).
- **FACT:** The deployed databases were documented as having empty chunk stores, so no-corpus operation matches observed deployment state rather than inventing a new mode (`docs/superpowers/specs/2026-08-10-tuning-loop-and-interfaces-design.md:68-71`).
- **FACT:** The current corpus lacks a repository-visible manifest and the schema cannot carry adequate license evidence (`lib/db.ts:21-23`; `scripts/ingest.ts:63-70`).
- **LEGAL INTERPRETATION:** Unknown provenance is not cured by RAG, by hiding source text behind a model, or by calling the output “generated.” Excluding the corpus is the only launch option here that does not depend on an unverified legal premise.

## 6. Decision record

**Recommended decision:** Proceed with the paid multi-user launch on a no-corpus architecture; clean and review the taxonomy; quarantine the 7,485-row personal corpus; build a new allowlisted/original corpus after launch.

**Blocker status:**

- **Current local corpus migration:** **BLOCKED** pending source inventory, rights evidence, and counsel review.
- **Paid multi-user launch without corpus:** **NOT BLOCKED** by the corpus issue, subject to taxonomy cleanup/review and quality validation of ungrounded questions.
- **Claim that Khan Academy specifically caused the blocker:** **NOT ESTABLISHED** from the available repository evidence.

**Lawyer checkpoint:** Before any corpus row enters the paid service, counsel should approve the source-level rights record, RAG/provider transmission, output policy, required attribution, and the cleaned AAMC taxonomy/branding posture.
