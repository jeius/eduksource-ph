# ADR-0007: BOW Extractions Durable, Content-Hash Keyed

> **Moved to `apps/studio/docs/adr/0007-bow-extractions-durable-content-hash.md`.** This stub preserves bare-number lookup.

BOW extractions are durable, api-owned records keyed by content hash. Studio owns the identity computation (producer); api persists it (consumer). Check before changing studio's extraction identity/persistence or `bow_documents`.
