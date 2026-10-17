# Tree Brain private ChatGPT entry

## 2026-10-18 current recovery checkpoint

Owner explicitly approved the 24-hour renewal and same-code Production release. Existing token/workspace/read+check scopes are preserved; expiry is 2026-10-18T21:54:17+08:00. Production now uses READY dpl_CZcqr62yYs7R3zN2v7BfQEBLYHNg, rebuilt from original dpl_BrtVwjcUrEQtoaJTYgxsQjQ7zsJq at the same source commit 5dccd27c7668250574b3122b8c260bbecf031edc. Preview alias remains on dpl_7CmSsArRnzMgyAf4uRnxkvWGAArE. Authenticated initialize and real execution-host connection tools pass; anonymous initialize still returns 401.

Ordinary native ChatGPT's existing Tree chat still returns TREE_BRAIN_CODEX_TOOL_NOT_AVAILABLE after explicit plugin selection. Execution-host task_status independently returns A2A_WORKFLOW_HOOK_NOT_READY. Neither historical mirrors nor run metadata establish current task/thread state. Existing index run/hook metadata exists, while an independent local by-token SDK lookup returns 403; the Production internal cause remains unproven. Do not reset the index or infer missing/expired data.

The existing tunnel runtime is running once, with loopback health/readiness HTTP 200 and a retained initial 2-second MCP probe timeout warning; this is not hosted client acceptance. Owner reports that the web custom-MCP form has Tunnel, but only that the tunnel is absent from the list: the known ID has not been entered. No permission denial is proven. Browser bootstrap now fails on missing browser/26.1013.40934/scripts/browser-service.mjs, so the external form has not been observed. Owner asks the agent to inspect it; obtain a screenshot or restore the supported browser entry instead of asking Owner to diagnose technical options.

Evidence: artifacts/tree-master-execution-2026-10-15/ordinary-chatgpt/brain-approved-renewal-verification.json and workflow-index-read-diagnostics.json. Goal B remains PASS and frozen. Earlier checkpoints below are history, including the now-resolved old grant-expiry/401 blocker.


## 2026-10-17 live acceptance checkpoint

Ordinary native ChatGPT still returns TREE_BRAIN_CODEX_TOOL_NOT_AVAILABLE after explicitly selecting Tree Brain Codex. The actual get_connection_status/task_status/task_start/task_resume tools are NOT_EXPOSED; task/thread/status/remaining_steps remain NOT_READ. No task was started or resumed, and no mirror was used as live state.

A separate local configuration fault was corrected: the disabled generic codex mcp-server entry was privately backed up, then replaced only within the existing tree_brain_codex entry with the installed plugin's existing HTTPS URL, header helper and tool allowlist. Approval remains prompt and all other settings are unchanged; CLI parsing and native MCP settings readback pass. This local repair does not register a hosted ChatGPT plugin.

An authenticated initialize against the existing service returns HTTP 401 / TREE_BRAIN_UNAUTHORIZED. The existing local content-reader read/check grant metadata expired 2026-09-14T14:45:50Z; remote sensitive grant contents were not read, so expiry is not claimed as the only cause. No grant renewal/rotation, Production deployment, OAuth or tunnel change was made. Account-side re-authorization/reconnection is required before live task acceptance can continue.

Evidence: artifacts/tree-master-execution-2026-10-15/ordinary-chatgpt/brain-existing-connection-correction.json and brain-after-config-probe-response.md. Goal B independently passed three consecutive fresh native ordinary-chat full OCR deliveries; it does not imply Goal A PASS. The following sections retain historical setup context.


Reviewed 2026-09-21. Engineering preparation only; ordinary ChatGPT acceptance is **NOT VERIFIED**.
Continue from `31d425b709ab329c994b451f23c434be3b5918f9` on `codex/a2a-control-loop`.
The accepted backend, worker, deployment and original-thread recovery baseline is unchanged.

## Current evidence and route

The 2026-09-20 authenticated browser inspection showed a Plus account with Developer Mode
already enabled. The hosted installed-plugin list did not include Tree Brain Codex.
The new-app form offered OAuth, None and Mixed, not a static Bearer input. The existing
public MCP URL did not discover OAuth authorization/token endpoints or DCR/CIMD support.
This is separate from the installed local Codex plugin and its Windows header helper.

The account already has private tunnel `tunnel_6aa97a833a7481919834581673d9f199`, named
`tree-brain-codex-content-reader`, associated with the personal organization and ChatGPT
workspace. Reuse it; do not create a replacement tunnel, worker, service or Codex task.
The tunnel runtime can supply origin-scoped authentication headers to the existing MCP.
That preserves its expiry, token digest, workspace restriction and tool/scope checks.
It does not establish end-user OAuth and is not a public or multi-user distribution design.

The current blocker is the missing locally provisioned **OpenAI Platform runtime API key**.
A masked key in Platform cannot be recovered from its list view. Plus login is not this key.
Do not infer a billing requirement from Platform's generic Add credits banner.

## Official requirements

- [Developer Mode](https://developers.openai.com/api/docs/guides/developer-mode) currently
  lists Plus and Pro as eligible and describes read/write MCP. The
  [Help Center](https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt)
  has given more restrictive plan language. Do not resolve this conflict by demanding an
  upgrade: inspect the account and record actual tool discovery/call results.
- [OAuth authentication](https://developers.openai.com/plugins/build/auth) requires a real
  authorization server, discovery metadata, supported client registration, PKCE, resource
  targeting and token validation. OAuth client ID/secret fields are not static Bearer fields.
- [Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)
  supports private Developer Mode connections, requires a runtime API key and Tunnels
  Read + Use, and must be associated with the intended organization/workspace.
- [Connect and test](https://developers.openai.com/plugins/deploy/connect-chatgpt) requires
  checking discovered metadata and testing real conversations. A local package, HTTP 200,
  successful tunnel poll, or tool list alone is not final acceptance.

## Windows setup (existing private tunnel)

Use a trusted PowerShell on the owner's Windows account. Keep secrets outside this repo.

```powershell
# Interactive hidden input; current-user DPAPI; refuses to overwrite a saved key.
& .\scripts\chatgpt-entry\save-runtime-key.ps1

# Existing downloaded runtime; this path is specific to the owner machine.
$runtime = 'C:\Users\Administrator\Documents\Codex\2026-09-13\tree-brain-codex-plugin-tree-brain\work\tunnel-client-v0.0.14\tunnel-client-runtime.exe'
& .\scripts\chatgpt-entry\start-existing-tunnel.ps1 -RuntimePath $runtime -Check
& .\scripts\chatgpt-entry\start-existing-tunnel.ps1 -RuntimePath $runtime
```

The key file defaults to `~/.codex/tree-brain/credentials/tunnel-control-plane-key.dpapi`.
The upstream header helper defaults to `~/plugins/tree-brain-codex/scripts/auth-headers.ps1`.
No key is accepted as a command-line argument or emitted by the launcher. Child process
environment supplies the control-plane key and existing upstream Bearer. The parent
environment is restored even after failure. Runtime logging stays at warn, without raw HTTP.
The health listener binds only to loopback. A detected existing runtime prevents a duplicate.
The precheck checks file presence only, not key validity, grant expiry, connectivity or readiness.

This launcher targets the installed **tunnel-client-runtime v0.0.14** CLI. Its verified
`run --help` supports the flags used here; it has no `init` or `doctor` command.
Do not blindly apply newer `tunnel-client` examples to this binary.
Keep this foreground process running during discovery and calls; stop it with Ctrl+C.
Do not start a replacement worker or enable automatic startup as part of this task.

In ordinary ChatGPT's existing unsaved app form, select the existing tunnel. For this
private, owner-scoped transport, select no additional app-level OAuth only after confirming
that tunnel access is restricted to the intended organization/workspace and the runtime
still attaches the existing bounded upstream Bearer. This must never turn the public MCP
endpoint anonymous. Let the owner complete any required installation/consent confirmation.
Inspect actual discovery errors before changing anything else.

## Direct public OAuth alternative (not provisioned)

The repository already verifies JWTs as an OAuth resource server; it does not issue them.
Before using the direct HTTPS/OAuth route an owner-controlled identity provider must supply:

1. HTTPS issuer discovery, authorization/token endpoints, JWKS and a client registration
   method ChatGPT actually supports (predefined client, DCR or CIMD), with PKCE and resource support.
2. Exact issuer, JWKS URL, stable owner subject and subject-to-`content-reader` mapping for
   `TREE_BRAIN_OAUTH_ISSUER`, `TREE_BRAIN_OAUTH_JWKS_URL`, `TREE_BRAIN_OAUTH_SUBJECTS_JSON`,
   and the correct `TREE_BRAIN_MCP_URL`.
3. A valid access token with correct issuer/audience/expiry and `treebrain:read` plus
   `treebrain:check` for writes. Refresh support should be configured at the provider for
   persistent access; it cannot be added by fabricating metadata here.

Do not switch production auth modes, invent an issuer, reuse a Vercel OIDC token, or add an
external identity provider before the real owner-controlled provider is available. The
private tunnel avoids this new-provider prerequisite; it does not implement OAuth for it.

## Verification and stopping boundary

```powershell
& .\test\chatgpt-entry.test.ps1
```

This offline test uses disposable encrypted fake credentials and a fake runtime. It checks
missing prerequisites, invalid/decryption-failed keys, helper errors, duplicate process
guard, fixed MCP origin, discovery auth, loopback binding, absence of secrets in arguments,
runtime failure, and restoration of the process environment on success/failure. It does not
call production, start tasks, poll the worker or prove the real tunnel works.

After the credential is provided: start the existing runtime, inspect its real errors,
create/refresh the hosted connection, and require real ordinary ChatGPT tool call receipts.
Call `task_status` first for `content-reader`; preserve the actual returned task/thread.
Only resume an appropriate existing task with `task_resume`. Do not create a substitute
task simply to satisfy a `task_start` checklist; retain that gate as unverified unless an
explicitly authorized genuine start can be tested. Record tool, arguments, returned task_id,
thread_id and errors. Do not launch quota-exhaustion checkpoint features before entry PASS.

If the actual account refuses private write tools after connection, capture that exact
product restriction and request only the necessary account action. Until such a refusal
occurs, do not report Plus as the blocker. The currently required owner action is local
provisioning of the existing tunnel runtime key, not a plan upgrade.
