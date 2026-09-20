# Tree Brain private ChatGPT entry

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
