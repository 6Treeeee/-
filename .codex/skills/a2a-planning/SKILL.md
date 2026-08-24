---
name: a2a-planning
description: Convert an Owner goal into an executable A2A task contract before code or deployment work begins.
---

# A2A Planning

Preserve the Owner's goal; do not replace it with an easier proxy.

Produce a task contract containing:

- `goal`: one outcome statement.
- `acceptance_criteria`: independently observable checks with stable IDs.
- `constraints`: public-access, safety, compatibility, and scope boundaries.
- `budget`: bounded attempts, agent calls, deployments, tokens, and elapsed time where known.
- `stop_conditions`: conditions that require review, path change, or Owner input.
- `allowed_actions` and `forbidden_actions`.
- `known_samples` and `blind_samples`, when real-world behavior is part of acceptance.

Separate build, test, deployment, real-world, and Owner-goal criteria. A successful intermediate stage must not imply a later one.

Resolve ordinary technical choices through a reversible next step. Ask the Owner only for credentials, payment, permissions, manual login, legal boundaries, irreversible actions, or a major product-direction choice.

Do not execute the task. Return the contract plus any explicit assumptions and the first evidence-producing action.
