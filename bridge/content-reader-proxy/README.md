# Existing Content Reader proxy

Recovered verbatim from Vercel deployment `dpl_CDpKrjUZBtNSG8ubCz4kvbYPDPu9` on 2026-10-14 (Asia/Shanghai). Existing project: `prj_Qc7PDKAPyOc2l68jSm7NoZajYOXK`, team: `team_ycnNdyU7i77RkROrgI8GtooX`.

The only runtime change replaces the deleted deployment hostname with the existing `codex/a2a-control-loop` Preview branch alias. The old URL returns HTTP 410 GONE even though the alias metadata points to a READY deployment; the branch alias returns the actual Preview health JSON. Authentication, OIDC identity, fixed acquisition path, method restrictions and size/time bounds are preserved.

Deploy this directory only to the existing proxy project, production environment. Do not deploy the main backend to production. Secrets remain in the existing Vercel project. Run `node --test test/proxy.test.js` before deployment.
