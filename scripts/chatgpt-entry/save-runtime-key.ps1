[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$credentialDirectory = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.codex\tree-brain\credentials'
$credentialPath = Join-Path $credentialDirectory 'tunnel-control-plane-key.dpapi'
if (Test-Path -LiteralPath $credentialPath) { throw 'TUNNEL_CREDENTIAL_ALREADY_EXISTS' }
Write-Host 'Enter your existing OpenAI Platform runtime API key locally. Do not paste it into chat.'
$credential = Read-Host 'API key (hidden)' -AsSecureString
$plain = $null
try {
    $plain = [System.Net.NetworkCredential]::new('', $credential).Password
    if ($plain -cnotmatch '^sk-[A-Za-z0-9_-]+$') { throw 'TUNNEL_CREDENTIAL_INVALID' }
    New-Item -ItemType Directory -Path $credentialDirectory -Force | Out-Null
    $encrypted = $credential | ConvertFrom-SecureString
    # CreateNew prevents races or accidental replacement of an existing credential.
    $stream = [System.IO.File]::Open($credentialPath, [System.IO.FileMode]::CreateNew)
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($encrypted)
        $stream.Write($bytes, 0, $bytes.Length)
    } finally { $stream.Dispose() }
    Write-Host 'Credential encrypted for this Windows user. No connection has been started.'
} finally {
    $plain = $null
    $credential.Dispose()
}
