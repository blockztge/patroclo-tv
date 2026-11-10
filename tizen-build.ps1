# Empaqueta Patroclo TV como app de Samsung (.wgt) y, opcionalmente, la instala en el televisor.
#
# Uso:
#   .\tizen-build.ps1 -Cert MiPerfil -Tv 192.168.100.20 -Online
#       Instala "Patroclo TV" cargando la app desde GitHub Pages: funciona las
#       24 horas y se actualiza sola cada vez que se ejecuta publicar.ps1.
#   .\tizen-build.ps1 -Cert MiPerfil -Tv 192.168.100.20 -Dev
#       Instala "Patroclo TV (dev)": carga la app desde XAMPP en esta PC y se
#       actualiza apenas se guarda un archivo (la PC tiene que estar encendida).
#   .\tizen-build.ps1 -Cert MiPerfil -Tv 192.168.100.20
#       Instala la app completa dentro del televisor (no se actualiza sola).
#
# -Cert    Nombre del perfil de certificado creado en el Certificate Manager de Tizen Studio.
# -Tv      IP del televisor (con el modo desarrollador activado) para instalar y abrir la app.
# -Online  Arma el lanzador que carga la app desde GitHub Pages.
# -Dev     Arma el lanzador que carga la app desde XAMPP en esta PC.
# -Server  Dirección desde donde carga la app el lanzador (si no se indica, se calcula sola).

param(
    [Parameter(Mandatory = $true)][string]$Cert,
    [string]$Tv = "",
    [switch]$Online,
    [switch]$Dev,
    [string]$Server = ""
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$dist = Join-Path $root "dist"

# Buscar la CLI de Tizen (tizen.bat) y sdb.
$tizen = (Get-Command tizen.bat -ErrorAction SilentlyContinue)
if ($tizen) { $tizen = $tizen.Source }
else {
    foreach ($dir in @("C:\tizen-studio", "$env:USERPROFILE\tizen-studio", "D:\tizen-studio")) {
        $candidate = Join-Path $dir "tools\ide\bin\tizen.bat"
        if (Test-Path $candidate) { $tizen = $candidate; break }
    }
}
if (-not $tizen) {
    Write-Host "No se encontró Tizen Studio. Instalalo desde https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/installing-tv-sdk.html" -ForegroundColor Red
    exit 1
}
$sdb = Join-Path (Split-Path (Split-Path (Split-Path $tizen))) "sdb.exe"

if (Test-Path $dist) { Remove-Item -Recurse -Force $dist }

if ($Online -or $Dev) {
    if ($Online) {
        $name = "PatrocloOnline"
        $appId = "PtrcloOnl1.PatrocloTV"
    } else {
        $name = "PatrocloDev"
        $appId = "PtrcloDev1.PatrocloDev"
    }
    $app = Join-Path $dist $name
    New-Item -ItemType Directory -Force $app | Out-Null
    Copy-Item (Join-Path $root "tizen\dev\*") $app
    Copy-Item (Join-Path $root "icon.png") $app

    if ($Online) {
        # Es otra app ("Patroclo TV"), así puede convivir con el lanzador de XAMPP.
        $cfg = Join-Path $app "config.xml"
        $xml = [System.IO.File]::ReadAllText($cfg)
        $xml = $xml.Replace('PtrcloDev1.PatrocloDev', $appId).Replace('package="PtrcloDev1"', 'package="PtrcloOnl1"')
        $xml = $xml.Replace('http://patroclo.tv/PatrocloDev', 'http://patroclo.tv/PatrocloOnline').Replace('<name>Patroclo TV (dev)</name>', '<name>Patroclo TV</name>')
        [System.IO.File]::WriteAllText($cfg, $xml)
        if (-not $Server) { $Server = (gh api "repos/{owner}/{repo}/pages" --jq .html_url) }
    }
    elseif (-not $Server) {
        # La IP de la placa de red que sale a internet.
        $ip = (Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway } | Select-Object -First 1).IPv4Address.IPAddress
        $Server = "http://$ip/patroclo/"
    }
    "// Generado por tizen-build.ps1`nvar PTV_DEV_SERVER = '$Server';`n" | Out-File -Encoding utf8 (Join-Path $app "server.js")
    Write-Host "El lanzador va a cargar la app desde $Server" -ForegroundColor Cyan
}
else {
    $name = "PatrocloTV"
    $appId = "PtrcloTV01.PatrocloTV"
    $app = Join-Path $dist $name
    New-Item -ItemType Directory -Force $app | Out-Null
    # Solo los archivos de la app (sin proxy.php, dev-version.php, README ni scripts).
    foreach ($item in @("index.html", "config.xml", "icon.png", "css", "js", "data")) {
        Copy-Item -Recurse (Join-Path $root $item) $app
    }
}

Write-Host "Empaquetando y firmando con el perfil '$Cert'..." -ForegroundColor Cyan
& $tizen package -t wgt -s $Cert -- $app
if ($LASTEXITCODE -ne 0) { Write-Host "Falló el empaquetado." -ForegroundColor Red; exit 1 }

$wgt = Get-ChildItem $app -Filter *.wgt | Select-Object -First 1
if (-not $wgt) { Write-Host "No se generó el archivo .wgt" -ForegroundColor Red; exit 1 }
$final = Join-Path $dist "$name.wgt"
Move-Item $wgt.FullName $final -Force
Write-Host "Listo: $final" -ForegroundColor Green

if ($Tv) {
    Write-Host "Conectando con el televisor $Tv..." -ForegroundColor Cyan
    & $sdb connect $Tv
    $serial = "${Tv}:26101"
    & $tizen install -n "$name.wgt" -s $serial -- $dist
    if ($LASTEXITCODE -ne 0) { Write-Host "Falló la instalación." -ForegroundColor Red; exit 1 }
    & $tizen run -p $appId -s $serial
    Write-Host "Instalada y abierta en el televisor." -ForegroundColor Green
}
