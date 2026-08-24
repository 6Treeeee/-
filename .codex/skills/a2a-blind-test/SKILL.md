---
name: a2a-blind-test
description: Design and verify real-world blind tests without fixtures, caches, snapshots, manual answers, or sample-specific logic.
---

# A2A Blind Test

Classify every sample as `KNOWN_SAMPLE` or `BLIND_SAMPLE` before interpreting results. A blind sample must not have supplied production logic, fixtures, expected output, or a prior cached artifact.

For a blind run:

- record sample identity, selection source, tested revision, deployment or runtime, and collection time;
- exercise the real input path and record live provenance sufficient to distinguish it from a fixture or cache;
- apply the acceptance oracle to observable output, not to an agent's narrative;
- inspect the diff and configured data sources for sample IDs, copied text, snapshots, or fallback artifacts;
- retain failures as evidence rather than replacing them with manual results.

When applicable, verify full output, non-empty content, ordering or monotonic timestamps, and the declared processing method. Do not infer body content from titles or metadata.

Return `real_world_test` with sample class, provenance, contamination checks, criterion results, and `pass`, `fail`, or `not_proven`.
