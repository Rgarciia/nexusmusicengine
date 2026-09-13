<#
.SYNOPSIS
    Módulo para la descompresión de archivos.
#>

function Expand-CompressedArchive {
    param (
        [string]$ArchivePath,
        [string]$DestinationPath,
        [string]$SevenZipPath,
        [string]$LogsBasePath
    )

    $extension = [System.IO.Path]::GetExtension($ArchivePath).ToLower()

    try {
        Ensure-DirectoryExists -Path $DestinationPath

        # Si es un ZIP y no está configurado 7-Zip, usa la herramienta nativa
        if ($extension -eq ".zip" -and (-not (Test-Path -Path $SevenZipPath))) {
            Expand-Archive -Path $ArchivePath -DestinationPath $DestinationPath -Force
            return $true
        }

        # Para RAR, 7Z o ZIP con 7z.exe
        if (Test-Path -Path $SevenZipPath) {
            $process = Start-Process -FilePath $SevenZipPath -ArgumentList "x `"$ArchivePath`" -o`"$DestinationPath`" -y" -NoNewWindow -Wait -PassThru
            
            if ($process.ExitCode -eq 0) {
                return $true
            } else {
                Write-ImporterLog -Message "7-Zip devolvió código de error $($process.ExitCode) procesando: $ArchivePath" -Level "ERROR" -LogsBasePath $LogsBasePath
                return $false
            }
        } else {
            Write-ImporterLog -Message "Herramienta 7-Zip no encontrada en $SevenZipPath para extraer $ArchivePath" -Level "ERROR" -LogsBasePath $LogsBasePath
            return $false
        }
    }
    catch {
        Write-ImporterLog -Message "Excepción al extraer $ArchivePath : $_" -Level "ERROR" -LogsBasePath $LogsBasePath
        return $false
    }
}