$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npmCommand) {
  $npmCommand = Get-Command npm -ErrorAction SilentlyContinue
}

if (-not $npmCommand) {
  Write-Host 'No se encontró npm. Instala Node.js 22 LTS y vuelve a abrir este archivo.' -ForegroundColor Red
  Read-Host 'Pulsa Enter para salir'
  exit 1
}

if (-not (Test-Path '.env.local')) {
  Copy-Item '.env.example' '.env.local'
  Write-Host 'Configuración local creada desde .env.example.' -ForegroundColor Green
}

if (-not (Test-Path 'node_modules')) {
  Write-Host 'Instalando dependencias…' -ForegroundColor Cyan
  & $npmCommand.Source install
}

Write-Host 'Iniciando SimpleLife en modo desarrollo…' -ForegroundColor Green
& $npmCommand.Source run dev
