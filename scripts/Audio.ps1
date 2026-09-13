<#
.SYNOPSIS
    Módulo para la validación, clasificación e inspección técnica de archivos de audio.
#>

function Test-IsAudioFile {
    param (
        [string]$FilePath,
        [array]$SupportedExtensions
    )

    $ext = [System.IO.Path]::GetExtension($FilePath).ToLower()
    return ($SupportedExtensions -contains $ext)
}

function Test-IsAllowedCover {
    param (
        [string]$FilePath,
        [array]$AllowedNames
    )

    $fileName = [System.IO.Path]::GetFileName($FilePath).ToLower()
    return ($AllowedNames -contains $fileName)
}

function Test-IsIgnoredFile {
    param (
        [string]$FilePath,
        [array]$IgnoredExtensions
    )

    $ext = [System.IO.Path]::GetExtension($FilePath).ToLower()
    return ($IgnoredExtensions -contains $ext)
}

function Get-AudioBitrate {
    param (
        [string]$FilePath
    )

    if (-not (Test-Path -LiteralPath $FilePath)) { return 0 }

    try {
        $shell = New-Object -ComObject Shell.Application
        $folderPath = [System.IO.Path]::GetDirectoryName($FilePath)
        $fileName = [System.IO.Path]::GetFileName($FilePath)
        
        $folder = $shell.NameSpace($folderPath)
        $file = $folder.ParseName($fileName)

        # Índice 28 en Shell de Windows = Velocidad de bits (Bitrate)
        $bitrateStr = $folder.GetDetailsOf($file, 28)
        
        if ($bitrateStr -match "(\d+)") {
            return [int]$matches[1]
        }
    }
    catch {
        return 0
    }
    return 0
}