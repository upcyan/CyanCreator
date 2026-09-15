$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Test-Path -LiteralPath 'node_modules/ffmpeg-static')) {
    npm.cmd install
    if ($LASTEXITCODE -ne 0) { throw '依赖安装失败' }
}
node server.js
