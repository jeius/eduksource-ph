# Studio Context

The EdukSource PH AI generation pipeline: Hono on Node, turning a BOW PDF into draft teaching materials. Admin/editor-only, Fly.io.

## Language

**Extraction**:
The structured output of parsing a BOW PDF (objectives JSON).
_Avoid_: parse result, BOW cache entry

**Extraction identity**:
The durable identifier for an extraction — normalized-text hash (ADR-0008) with a catalog safety net; derived inside Studio from markdown/text (currently `unpdf`/`pdfjs-dist`+vision; designed for BOW Parsing `markdown` when parked service revives), then persisted by API as a durable record (ADR-0007). Studio is the sole producer of the hash (Q3).
_Avoid_: cache key, content hash (the hash is the computation, not the concept)

**Provider registry**:
The swappable AI-provider seam at `apps/studio/src/lib/ai/` (ADR-0002). NIM primary, OpenRouter secondary, Opencode tertiary. Provider/model swappable via config.
_Avoid_: AI client, LLM wrapper

**Lesson plan**:
The intermediate artifact that slide content is generated from (ADR-0006). Slides never consume the raw BOW directly.
_Avoid_: lesson, plan

**Task type**:
The per-task model slot: extraction, ocr, lesson-plan, summative-test, image. Each maps to AI_MODEL_* env vars.
_Avoid_: model role

**BOW Document**:
A durable extraction record for a Budget of Work PDF (ADR-0007/0008), owned by the bow-documents module in api. Studio produces the extraction that becomes one.
_Avoid_: extraction record, BOW cache entry

**BOW Parsing** *(parked external context)*:
The `apps/extraction` *design* for parsing a BOW PDF to markdown (docling.rs, Q2=c) — parked 2026-08-22; Studio does not call it, uses in-process `unpdf`/`pdfjs-dist`+vision. See [BOW Parsing Context](../extraction/CONTEXT.md) (parked record).
_Avoid_: extraction service, docling service
