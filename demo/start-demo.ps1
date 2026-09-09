param([switch]$Dev)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$taskNodeCommand = Get-Command node -ErrorAction SilentlyContinue
if ($taskNodeCommand) {
    $taskNodePath = $taskNodeCommand.Source
} else {
    $taskNodePath = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
}
if (-not (Test-Path -LiteralPath $taskNodePath)) {
    throw '需要安装 Node.js 22.13 或更高版本后运行。'
}
if ($Dev) {
    & $taskNodePath 'node_modules/vinext/dist/cli.js' dev --hostname 127.0.0.1 --port 3000
    exit $LASTEXITCODE
}
& $taskNodePath 'node_modules/vinext/dist/cli.js' build
if ($LASTEXITCODE -ne 0) { throw '构建失败，请检查上面的错误。' }
& $taskNodePath --import './scripts/local-runtime.mjs' './node_modules/wrangler/bin/wrangler.js' d1 migrations apply DB --local --config 'dist/server/wrangler.json' --persist-to '.wrangler/state'
if ($LASTEXITCODE -ne 0) { throw '收件数据库初始化失败，请检查上面的错误。' }
& $taskNodePath './scripts/start-local.mjs'
