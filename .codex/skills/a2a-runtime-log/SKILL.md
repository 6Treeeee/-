---
name: a2a-runtime-log
description: Turn bounded runtime logs into redacted, correlated evidence about an A2A attempt's actual failure or success.
---

# A2A Runtime Log

Query the narrowest time window that covers the attempt. Correlate entries by task ID, attempt ID, request ID, deployment ID, commit, and route when available.

Preserve exact timestamps, status codes, error codes, provider stages, retry counts, and terminal outcomes. Redact tokens, cookies, authorization headers, passwords, signed URLs, personal data, and secret-bearing query values.

Separate:

- observed symptom;
- confirmed causal evidence;
- inference that still needs a test;
- unrelated noise.

Compare the current attempt with the previous same-root-cause attempt before recommending another fix. Return a concise evidence object with source, time range, correlation IDs, decisive entries, redactions applied, and root-cause confidence.
