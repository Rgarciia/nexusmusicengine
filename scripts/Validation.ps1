<#
.SYNOPSIS
    Módulo de validación de configuración y entorno para MusicImporter.
#>

function Get-MusicImporterConfig {
    param (
        [string]$ConfigPath
    )

    if (-not (Test-Path -LiteralPath $ConfigPath)) {
        throw "El archivo de configuración no existe en la ruta: '$ConfigPath'"
    }

    $rawJson = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8
    return ($rawJson | ConvertFrom-Json)
}

function Test-ImporterEnvironment {
    param (
        [PSObject]$Config
    )

    # Validar que exista la ruta origen
    if (-not (Test-Path -LiteralPath $Config.Paths.SourcePath)) {
        Write-Host "Error: La carpeta origen no existe: $($Config.Paths.SourcePath)" -ForegroundColor Red
        return $false
    }

    # Crear la ruta destino si no existe
    Ensure-DirectoryExists -Path $Config.Paths.DestinationPath

    # Validar ejecutable de 7-Zip
    if (-not (Test-Path -LiteralPath $Config.Paths.SevenZipExecutable)) {
        Write-Host "Error: No se encontró 7-Zip en: $($Config.Paths.SevenZipExecutable)" -ForegroundColor Red
        return $false
    }

    return $true
}