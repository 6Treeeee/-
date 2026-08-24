---
name: a2a-cost-tracking
description: Track approximate A2A execution cost and complexity so repeated work can trigger budget or stop-loss decisions.
---

# A2A Cost Tracking

Track deltas and cumulative totals for:

- executor attempts and failures;
- consecutive failures with the same root cause;
- known and blind real-world tests;
- planner, executor, reviewer, and research calls;
- input, cached-input, output, and reasoning tokens when reported;
- external API calls and deployments;
- changed lines, dependency count delta, and new operational components.

Use provider-reported usage when available; otherwise label estimates explicitly. Do not reconstruct secrets from logs or store credential-bearing payloads.

Compare totals with the task budget after each attempt. Return `within_budget`, `warning`, or `exhausted`, the dominant cost driver, and the next permitted action. Budget exhaustion or a stop-loss threshold must block another equivalent attempt until a new decision changes the budget or path.
