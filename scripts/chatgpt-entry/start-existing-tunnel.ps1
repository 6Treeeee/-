[CmdletBinding()]
param(
    [string]$RuntimePath,
    [string]$CredentialPath = (Join-Path ([Environment]::GetFolderPath('UserProfile')) '.codex\tree-brain\credentials\tunnel-control-plane-key.dpapi'),
    [string]$HeaderHelperPath = (Join-Path ([Environment]::GetFolderPath('UserProfile')) 'plugins\tree-brain-codex\scripts\auth-headers.ps1'),
    [switch]$Check
)
$ErrorActionPreference = 'Stop'
# This launcher only transports the existing service. It does not start Codex tasks.
$runtimeExists = $RuntimePath -and (Test-Path -LiteralPath $RuntimePath -PathType Leaf)
$keyExists = Test-Path -LiteralPath $CredentialPath -PathType Leaf
$helperExists = Test-Path -LiteralPath $HeaderHelperPath -PathType Leaf
if ($Check) {
    [pscustomobject]@{
        runtime_present = [bool]$runtimeExists
        credential_present = $keyExists
        helper_present = $helperExists
        tunnel_id = 'tunnel_6aa97a833a7481919834581673d9f199'
        remote_mcp = 'https://sigma-silk-88.vercel.app/mcp'
        live_connection = 'NOT_TESTED'
    } | ConvertTo-Json
    return
}
if (-not $keyExists) { throw 'TUNNEL_RUNTIME_KEY_NOT_PROVISIONED' }
if (-not $runtimeExists) { throw 'TUNNEL_RUNTIME_NOT_FOUND' }
if (-not $helperExists) { throw 'TREE_BRAIN_HEADER_HELPER_NOT_FOUND' }
if (Get-Process -Name 'tunnel-client-runtime' -ErrorAction SilentlyContinue) {
    throw 'TUNNEL_RUNTIME_ALREADY_RUNNING'
}

$previousKey = $env:TREE_BRAIN_TUNNEL_CONTROL_KEY
$previousHeader = $env:TREE_BRAIN_TUNNEL_MCP_AUTH
$secureKey = $null
try {
    try {
        $secureKey = (Get-Content -Raw -LiteralPath $CredentialPath).Trim() | ConvertTo-SecureString
        $env:TREE_BRAIN_TUNNEL_CONTROL_KEY = [System.Net.NetworkCredential]::new('', $secureKey).Password
    } catch { throw 'TUNNEL_CREDENTIAL_DECRYPT_FAILED' }
    if ($env:TREE_BRAIN_TUNNEL_CONTROL_KEY -cnotmatch '^sk-[A-Za-z0-9_-]+$') {
        throw 'TUNNEL_CREDENTIAL_INVALID'
    }
    try {
        $headers = (& $HeaderHelperPath | ConvertFrom-Json)
    } catch { throw 'TREE_BRAIN_HEADER_HELPER_FAILED' }
    if ($headers.Authorization -cnotmatch '^Bearer tb_[A-Za-z0-9_-]{43}$') {
        throw 'TREE_BRAIN_HEADER_INVALID'
    }
    $env:TREE_BRAIN_TUNNEL_MCP_AUTH = $headers.Authorization
    # Secrets are inherited only by this process's child, never command-line values.
    # Both discovery and RPC use the existing bounded grant on the fixed MCP origin.
    $runtimeArguments = @(
        'run',
        '--control-plane.api-key', 'env:TREE_BRAIN_TUNNEL_CONTROL_KEY',
        '--control-plane.organization-id', 'org-QZonCtmEv0bjoPdBBrdfwqq2',
        '--control-plane.tunnel-id', 'tunnel_6aa97a833a7481919834581673d9f199',
        '--mcp.server-url', 'url=https://sigma-silk-88.vercel.app/mcp,channel=main',
        '--mcp.extra-headers', 'Authorization: env:TREE_BRAIN_TUNNEL_MCP_AUTH',
        '--mcp.discovery-extra-headers', 'Authorization: env:TREE_BRAIN_TUNNEL_MCP_AUTH',
        '--health.listen-addr', '127.0.0.1:0',
        '--log.level', 'warn'
    )
    $LASTEXITCODE = 0
    & $RuntimePath @runtimeArguments
    if ($LASTEXITCODE -ne 0) { throw "TUNNEL_RUNTIME_EXIT_$LASTEXITCODE" }
} finally {
    $env:TREE_BRAIN_TUNNEL_CONTROL_KEY = $previousKey
    $env:TREE_BRAIN_TUNNEL_MCP_AUTH = $previousHeader
    $headers = $null
    if ($secureKey) { $secureKey.Dispose() }
}
