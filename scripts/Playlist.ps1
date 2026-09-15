<#
.SYNOPSIS
    Módulo para la generación de archivos de playlist M3U8 para Rekordbox / Engine DJ.
#>

# Función helper para calcular rutas relativas compatibles con Windows PowerShell 5.1
function Get-RelativePathCustom {
    param (
        [string]$BasePath,
        [string]$TargetPath
    )
    $baseUri = New-Object System.Uri(($BasePath.TrimEnd('\') + '\'))
    $targetUri = New-Object System.Uri($TargetPath)
    $relativeUri = $baseUri.MakeRelativeUri($targetUri)
    return [System.Uri]::UnescapeDataString($relativeUri.ToString()).Replace('/', '\')
}

function New-BatchPlaylists {
    [CmdletBinding()]
    param (
        [string]$TargetDirectory,
        [array]$SupportedExtensions,
        [string]$LogsBasePath
    )

    # Crear playlists individuales por subcarpeta (incluye _LooseTracks)
    $subFolders = Get-ChildItem -LiteralPath $TargetDirectory -Directory -ErrorAction SilentlyContinue

    foreach ($folder in $subFolders) {
        $audioFiles = Get-ChildItem -LiteralPath $folder.FullName -File -Recurse -ErrorAction SilentlyContinue | Where-Object {
            $SupportedExtensions -contains $_.Extension.ToLower()
        }

        if ($audioFiles.Count -gt 0) {
            $m3uPath = Join-Path -Path $folder.FullName -ChildPath "$($folder.Name).m3u8"
            $lines = @("#EXTM3U")

            foreach ($file in $audioFiles) {
                # Ruta relativa
                $relativePath = $file.Name
                $lines += $relativePath
            }

            $lines | Set-Content -Path $m3uPath -Encoding UTF8
            if (Get-Command -Name "Write-ImporterLog" -ErrorAction SilentlyContinue) {
                Write-ImporterLog -Message "Playlist generada: '$($folder.Name).m3u8' con $($audioFiles.Count) tracks." -Level "INFO" -LogsBasePath $LogsBasePath
            }
        }
    }
}

function New-GlobalBatchPlaylist {
    [CmdletBinding()]
    param (
        [string]$TargetDirectory,
        [array]$SupportedExtensions,
        [string]$LogsBasePath
    )

    # Buscar TODOS los archivos de audio en todo el lote
    $allAudioFiles = Get-ChildItem -LiteralPath $TargetDirectory -File -Recurse -ErrorAction SilentlyContinue | Where-Object {
        $SupportedExtensions -contains $_.Extension.ToLower()
    }

    if ($allAudioFiles.Count -gt 0) {
        $folderName = (Get-Item -LiteralPath $TargetDirectory).Name
        $globalM3uPath = Join-Path -Path $TargetDirectory -ChildPath "$folderName.m3u8"
        
        $lines = @("#EXTM3U")

        foreach ($file in $allAudioFiles) {
            # Calcular la ruta relativa respecto a la raíz del lote (Compatible con PowerShell 5.1)
            $relativePath = Get-RelativePathCustom -BasePath $TargetDirectory -TargetPath $file.FullName
            # Reemplazar diagonales inversas por / para compatibilidad estándar M3U8
            $relativePath = $relativePath -replace '\\', '/'
            $lines += $relativePath
        }

        $lines | Set-Content -Path $globalM3uPath -Encoding UTF8
        
        Write-Host "Playlist Global generada: '$folderName.m3u8' con $($allAudioFiles.Count) tracks." -ForegroundColor Cyan
        if (Get-Command -Name "Write-ImporterLog" -ErrorAction SilentlyContinue) {
            Write-ImporterLog -Message "Playlist Global generada: '$folderName.m3u8' con $($allAudioFiles.Count) tracks." -Level "INFO" -LogsBasePath $LogsBasePath
        }
    }
}