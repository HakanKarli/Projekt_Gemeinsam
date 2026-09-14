# =====================================================================
# Sicherung der Datenbank ausführen.
#
#   .\ops\backup.ps1 -Typ full     vollständig  (sonntags)
#   .\ops\backup.ps1 -Typ diff     differenziell (werktags)
#
# Wird von der Aufgabenplanung aufgerufen — siehe ops\install-backup-tasks.ps1.
#
# Bei Erfolg wird optional ein Heartbeat an Uptime Kuma gesendet. Bleibt er aus,
# meldet Kuma nach 26 Stunden: So fällt eine ausgefallene Sicherung auf, BEVOR sie
# gebraucht wird. Eine Sicherung, deren Ausfall niemand bemerkt, ist keine.
# =====================================================================

[CmdletBinding()]
param(
    [ValidateSet('full', 'diff', 'incr')]
    [string]$Typ = 'diff',

    # Push-URL eines Kuma-Monitors vom Typ "Push". Leer = keine Meldung.
    [string]$KumaPushUrl = $env:OHB_BACKUP_PUSH_URL,

    # Fallback, falls $PSScriptRoot leer ist (kommt vor, wenn der Aufruf über eine
    # Shell mit Pfadübersetzung läuft, z.B. Git Bash).
    [string]$ProjektVerzeichnis
)

if ([string]::IsNullOrWhiteSpace($ProjektVerzeichnis)) {
    $skriptOrdner = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
    $ProjektVerzeichnis = Split-Path -Parent $skriptOrdner
}

$ErrorActionPreference = 'Stop'
Set-Location $ProjektVerzeichnis

$LogVerzeichnis = Join-Path $ProjektVerzeichnis 'ops\logs'
New-Item -ItemType Directory -Force -Path $LogVerzeichnis | Out-Null
$LogDatei = Join-Path $LogVerzeichnis ("backup-{0}.log" -f (Get-Date -Format 'yyyy-MM'))

function Schreibe {
    param([string]$Stufe, [string]$Text)
    $zeile = "{0} {1,-7} {2}" -f (Get-Date -Format 'yyyy-MM-ddTHH:mm:ssK'), $Stufe, $Text
    Write-Host $zeile
    Add-Content -Path $LogDatei -Value $zeile -Encoding utf8
}

function Melde-AnKuma {
    param([string]$Status, [string]$Nachricht)
    if ([string]::IsNullOrWhiteSpace($KumaPushUrl)) { return }
    try {
        $url = "{0}?status={1}&msg={2}" -f $KumaPushUrl, $Status, [uri]::EscapeDataString($Nachricht)
        Invoke-RestMethod -Uri $url -TimeoutSec 10 | Out-Null
    } catch {
        Schreibe 'WARN' "Heartbeat an Kuma fehlgeschlagen: $($_.Exception.Message)"
    }
}

Schreibe 'INFO' "Sicherung startet (Typ: $Typ)"
$begonnen = Get-Date

try {
    # -T: kein Pseudo-Terminal — zwingend, sonst hängt der Aufruf in der Aufgabenplanung.
    # -u postgres: Die erzeugten Dateien müssen dem Archiver gehören, nicht root.
    $ausgabe = docker compose exec -T -u postgres postgres `
        pgbackrest --stanza=ohb --type=$Typ backup 2>&1

    if ($LASTEXITCODE -ne 0) {
        throw "pgbackrest endete mit Code $LASTEXITCODE`n$($ausgabe -join "`n")"
    }

    $dauer = [int]((Get-Date) - $begonnen).TotalSeconds
    $label = ($ausgabe | Select-String 'new backup label = (\S+)').Matches.Groups[1].Value

    Schreibe 'INFO' "Sicherung erfolgreich: $label (${dauer}s)"
    Melde-AnKuma -Status 'up' -Nachricht "$Typ ok: $label"
    exit 0

} catch {
    Schreibe 'ERROR' "Sicherung FEHLGESCHLAGEN: $($_.Exception.Message)"
    Melde-AnKuma -Status 'down' -Nachricht "$Typ fehlgeschlagen"

    # Auffällig scheitern. Eine still fehlgeschlagene Sicherung ist gefährlicher als
    # gar keine, weil man sich auf sie verlässt.
    exit 1
}
