# Audit Checklist for EdukSource

Audit this repo against our project documentation. Do not make any changes —
this is a read-only assessment.

1. Read PROJECT_PLAN.md, AGENTS.md, and every file in /docs/adr/ first.
   Build a mental model of the intended architecture, tech stack, monorepo
   layout, and roadmap phase checklists before looking at any code.

2. Walk the actual repo (apps/, packages/, config files, package.json
   dependencies) and compare it against what the docs describe. For each
   app (store, admin, api, studio, docs) and each shared package, check:
   - Does it exist yet, and if so, does its structure match §5 (Monorepo
     Layout) in PROJECT_PLAN.md?
   - Does the tech stack actually in use match §4 (Tech Stack) — same
     frameworks, same libraries, not silently swapped for something else?
   - Are the "hard boundaries" in AGENTS.md actually being respected in
     code right now (e.g. does `studio` import `packages/db` anywhere?
     does anything call an R2 URL that isn't signed/expiring? is the
     provider registry in studio/src/lib/ai actually being used, or is
     there a hardcoded AI client call somewhere)?
   - For each ADR (0001–0005), does the current code align with its
     Decision section? Flag anything that contradicts one, even partially.

3. Cross-check against the roadmap in PROJECT_PLAN.md §11. For each phase:
   - Which checklist items are actually done based on real code, not just
     marked done in the doc?
   - Is there anything built that isn't on the roadmap at all (scope creep,
     or work that should be reflected back into the plan)?
   - Is anything marked done in the plan that doesn't match what's in the
     repo (stale checkboxes)?

4. Report back in three buckets, being specific (file paths, not vague
   impressions):
   - ALIGNED — matches the plan, no action needed
   - DRIFTED — exists, but diverges from what the docs say (explain the
     gap and whether the code or the doc is more likely to be "right")
   - MISSING — planned but not built yet, mapped to its roadmap phase

Don't propose fixes yet unless I ask — I want the gap report first so I can
decide what's actually worth fixing vs. what's just the plan being ahead of
the code.
