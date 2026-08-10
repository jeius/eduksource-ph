# EdukSource PH — Learning Materials Generator

## Project Plan

**Owner:** EdukSource PH admin/editor team
**Purpose:** Internal, admin-only service that converts a Budget of Work (BOW) PDF into a lesson plan, a slide deck (PPTX), a Word document, and a summative test — for materials sold on the EdukSource PH app.

---

## 1. Goal & scope

**Goal:** Reduce the manual effort of turning a BOW PDF into ready-to-sell learning materials by automating extraction, lesson planning, and document generation using LLM/AI models, with a human (admin/editor) reviewing and approving output before it's published to the app.

**In scope**

- Upload a BOW PDF and extract its structure (objectives, topics, week/quarter breakdown).
- Generate a lesson plan derived from the extracted objectives.
- Generate a PPTX presentation (with images) from the lesson plan.
- Generate a DOCX version of the lesson plan/materials.
- Generate a summative test (questions + answer key) aligned to the objectives.
- Admin/editor-only access — no public or student-facing interface.
- Hook the output (files or signed URLs) into the existing ecommerce app so approved materials can be listed for sale.

**Out of scope (for now)**

- Public/student-facing generation or self-serve tools.
- Real-time or high-throughput usage — this is a low-frequency, internal tool.
- Automated publishing without human review.
- Self-hosted GPU inference (relying on NVIDIA NIM hosted endpoints instead).

---

## 2. Confirmed technical decisions

| Decision         | Choice                                                                                | Why                                                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| API framework    | **Hono.js** on Node (not Cloudflare Workers)                                          | Node runtime needed for PDF/PPTX/DOCX libraries; Workers' 128MB memory cap and CPU time limits are a poor fit for document assembly |
| AI inference     | **NVIDIA NIM** hosted endpoints (build.nvidia.com), OpenAI-compatible API             | No self-hosting/GPU needed; call it like any REST API from Hono                                                                     |
| PDF extraction   | `pdf-parse` / `unpdf`, fallback to a NIM vision-language model for scanned/messy PDFs | Keeps everything in one runtime unless extraction quality demands otherwise                                                         |
| PPTX generation  | `pptxgenjs`                                                                           | Mature, same OOXML ceiling as Python equivalents — no quality/perf reason to split into a separate service                          |
| DOCX generation  | `docx` (npm)                                                                          | Same reasoning as above                                                                                                             |
| Image generation | NIM image/diffusion model                                                             | Keeps the AI vendor consistent                                                                                                      |
| Deployment       | Single Node service, **scale-to-zero** hosting (Fly.io / Cloud Run / Render)          | Usage is low-frequency and internal — avoid paying for an always-on server                                                          |
| Architecture     | **One service**, not split into Node + Python microservices                           | Splitting adds deployment/network overhead with no proven cost, performance, or quality benefit at this usage scale                 |

**Deferred decision:** whether NIM's free tier is appropriate once this is generating materials that are actually sold (vs. prototyping). NVIDIA's terms restrict the free Developer Program tier to prototyping/testing/evaluation, and it's genuinely ambiguous whether low-volume internal generation feeding a commercial product counts as "production" under their definition. **Revisit this before deployment** — confirm current terms directly with NVIDIA, or budget for a paid tier / NVIDIA AI Enterprise trial if needed.

---

## 3. High-level architecture

```
Admin/editor uploads BOW PDF
        │
        ▼
 Hono.js API (Node)
   ├─ PDF extraction route      → pdf-parse/unpdf (+ NIM vision fallback)
   ├─ Lesson plan route         → NIM LLM, reasons over extracted objectives
   ├─ Summative test route      → NIM LLM, structured JSON (questions + key)
   ├─ PPTX generator            → pptxgenjs (+ NIM image gen for visuals)
   └─ DOCX generator            → docx (npm)
        │
        ▼
 Object storage (S3-compatible) → signed URLs
        │
        ▼
 Ecommerce app (EdukSource PH) — admin reviews & lists materials for sale
```

---

## 4. Phases & milestones

### Phase 1 — Prototype (current focus)

- [ ] Set up Hono.js project skeleton (Node runtime)
- [ ] NVIDIA NIM API key + test call (confirm model choice: LLM for reasoning, vision model for extraction fallback, image model for visuals)
- [ ] PDF extraction route: parse a sample BOW PDF, output structured objectives (JSON)
- [ ] Lesson plan generation route: prompt design + structured JSON output from NIM LLM
- [ ] PPTX generation: map lesson plan JSON → slides via pptxgenjs (basic template, no design polish yet)
- [ ] DOCX generation: map lesson plan JSON → Word doc via docx (npm)
- [ ] Summative test generation route: structured question/answer JSON from NIM LLM
- [ ] Manual end-to-end test: one BOW PDF → all four outputs, reviewed by hand for accuracy

**Exit criteria:** a single BOW PDF can be run through the full pipeline locally and produce a usable (if unpolished) lesson plan, deck, doc, and test.

### Phase 2 — Refinement

- [ ] Improve PPTX visual design (templates, consistent styling, better image prompts)
- [ ] Improve DOCX formatting (headers, TOC, consistent styles matching EdukSource branding)
- [ ] Tune summative test quality (difficulty balance, answer key accuracy, question variety)
- [ ] Add basic auth for admin/editor access (this is not public-facing)
- [ ] Add error handling/retries around NIM calls (rate limits, timeouts)
- [ ] Add job-based flow if generation takes long (submit → poll status) rather than blocking requests

**Exit criteria:** output quality is consistently good enough for an editor to review and approve with minor edits, not rewrite from scratch.

### Phase 3 — Pre-deployment

- [ ] **Revisit NIM licensing** — confirm free tier vs. paid tier appropriateness for this use case; verify current terms with NVIDIA
- [ ] Load-test-ish sanity check: confirm 40 RPM (or current NIM rate limit) is enough for realistic editor usage
- [ ] Set up object storage + signed URL delivery
- [ ] Wire output delivery into the ecommerce app's admin flow
- [ ] Choose and configure scale-to-zero hosting for the Hono service
- [ ] Add basic logging/monitoring for failed generations

**Exit criteria:** service is deployed, reachable only by admin/editors, and integrated with the ecommerce app's material-upload flow.

### Phase 4 — Launch & iterate

- [ ] Soft-launch with a small batch of real BOW PDFs
- [ ] Collect editor feedback on output quality and turnaround time
- [ ] Iterate on prompts/templates based on real usage

---

## 5. Open questions / risks

| Risk                                                    | Notes                                                                                                                              |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| NIM free-tier terms ambiguity                           | Their "production use" definition is broad; needs direct confirmation before relying on the free tier for a commercial-output tool |
| NIM free-tier rate limits (~40 RPM)                     | Likely fine for low-frequency internal use, but worth sanity-checking during Phase 3                                               |
| No SLA/uptime guarantee on free tier                    | Acceptable for an internal tool (retry later), not acceptable if this ever becomes real-time/customer-facing                       |
| PDF extraction quality on scanned/irregular BOW formats | May need the NIM vision-model fallback more than expected — validate early in Phase 1                                              |
| Generated content accuracy (curriculum alignment)       | Human review by admin/editors remains mandatory before anything is sold — not a fire-and-forget pipeline                           |

---

## 6. Explicitly deferred / not doing now

- Cloudflare Workers/Pages deployment — ruled out due to memory/CPU/native-module constraints for document generation.
- Separate Python microservice for PPTX/DOCX generation — no proven output-quality or performance benefit at this scale; adds operational overhead.
- Self-hosted NIM containers — not needed unless/until hosted endpoints become insufficient.
