param(
    [string]$ThreadId,
    [string]$RuntimeRoot = (Join-Path $PSScriptRoot 'runtime'),
    [switch]$VerifyOnly,
    [switch]$Original
)

$ErrorActionPreference = 'Stop'
$taskInstalled = @(Get-AppxPackage -Name OpenAI.Codex)
if ($Original) {
    if ($taskInstalled.Count -ne 1) { throw '找不到原版 Codex 安装。' }
    $taskOriginalExe = Join-Path $taskInstalled[0].InstallLocation 'app/ChatGPT.exe'
    Start-Process -FilePath $taskOriginalExe
    exit 0
}

$taskRuntime = [System.IO.Path]::GetFullPath($RuntimeRoot)
$taskExe = Join-Path $taskRuntime 'ChatGPT.exe'
$taskCli = Join-Path $taskRuntime 'resources/codex.exe'
if (-not (Test-Path -LiteralPath $taskExe -PathType Leaf)) { throw '候选版程序文件缺失。' }
if (-not (Test-Path -LiteralPath $taskCli -PathType Leaf)) { throw '候选版运行组件缺失。' }

# Match all official package versions, including a process left from an update.
$taskRunning = @(Get-CimInstance Win32_Process | Where-Object {
    $_.Name -eq 'ChatGPT.exe' -and $_.ExecutablePath -and
    $_.ExecutablePath -match '(?i)[\\/]WindowsApps[\\/]OpenAI\.Codex_[^\\/]+[\\/]app[\\/]ChatGPT\.exe$'
})
if ($VerifyOnly) {
    $taskVersion = (& $taskCli --version | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) { throw '候选版运行组件无法执行。' }
    [pscustomobject]@{
        Runtime = $taskRuntime
        Cli = $taskCli
        CliVersion = $taskVersion
        OriginalRunning = $taskRunning.Count -gt 0
        InstalledPackages = @($taskInstalled | ForEach-Object { $_.Version.ToString() })
    } | ConvertTo-Json -Compress
    exit 0
}
if ($taskRunning.Count -gt 0) {
    Write-Host '请等当前任务结束并完全退出原版 Codex，再启动候选版。'
    exit 1
}

$env:CODEX_HOME = Join-Path $env:USERPROFILE '.codex'
$env:CODEX_CLI_PATH = $taskCli
Remove-Item Env:CODEX_CANDIDATES_DEBUG_PORT -ErrorAction SilentlyContinue
Remove-Item Env:CODEX_ELECTRON_USER_DATA_PATH -ErrorAction SilentlyContinue
$taskArgs = @()
if ($ThreadId) { $taskArgs = @('codex://threads/' + $ThreadId) }
if ($taskArgs.Count) { Start-Process -FilePath $taskExe -ArgumentList $taskArgs -WorkingDirectory $taskRuntime }
else { Start-Process -FilePath $taskExe -WorkingDirectory $taskRuntime }
