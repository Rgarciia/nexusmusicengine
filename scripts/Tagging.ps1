<#
.SYNOPSIS
    Módulo para la lectura, inspección, limpieza y edición de metadatos ID3.
#>

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
                Write-ImporterLog -Message "Spam detectado en metadatos de '$fileName': $comment" -Level "WARNING" -LogsBasePath $LogsBasePath
                break
            }
        }

        # 2. Detección de Archivos sin BPM / Key
        $bpm = $folder.GetDetailsOf($file, 225) # BPM
        $key = $folder.GetDetailsOf($file, 226) # Key
        if ([string]::IsNullOrWhiteSpace($bpm) -or [string]::IsNullOrWhiteSpace($key)) {
            Write-ImporterLog -Message "Track sin BPM/Key detectado: '$fileName' (Requiere análisis en Rekordbox)" -Level "WARNING" -LogsBasePath $LogsBasePath
        }

        # 3. Advertencia de Calidad (Bitrate < 320 kbps en MP3)
        $ext = [System.IO.Path]::GetExtension($FilePath).ToLower()
        if ($ext -eq ".mp3" -and (Get-Command -Name "Get-AudioBitrate" -ErrorAction SilentlyContinue)) {
            $bitrate = Get-AudioBitrate -FilePath $FilePath
            if ($bitrate -gt 0 -and $bitrate -lt 320) {
                Write-ImporterLog -Message "Calidad baja detectada en '$fileName': ($bitrate kbps)" -Level "WARNING" -LogsBasePath $LogsBasePath
            }
        }
    }
    catch {
        # Si falla la inspección de metadatos de un archivo, continúa sin detener el proceso
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
        Write-ImporterLog -Message "Género sugerido para '$dirName': $detectedGenre" -Level "INFO" -LogsBasePath $LogsBasePath
    }
}