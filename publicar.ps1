# Publica los cambios de Patroclo TV en GitHub Pages.
# El televisor (instalado con tizen-build.ps1 -Online) se actualiza solo en uno o dos minutos.
#
# Uso:
#   .\publicar.ps1
#   .\publicar.ps1 "Agrego canales de noticias"

param([string]$Mensaje = "")

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not $Mensaje) { $Mensaje = "Actualización " + (Get-Date -Format "yyyy-MM-dd HH:mm") }

# version.txt cambia en cada publicación: el televisor lo consulta para saber cuándo recargarse.
[System.IO.File]::WriteAllText((Join-Path $PSScriptRoot "version.txt"), [string][DateTimeOffset]::Now.ToUnixTimeSeconds())

git add -A
$cambios = git status --porcelain
if (-not $cambios) { Write-Host "No hay cambios para publicar." -ForegroundColor Yellow; exit 0 }

git commit -m $Mensaje
if ($LASTEXITCODE -ne 0) { Write-Host "Falló el commit." -ForegroundColor Red; exit 1 }
git push
if ($LASTEXITCODE -ne 0) { Write-Host "Falló la subida a GitHub." -ForegroundColor Red; exit 1 }

$url = (gh api "repos/{owner}/{repo}/pages" --jq .html_url 2>$null)
Write-Host "Publicado. En uno o dos minutos va a estar en línea: $url" -ForegroundColor Green
