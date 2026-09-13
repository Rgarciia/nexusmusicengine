<#
.SYNOPSIS
    Utilidades generales para MusicImporter con retorno de estado seguro.
#>

function Ensure-DirectoryExists {
    param (
        [string]$Path
    )
    if (-not (Test-Path -LiteralPath $Path)) {
        New-Item -ItemType Directory -Path $Path -Force | Out-Null
    }
}

function Move-ItemSafe {
    param (
        [string]$Path,
        [string]$Destination
    )

    if (-not (Test-Path -LiteralPath $Path)) { return $false }

    Ensure-DirectoryExists -Path $Destination

    $itemName = [System.IO.Path]::GetFileName($Path)
    $targetPath = Join-Path -Path $Destination -ChildPath $itemName

    # Si ya existe en destino, remover previo para evitar colisión
    if (Test-Path -LiteralPath $targetPath) {
        Remove-Item -LiteralPath $targetPath -Recurse -Force -ErrorAction SilentlyContinue
    }

    try {
        # Intento 1: Movimiento Estándar de PowerShell
        Move-Item -LiteralPath $Path -Destination $Destination -Force -ErrorAction Stop
        return $true
    }
    catch {
        try {
            # Intento 2: API directa del sistema operativo (.NET)
            if ([System.IO.Directory]::Exists($Path)) {
                [System.IO.Directory]::Move($Path, $targetPath)
            }
            elseif ([System.IO.File]::Exists($Path)) {
                [System.IO.File]::Move($Path, $targetPath)
            }
            return $true
        }
        catch {
            try {
                # Intento 3: Copiado + Borrado como último recurso
                Copy-Item -LiteralPath $Path -Destination $targetPath -Recurse -Force -ErrorAction Stop
                Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction Stop
                return $true
            }
            catch {
                # Si fallan todos los intentos, el archivo permanece intacto en el origen
                return $false
            }
        }
    }
}