---
name: a2a-stop-loss
description: Detect unproductive A2A execution loops and force review before more attempts, complexity, or spend are added.
---

# A2A Stop Loss

Evaluate ordered attempts using normalized root cause, blind-test outcome, revision, complexity delta, and cost.

Apply these rules:

1. The same root cause fails twice consecutively: emit `REVIEW_PATH` and prohibit another mechanically equivalent fix.
2. Two consecutive commits do not improve blind-test success: emit `ARCHITECTURE_REVIEW` and pause complexity growth.
3. Code, dependencies, or operational components increase while `OWNER_GOAL_PASS` still fails: lower the route's priority and require a simpler alternative comparison.
4. A clearly simpler route appears: require its smallest proof of concept before more sunk-cost work on the current route.
5. Escalate to the Owner only for credentials, payment, permissions, manual login, legal boundaries, irreversible actions, or major product direction.

Treat failures as the same root cause only when evidence identifies the same failing subsystem and causal mechanism; matching top-level error text alone is insufficient.

Return the triggered rule, supporting attempt IDs, prohibited next action, required review, and remaining budget. A trigger changes control flow; it is not merely a warning.
