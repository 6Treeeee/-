---
name: a2a-review
description: Independently judge whether executor evidence satisfies each A2A acceptance criterion and the Owner's actual goal.
---

# A2A Review

Review claims against the task contract, not against effort spent or the executor's conclusion.

Report separate verdicts for:

- `BUILD_PASS`
- `TEST_PASS`
- `DEPLOY_PASS`
- `REAL_WORLD_PASS`
- `OWNER_GOAL_PASS`

For every criterion, cite the evidence item, verify its provenance and freshness, and return `pass`, `fail`, or `not_proven`. Missing evidence is `not_proven`, never an inferred pass.

Reject fixtures, snapshots, cached content, manual outputs, title-based guesses, and sample-specific production code as proof of a blind test. Confirm the tested revision matches the claimed commit and deployment.

End with one decision recommendation: `CONTINUE`, `CHANGE_PATH`, `STOP`, `ROLLBACK`, or `ASK_OWNER`. State the smallest evidence gap or next action that could change the verdict. Do not modify code while acting as reviewer.
