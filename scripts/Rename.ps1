<#
.SYNOPSIS
    Módulo para estandarizar y limpiar nombres de archivos de audio.
#>

function Format-TrackFileName {
    param (
        [string]$FilePath,
        [string]$LogsBasePath
    )

    if (-not (Test-Path -LiteralPath $FilePath)) { return }

    $directory = [System.IO.Path]::GetDirectoryName($FilePath)
    $extension = [System.IO.Path]::GetExtension($FilePath)
    $fileName = [System.IO.Path]::GetFileNameWithoutExtension($FilePath)

    $cleanName = $fileName

    # 1. Eliminar URLs o marcas de agua conocidas (ej. www.sitio.com, [320kbps], etc.)
    $cleanName = $cleanName -replace "(?i)www\.[a-z0-9\-]+\.[a-z]{2,4}", ""
    $cleanName = $cleanName -replace "(?i)http[s]?://\S+", ""
    $cleanName = $cleanName -replace "\[.*?320.*?\]", ""
    $cleanName = $cleanName -replace "\[.*?kbps.*?\]", ""

    # 2. Reemplazar múltiples guiones bajos o espacios por un solo espacio/guión limpio
    $cleanName = $cleanName -replace "_{2,}", " "
    $cleanName = $cleanName -replace "_", " "
    $cleanName = $cleanName -replace "\s{2,}", " "

    # 3. Limpiar espacios sobrantes al inicio y final
    $cleanName = $cleanName.Trim()

    # Si el nombre cambió, renombrar de forma segura
    if ($cleanName -and ($cleanName -ne $fileName)) {
        $newFullPath = Join-Path -Path $directory -ChildPath "$cleanName$extension"
        
        if (-not (Test-Path -LiteralPath $newFullPath)) {
            try {
                Rename-Item -LiteralPath $FilePath -NewName "$cleanName$extension" -ErrorAction Stop
                Write-ImporterLog -Message "Archivo renombrado: '$fileName' -> '$cleanName$extension'" -Level "INFO" -LogsBasePath $LogsBasePath
            }
            catch {
                Write-ImporterLog -Message "No se pudo renombrar '$fileName': $_" -Level "WARNING" -LogsBasePath $LogsBasePath
            }
        }
    }
}

function Invoke-TrackRenamingInDirectory {
    param (
        [string]$DirectoryPath,
        [array]$SupportedExtensions,
        [string]$LogsBasePath
    )

    if (-not (Test-Path -LiteralPath $DirectoryPath)) { return }

    $audioFiles = Get-ChildItem -LiteralPath $DirectoryPath -File -Recurse | Where-Object {
        $SupportedExtensions -contains $_.Extension.ToLower()
    }

    foreach ($file in $audioFiles) {
        Format-TrackFileName -FilePath $file.FullName -LogsBasePath $LogsBasePath
    }
}