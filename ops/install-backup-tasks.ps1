# =====================================================================
# Richtet die geplanten Sicherungen in der Windows-Aufgabenplanung ein.
#
# Als Administrator ausführen:
#   .\ops\install-backup-tasks.ps1
#
# Entfernen:
#   .\ops\install-backup-tasks.ps1 -Entfernen
# =====================================================================

[CmdletBinding()]
param(
    [switch]$Entfernen,

    # Push-URL des Kuma-Monitors "Backup". Ohne sie fällt eine ausgefallene
    # Sicherung erst auf, wenn sie gebraucht wird.
    [string]$KumaPushUrl = '',

    # Fallback, falls $PSScriptRoot leer ist (kommt vor, wenn der Aufruf über eine
    # Shell mit Pfadübersetzung läuft, z.B. Git Bash).
    [string]$ProjektVerzeichnis
)

if ([string]::IsNullOrWhiteSpace($ProjektVerzeichnis)) {
    $skriptOrdner = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
    $ProjektVerzeichnis = Split-Path -Parent $skriptOrdner
}

$ErrorActionPreference = 'Stop'

$AufgabenPfad = '\OHB\'
$Aufgaben = @(
    @{ Name = 'OHB-Backup-Voll';         Typ = 'full'; Zeit = '02:00'; Tage = 'Sunday' }
    @{ Name = 'OHB-Backup-Differenziell'; Typ = 'diff'; Zeit = '02:00'; Tage = 'Monday,Tuesday,Wednesday,Thursday,Friday,Saturday' }
)

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
        ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Error 'Bitte als Administrator ausführen — die Aufgabenplanung verlangt erhöhte Rechte.'
    exit 1
}

if ($Entfernen) {
    foreach ($aufgabe in $Aufgaben) {
        $vorhanden = Get-ScheduledTask -TaskName $aufgabe.Name -TaskPath $AufgabenPfad -ErrorAction SilentlyContinue
        if ($vorhanden) {
            Unregister-ScheduledTask -TaskName $aufgabe.Name -TaskPath $AufgabenPfad -Confirm:$false
            Write-Host "Entfernt: $($aufgabe.Name)" -ForegroundColor Yellow
        }
    }
    exit 0
}

$SkriptPfad = Join-Path $ProjektVerzeichnis 'ops\backup.ps1'
if (-not (Test-Path $SkriptPfad)) {
    Write-Error "backup.ps1 nicht gefunden unter $SkriptPfad"
    exit 1
}

foreach ($aufgabe in $Aufgaben) {
    $argumente = "-NoProfile -ExecutionPolicy Bypass -File `"$SkriptPfad`" -Typ $($aufgabe.Typ)"
    if ($KumaPushUrl) { $argumente += " -KumaPushUrl `"$KumaPushUrl`"" }

    $aktion = New-ScheduledTaskAction -Execute 'powershell.exe' `
        -Argument $argumente -WorkingDirectory $ProjektVerzeichnis

    $ausloeser = New-ScheduledTaskTrigger -Weekly `
        -DaysOfWeek ($aufgabe.Tage -split ',') -At $aufgabe.Zeit

    # Auch ohne angemeldeten Benutzer ausführen; Docker Desktop muss laufen.
    $einstellungen = New-ScheduledTaskSettingsSet `
        -StartWhenAvailable `
        -DontStopOnIdleEnd `
        -ExecutionTimeLimit (New-TimeSpan -Hours 2) `
        -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 10)

    $vorhanden = Get-ScheduledTask -TaskName $aufgabe.Name -TaskPath $AufgabenPfad -ErrorAction SilentlyContinue
    if ($vorhanden) {
        Unregister-ScheduledTask -TaskName $aufgabe.Name -TaskPath $AufgabenPfad -Confirm:$false
    }

    Register-ScheduledTask -TaskName $aufgabe.Name -TaskPath $AufgabenPfad `
        -Action $aktion -Trigger $ausloeser -Settings $einstellungen `
        -Description "OHB Reinraum — $($aufgabe.Typ)-Sicherung der Messdatenbank" `
        -RunLevel Highest | Out-Null

    Write-Host "Eingerichtet: $($aufgabe.Name) — $($aufgabe.Tage) um $($aufgabe.Zeit)" -ForegroundColor Green
}

Write-Host ''
Write-Host 'Prüfen mit:' -ForegroundColor Cyan
Write-Host '  Get-ScheduledTask -TaskPath \OHB\ | Format-Table TaskName, State'
Write-Host '  Start-ScheduledTask -TaskName OHB-Backup-Differenziell -TaskPath \OHB\   # sofort testen'
Write-Host ''
if (-not $KumaPushUrl) {
    Write-Host 'HINWEIS: Ohne -KumaPushUrl bleibt ein Ausfall der Sicherung unbemerkt.' -ForegroundColor Yellow
    Write-Host '  In Uptime Kuma einen Monitor vom Typ "Push" mit Intervall 26 h anlegen' -ForegroundColor Yellow
    Write-Host '  und dieses Skript mit der erzeugten URL erneut ausführen.' -ForegroundColor Yellow
}
