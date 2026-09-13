<#
.SYNOPSIS
    Módulo para la estructuración y limpieza de archivos/carpetas en la biblioteca final.
#>

function Clean-ProcessedDirectory {
    param (
        [string]$TargetDirectory,
        [PSObject]$Config,
        [string]$LogsBasePath
    )

    if (-not (Test-Path -Path $TargetDirectory) -and -not (Test-Path -LiteralPath $TargetDirectory)) { return }

    # Búsqueda segura de archivos
    $allFiles = try { @(Get-ChildItem -Path $TargetDirectory -Recurse -File -ErrorAction Stop) } 
                catch { @(Get-ChildItem -LiteralPath $TargetDirectory -Recurse -File) }

    $audioCount = 0
    $coverCount = 0
    $ignoredCount = 0

    foreach ($file in $allFiles) {
        if (Test-IsAudioFile -FilePath $file.FullName -SupportedExtensions $Config.Audio.SupportedExtensions) {
            $audioCount++
        }
        elseif (Test-IsAllowedCover -FilePath $file.FullName -AllowedNames $Config.Covers.AllowedNames) {
            $coverCount++
        }
        else {
            $ignoredCount++
            try { Remove-Item -Path $file.FullName -Force -ErrorAction Stop }
            catch { Remove-Item -LiteralPath $file.FullName -Force -ErrorAction SilentlyContinue }
        }
    }

    $folderName = [System.IO.Path]::GetFileName($TargetDirectory)
    Write-ImporterLog -Message "Organizado: '$folderName' -> Audios: $audioCount | Covers: $coverCount | Eliminados: $ignoredCount" -Level "INFO" -LogsBasePath $LogsBasePath
}