# 一键打包：生成 release\桌面待办日历.exe 与 NSIS 安装程序
. (Join-Path $PSScriptRoot '_env.ps1')
Initialize-Console
Write-Banner

Write-Title '环境检查'
Test-Node
$pnpm = Get-Pnpm
Test-Deps $pnpm
$null = Get-Cargo
Test-DiskSpace

Write-Title '开始打包'
$td = if ($env:CARGO_TARGET_DIR) { $env:CARGO_TARGET_DIR } else { Join-Path $Script:Root 'src-tauri\target' }
if (-not (Test-Path (Join-Path $td 'release'))) {
  Write-Bad '首次编译需下载并编译约 600 个依赖，可能耗时 1 小时以上'
}
Write-Note '执行：pnpm tauri build --bundles nsis'
Push-Location $Script:Root
try { & $pnpm tauri build --bundles nsis } finally { Pop-Location }
$code = $LASTEXITCODE
if ($code -ne 0) {
  Write-Fail "打包失败（退出码 $code）"
  Write-Hint '常见原因：C 盘空间不足、内存不足（LNK1102）、GitHub 不可达导致 NSIS 缺失'
  Write-Hint '只要 exe 已经生成，release\桌面待办日历.exe 就能直接用，安装程序不是必需的'
  Pause-Exit $code
}

Write-Title '收集产物'
$out = Join-Path $Script:Root 'release'
New-Item -ItemType Directory -Path $out -Force | Out-Null

$exeSrc = Join-Path (Join-Path $td 'release') 'DesktopTodoCalendar.exe'
if (-not (Test-Path $exeSrc)) { $exeSrc = Join-Path (Join-Path $td 'release') 'desktop-todo-calendar.exe' }
$exeDst = Join-Path $out '桌面待办日历.exe'

if (-not (Test-Path $exeSrc)) {
  Write-Fail '未找到已编译的 exe'
  Pause-Exit 1
}

$busy = @(Get-Process | Where-Object { $_.Path -eq $exeDst })
if ($busy.Count -gt 0) {
  Write-Bad '应用正在运行，exe 被占用 —— 先关闭它再覆盖'
  $busy | Stop-Process -Force
  Start-Sleep 2
}
Copy-Item $exeSrc $exeDst -Force -ErrorAction SilentlyContinue
if ((Test-Path $exeDst) -and ((Get-FileHash $exeSrc).Hash -eq (Get-FileHash $exeDst).Hash)) {
  Write-Ok ('免安装版：' + $exeDst)
} else {
  Write-Fail ('复制失败，' + $exeDst + ' 仍是旧版本，请关闭正在运行的应用后重试')
  Pause-Exit 1
}
$nsisDir = Join-Path (Join-Path $td 'release') 'bundle\nsis'
$setup = Get-ChildItem $nsisDir -Filter '*-setup.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
if ($setup) {
  Copy-Item $setup.FullName $out -Force -ErrorAction SilentlyContinue
  $setupDst = Join-Path $out $setup.Name
  if ((Test-Path $setupDst) -and ((Get-FileHash $setup.FullName).Hash -eq (Get-FileHash $setupDst).Hash)) {
    Write-Ok ('安装程序：' + $setupDst)
  } else { Write-Bad '安装程序复制失败（免安装版仍可用）' }
} else { Write-Bad '未找到 NSIS 安装程序（免安装版仍可用）' }

Write-Host ''
Write-Ok '打包完成，双击 release\桌面待办日历.exe 即可运行'
Start-Process explorer.exe $out
Pause-Exit 0