# 共享环境与辅助函数（必须以 UTF-8 BOM 保存，否则 PowerShell 5.1 会按 GBK 解析）
$Script:Root = Split-Path -Parent $PSScriptRoot

function Write-Title([string]$t) { Write-Host ''; Write-Host "=== $t ===" -ForegroundColor Cyan }
function Write-Ok([string]$t)    { Write-Host "[OK] $t" -ForegroundColor Green }
function Write-Note([string]$t)  { Write-Host "[..] $t" -ForegroundColor Gray }
function Write-Bad([string]$t)   { Write-Host "[!!] $t" -ForegroundColor Yellow }
function Write-Fail([string]$t)  { Write-Host "[XX] $t" -ForegroundColor Red }
function Write-Hint([string]$t)  { Write-Host "      $t" -ForegroundColor DarkGray }

function Pause-Exit([int]$code = 0) {
  Write-Host ''
  if ($code -eq 0) { Write-Host '完成，按任意键关闭窗口...' -ForegroundColor Green }
  else { Write-Host "失败（退出码 $code），按任意键关闭窗口..." -ForegroundColor Red }
  try { [void][Console]::ReadKey($true) } catch { [void](Read-Host '回车关闭') }
  exit $code
}

function Initialize-Console {
  try { chcp 65001 > $null } catch {}
  try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
  $global:OutputEncoding = [System.Text.Encoding]::UTF8
}

# 可选：把 Rust 工具链与构建产物放到其他分区（系统盘紧张时很有用）。
# 设置环境变量 TODOCAL_RUST_HOME 指向目标目录（例如 D:\RustDev），下面的逻辑会自动接管；
# 未设置或不存时回退到 %USERPROFILE%\.cargo / %USERPROFILE%\.rustup / src-tauri\target。
function Initialize-RustEnv {
  $alt = $env:TODOCAL_RUST_HOME
  if (-not $alt) { $alt = '' }
  if (-not $env:CARGO_HOME -or -not (Test-Path $env:CARGO_HOME)) {
    if ($alt -and (Test-Path "$alt\cargo\bin\cargo.exe")) { $env:CARGO_HOME = "$alt\cargo" }
    else { $env:CARGO_HOME = "$env:USERPROFILE\.cargo" }
  }
  if (-not $env:RUSTUP_HOME -or -not (Test-Path $env:RUSTUP_HOME)) {
    if ($alt -and (Test-Path "$alt\rustup") ) { $env:RUSTUP_HOME = "$alt\rustup" }
    else { $env:RUSTUP_HOME = "$env:USERPROFILE\.rustup" }
  }
  if (-not $env:CARGO_TARGET_DIR) {
    if ($alt -and (Test-Path $alt)) { $env:CARGO_TARGET_DIR = "$alt\target" }
  }
  $env:PATH = "$env:CARGO_HOME\bin;$env:PATH"
}

function Write-Banner {
  Write-Host ''
  Write-Host '   桌面待办日历 / Desktop Todo Calendar' -ForegroundColor Cyan
  Write-Host '   Tauri 2 + React 19 + TypeScript + SQLite' -ForegroundColor DarkGray
  Write-Host ''
}

function Test-Node {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Fail '未检测到 Node.js（需要 >= 20）'
    Write-Hint '请先安装：https://nodejs.org/zh-cn  然后重新双击运行'
    Pause-Exit 1
  }
  $v = (& node -v) -replace '^v', ''
  if ([int](($v -split '\.')[0]) -lt 20) { Write-Fail "Node.js 版本过低：v$v"; Pause-Exit 1 }
  Write-Ok "Node.js v$v"
}
function Get-Pnpm {
  $cmd = Get-Command pnpm.cmd -ErrorAction SilentlyContinue
  if (-not $cmd) {
    Write-Note '未找到 pnpm，正在安装...'
    & npm.cmd install -g pnpm 2>&1 | Out-Null
    $cmd = Get-Command pnpm.cmd -ErrorAction SilentlyContinue
  }
  if (-not $cmd) { Write-Fail 'pnpm 不可用，请手动执行：npm install -g pnpm'; Pause-Exit 1 }
  Write-Ok ("pnpm " + (& pnpm.cmd -v))
  return $cmd.Source
}

function Test-Deps([string]$pnpm) {
  # 只判目录是否存在会漏掉「目录在但内容被清空」的坏状态（pnpm 链接被清理后很常见），
  # 因此校验一个真实文件：vite 的类型声明 + react 的类型声明
  $ok = (Test-Path (Join-Path $Script:Root 'node_modules\vite\client.d.ts')) -and
        (Test-Path (Join-Path $Script:Root 'node_modules\@types\react\index.d.ts'))
  if ($ok) { Write-Ok '前端依赖已就绪'; return }
  Write-Note '正在安装前端依赖（约 2-5 分钟）...'
  Push-Location $Script:Root
  try { & $pnpm install } finally { Pop-Location }
  if ($LASTEXITCODE -ne 0) {
    Write-Fail '依赖安装失败'
    Write-Hint '若是 EPERM: unlink ...\pnpm\store\v11\projects\<hash>：删掉该目录或改用 pnpm install --store-dir=<另一路径> 后重试'
    Pause-Exit $LASTEXITCODE
  }
  Write-Ok '前端依赖安装完成'
}
function Get-Cargo {
  Initialize-RustEnv
  $c = Get-Command cargo.exe -ErrorAction SilentlyContinue
  if (-not $c) {
    Write-Fail '未检测到 Rust 工具链（cargo）'
    Write-Hint '若工具链装在非默认目录，请设置环境变量 TODOCAL_RUST_HOME 指向该目录'
    Write-Hint '如已丢失，请重新安装：https://rustup.rs'
    Pause-Exit 1
  }
  Write-Ok ("Rust " + (& rustc.exe -V))
  Write-Hint ("构建产物目录 = " + $(if ($env:CARGO_TARGET_DIR) { $env:CARGO_TARGET_DIR } else { 'src-tauri\target' }))
  return $c.Source
}

function Test-DiskSpace {
  $free = [math]::Round((Get-PSDrive C).Free / 1GB, 2)
  if ($free -lt 2) {
    Write-Bad "C 盘仅剩 $free GB（页面文件在 C 盘，编译时可能报 LNK1102 内存不足）"
    Write-Hint '建议关闭部分后台程序，或清理 C 盘后重试'
  } else {
    Write-Ok "C 盘可用 $free GB"
  }
}