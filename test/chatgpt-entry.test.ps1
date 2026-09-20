$ErrorActionPreference = 'Stop'
$launcher = Join-Path $PSScriptRoot '..\scripts\chatgpt-entry\start-existing-tunnel.ps1'
$testDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ('tree-brain-entry-test-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $testDirectory | Out-Null
$keyFile = Join-Path $testDirectory 'key.dpapi'
$helper = Join-Path $testDirectory 'headers.ps1'
$runtime = Join-Path $testDirectory 'runtime.ps1'
$oldKey = $env:TREE_BRAIN_TUNNEL_CONTROL_KEY
$oldHeader = $env:TREE_BRAIN_TUNNEL_MCP_AUTH
function Assert-Equal($actual, $expected, $label) {
    if ($actual -cne $expected) { throw "Assertion failed: $label" }
}
function Assert-Failure($expected) {
    $caught = $null
    try { & $launcher -RuntimePath $runtime -CredentialPath $keyFile -HeaderHelperPath $helper | Out-Null }
    catch { $caught = $_.Exception.Message }
    Assert-Equal $caught $expected "expected $expected; got $caught"
}
try {
    $env:TREE_BRAIN_TUNNEL_CONTROL_KEY = 'previous-key'
    $env:TREE_BRAIN_TUNNEL_MCP_AUTH = 'previous-header'
    $check = & $launcher -Check -RuntimePath $runtime -CredentialPath $keyFile -HeaderHelperPath $helper | ConvertFrom-Json
    Assert-Equal $check.credential_present $false 'check does not provision credentials'
    Assert-Equal $check.live_connection 'NOT_TESTED' 'offline check cannot claim live PASS'
    Assert-Failure 'TUNNEL_RUNTIME_KEY_NOT_PROVISIONED'
    ConvertTo-SecureString 'sk-fixture-only' -AsPlainText -Force | ConvertFrom-SecureString | Set-Content $keyFile
    Assert-Failure 'TUNNEL_RUNTIME_NOT_FOUND'
    @'
if ($args -contains 'sk-fixture-only' -or (($args -join ' ') -match 'Bearer tb_')) { throw 'Secret in arguments' }
if ($env:TREE_BRAIN_TUNNEL_CONTROL_KEY -cne 'sk-fixture-only') { throw 'Missing inherited key' }
if ($env:TREE_BRAIN_TUNNEL_MCP_AUTH -cne ('Bearer tb_' + ('A' * 43))) { throw 'Missing MCP header' }
if ($args -notcontains 'url=https://sigma-silk-88.vercel.app/mcp,channel=main') { throw 'Wrong origin' }
if ($args -notcontains '--mcp.discovery-extra-headers') { throw 'Missing discovery auth' }
if ($args -notcontains '127.0.0.1:0') { throw 'Exposed health endpoint' }
# Simulate the native process exit code in the launcher's scope.
Set-Variable -Name LASTEXITCODE -Value 23 -Scope 1
'@ | Set-Content $runtime
    Assert-Failure 'TREE_BRAIN_HEADER_HELPER_NOT_FOUND'
    "throw 'fixture secret must not appear in the surfaced error'" | Set-Content $helper
    Assert-Failure 'TREE_BRAIN_HEADER_HELPER_FAILED'
    "'{}'" | Set-Content $helper
    Assert-Failure 'TREE_BRAIN_HEADER_INVALID'
    "@{ Authorization = 'Bearer tb_' + ('A' * 43) } | ConvertTo-Json" | Set-Content $helper
    Assert-Failure 'TUNNEL_RUNTIME_EXIT_23'
    Assert-Equal $env:TREE_BRAIN_TUNNEL_CONTROL_KEY 'previous-key' 'key restored after runtime failure'
    Assert-Equal $env:TREE_BRAIN_TUNNEL_MCP_AUTH 'previous-header' 'header restored after runtime failure'
    (Get-Content -Raw $runtime).Replace('-Value 23', '-Value 0') | Set-Content $runtime
    & $launcher -RuntimePath $runtime -CredentialPath $keyFile -HeaderHelperPath $helper
    Assert-Equal $env:TREE_BRAIN_TUNNEL_CONTROL_KEY 'previous-key' 'key restored after success'
    Assert-Equal $env:TREE_BRAIN_TUNNEL_MCP_AUTH 'previous-header' 'header restored after success'
    function Get-Process { param($Name, $ErrorAction) [pscustomobject]@{ Id = 1 } }
    Assert-Failure 'TUNNEL_RUNTIME_ALREADY_RUNNING'
    Remove-Item Function:\Get-Process
    'not encrypted' | Set-Content $keyFile
    Assert-Failure 'TUNNEL_CREDENTIAL_DECRYPT_FAILED'
    ConvertTo-SecureString 'wrong-format' -AsPlainText -Force | ConvertFrom-SecureString | Set-Content $keyFile
    Assert-Failure 'TUNNEL_CREDENTIAL_INVALID'
    Assert-Equal $env:TREE_BRAIN_TUNNEL_CONTROL_KEY 'previous-key' 'key restored after invalid credential'
    Write-Output 'PASS: offline checks, missing files, DPAPI failures, helper failures, fixed origin, secret handling, runtime failure, environment cleanup.'
} finally {
    $env:TREE_BRAIN_TUNNEL_CONTROL_KEY = $oldKey
    $env:TREE_BRAIN_TUNNEL_MCP_AUTH = $oldHeader
    # Delete only individually created fixture files; no recursive deletion.
    foreach ($file in @($keyFile, $helper, $runtime)) { if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file } }
    Remove-Item -LiteralPath $testDirectory
}
