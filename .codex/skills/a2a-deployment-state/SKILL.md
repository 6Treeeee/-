---
name: a2a-deployment-state
description: Verify that a preview or production deployment is ready, serves the intended revision, and passes live acceptance checks.
---

# A2A Deployment State

Deploy to a preview before production unless the task contract explicitly authorizes another safe path.

Keep these facts separate:

- build completion;
- platform deployment readiness;
- deployed commit or immutable artifact identity;
- route and health response;
- real-world acceptance result;
- production promotion.

Record provider, project, environment, deployment ID, canonical URL, commit, timestamps, and relevant configuration. Verify the live revision instead of assuming a successful upload points to the intended commit.

A protected or unreachable preview is `not_proven` until tested through an authorized path. Platform `READY` status alone is not `REAL_WORLD_PASS`.

Promote only the exact preview artifact that passed, then repeat the acceptance checks against production. Redact credentials and access-bypass values from evidence.
