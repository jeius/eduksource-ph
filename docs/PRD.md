# EdukSource PH — Product Requirements (PRD)

The product-level source of truth: what is being built, for whom, and what is explicitly out of scope. Architecture lives in `docs/architecture.md`, roadmap in `docs/plan.md`, stack in `docs/tech-stack.md`, status in `docs/progress.md`.

---

## 1. Overview

**Product:** A digital marketplace where the owner sells self-made teaching materials aligned with DepEd's Budget of Work (BOW). Customers browse by grade level / subject / quarter, preview samples, purchase, and download. An admin app manages catalog, orders, and support. A separate internal **Studio** service uses AI to turn a BOW PDF into draft products (lesson plan, slide deck, DOCX, summative/term exam) for an editor to review before listing.

**Apps:**

| App      | Audience                          | Runtime               | Status         |
| -------- | ---------------------------------- | ---------------------- | -------------- |
| `store`  | Public customers                   | Cloudflare Workers/Pages | Planned        |
| `admin`  | Internal admin/editor              | Cloudflare Workers/Pages | Planned        |
| `api`    | Backend for store + admin          | Cloudflare Workers      | Planned        |
| `studio` | Internal admin/editor (via `admin`) | **Node** (separate host) | In progress    |
| `docs`   | Internal, later public             | Cloudflare Workers/Pages | Planned        |

**Working prototype goal:** all four base features functional end-to-end — public storefront, admin dashboard, API, and studio generating real draft products from a BOW PDF that an editor can approve and list.

**Explicitly not in the prototype:** public/self-serve access to Studio. That's a future feature, gated on demand (see §3).

## 2. Product Requirements

### 2.1 Goals

- Sell DepEd BOW-aligned digital teaching materials to Filipino teachers, with local payment methods (GCash/Maya) as the primary checkout path.
- Cut the time to produce a sellable material (lesson plan → deck → doc → exam) using AI, with a human editor as the final gate before anything goes live.
- Ship a working, deployed prototype covering all four base features before investing in polish.

### 2.2 Non-goals (for the prototype)

- Public/self-serve material generation (Studio stays admin/editor-only).
- High-throughput or real-time generation — Studio is a low-frequency internal tool.
- Multi-tenant or white-label support.
- Full BIR receipt automation (flagged, not blocking).

### 2.3 Primary personas

| Persona | Needs |
| ------------------ | ---------------------------------------------------------------------- |
| Shopper (teacher) | Find materials by grade/subject/quarter, preview, pay via GCash/Maya, re-download later |
| Admin/Editor | Upload a BOW PDF, get AI-generated drafts, review/edit, publish, manage orders/coupons/refunds |
| You (owner/dev) | Ship, deploy cheaply, swap AI providers opportunistically, keep the system debuggable solo |

### 2.4 Key non-functional requirements

- **Cost control:** scale-to-zero everywhere possible; AI provider costs must be swappable, not locked in.
- **PH compliance:** Data Privacy Act (RA 10173) — privacy policy + consent handling; BIR-compliant receipts flagged for later.
- **Security:** signed/expiring download URLs only, never public bucket links; admin/editor-only access to Studio for now.
- **Solo-maintainable:** every non-obvious decision gets an ADR; nothing depends on tribal knowledge only you remember today.

## 3. Explicitly Deferred / Not Doing Now

- **Public/self-serve Studio access from `store`** — planned feature, gated on user demand; see `docs/plan.md` Phase 9.
- Cloudflare Workers deployment for `studio` — ruled out due to memory/CPU/native-module constraints.
- Separate Python microservice for PPTX/DOCX generation — no proven benefit at this scale; adds overhead.
- Self-hosted AI inference — not needed unless hosted endpoints become insufficient.
- Full BIR receipt automation — flagged, not blocking the prototype.
- Async job queue for Studio — start synchronous, add only when generation time demands it.
