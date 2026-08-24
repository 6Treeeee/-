---
name: a2a-research
description: Find a shorter, safer, or cheaper technical path when repeated failures or external dependencies make the current route doubtful.
---

# A2A Research

Run only when requested by the decision agent or when stop-loss evidence shows repeated failure, an external dependency problem, or a materially simpler alternative.

Use current primary sources: official documentation, specifications, repositories, releases, and licenses. For each viable option record:

- what it solves and what it does not solve;
- maintenance signal and license;
- credentials, infrastructure, recurring cost, and migration burden;
- the smallest proof of concept that tests its critical assumption.

Prefer a bounded experiment over a framework migration. Compare no more alternatives than needed to make the route decision.

Return a short recommendation with `CONTINUE` or `CHANGE_PATH`, evidence links, and a pass/fail proof-of-concept plan. Do not turn research into implementation or a long survey.
