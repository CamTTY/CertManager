<#
.SYNOPSIS
    Deploy a renewed certificate to a remote Windows IIS server.

.DESCRIPTION
    Pushes a PFX to the target server's local temp directory via PSRemoting,
    imports it into LocalMachine\My, optionally swaps the IIS HTTPS SslBinding
    for the chosen port, and optionally removes the old certificate by
    thumbprint. Designed to be invoked by cert_service.py — emits structured
    STEP|... and RESULT|... markers on stdout for parsing.

    Reads the PFX passphrase from $env:CERT_PASSPHRASE (set by the caller; the
    passphrase is never logged or echoed).

.PARAMETER TargetServer
    DNS name of the IIS server (used by Invoke-Command -ComputerName).

.PARAMETER PfxPath
    Local path on THIS host (the cert_service host) to the PFX bundle. The
    script copies it to the remote server before import.

.PARAMETER SiteName
    IIS site name whose HTTPS binding should be updated (when -UpdateIIS).

.PARAMETER BindingPort
    HTTPS binding port (e.g. 443).

.PARAMETER OldThumbprint
    Optional. If supplied, the old certificate with this thumbprint is removed
    from LocalMachine\My after the new one is bound.

.PARAMETER ReplaceStore
    Reserved switch — kept for parity with the modal's "Replace Personal
    Store" checkbox. Currently a no-op (Import-PfxCertificate already replaces
    by thumbprint); flag is recorded in the result for auditability.

.PARAMETER UpdateIIS
    If set, swap the IIS SslBinding for $BindingPort to the newly-imported
    cert. If not set, the cert is imported into the store but the binding is
    left alone (useful for non-IIS hosts).
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $TargetServer,
    [Parameter(Mandatory)] [string] $PfxPath,
    [Parameter(Mandatory)] [string] $SiteName,
    [Parameter(Mandatory)] [int]    $BindingPort,
    [string] $OldThumbprint,
    [switch] $ReplaceStore,
    [switch] $UpdateIIS
)

$ErrorActionPreference = 'Stop'

# ── Helpers (run locally, before PSRemoting) ─────────────────────────────
function Write-Step([string]$Id, [string]$Message) {
    # Single-line marker; cert_service splits on '|' to build the steps array.
    Write-Host ("STEP|{0}|{1}" -f $Id, $Message)
}
function Write-Result([hashtable]$Payload) {
    Write-Host ("RESULT|" + ($Payload | ConvertTo-Json -Compress))
}
function Write-StructuredError([string]$Step, [string]$Message, [string]$Trace) {
    $payload = @{ step = $Step; message = $Message; trace = $Trace }
    Write-Host ("ERROR|" + ($payload | ConvertTo-Json -Compress))
}

# ── Validate local inputs ────────────────────────────────────────────────
if (-not (Test-Path -LiteralPath $PfxPath)) {
    Write-StructuredError 'validate' "PfxPath not found: $PfxPath" ''
    exit 2
}
$pfxBytes = [System.IO.File]::ReadAllBytes($PfxPath)
$pfxSize  = $pfxBytes.Length

$passphraseRaw = $env:CERT_PASSPHRASE
if ([string]::IsNullOrEmpty($passphraseRaw)) {
    Write-StructuredError 'validate' '$env:CERT_PASSPHRASE is not set' ''
    exit 2
}
$pfxPassword = ConvertTo-SecureString -String $passphraseRaw -AsPlainText -Force

# Random remote staging filename so concurrent deploys don't collide.
$remoteStagingPath = "C:\Windows\Temp\certdeploy-$([guid]::NewGuid().ToString('N')).pfx"

$session   = $null
$currentStep = 'connect'
try {
    Write-Step 'connect' "Opening PSSession to $TargetServer"
    $session = New-PSSession -ComputerName $TargetServer -ErrorAction Stop

    $currentStep = 'copy'
    Write-Step 'copy' "Copying PFX to ${TargetServer}:${remoteStagingPath} ($pfxSize bytes)"
    Copy-Item -Path $PfxPath -Destination $remoteStagingPath -ToSession $session -Force

    $currentStep = 'import-and-bind'
    Write-Step 'import' "Importing PFX into LocalMachine\My on $TargetServer"
    if ($UpdateIIS) {
        Write-Step 'binding' "Replacing IIS SslBinding on 0.0.0.0:$BindingPort for site '$SiteName'"
    }
    if ($OldThumbprint) {
        Write-Step 'cleanup' "Will remove old certificate $OldThumbprint after binding swap"
    }

    $remoteResult = Invoke-Command -Session $session -ScriptBlock {
        param($remotePfxPath, $pfxPassword, $siteName, $bindingPort, $oldThumbprint, $updateIIS)

        $newCert = Import-PfxCertificate -FilePath $remotePfxPath `
            -CertStoreLocation Cert:\LocalMachine\My `
            -Password $pfxPassword

        $oldThumbActual = $null
        if ($updateIIS) {
            Import-Module WebAdministration -ErrorAction Stop

            $bindingKey = "0.0.0.0!$bindingPort"
            $existing = $null
            if (Test-Path "IIS:\SslBindings\$bindingKey") {
                $existing = Get-Item "IIS:\SslBindings\$bindingKey"
                $oldThumbActual = $existing.Thumbprint
                Remove-Item "IIS:\SslBindings\$bindingKey" -Force
            }
            New-Item "IIS:\SslBindings\$bindingKey" -Value $newCert | Out-Null
        }

        # Caller-supplied old thumbprint trumps whatever the binding pointed at.
        $thumbToRemove = if ($oldThumbprint) { $oldThumbprint } else { $oldThumbActual }
        if ($thumbToRemove -and $thumbToRemove -ne $newCert.Thumbprint) {
            $oldCert = Get-ChildItem "Cert:\LocalMachine\My\$thumbToRemove" -ErrorAction SilentlyContinue
            if ($oldCert) { $oldCert | Remove-Item -Force }
        }

        return @{
            thumbprint    = $newCert.Thumbprint
            oldThumbprint = $thumbToRemove
            siteName      = $siteName
            bindingPort   = $bindingPort
        }
    } -ArgumentList $remoteStagingPath, $pfxPassword, $SiteName, $BindingPort, $OldThumbprint, [bool]$UpdateIIS

    Write-Result @{
        thumbprint    = $remoteResult.thumbprint
        oldThumbprint = $remoteResult.oldThumbprint
        siteName      = $remoteResult.siteName
        bindingPort   = $remoteResult.bindingPort
        replaceStore  = [bool]$ReplaceStore
        updateIIS     = [bool]$UpdateIIS
    }
    exit 0
}
catch {
    $msg   = $_.Exception.Message
    $trace = $_.ScriptStackTrace
    Write-StructuredError $currentStep $msg $trace
    exit 1
}
finally {
    if ($session) {
        try {
            # Best-effort: nuke the remote staging file even on error.
            Invoke-Command -Session $session -ScriptBlock {
                param($p)
                if ($p -and (Test-Path -LiteralPath $p)) { Remove-Item -LiteralPath $p -Force }
            } -ArgumentList $remoteStagingPath -ErrorAction SilentlyContinue
        } catch { }
        Remove-PSSession $session -ErrorAction SilentlyContinue
    }
}
