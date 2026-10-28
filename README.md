# 桌面待办日历

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB.svg)](https://tauri.app)
[![React](https://img.shields.io/badge/React-19-61DAFB.svg)](https://react.dev)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)](#平台支持)

常驻桌面角落的极轻待办日历。启动后只是一条 **264 × 44** 的小长条，点箭头弹簧展开成月历面板，
格子上直接创建、拖拽、拉伸待办，到期前弹系统通知。

**全部离线本地运行** —— 无账号、无云端、无遥测，数据只存在你本机的 SQLite 里。

- 安装包约 8 MB，用 Tauri 2 + 系统 WebView，不是 Electron
- 四种视图（月 / 周 / 日 / 列表）+ 命令面板 + 全局热键
- 中文自然语言速记、农历与法定节假日、番茄钟、完成热力图
- JSON / CSV / ICS 导入导出，每日自动快照

---

## 功能

| | 功能 | 说明 |
| --- | --- | --- |
| 形态 | 单窗口形变 | 长条与面板是同一个窗口，逐帧插值缩放，箭头旋转 180° |
| | 8 方向缩放 | 面板可任意拖拽缩放，位置与尺寸重启后恢复 |
| 待办 | 拖拽改期 | 拖到别的格子就改日期，拖下边缘改结束时间（15 分钟吸附） |
| | 优先级与冲突 | P1–P3 色条；时间重叠的事项会橙色脉冲提示 |
| | 子任务与重复 | 子任务勾选、重复规则（每天 / 每周 / 工作日等） |
| 输入 | 自然语言速记 | 「明天下午三点开会 P1 #工作 @30min」直接解析出日期、优先级、标签、时长 |
| | 命令面板 | `Ctrl/Cmd + K` 模糊搜索待办、命令、跳转日期 |
| 提醒 | 系统通知 | 可设提前量（准时 / 5 分 / 15 分 / 1 小时 / 1 天 / 自定义）与稍后提醒 |
| | 每日晨报 | 早上推一条「今天有 N 件事，其中 P1 有 M 件」 |
| | 应用内通知中心 | 错过通知也能在这里 Snooze / 完成 / 打开 |
| 视图 | 月 / 周 / 日 / 列表 | 窗口窄于 420px 自动切列表视图 |
| | 侧边栏 | 迷你月历、分类勾选、未完成角标 |
| 统计 | 完成热力图 | 年度热力图、连续打卡、P1 完成率、专注时长环形图 |
| 专注 | 番茄钟 | 状态机 + 会话落库，统计页可查 |
| 日历 | 农历与节假日 | 农历、二十四节气、2024–2026 法定节假日与调休，支持手动修正 |
| 安全 | 主密码锁 | `Ctrl/Cmd + L` 遮罩锁定（界面级，非字段加密，见[已知限制](#已知限制)） |
| | 回收站 | 删除进回收站，保留 30 天可还原 |
| 数据 | 导入导出 | JSON 全量、CSV 明细、ICS 日历文件 |
| | 每日快照 | 自动 JSON 快照保留最近 30 份，可同步到指定目录 |
| 系统 | 托盘与自启 | 托盘动态菜单显示今日待办，可开机自启、失焦自动收起 |

---

## 下载安装

### 方式一：预编译包（Windows）

到 [Releases](../../releases) 页面下载：

| 文件 | 说明 |
| --- | --- |
| `DesktopTodoCalendar_0.1.0_x64-setup.exe` | NSIS 安装程序，当前用户安装，免管理员权限 |
| `桌面待办日历.exe` | 免安装版，双击即用（前端资源与图标已内嵌） |

只需要系统自带的 **WebView2 Runtime**（Win10/11 一般已预装），其余全部打包进 exe。

> macOS / Linux 暂无预编译包，需按下面的方式自行构建。

### 方式二：从源码构建

见[从源码运行](#从源码运行)与[打包](#打包)。

---

## 从源码运行

### 环境要求

| 依赖 | 版本 | 说明 |
| --- | --- | --- |
| Node.js | >= 20 | 前端构建 |
| pnpm | >= 9 | 包管理，**不要用 npm / yarn** |
| Rust | >= 1.77.2 | 仅打包桌面应用时需要 |
| Windows | VS 2022「使用 C++ 的桌面开发」+ WebView2 Runtime | |
| macOS | Xcode Command Line Tools（`xcode-select --install`） | |
| Linux | `libwebkit2gtk-4.1-dev`、`libgtk-3-dev`、`libayatana-appindicator3-dev` | 托盘依赖 appindicator |

### 常用命令

```bash
pnpm install        # 安装依赖

pnpm dev            # 纯前端预览 http://localhost:1420（不需要 Rust，看 UI 最快）
pnpm app:dev        # 桌面开发模式（热重载 + 原生能力全开，首次编译 Rust 约 3–8 分钟）
pnpm build          # 类型检查 + 前端构建
pnpm icon           # 重新生成图标
```

> `pnpm dev` 在浏览器里跑：没有 Tauri 环境，存储自动降级为内存实现（带几条示例数据），
> 窗口形变、托盘、系统通知、全局热键全部 no-op。**仅用于看 UI，刷新即丢。**

### 打包

```bash
pnpm app:build -- --bundles nsis        # Windows：NSIS 安装包（当前用户，免管理员）
pnpm app:build -- --bundles msi         # Windows：MSI
pnpm app:build -- --bundles app,dmg     # macOS：.app + .dmg
```

产物在 `src-tauri/target/release/bundle/`（若设置了 `CARGO_TARGET_DIR`，则在该目录的 `release/bundle/` 下）。
Windows 上也可以直接双击 `打包exe.bat`，脚本会检查环境、打包并把成品复制到 `release\`。

---

## 使用

### 快捷键

| 键 | 作用 |
| --- | --- |
| `Ctrl/Cmd + Shift + Q` | **全局**展开 / 收起，窗口失焦也生效 |
| `Ctrl/Cmd + K` | 命令面板 |
| `Ctrl/Cmd + N` | 新建待办 |
| `Ctrl/Cmd + F` | 聚焦搜索框 |
| `Ctrl/Cmd + 1 / 2 / 3 / 4` | 月 / 周 / 日 / 列表视图 |
| `Ctrl/Cmd + ,` | 打开设置 |
| `Ctrl/Cmd + L` | 锁定应用（需先在设置里开启主密码） |
| `?` | 快捷键总览 |
| `Esc` | 逐层关闭弹层 / 收起面板 |
| 双击格子 | 在该日新建待办 |
| 拖动待办条 | 改期到目标格子 |
| 拖动下边缘 | 调整结束时间（15 分钟吸附） |
| `Tab`（标题框内） | 应用自然语言解析结果 |
| `Ctrl/Cmd + 点击` | 多选，唤起底部批量工具栏 |

### 搜索语法

搜索框与命令面板都支持筛选词：

```text
#工作 p:1 is:open after:today 会议
```

`#标签`、`p:1`–`p:3`、`is:done` / `is:open` / `is:overdue`、`after:` / `before:` / `on:` + 日期，可与关键词混用。

### 数据目录

| 平台 | 路径 |
| --- | --- |
| Windows | `%APPDATA%\com.desktop.todocalendar\` |
| macOS | `~/Library/Application Support/com.desktop.todocalendar/` |
| Linux | `~/.local/share/com.desktop.todocalendar/` |

里面是 `todocalendar.db`（含 `-wal` / `-shm`）、`backups/`（每日快照）、`attachments/`（附件）、`logs/`。
「设置 → 数据目录」可直接打开；「设置 → 同步目录」会每天把库与备份复制过去。

卸载应用不会删除这个目录，备份直接拷走即可。

---

## 技术栈

Tauri 2（Rust）· React 19 · TypeScript 5 · Vite 6 · Tailwind CSS 3 · Framer Motion 11 ·
Zustand 5 · SQLite（`tauri-plugin-sql` + sqlx）· date-fns 4 · chrono-node · lucide-react

| 关注点 | 做法 |
| --- | --- |
| 存储 | SQLite，WAL + `busy_timeout`；schema 与迁移的唯一真源在 Rust 侧（`PRAGMA user_version` 递增），前端不碰 DDL |
| 窗口 | 无边框 + 透明 + 置顶，单窗口形变；位置与展开状态存在 `app_state` 表 |
| 动画 | 窗口尺寸用 `requestAnimationFrame` 逐帧插值，内容层交给 Framer Motion，尊重 `prefers-reduced-motion` |
| 提醒 | 三个 `tokio::time::interval`（到期扫描 15s / 晨报 60s / 快照 1h），无阻塞 sleep，每次发送写 `reminders_log` |
| 农历 | 纯算法实现（1900–2100 压缩表），不引第三方农历包 |
| ICS | 手写解析 / 生成，不带重量级依赖 |

### 项目结构

```text
src/                 前端
├─ components/       界面组件（Dock / Panel / 抽屉 / 弹层 / 统计页 …）
├─ views/            月 / 周 / 日 / 列表四种视图
├─ store/            Zustand：待办、设置、UI、番茄钟
├─ hooks/            窗口形变、热键、托盘、通知、NLP、主题 …
├─ lib/              存储层、时间与重复规则、农历、搜索、统计
└─ data/             法定节假日与节气数据
src-tauri/           Rust 侧
├─ src/db.rs         连接池 + schema 迁移
├─ src/scheduler.rs  提醒 / 晨报 / 快照定时任务
├─ src/commands.rs   全部 #[tauri::command] 入口
├─ src/tray.rs       托盘图标与动态菜单
├─ src/backup.rs     快照、CSV 导出、指定目录同步
└─ src/ics.rs        iCalendar 解析与生成
scripts/             图标生成、节假日数据生成、Windows 一键脚本
```

---

## 平台支持

| 能力 | Windows | macOS | Linux | 不支持时 |
| --- | --- | --- | --- | --- |
| 系统通知 | 是 | 是 | 是（libnotify） | 权限被拒 → 写日志 + 设置页给引导文案 |
| 系统托盘 | 是 | 是 | 需 appindicator | 托盘创建失败退化为「仅窗口模式」 |
| 开机自启 | 注册表 Run | LaunchAgent | .desktop | 失败弹 toast，不影响使用 |
| 毛玻璃 | Win11 需 Mica/Acrylic | 是（vibrancy） | 否 | `backdrop-filter` + 半透明底色兜底 |
| 通知内按钮 | 否 | 否 | 否 | 桌面端插件不支持 action，改用应用内通知中心 |

> 开发和打包主要在 Windows 上完成，macOS / Linux 的构建尚未充分验证，欢迎提交 PR。

---

## 已知限制

- **应用锁是界面遮罩 + 主密码校验，不是字段级加密**。数据库文件本身未加密，需要真加密请自行放在加密磁盘上。
- **没有自动更新**。当前构建不含下载器，也不会发起任何网络请求，升级请手动下载新版本。
- **ICS 订阅链接未实现**，只支持文件导入 / 导出；带 `TZID` 的跨时区事件按本机时区解释，可能有小时级偏移。
- 月视图在单月超过约 2000 条事项时没有做格子内虚拟滚动，数据量极大时可能掉帧。
- 形变动画每帧发起 2 次 IPC（`setSize` + `setPosition`），极低端机可能掉到 40 fps 左右。
- 2026 年法定节假日为预发布数据，国务院正式通知后需要更新 `src/data/holidays-cn.json`（也可在应用内手动修正）。

计划中：Rust 侧接入 `cargo check` CI、单月虚拟滚动、WebDAV 同步、字段级加密、签名更新器、纯函数单元测试。

---

## 常见问题

**打包报 `LNK1102: 内存不足` / `memory allocation of N bytes failed`**

不是编译器 bug。系统盘（页面文件所在盘）可用空间不足 1 GB 时，链接期提交内存会耗尽。
把工具链与产物挪到其他分区，并限制并行度：

```bash
# 用户环境变量
setx CARGO_TARGET_DIR D:\RustDev\target
setx CARGO_HOME D:\RustDev\cargo
setx RUSTUP_HOME D:\RustDev\rustup

cargo build -j 2
```

`scripts\_env.ps1` 会读取 `TODOCAL_RUST_HOME` 自动接管这三个变量，未设置则回退用户目录。
release profile 已用 `lto = "thin"` + `codegen-units = 8` 降低链接期内存峰值。

**启动报 `invalid type: map, expected unit`**

`tauri.conf.json` 的 `plugins` 里只能给「有配置类型」的插件写条目（`sql`、`shell`）。
给 `notification` / `global-shortcut` / `autostart` / `os` / `process` / `dialog` 写 `{}` 会导致整个应用启动失败，删掉即可。

**`tauri build` 报权限 id 不存在**

`src-tauri/capabilities/default.json` 里每个权限 id 必须真实存在。例如 `os` 插件没有 `theme` 命令（窗口主题用 `core:window:allow-theme`）。

**Vite 起不来 / esbuild 没执行 postinstall**

`pnpm-workspace.yaml` 里必须保留 `onlyBuiltDependencies: [esbuild]`，删掉会导致 esbuild 跳过构建脚本。

**Windows 上 `program not found`**

`tauri.conf.json` 的 `beforeDevCommand` / `beforeBuildCommand` 走 `pnpm`，万一解析不到就改成 `pnpm.cmd dev` / `pnpm.cmd build`。
PowerShell 禁用脚本执行时同理，直接调用 `pnpm.cmd`。

**打包时 NSIS 下载失败**

无外网环境可提前把 NSIS 工具放到 `%LOCALAPPDATA%\tauri\NSIS` 并核对官方 SHA1；只有免安装版 exe 也能正常使用。

---

## 参与贡献

欢迎 issue 与 PR。提交前请跑一遍：

```bash
pnpm typecheck && pnpm build
```

---

## 许可证

[MIT License](./LICENSE) —— 可自由使用、修改、分发，包括商业用途，保留版权声明即可。
