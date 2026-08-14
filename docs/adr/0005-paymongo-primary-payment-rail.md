# ADR-0005: PayMongo as Primary Payment Rail, Stripe as Secondary

**Status:** Accepted
**Date:** 2026-08-14 *(decision predates this ADR — part of the original v1 project plan; documented retroactively)*

## Context

This is a Philippines-first marketplace. The dominant payment methods for the target customers (Filipino teachers) are GCash, Maya, and GrabPay — not international cards. Stripe, while excellent for card payments and international buyers, doesn't natively support these PH mobile wallet methods. PH sellers also need locally-compliant receipts, which a PH-focused processor handles more directly than a global one.

## Decision

Integrate **PayMongo** first (Phase 4 of the roadmap) as the primary checkout path, covering GCash, Maya, GrabPay, and cards, with PH-compliant receipts. Add **Stripe** as a secondary path for international buyers who wouldn't be served by PayMongo's local methods.

## Alternatives Considered

- **Stripe only** — rejected. Poor fit for the dominant local payment methods; would force the majority of the target customer base into a card-only checkout, which is a real conversion-rate risk for a PH teacher audience.
- **Xendit** (another PH-friendly processor) — not deeply evaluated; PayMongo was chosen without a formal head-to-head comparison. Worth a quick sanity-check before launch if PayMongo's rates or reliability become a concern, but not blocking.
- **PayPal** — rejected. Higher friction and worse UX for peso-denominated transactions in this market compared to GCash/Maya.

## Consequences

**Gets easier:**
- Checkout matches how the target customer actually wants to pay, which matters more for conversion than almost anything else in the storefront.
- PayMongo's PH-compliant receipts reduce the scope of the still-open BIR receipt compliance work (`PROJECT_PLAN.md` §12).

**Gets harder / new obligations:**
- Two payment integrations to build, test, and maintain — two webhook handlers, two sets of failure modes, and revenue reconciliation across both in the admin dashboard.
- Currency handling adds a small amount of complexity once Stripe (USD-likely) sits alongside PayMongo (PHP).
