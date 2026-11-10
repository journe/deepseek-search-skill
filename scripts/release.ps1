#Requires -Version 7.0
<#
.SYNOPSIS
发布新版本：校验仓库状态、运行测试、打标签、推送并创建 GitHub Release。

.DESCRIPTION
版本号支持 1.0.1 或 v1.0.1 两种写法，标签统一为 v 前缀。
默认使用 GitHub 自动生成的发布说明；也可通过 -NotesFile 指定 Markdown 文件。

.PARAMETER Version
要发布的版本号，例如 1.0.1 或 v1.0.1。

.PARAMETER NotesFile
可选的发布说明 Markdown 文件路径。

.PARAMETER DryRun
只做校验和测试，不修改仓库、不推送。

.PARAMETER SkipTests
跳过测试，仅建议在确认测试已在别处通过时使用。

.EXAMPLE
pwsh scripts/release.ps1 1.0.1 -DryRun

.EXAMPLE
pwsh scripts/release.ps1 v1.0.1 -NotesFile ./release-notes.md
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$Version,

    [string]$NotesFile,

    [switch]$DryRun,

    [switch]$SkipTests
)

$ErrorActionPreference = 'Stop'

function Write-Step([string]$Message) {
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Fail([string]$Message) {
    Write-Host "错误：$Message" -ForegroundColor Red
    exit 1
}

function Assert-Ok([string]$Label) {
    if ($LASTEXITCODE -ne 0) {
        Fail "命令失败：$Label"
    }
}

function Resolve-Gh {
    $command = Get-Command gh -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }

    $fallback = Join-Path $env:ProgramFiles 'GitHub CLI\gh.exe'
    if (Test-Path $fallback) { return $fallback }

    Fail '未找到 GitHub CLI，请先安装：winget install --id GitHub.cli -e'
}

$repoRoot = Split-Path $PSScriptRoot -Parent
Set-Location $repoRoot

$normalized = $Version.Trim() -replace '^[vV]', ''
if ($normalized -notmatch '^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$') {
    Fail "版本号格式不正确：$Version（示例：1.0.1 或 v1.0.1）"
}

$tag = "v$normalized"
$gh = Resolve-Gh

Write-Step "版本 $tag，仓库 $repoRoot"

if (-not (Test-Path (Join-Path $repoRoot '.git'))) {
    Fail '当前目录不是 Git 仓库'
}

$branch = (git rev-parse --abbrev-ref HEAD).Trim()
if ($branch -ne 'main') {
    Fail "请在 main 分支发布，当前分支：$branch"
}

$changes = git status --porcelain
if ($changes) {
    Fail "工作区有未提交的改动：`n$changes"
}

$localTag = git tag -l $tag
if ($localTag) {
    Fail "本地已存在标签 $tag"
}

$remoteTag = git ls-remote --tags origin "refs/tags/$tag"
if ($remoteTag) {
    Fail "远程已存在标签 $tag"
}

Write-Step '检查 GitHub 登录状态'
$authStatus = & $gh auth status 2>&1
if ($LASTEXITCODE -ne 0) {
    Fail 'gh 未登录，请先执行：gh auth login --web'
}

if ($NotesFile -and -not (Test-Path $NotesFile)) {
    Fail "找不到发布说明文件：$NotesFile"
}

if (-not $SkipTests) {
    Write-Step '运行测试'
    $tests = Get-ChildItem -Path (Join-Path $repoRoot 'tests') -Filter '*.test.mjs' -File | Sort-Object Name
    if (-not $tests) {
        Fail 'tests 目录下没有 *.test.mjs'
    }
    foreach ($test in $tests) {
        Write-Host "  - $($test.Name)"
        node $test.FullName
        Assert-Ok "node $($test.Name)"
    }
} else {
    Write-Host '已跳过测试（-SkipTests）' -ForegroundColor Yellow
}

if ($DryRun) {
    Write-Step '预演完成，未做任何修改'
    Write-Host "正式执行将：创建标签 $tag、推送 main 与标签、创建 GitHub Release"
    exit 0
}

Write-Step "创建标签 $tag"
git tag -a $tag -m "v$normalized：发布新版本"
Assert-Ok "git tag $tag"

Write-Step '推送提交与标签'
git push origin main
Assert-Ok 'git push origin main'
git push origin $tag
Assert-Ok "git push origin $tag"

Write-Step '创建 GitHub Release'
$releaseArgs = @('release', 'create', $tag, '--title', "$tag - DeepSeek Search Skill")
if ($NotesFile) {
    $releaseArgs += @('--notes-file', (Resolve-Path $NotesFile).Path)
} else {
    $releaseArgs += '--generate-notes'
}
& $gh @releaseArgs
Assert-Ok "gh release create $tag"

Write-Step '发布完成'
& $gh release view $tag --json url --jq '.url'
