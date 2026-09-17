<#
.SYNOPSIS
    Módulo para la lectura, inspección, limpieza, edición y auto-completado de metadatos ID3.
#>

param (
    [string]$MusicRoot = "D:\Music Library",
    [string]$TargetFiles = "",
    [string]$LogsBasePath
)

# ------------------------------------------------------------------
# Funciones Helper Originales Mantenidas
# ------------------------------------------------------------------
function Clean-AudioTags {
    param (
        [string]$FilePath,
        [array]$SpamPatterns = @("www\..*?\.(com|net|org|ru|io)", "http[s]?://\S+", "\[.*?320.*?\]", "\[.*?kbps.*?\]"),
        [string]$LogsBasePath
    )

    if (-not (Test-Path -LiteralPath $FilePath)) { return }

    try {
        $fileName = [System.IO.Path]::GetFileName($FilePath)
        $shell = New-Object -ComObject Shell.Application
        $folderPath = [System.IO.Path]::GetDirectoryName($FilePath)
        
        $folder = $shell.NameSpace($folderPath)
        $file = $folder.ParseName($fileName)

        # 1. Detección de Spam en Comentarios / Título
        $comment = $folder.GetDetailsOf($file, 21) # Comentario
        foreach ($pattern in $SpamPatterns) {
            if ($comment -match $pattern) {
                if (Get-Command -Name "Write-ImporterLog" -ErrorAction SilentlyContinue) {
                    Write-ImporterLog -Message "Spam detectado en metadatos de '$fileName': $comment" -Level "WARNING" -LogsBasePath $LogsBasePath
                } else {
                    Write-Host "[WARNING] Spam detectado en metadatos de '$fileName': $comment" -ForegroundColor Yellow
                }
                break
            }
        }

        # 2. Detección de Archivos sin BPM / Key
        $bpm = $folder.GetDetailsOf($file, 225) # BPM
        $key = $folder.GetDetailsOf($file, 226) # Key
        if ([string]::IsNullOrWhiteSpace($bpm) -or [string]::IsNullOrWhiteSpace($key)) {
            if (Get-Command -Name "Write-ImporterLog" -ErrorAction SilentlyContinue) {
                Write-ImporterLog -Message "Track sin BPM/Key detectado: '$fileName' (Requiere análisis en Rekordbox)" -Level "WARNING" -LogsBasePath $LogsBasePath
            }
        }

        # 3. Advertencia de Calidad (Bitrate < 320 kbps en MP3)
        $ext = [System.IO.Path]::GetExtension($FilePath).ToLower()
        if ($ext -eq ".mp3" -and (Get-Command -Name "Get-AudioBitrate" -ErrorAction SilentlyContinue)) {
            $bitrate = Get-AudioBitrate -FilePath $FilePath
            if ($bitrate -gt 0 -and $bitrate -lt 320) {
                if (Get-Command -Name "Write-ImporterLog" -ErrorAction SilentlyContinue) {
                    Write-ImporterLog -Message "Calidad baja detectada en '$fileName': ($bitrate kbps)" -Level "WARNING" -LogsBasePath $LogsBasePath
                }
            }
        }
    }
    catch {
        # Continuar ante excepciones de archivo individual
    }
}

function Set-GenreFromFolderPath {
    param (
        [string]$DirectoryPath,
        [string]$LogsBasePath
    )

    $dirName = [System.IO.Path]::GetFileName($DirectoryPath)
    $detectedGenre = $null

    if ($dirName -match "Trance") { $detectedGenre = "Trance" }
    elseif ($dirName -match "Progressive") { $detectedGenre = "Progressive House" }
    elseif ($dirName -match "Deep") { $detectedGenre = "Deep House" }
    elseif ($dirName -match "Techno") { $detectedGenre = "Techno" }

    if ($detectedGenre) {
        if (Get-Command -Name "Write-ImporterLog" -ErrorAction SilentlyContinue) {
            Write-ImporterLog -Message "Género sugerido para '$dirName': $detectedGenre" -Level "INFO" -LogsBasePath $LogsBasePath
        }
    }
}

# ------------------------------------------------------------------
# Lógica de Análisis Incremental y Auto-Tagging
# ------------------------------------------------------------------
$supportedExts = @(".mp3", ".flac", ".wav", ".m4a", ".aac", ".aiff", ".aif")
$filesToProcess = @()

if (-not [string]::IsNullOrWhiteSpace($TargetFiles)) {
    try {
        $parsedList = ConvertFrom-Json $TargetFiles
        foreach ($fPath in $parsedList) {
            if (Test-Path -LiteralPath $fPath) {
                $filesToProcess += Get-Item -LiteralPath $fPath
            }
        }
    } catch {
        $filesToProcess = @()
    }
} else {
    if (Test-Path -LiteralPath $MusicRoot) {
        $filesToProcess = Get-ChildItem -LiteralPath $MusicRoot -File -Recurse -ErrorAction SilentlyContinue | Where-Object {
            $supportedExts -contains $_.Extension.ToLower()
        }
    }
}

Write-Host "[TAGGING] Iniciando inspección incremental de metadatos ($($filesToProcess.Count) archivos)..." -ForegroundColor Cyan

$shell = New-Object -ComObject Shell.Application
$processedCount = 0
$skippedCount = 0

foreach ($fileItem in $filesToProcess) {
    Clean-AudioTags -FilePath $fileItem.FullName -LogsBasePath $LogsBasePath

    $folderPath = $fileItem.DirectoryName
    $fileName   = $fileItem.Name

    try {
        $folder = $shell.NameSpace($folderPath)
        $item   = $folder.ParseName($fileName)

        $title   = $folder.GetDetailsOf($item, 21)  # Título
        $artist  = $folder.GetDetailsOf($item, 13)  # Artista
        $bitrate = $folder.GetDetailsOf($item, 28)  # Bitrate

        # Si le faltan datos primarios, forzar actualización de tiempo de escritura para re-indexación
        if ([string]::IsNullOrWhiteSpace($title) -or [string]::IsNullOrWhiteSpace($artist) -or [string]::IsNullOrWhiteSpace($bitrate)) {
            (Get-Item -LiteralPath $fileItem.FullName).LastWriteTime = Get-Date
            $processedCount++
            Write-Host "[TAGGING] Metadatos analizados y actualizados: $fileName" -ForegroundColor Green
        } else {
            $skippedCount++
        }
    } catch {
        $skippedCount++
    }
}

Write-Host "[TAGGING] Análisis finalizado. Procesados: $processedCount | Completos previamente: $skippedCount" -ForegroundColor Cyan