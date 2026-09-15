<#
.SYNOPSIS
    Script principal para la importación, descompresión, organización,
    renombrado y creación de playlist global para Rekordbox / Engine DJ.
#>

[CmdletBinding()]
param (
    [string]$ConfigPath = "config\config.json"
)

# Definir la ruta base del script y del proyecto
$scriptRoot = $PSScriptRoot
$projectRoot = (Get-Item -LiteralPath $scriptRoot).Parent.FullName

# Cargar módulos auxiliares desde $scriptRoot
. (Join-Path -Path $scriptRoot -ChildPath "Utils.ps1")
. (Join-Path -Path $scriptRoot -ChildPath "Logger.ps1")
. (Join-Path -Path $scriptRoot -ChildPath "Validation.ps1")
. (Join-Path -Path $scriptRoot -ChildPath "Extract.ps1")
. (Join-Path -Path $scriptRoot -ChildPath "Recycle.ps1")
. (Join-Path -Path $scriptRoot -ChildPath "Audio.ps1")
. (Join-Path -Path $scriptRoot -ChildPath "Organize.ps1")
. (Join-Path -Path $scriptRoot -ChildPath "Tagging.ps1")
. (Join-Path -Path $scriptRoot -ChildPath "Rename.ps1")
. (Join-Path -Path $scriptRoot -ChildPath "Playlist.ps1")
. (Join-Path -Path $scriptRoot -ChildPath "Notifications.ps1")

# Función helper para reemplazar [System.IO.Path]::GetRelativePath
# Garantiza compatibilidad universal con Windows PowerShell 5.1 y .NET Framework
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

# Resolver ruta de configuración relativa al projectRoot
$fullConfigPath = Join-Path -Path $projectRoot -ChildPath $ConfigPath

if (-not (Test-Path -LiteralPath $fullConfigPath)) {
    Write-Host "Error: No se encontró el archivo de configuración en '$fullConfigPath'" -ForegroundColor Red
    exit 1
}

$config = Get-Content -LiteralPath $fullConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json

$stopwatch = [System.Diagnostics.Stopwatch]::StartNew()

Write-Host "=== Iniciando MusicImporter v$($config.Version) (Procesamiento Avanzado) ===" -ForegroundColor Green

try {
    $sourcePath = $config.Paths.SourcePath
    $libraryPath = if ($config.Paths.DestinationPath) { $config.Paths.DestinationPath } else { $config.Paths.LibraryPath }
    $sevenZipExe = if ($config.Paths.SevenZipExecutable) { $config.Paths.SevenZipExecutable } else { $config.Paths.SevenZipExe }
    $prefix = if ($config.Paths.TargetFolderPrefix) { $config.Paths.TargetFolderPrefix } else { "BestTracks" }

    # Detectar dinámicamente la función de organización
    $organizeCmd = $null
    $possibleCmds = @("Organize-ExtractedDirectory", "Organize-MusicDirectory", "Invoke-OrganizeDirectory")
    foreach ($cmd in $possibleCmds) {
        if (Get-Command -Name $cmd -ErrorAction SilentlyContinue) {
            $organizeCmd = $cmd
            break
        }
    }

    # 1. Crear carpeta de destino con Timestamp para el lote actual
    $timestamp = Get-Date -Format "yyyyMMdd_HHmm"
    $targetFolderName = "${prefix}_$timestamp"
    $targetImportPath = Join-Path -Path $libraryPath -ChildPath $targetFolderName

    if (-not (Test-Path -LiteralPath $targetImportPath)) {
        New-Item -Path $targetImportPath -ItemType Directory -Force | Out-Null
    }

    # 2. Configurar la carpeta de LOGS DIRECTAMENTE en la raíz del lote creado
    $logsPath = $targetImportPath

    Write-ImporterLog -Message "Configuración v$($config.Version) cargada." -Level "INFO" -LogsBasePath $logsPath
    Write-ImporterLog -Message "Carpeta de lote creada en: '$targetImportPath'" -Level "INFO" -LogsBasePath $logsPath

    $itemsToRecycle = @()

    # 3. Descompresión de Archivos Comprimidos (.zip, .rar, .7z)
    $archiveExts = if ($config.Archive.SupportedExtensions) { $config.Archive.SupportedExtensions } else { $config.CompressedExtensions }
    $compressedFiles = Get-ChildItem -LiteralPath $sourcePath -File -ErrorAction SilentlyContinue | Where-Object {
        $archiveExts -contains $_.Extension.ToLower()
    }
    Write-ImporterLog -Message "Se encontraron $($compressedFiles.Count) archivos comprimidos." -Level "INFO" -LogsBasePath $logsPath

    foreach ($archive in $compressedFiles) {
        $archiveBaseName = [System.IO.Path]::GetFileNameWithoutExtension($archive.Name)
        $extractedDest = Join-Path -Path $targetImportPath -ChildPath $archiveBaseName

        # Intento de descompresión por 7-Zip o Expand-Archive
        if (Test-Path -LiteralPath $sevenZipExe) {
            & $sevenZipExe x "$($archive.FullName)" "-o$extractedDest" -y | Out-Null
        } elseif ($archive.Extension.ToLower() -eq ".zip") {
            Expand-Archive -LiteralPath $archive.FullName -DestinationPath $extractedDest -Force
        }

        if (Test-Path -LiteralPath $extractedDest) {
            if ($organizeCmd) {
                & $organizeCmd -DirectoryPath $extractedDest -AudioExtensions $config.Audio.SupportedExtensions -ImageExtensions @(".jpg", ".jpeg", ".png") -LogsBasePath $logsPath
            }
            Write-ImporterLog -Message "Descomprimido y procesado: '$($archive.Name)'" -Level "INFO" -LogsBasePath $logsPath
            $itemsToRecycle += $archive.FullName
        }
    }

    # 4. Procesamiento de Carpetas Sueltas en Raíz
    $uncompressedFolders = Get-ChildItem -LiteralPath $sourcePath -Directory -ErrorAction SilentlyContinue
    Write-ImporterLog -Message "Se encontraron $($uncompressedFolders.Count) carpetas no comprimidas en la raíz." -Level "INFO" -LogsBasePath $logsPath

    foreach ($folder in $uncompressedFolders) {
        $destFolder = Join-Path -Path $targetImportPath -ChildPath $folder.Name
        Copy-Item -LiteralPath $folder.FullName -Destination $destFolder -Recurse -Force

        if ($organizeCmd) {
            $stats = & $organizeCmd -DirectoryPath $destFolder -AudioExtensions $config.Audio.SupportedExtensions -ImageExtensions @(".jpg", ".jpeg", ".png") -LogsBasePath $logsPath
            Write-ImporterLog -Message "Organizado: '$($folder.Name)' -> Audios: $($stats.AudioCount) | Covers: $($stats.CoverCount) | Eliminados: $($stats.DeletedCount)" -Level "INFO" -LogsBasePath $logsPath
        }
        $itemsToRecycle += $folder.FullName
    }

    # 5. Procesamiento de Archivos de Audio Sueltos en Raíz
    $looseAudioFiles = Get-ChildItem -LiteralPath $sourcePath -File -ErrorAction SilentlyContinue | Where-Object {
        $config.Audio.SupportedExtensions -contains $_.Extension.ToLower()
    }

    if ($looseAudioFiles.Count -gt 0) {
        $looseTracksFolder = Join-Path -Path $targetImportPath -ChildPath "_LooseTracks"
        if (-not (Test-Path -LiteralPath $looseTracksFolder)) {
            New-Item -Path $looseTracksFolder -ItemType Directory -Force | Out-Null
        }

        foreach ($audio in $looseAudioFiles) {
            $destAudio = Join-Path -Path $looseTracksFolder -ChildPath $audio.Name
            Copy-Item -LiteralPath $audio.FullName -Destination $destAudio -Force
            $itemsToRecycle += $audio.FullName
        }
        Write-ImporterLog -Message "Archivos sueltos procesados e ingresados a '_LooseTracks': $($looseAudioFiles.Count)" -Level "INFO" -LogsBasePath $logsPath
    }

    # 6. Estandarización, Inspección de Metadatos y Renombrado
    Write-ImporterLog -Message "Iniciando estandarización de nombres e inspección de metadatos..." -Level "INFO" -LogsBasePath $logsPath
    
    if (Get-Command -Name "Invoke-BatchRename" -ErrorAction SilentlyContinue) {
        Invoke-BatchRename -TargetDirectory $targetImportPath -SupportedExtensions $config.Audio.SupportedExtensions -LogsBasePath $logsPath
    }

    # Inspección técnica (BPM, Key y Bitrate de MP3)
    $allAudios = Get-ChildItem -LiteralPath $targetImportPath -File -Recurse | Where-Object {
        $config.Audio.SupportedExtensions -contains $_.Extension.ToLower()
    }
    foreach ($track in $allAudios) {
        if (Get-Command -Name "Clean-AudioTags" -ErrorAction SilentlyContinue) {
            Clean-AudioTags -FilePath $track.FullName -LogsBasePath $logsPath
        }
    }

    # 7. Generación ÚNICAMENTE de la Playlist GLOBAL en la Raíz (.m3u8)
    Write-ImporterLog -Message "Generando lista de reproducción global (.m3u8)..." -Level "INFO" -LogsBasePath $logsPath
    
    if (Get-Command -Name "New-GlobalBatchPlaylist" -ErrorAction SilentlyContinue) {
        New-GlobalBatchPlaylist -TargetDirectory $targetImportPath -SupportedExtensions $config.Audio.SupportedExtensions -LogsBasePath $logsPath
    }

    # 8. Limpieza: Enviar elementos originales procesados a la Papelera de Reciclaje
    if ($itemsToRecycle.Count -gt 0) {
        Write-ImporterLog -Message "Limpiando origen: enviando $($itemsToRecycle.Count) elementos procesados a la Papelera de Reciclaje..." -Level "INFO" -LogsBasePath $logsPath
        
        foreach ($itemPath in $itemsToRecycle) {
            if (Get-Command -Name "Send-ToRecycleBin" -ErrorAction SilentlyContinue) {
                Send-ToRecycleBin -Path $itemPath -LogsBasePath $logsPath
            } else {
                Remove-Item -LiteralPath $itemPath -Recurse -Force -ErrorAction SilentlyContinue
            }
        }
    }

    $stopwatch.Stop()
    $elapsedSeconds = [math]::Round($stopwatch.Elapsed.TotalSeconds, 2)
    $successMessage = "Importación completada con éxito en $elapsedSeconds segundos en '$targetFolderName'"
    
    Write-ImporterLog -Message "=== $successMessage ===" -Level "INFO" -LogsBasePath $logsPath

    # 9. Enviar Notificación de Escritorio al Finalizar
    if (Get-Command -Name "Send-ToastNotification" -ErrorAction SilentlyContinue) {
        Send-ToastNotification -Title "MusicImporter" -Message $successMessage
    }
}
catch {
    $stopwatch.Stop()
    $errorMessage = $_.Exception.Message
    Write-Host "Error durante la ejecución: $errorMessage" -ForegroundColor Red
    if ($logsPath) {
        Write-ImporterLog -Message "Error Crítico no controlado: $errorMessage" -Level "ERROR" -LogsBasePath $logsPath
    }

    if (Get-Command -Name "Send-ToastNotification" -ErrorAction SilentlyContinue) {
        Send-ToastNotification -Title "MusicImporter - Error" -Message $errorMessage
    }
}