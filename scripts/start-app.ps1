# 启动已打包好的桌面应用（无需编译）
. (Join-Path $PSScriptRoot '_env.ps1')
Initialize-Console
Write-Banner

$exe = Join-Path $Script:Root 'release\桌面待办日历.exe'
if (-not (Test-Path $exe)) { $exe = Join-Path $Script:Root 'release\DesktopTodoCalendar.exe' }

if (-not (Test-Path $exe)) {
  Write-Fail '还没有可执行文件'
  Write-Hint '请先双击项目根目录的「打包exe.bat」生成 release\桌面待办日历.exe'
  Pause-Exit 1
}

Write-Title '启动应用'
Write-Ok $exe
Write-Hint '程序常驻桌面右上角；托盘图标右键可退出。若已在运行，则只会把已有窗口带到前台。'
Start-Process -FilePath $exe
Pause-Exit 0