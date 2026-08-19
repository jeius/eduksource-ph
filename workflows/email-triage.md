# Workflow: Email Triage

**Status:** specified — ready for implementation
**Date:** 2026-08-19

## Loop

Process the editor's Gmail main inbox on a rolling basis. Each new message is classified, and most are handled without the editor: FAQs auto-answer, notifications log, spam files itself. Only support/refund requests and low-confidence messages reach the editor, as drafted replies in the admin checkpoint. Runs every few minutes.

## Trigger

**Event-ish poll:** every 5 minutes (configurable) on the Gmail main inbox via Gmail API OAuth (read). No webhook setup.

## Roles

- **Workflow** — reads, classifies, auto-answers, drafts, files.
- **Editor** — reviews only the flagged messages via the admin checkpoint, edits or sends.

## Scope

- Gmail is **read-only** for the workflow. All outgoing mail goes through **Resend from a verified domain** (default `@eduksource.ph`), not the Gmail identity.
- Checkpoint surface is the same admin review surface used by `material-pipeline`.

## Steps

1. **Fetch.** Pull new/unread messages from the Gmail main inbox (OAuth read scope).
2. **Classify.** Each message gets a category and a confidence score:
   - FAQ / order question
   - Support / refund request
   - Order / fulfillment notification
   - Spam
3. **Route per category:**
   - **Spam** → auto-file (apply a label), no reply.
   - **Order / fulfillment notification** → log only via `@eduksource/logger`, no reply.
   - **FAQ / order question** with confidence above threshold → auto-reply immediately via Resend (from the verified domain, signed as the brand), one or two lines, drawn from the FAQ config.
   - **Support / refund request** OR confidence below threshold → hold for the checkpoint.
4. **Checkpoint (admin UI).** Flagged messages appear with thread context and a drafted reply (generated from the message). The editor edits, sends, or handles manually. Sending uses the same Resend path.
5. **Done** when every new message is answered, logged, filed, or routed.

## Checkpoint brief (admin UI)

A list of flagged conversations. Each row shows:

- Sender, subject, time, thread excerpt
- Category + confidence
- A drafted reply, editable inline
- Send / skip buttons

Speed of review is imperative: a row is decidable in seconds.

## Config

- Gmail OAuth credentials (read scope only).
- Resend API key + verified sender domain.
- FAQ answer templates (short, 1-2 lines).
- Confidence threshold gating auto-reply.
- Poll interval (default 5 min).
- Spam label name.

## Error handling

- Gmail fetch failure → log, alert via admin checkpoint, retry next poll.
- Auto-reply send failure → log, hold the message for the checkpoint so it is not silently dropped. Never send a reply twice for the same message.

## References

- `packages/email` (planned Resend templates), `packages/logger`.
- `workflows/material-pipeline.md` (shared admin checkpoint surface).