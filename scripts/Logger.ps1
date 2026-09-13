<#
.SYNOPSIS
    Módulo para el registro de eventos (Logging) directamente en la raíz especificada.
#>

function Write-ImporterLog {
    param (
        [string]$Message,
        [string]$Level = "INFO",
        [string]$LogsBasePath
    )

    if (-not $LogsBasePath) { return }

    # Asegurar que el directorio especificado existe
    if (-not (Test-Path -LiteralPath $LogsBasePath)) {
        New-Item -ItemType Directory -Path $LogsBasePath -Force | Out-Null
    }

    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $dateFile = Get-Date -Format "yyyyMMdd"
    $logFileName = "Import_$dateFile.log"
    $fullPath = Join-Path -Path $LogsBasePath -ChildPath $logFileName

    $logEntry = "[$timestamp] [$Level] $Message"

    # Escribir en consola
    switch ($Level) {
        "ERROR"   { Write-Host $logEntry -ForegroundColor Red }
        "WARNING" { Write-Host $logEntry -ForegroundColor Yellow }
        default   { Write-Host $logEntry -ForegroundColor Cyan }
    }

    # Guardar en el archivo .log directamente en la raíz dada
    Add-Content -LiteralPath $fullPath -Value $logEntry -Encoding UTF8
}