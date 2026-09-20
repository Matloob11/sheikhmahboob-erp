# Local pg_dump of daftar DB → ../server-snapshot/daftar-pg/<stamp>/
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$OutDir = Join-Path (Split-Path -Parent $Root) "server-snapshot\daftar-pg\$Stamp"
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$Container = if ($env:DAFTAR_PG_CONTAINER) { $env:DAFTAR_PG_CONTAINER } else { "daftar-pg" }
$DumpFile = Join-Path $OutDir "daftar.dump"

Write-Host "Dumping $Container → $DumpFile"
docker exec $Container pg_dump -U daftar -d daftar -Fc -f /tmp/daftar.dump
docker cp "${Container}:/tmp/daftar.dump" $DumpFile
docker exec $Container rm -f /tmp/daftar.dump

Get-FileHash -Algorithm SHA256 $DumpFile |
  ForEach-Object { "$($_.Hash.ToLower())  daftar.dump" } |
  Tee-Object -FilePath (Join-Path $OutDir "daftar.dump.sha256")

Write-Host "DUMP_OK $OutDir"
