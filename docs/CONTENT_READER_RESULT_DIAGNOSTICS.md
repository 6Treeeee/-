# Content Reader safe result diagnostics

The acceptance predicates in `src/services/acquisition-result.js` remain unchanged. Rejection now adds `error.details.validation`, covering every applicable predicate (37 for Whisper, 16 for OCR). Each check is a boolean; `failed_checks` lists all rejected conditions rather than the first short-circuit failure.

ASR segment diagnostics contain total violation counts per condition plus at most ten examples with zero-based indices, finite numeric timestamps and fixed condition names. They never contain transcript text, arbitrary input strings, model hashes, credentials or media addresses. Nonfinite numbers become null.

The asynchronous worker computes diagnostics before replacing a rejected candidate. It retains `pass=false` and exit code 2, writes `diagnostics.json` first, then `result.json`. The existing always-run artifact step uploads both. A pre-result acquisition failure has `candidate_available=false` and no invented validation verdict. Original failed transcripts are not persisted by this diagnostics change.

Offline inspection, with no network or acquisition:

```text
node scripts/diagnose-acquisition-result.mjs --input existing-result.zip --output safe-diagnostics.json --request-id 767e9a51-f123-45d0-a232-f45f342faedb --aweme-id 7698100976309275939 --sha256 6a1f99a5dc15490563e2f858c69e47fae5ccf3d064613e189e5a3cf14e053e0c
```

Use an independently verified request/video identity. This command examines the supplied content contract; it does not authenticate GitHub provenance or verify a signed task ticket. It rejects overwriting the input path. A saved safe report is projected onto known schema fields, not echoed wholesale.

Run 40221770611 retained only a 520-byte error-only artifact (12609602790). Its safe summary supports five predicates; the other 32 are unknown. Offline inspection reports `unavailable_candidate_not_retained`. Full source/media/segment data were discarded, so counts 6060/570 and coverage_end_ms=1006516 cannot identify the exact historical failure. A later rerun cannot retroactively prove the discarded payload's conditions.

Regression checks: each predicate remains fail-closed; simultaneous failures and bounded examples are preserved; privacy sentinels never reach public diagnostics; failure output files retain the safe report. Instrumentation commits use `[skip ci]` to avoid triggering video acquisition merely to publish code.
