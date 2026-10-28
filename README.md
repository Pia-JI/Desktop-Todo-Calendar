# 桌面待办日历（Desktop Todo Calendar）

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Tauri 2](https://img.shields.io/badge/Tauri-2-24C8DB.svg)](https://tauri.app)
[![React 19](https://img.shields.io/badge/React-19-61DAFB.svg)](https://react.dev)

常驻桌面右下角的轻量待办日历：启动后是一条「收缩态小长条」，点箭头弹簧展开成月历面板；
格子上可直接创建 / 拖拽 / 拉伸待办，到期前弹系统通知。**全部离线本地运行，无账号、无云端。**

- 框架：Tauri 2（Rust）+ React 19 + TypeScript + Vite 6
- 样式：Tailwind CSS 3 + CSS Variables 主题系统（亮 / 暗 / 跟随系统）
- 动画：Framer Motion 11（spring）+ CSS transition；尊重 `prefers-reduced-motion`
- 存储：SQLite（`tauri-plugin-sql`，Rust 侧持有 schema 与迁移，WAL）
- 其他：Zustand 5（持久化）、date-fns 4 + date-fns-tz、chrono-node（中文自然语言）、lucide-react

---

## 一、快速开始

### 已经打包好了：直接双击运行

| 文件 | 说明 |
| --- | --- |
| `release\桌面待办日历.exe` | **免安装版**，双击即用（7.9 MB，前端资源与图标已内嵌） |
| `release\DesktopTodoCalendar_0.1.0_x64-setup.exe` | NSIS 安装程序（2.7 MB，当前用户安装，免管理员权限） |
| `启动应用.bat` | 双击启动上面的 exe |
| `打包exe.bat` | 双击重新打包（改完代码后用） |

- 运行依赖：只需系统自带的 WebView2 Runtime（Win10/11 一般已预装），其余全部打包进 exe。
- 数据目录：`%APPDATA%\com.desktop.todocalendar\`（SQLite 数据库 + 日志 + 每日快照）。
- 退出方式：托盘图标右键 → 退出。程序常驻桌面右上角，重复启动只会把已有窗口带到前台。

### 构建环境调优（可选）

Rust 首次编译需要数 GB 磁盘空间和较多提交内存。如果系统盘吃紧，可以把工具链与产物挪到其他分区，
用三个环境变量控制（写进用户环境变量，或直接改 `scripts\_env.ps1` 里的默认目录）：

| 变量 | 建议值 | 说明 |
| --- | --- | --- |
| `RUSTUP_HOME` | `<OtherDrive>\RustDev\rustup` | rustup 工具链与已安装 target |
| `CARGO_HOME` | `<OtherDrive>\RustDev\cargo` | crate 缓存；`config.toml` 可配国内镜像加速 |
| `CARGO_TARGET_DIR` | `<OtherDrive>\RustDev\target` | 构建产物（最占空间的一项） |

`scripts\_env.ps1` 的 `Initialize-RustEnv` 会做自适应兜底：设置过就沿用，没设置则回退到
`%USERPROFILE%\.cargo` / `%USERPROFILE%\.rustup` / `src-tauri\target`。

> **踩过的坑（重要）**：系统盘（页面文件所在盘）可用空间 < 1 GB 时，`cargo build` 会报
> `LNK1102: 内存不足` 或 `memory allocation of N bytes failed`，
> 看起来像编译器 bug，实际是页面文件无法增长导致的提交内存耗尽。
> 因此 `src-tauri/Cargo.toml` 的 release profile 已从 `lto = true` + `codegen-units = 1`
> 调整为 `lto = "thin"` + `codegen-units = 8`，显著降低链接期内存峰值，体积只增大约 3%。
> 编译时建议限制并行度（如 `cargo build -j 2`），按可用提交内存调整。

耗时量级参考：首次 release 全量编译约 1 小时（取决于并行度与磁盘）；
之后只改 Rust 代码增量编译约 2 分钟，只改前端约 40 秒。

> **打包机无外网时**：NSIS 依赖会下载失败，可提前把 NSIS 工具放到 `%LOCALAPPDATA%\tauri\NSIS`，
> 并核对官方 SHA1 后再打包。

### 前置依赖

| 依赖 | 版本要求 | 说明 |
| --- | --- | --- |
| Node.js | >= 20（推荐 22 LTS 及以上） | 前端构建 |
| pnpm | >= 9（推荐 10+） | 包管理，**不要用 npm/yarn**（见 `pnpm-workspace.yaml`） |
| Rust | >= 1.77.2（tauri 2.11 MSRV） | 仅打包桌面应用时需要 |
| Windows | VS 2022「使用 C++ 的桌面开发」+ WebView2 Runtime | WebView2 在 Win10/11 一般已预装 |
| macOS | Xcode Command Line Tools | `xcode-select --install` |
| Linux | `libwebkit2gtk-4.1-dev`、`libgtk-3-dev`、`libayatana-appindicator3-dev` | 托盘依赖 appindicator |

### 安装

```bash
pnpm install
```

> `pnpm-workspace.yaml` 里保留了 `onlyBuiltDependencies: [esbuild]` / `allowBuilds: esbuild: true`。
> 删掉会导致 esbuild 不执行 postinstall，Vite 直接起不来。

### 三种运行方式

**1）纯前端预览（不需要 Rust，最快看到 UI）**

```bash
pnpm dev          # http://localhost:1420
```

浏览器里没有 `__TAURI_INTERNALS__`，`src/lib/db.ts` 自动降级为内存存储（`MemoryRepo`，带 5 条示例数据），
窗口形变 / 托盘 / 系统通知 / 全局热键全部 no-op。**仅用于 UI 演示，数据刷新即丢。**

**2）桌面开发模式（热重载 + 原生能力全开）**

```bash
pnpm app:dev      # = tauri dev，首次会编译 Rust 依赖，约 3-8 分钟
```

**3）打包**

```bash
# Windows：NSIS 安装包（currentUser，无需管理员权限）
pnpm app:build -- --bundles nsis

# Windows：MSI
pnpm app:build -- --bundles msi

# macOS：.app + .dmg
pnpm app:build -- --bundles app,dmg

# 只做前端类型检查 + 构建（不碰 Rust）
pnpm build        # tsc --noEmit && vite build
pnpm typecheck
```

产物默认在 `src-tauri/target/release/bundle/`；若设置了 `CARGO_TARGET_DIR`，则输出在该目录的
`release/bundle/` 下，`打包exe.bat` 会自动把成品复制到项目的 `release\` 目录。

> **Windows 排错**：`tauri.conf.json` 里 `beforeDevCommand` / `beforeBuildCommand` 走的是 `pnpm`。
> tauri-cli 在 Windows 上用 `cmd /C` 拉起，正常能解析到 `pnpm.cmd`；万一报
> `program not found`，把它们改成 `pnpm.cmd dev` / `pnpm.cmd build` 即可。
> 另外 PowerShell 若禁用了脚本执行（`cannot be loaded because running scripts is disabled`），
> 直接调用 `pnpm.cmd` 而不是 `pnpm`。

### 图标重生成

```bash
pnpm icon         # scripts/make-icon.mjs 生成 app-icon.png，再 tauri icon 铺全平台
```

---

## 二、目录树与每文件作用

```text
桌面待办日历/
├─ index.html                     单页入口，内联首屏骨架屏 CSS，避免白屏
├─ package.json                   脚本与依赖（dev / build / app:dev / app:build / icon）
├─ pnpm-workspace.yaml            pnpm 构建白名单（esbuild 必须放行）
├─ tsconfig.json                  前端 TS 配置：strict + noUnusedLocals/Parameters
├─ tsconfig.node.json             vite.config.ts 自身的 TS 配置
├─ vite.config.ts                 @ 别名、1420 固定端口、manualChunks 分包
├─ tailwind.config.ts             主题色 → CSS 变量（rgb 三元组）映射
├─ postcss.config.js              tailwindcss + autoprefixer
├─ .gitignore
├─ scripts/
│  ├─ make-icon.mjs               纯 Node 生成 1024x1024 app-icon.png（无原生依赖）
│  └─ gen-holidays.mjs            生成 src/data/holidays-cn.json（法定假日 + 调休 + 节气）
├─ src/
│  ├─ main.tsx                    React 挂载入口
│  ├─ App.tsx                     根组件：Dock/Panel 二态 + 全部弹层
│  ├─ types/index.ts              Todo / Subtask / CalendarCategory / PomodoroSession 等全部领域类型
│  ├─ styles/
│  │  ├─ themes.css               亮/暗两套 CSS 变量（严格按规范色值）
│  │  └─ globals.css              Tailwind 入口 + 滚动条/focus-visible/毛玻璃等基础样式
│  ├─ data/holidays-cn.json       2024–2026 中国法定节假日、调休上班日、二十四节气
│  ├─ components/
│  │  ├─ Dock.tsx                 收缩态长条：三种显示模式、过期红点呼吸、拖拽移动、右键菜单
│  │  ├─ Panel.tsx                展开态外壳：顶栏 + 边栏 + 视图 + 8 方向 resize 手柄
│  │  ├─ TopBar.tsx               月份切换 / 视图切换 / 搜索 / 主题 / 设置
│  │  ├─ Sidebar.tsx              可折叠边栏：迷你月历、日历分类勾选、未完成角标、今日入口
│  │  ├─ MiniCalendar.tsx         边栏迷你月历（农历角标、点击跳转）
│  │  ├─ TodoBar.tsx              单条待办条：优先级色条、拖拽、下边缘 resize、勾选动画
│  │  ├─ TodoDrawer.tsx           创建/编辑抽屉：NLP 速记、子任务、附件、重复提醒、专注
│  │  ├─ BatchBar.tsx             多选底部工具栏：批量完成/改期/删除/加标签
│  │  ├─ CommandPalette.tsx       Ctrl/Cmd+K：模糊搜索 + 命令 + 跳日期，按最近使用排序
│  │  ├─ ContextMenu.tsx          通用右键菜单 + ContextMenuHost
│  │  ├─ Dialog.tsx               通用对话框（二次确认走这里）
│  │  ├─ SettingsDialog.tsx       设置页：主题/自启/失焦收起/提前量/晨报/农历/数据目录/锁定/导入导出（JSON·CSV·ICS）
│  │  ├─ ShortcutsDialog.tsx      快捷键总览（? 唤起）
│  │  ├─ NotificationCenter.tsx   应用内通知中心：Snooze 5/10/30、完成、打开事项
│  │  ├─ Toasts.tsx               Undo toast（滑入，5 秒）
│  │  ├─ StatsView.tsx            统计页：完成数/专注时长/环形图/年度热力图/连续打卡
│  │  ├─ WeeklyReview.tsx         周日晚周回顾弹窗（可关闭）
│  │  ├─ RecycleBin.tsx           回收站：30 天保留、还原、清空（二次确认）
│  │  ├─ LockScreen.tsx           主密码锁屏遮罩（Ctrl/Cmd+L）
│  │  ├─ HolidaysDialog.tsx       节假日/农历手动修正
│  │  ├─ DiagnosticsView.tsx      故障排查：通知发送记录、错误日志、导出诊断包
│  │  └─ EmptyState.tsx           空状态插画 + 引导文案
│  ├─ views/
│  │  ├─ MonthView.tsx            月视图：date-fns 六周矩阵、+N 溢出、拖拽改期、冲突橙框 pulse
│  │  ├─ WeekView.tsx             周视图：七天横向卡片 + 列表汇总
│  │  ├─ DayView.tsx              日视图：00:00–24:00 小时网格、当前时间红线、点空白快速新建
│  │  └─ ListView.tsx             列表视图（紧凑模式 <=420px 自动切这里）
│  ├─ store/
│  │  ├─ ui.ts                    展开态/视图/日期/弹层/toast/锁定等 UI 状态（持久化）
│  │  ├─ todos.ts                 待办领域状态：CRUD、软删除、批量、Undo、重复实例生成
│  │  ├─ settings.ts              全部设置项（持久化，Rust 侧也读这张表）
│  │  ├─ focus.ts                 番茄钟状态机 + 会话落库
│  │  └─ menu.ts                  右键菜单状态
│  ├─ hooks/
│  │  ├─ useMorphWindow.ts        收缩↔展开形变编排（rAF 逐帧 setSize/setPosition）
│  │  ├─ useHotkeys.ts            全局与应用内快捷键
│  │  ├─ useTray.ts               托盘事件监听 + 数据变化后 refresh_tray
│  │  ├─ useNotifications.ts      权限请求、Rust 推来的提醒事件、铃铛角标
│  │  ├─ usePomodoro.ts           番茄钟 ticker
│  │  ├─ useNlp.ts                chrono-node 中文解析 + #标签 / P1 / @30min token
│  │  ├─ useHolidays.ts           节假日 + 农历 + 用户修正合并
│  │  ├─ useTheme.ts              主题应用（system 跟随 matchMedia）
│  │  ├─ useNow.ts                1 分钟 tick 的「现在」
│  │  └─ reminderTypes.ts         提醒提前量枚举（准时/5分/15分/1小时/1天/自定义）
│  └─ lib/
│     ├─ db.ts                    存储层：SqlRepo（SQLite）/ MemoryRepo（浏览器预览）
│     ├─ repo.ts                  领域对象 ↔ 数据库行的读写封装
│     ├─ case.ts                  camelCase ↔ snake_case 映射（含各表布尔字段清单）
│     ├─ kvstorage.ts             Zustand persist 适配器：每个顶层键写 settings 表一行
│     ├─ window.ts                窗口几何、工作区吸附、rAF 形变动画
│     ├─ date.ts                  六周矩阵、时间网格、重叠判断、重复规则展开
│     ├─ lunar.ts                 农历/节气/传统节日纯算法实现（无外部数据表）
│     ├─ nlp.ts                   速记解析：chrono-node + #标签 + P1-P3 + @时长
│     ├─ search.ts                搜索与筛选语法：#工作 p:1 is:done after:today
│     ├─ fuzzy.ts                 命令面板模糊匹配打分
│     ├─ query.ts                 查询串解析
│     ├─ stats.ts                 统计聚合：周/月完成、热力图、连续打卡、P1 完成率
│     ├─ colors.ts                分类色板与对比度取色
│     ├─ todoMenu.ts              待办右键菜单项定义
│     ├─ platform.ts              Tauri 环境判定 + invoke 包装（非 Tauri 优雅降级）
│     └─ util.ts                  uid / nowIso / clamp / 防抖等
└─ src-tauri/
   ├─ tauri.conf.json             窗口（无边框/透明/置顶）、CSP、asset 协议、打包目标
   ├─ Cargo.toml                  Rust 依赖与 release 体积优化（lto + opt-level=s + strip）
   ├─ build.rs                    tauri-build
   ├─ capabilities/default.json   ACL 权限清单（core:* / sql / notification / dialog / fs …）
   ├─ icons/                      全平台图标（tauri icon 生成）
   └─ src/
      ├─ main.rs                  二进制入口（release 隐藏控制台窗口）
      ├─ lib.rs                   Tauri Builder：插件注册、setup、窗口事件、AppState
      ├─ db.rs                    SQLite 连接池 + schema/迁移（PRAGMA user_version）+ 领域查询
      ├─ scheduler.rs             tokio 定时：到期扫描 15s / 晨报 60s / 快照 1h（全非阻塞）
      ├─ notify.rs                系统通知发送与权限状态（含平台能力说明）
      ├─ tray.rs                  托盘图标 + 动态菜单（今日最多 5 条）+ 快捷操作
      ├─ win.rs                   窗口几何常量与位置持久化（app_state 表）
      ├─ commands.rs              全部 #[tauri::command]（前端 invoke 的唯一入口）
      ├─ ics.rs                   iCalendar 解析/生成（手写，无 heavy dep）
      ├─ backup.rs                JSON 快照 / CSV 导出 / 导入 / 指定目录同步（原子替换）
      ├─ attachments.rs           附件复制到 app_data/attachments，路径穿越防护，<=10MB
      ├─ logs.rs                  环形日志（内存 800 条）+ 按天落盘
      ├─ serialize.rs             sqlx Row → serde_json::Value
      ├─ timeutil.rs              UTC 存储 / 本地显示的全部时间换算
      └─ error.rs                 AppError（序列化成字符串给前端 toast）
```

---

## 三、关键设计

### 单窗口形变，而不是两个窗口
收缩态和展开态是**同一个 Tauri 窗口**：`useMorphWindow` 用 `requestAnimationFrame` 逐帧
`setSize` + `setPosition`（`src/lib/window.ts:116`）做 easeOutCubic 插值，内容层的淡入/交错入场交给
Framer Motion。这样箭头旋转 180°、面板从长条中心展开的「同一物体形变」观感才成立。

- 常量：DOCK 264×44、PANEL 760×560、四周 12px 透明外边距（画阴影用）、COMPACT_W 420
- 窗口 `decorations:false` + `transparent:true` + `alwaysOnTop:true`；面板 8 个方向用
  `startResizeDragging` 做原生缩放
- 位置持久化在 SQLite `app_state` 表（`windowRect` / `windowExpanded`），重启恢复

### 存储分层
| 数据 | 落地位置 |
| --- | --- |
| 待办 / 子任务 / 分类 / 专注会话 / 外部日历 / 提醒日志 / 快照索引 | SQLite 业务表 |
| Zustand 持久化状态（设置、UI 偏好） | SQLite `settings` 表，每个顶层键一行（`src/lib/kvstorage.ts`） |
| 窗口位置、晨报/快照「上次执行日期」 | SQLite `app_state` 表 |
| 附件二进制 | `<app_data>/attachments/`，库里只存相对路径 |

**没有用 localStorage 存任何业务数据**（规范禁止）。Rust 与前端各持一个连接池指向同一个
`<app_data>/todocalendar.db`，靠 WAL + `busy_timeout` 保证并发写安全。

- Schema 唯一真源是 Rust（`src-tauri/src/db.rs`），`SCHEMA_VERSION` + `PRAGMA user_version` 递增迁移
- 前端 `waitForSchema()` 会等 `todos` 表出现再放行，规避首帧 JS 抢在迁移之前的竞态
- 浏览器预览走 `MemoryRepo`，UI 逻辑零改动

### 提醒可靠性
`scheduler.rs` 三个 `tokio::time::interval`，**没有阻塞式 sleep**：

1. 到期扫描（15s）：取未完成事项 → 按 `remindBeforeSec` / `snoozeUntil` / 重复提醒间隔判定 →
   发系统通知 + `app://reminder-fired` 事件给前端铃铛。超过 24h 的历史事项不补发，避免启动刷屏。
2. 每日晨报（60s 检查一次是否跨天 + 到点）：`今天有 N 件事，其中 P1 有 M 件`。
3. 每日快照（启动 8s 后 + 每小时检查跨天）：JSON 全量快照到 `backups/`，保留最近 30 份，
   可选同步到用户指定目录。

每次发送都写 `reminders_log`，「故障排查」页可查、可导出诊断包。

### 配置注意事项（两个必踩的坑）

1. **`tauri.conf.json > plugins` 只能给「有配置类型」的插件写条目。**
   `tauri-plugin-sql`（`Option<PluginConfig>`）和 `tauri-plugin-shell`（`Option<Config>`）可以写；
   而 `notification` / `global-shortcut` / `autostart` / `os` / `process` / `dialog` 的 `init()`
   返回的是 `TauriPlugin<R>`（配置类型为 `()`）。Tauri 用
   `serde_json::from_value::<C>(plugins[名字])` 反序列化，键缺失时给 `Null`（→ `()` 正常），
   但写成 `"notification": {}` 会报
   `Error deserializing 'plugins.notification' within your Tauri configuration: invalid type: map, expected unit`
   然后**整个应用启动失败**。autostart 的 `macosLauncher` / `args` 只能在 Rust 里传：
   `tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec!["--minimized"]))`。
2. **`capabilities/default.json` 里每一个权限 id 都必须真实存在**，写错一个 `tauri build` 直接失败。
   已逐个核对：`os` 插件**没有** `theme` 命令（窗口主题要用 `core:window:allow-theme`）；
   `dialog:allow-ask` / `dialog:allow-confirm` 在插件里只是 `allow-message` 的废弃别名，
   `dialog:default` 已覆盖，所以不必写。

---

## 四、需要你确认的 8 条决策

1. **Tauri 2 而不是 Electron 32。** 安装包目标 <60MB、常驻内存 <150MB，Electron 单是运行时
   就 ~120MB 内存 / ~90MB 安装包。代价：依赖系统 WebView（Win 上要 WebView2 Runtime）。
2. **单窗口形变，而不是 Dock + Panel 两个窗口。** 观感更连贯，但每帧要发 2 次 IPC
   （`setSize` + `setPosition`）。如果你觉得低端机上有掉帧，我可以改成「Dock 是独立小窗，
   Panel 另开窗 + 共享动画时序」。
3. **通知里的「完成 / 推迟 10 分钟」按钮在桌面端做不了。** 已核对 `tauri-plugin-notification` 2.4
   源码：`registerActionTypes` / `onAction` 只在 Android / iOS 生效，桌面端插件只暴露
   `title/body/show`。当前降级为「系统通知负责叫人回来，Snooze/完成 在应用内通知中心点」。
   若必须要原生按钮，需要额外引 Windows-only 的 toast 实现（raw Toast XML 或 `winrt-notification`），
   会破坏「不引入需要编译原生模块的 heavy deps」这条约束——**要不要做，请拍板。**
4. **Rust 与前端各持一个 SQLite 连接池指向同一文件**（而不是前端所有读写都走 Rust command）。
   CRUD 代码量少、类型直连，代价是两个池 + 依赖 WAL。若你更想要「单一写入方」，
   我可以把前端 CRUD 全改成 `#[tauri::command]`。
5. **农历/节气用纯算法实现**（`src/lib/lunar.ts`，1900–2100 压缩表），不引 `lunar-typescript`
   之类的包；法定节假日用 `src/data/holidays-cn.json`（2024/2025 已发布，2026 为 provisional），
   并允许用户在「节假日」里手动修正后持久化。**2026 数据需要等国务院正式通知后更新。**
6. **ICS 解析/生成手写**（`src-tauri/src/ics.rs`），不引 `ical` / `chrono-tz`。代价：带 `TZID`
   的跨时区事件按「本机时区」解释，源时区与本机不同会有小时级偏移（已在文件头标注）。
7. **应用锁定只做界面遮罩 + 主密码校验，字段级加密列为二期。** 真加密需要引
   `ring`/`age` 之类原生模块，且密钥托管本身又是一个问题。
8. **更新检查默认关闭且当前构建不含下载器**（`check_update` 直接返回 disabled，绝不发网络请求）。
   规范要求「任何网络请求必须可关闭且有超时与失败重试」——最保守的做法就是先不实现，
   二期接 `tauri-plugin-updater` 时再补签名校验与断点续传。

---

## 五、平台能力受限与降级方案

| 能力 | Windows | macOS | Linux | 降级 |
| --- | --- | --- | --- | --- |
| 系统通知 | ✅ toast | ✅ | ✅ libnotify | 权限被拒 → 写 `reminders_log` + 设置页给平台级引导文案 |
| 通知内 action 按钮 | ❌ | ❌ | ❌ | 应用内「通知中心」承接 Snooze / 完成 / 打开 |
| 全局热键 Ctrl/Cmd+Shift+Q | ✅ | ✅ | ✅ | 注册失败只记日志，不影响应用内快捷键 |
| 系统托盘 | ✅ | ✅ | ⚠️ 需 appindicator | 托盘创建失败 → `tray_ok=false`，退化为「仅窗口模式」 |
| 开机自启 | ✅ 注册表 Run | ✅ LaunchAgent | ✅ .desktop | 开关失败 → toast 提示，不崩 |
| 毛玻璃 | ⚠️ Mica/Acrylic 需 Win11 | ✅ vibrancy | ❌ | `backdrop-filter` + 半透明底色兜底 |
| 附件预览 | ✅ | ✅ | ✅ | `asset:` 协议，作用域限定 `$APPDATA/**` |
| WebDAV 同步 | — | — | — | 一期只做「指定目录定时复制」（`backup.rs::sync_to_dir`） |
| 浏览器预览（`pnpm dev`） | 全部原生能力 no-op，存储走内存 | | | 仅用于看 UI |

---

## 六、已知限制与后续优化

**已知限制**
- 前端已通过 `tsc --noEmit`（strict + noUnusedLocals）与 `vite build`，两者均无错误。
- Rust 侧已能 `tauri build` 出可运行的安装包，但**尚未接入 `cargo check` 到 CI**，跨平台（macOS / Linux）
  的编译验证也还不完整。第三方 crate 版本见 `src-tauri/Cargo.toml`：tauri 2.11.6、
  tauri-plugin-notification 2.4.0、global-shortcut 2.3.2、sql 2.4.1、autostart 2.5.1、
  single-instance 2.4.5、shell 2.3.6、os 2.3.2、process 2.3.1、dialog 2.7.3、fs 2.5.2、
  sqlx 0.8.6、muda 0.20.0、global-hotkey 0.8.0、tray-icon 0.25.1。
- 月视图在 >2000 条事项时未做格子内虚拟滚动（当前靠 `start_at` 复合索引 + 按可视月份裁剪）；
  实测数据量上来后若掉帧，`MonthView` 的格子内容需要换成虚拟列表。
- 形变动画每帧 2 次 IPC，极端低端机可能掉到 40fps 左右。
- `log::info!` 没有绑定 logger 后端，实际日志走 `LogStore`（内存 800 条 + 按天落盘）。
- ICS「订阅链接」模式（本地 http 服务）未实现，一期只做文件导出/导入。

**后续优化建议（按性价比排序）**
1. 接 `cargo check` 进 CI，把 Rust 侧纳入类型安全网。
2. `setSize`/`setPosition` 合并为一次 `set_bounds`（Tauri 2.9+ 支持），形变 IPC 减半。
3. 月视图格子内虚拟滚动 + `content-visibility: auto`。
4. WebDAV 同步（`reqwest` + 超时/重试/可关闭），补齐规范里的二期项。
5. 字段级加密（`age` + 系统钥匙串托管密钥）。
6. `tauri-plugin-updater` + 签名校验。
7. 接入 `chrono-tz` 修正 ICS 跨时区偏移（会增加约 200KB）。
8. 单元测试：`lunar.ts` / `date.ts` / `nlp.ts` / `ics.rs` 都是纯函数，最容易补测。

---

## 七、常用快捷键

| 键 | 作用 |
| --- | --- |
| `Ctrl/Cmd + Shift + Q` | 全局：展开 / 收起（系统级热键，窗口失焦也生效） |
| `Ctrl/Cmd + K` | 命令面板 |
| `Ctrl/Cmd + N` | 新建待办 |
| `Ctrl/Cmd + ,` | 打开设置 |
| `Ctrl/Cmd + L` | 锁定应用（需先在设置里开启主密码） |
| `Ctrl/Cmd + F` | 聚焦搜索框 |
| `Ctrl/Cmd + 1 / 2 / 3 / 4` | 月 / 周 / 日 / 列表视图 |
| `?` | 快捷键总览 |
| `Esc` | 逐层关闭弹层 / 收起面板 |
| 双击格子 | 在该日新建待办 |
| 拖动待办条 | 改期到目标格 / 时间段 |
| 拖动待办条下边缘 | 调整结束时间（15 分钟吸附） |
| `Tab`（标题输入框内） | 应用自然语言解析结果 |
| `Ctrl/Cmd + 点击` | 多选（底部批量工具栏） |

---

## 八、数据目录

| 平台 | 路径 |
| --- | --- |
| Windows | `%APPDATA%\com.desktop.todocalendar\` |
| macOS | `~/Library/Application Support/com.desktop.todocalendar/` |
| Linux | `~/.local/share/com.desktop.todocalendar/` |

里面包含 `todocalendar.db`（+ `-wal` / `-shm`）、`backups/`、`attachments/`、`logs/`。
「设置 → 数据目录」可直接打开；「设置 → 同步目录」会每天把库与备份复制过去。

---

## 九、许可证

本项目基于 [MIT License](./LICENSE) 开源，可自由使用、修改、分发，包括商业用途，保留版权声明即可。
