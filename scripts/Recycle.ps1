<#
.SYNOPSIS
    Módulo para mover archivos a la papelera de reciclaje sin borrado definitivo.
#>

Add-Type -AssemblyName Microsoft.VisualBasic

function Move-ToRecycleBin {
    param (
        [string]$FilePath,
        [string]$LogsBasePath
    )

    if (-not (Test-Path -Path $FilePath)) {
        Write-ImporterLog -Message "No se encontró el archivo a reciclar: $FilePath" -Level "WARNING" -LogsBasePath $LogsBasePath
        return
    }

    try {
        [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile(
            $FilePath,
            'OnlyErrorDialogs',
            'SendToRecycleBin'
        )
        Write-ImporterLog -Message "Enviado a papelera: $FilePath" -Level "INFO" -LogsBasePath $LogsBasePath
    }
    catch {
        Write-ImporterLog -Message "Error al reciclar $FilePath : $_" -Level "ERROR" -LogsBasePath $LogsBasePath
    }
}