# Hoshi Reader Windows

> 基于三款 Hoshi Reader 移植到 Windows 平台的项目。
> 技术栈: Tauri 2 + Svelte 5 + Rust + TypeScript 6 + Vite 8

## 参考项目

| 项目 | 用途 |
|---|---|
| [W1ght/Hoshi-Reader-Mac](https://github.com/W1ght/Hoshi-Reader-Mac) | 功能蓝图，Reader WebView 渲染逻辑 (reader.js) 及分页方案 |
| [HuangAntimony/Hoshi-Reader-Android](https://github.com/HuangAntimony/Hoshi-Reader-Android) | 架构参考，hoshiepub Rust EPUB 解析模块直接移植 |
| [Manhhao/Hoshi-Reader](https://github.com/Manhhao/Hoshi-Reader) | iOS 原版，功能参考 |
| [Manhhao/hoshidicts](https://github.com/Manhhao/hoshidicts) | 词典引擎 (C++)，待集成 |
| [ttu-ttu/ebook-reader](https://github.com/ttu-ttu/ebook-reader) | 仅参考 Yomitan 对接方式及分页方案，未采用其代码 |

## 进度

### 已完成

- [x] Tauri + Svelte 5 项目骨架
- [x] EPUB 解析 (移植 Android 版 hoshiepub Rust crate)
  - ZIP 解压提取
  - rbook 元数据/目录/spine 读取
  - 章节 HTML 读取改为使用 rbook manifest resource API
  - 临时目录生命周期管理，每次打开生成唯一解压目录
  - 已加回归测试
- [x] 阅读器前端
  - 竖排/横排切换 + 持久化 (localStorage hoshi_direction)
  - **分页模式** — 竖排单列垂直 scroll-snap，横排 CSS columns 水平 scroll-snap（参考 Mac 版方案）
  - **滚动模式** — 纯垂直滚动，无分页
  - 分页/滚动模式持久化 (localStorage hoshi_mode)
  - 键盘快捷键
    - 竖排：← 前进 / → 后退 / Ctrl+← 下一章 / Ctrl+→ 上一章（从右往左）
    - 横排：→ 前进 / ← 后退 / Ctrl+→ 下一章 / Ctrl+← 上一章（从左往右）
    - M 切换分页/滚动模式，Esc 回书架
  - 字符数统计 (修复 normalizeText 正则缺失 `]` 导致计数为 0)
  - ResizeObserver 自动重算总页数
  - 初始化时 onScroll 抑制（initializing 标记）
  - 回翻跨章定位到上一章末尾（startAtEnd）
  - Ctrl+箭头跳章始终定位到开头（prevChapterDirect）
  - Paginated / Continuous 两种模式 DOM + CSS 完全分离
  - 刷新自动恢复阅读位置 (localStorage)
  - 设置面板 — 字体大小、行高、边距、缩进四滑块，实时调整 + 持久化
- [x] 词典模块骨架
  - hoshidicts C++ 包装层
  - Rust FFI 绑定
  - Tauri 命令占位
- [x] Tauri invoke 守卫 (非 Tauri 环境提示)

### 待完成

- [ ] hoshidicts C++ 编译链接
- [ ] AnkiConnect 制卡
- [ ] Sasayaki 有声书
- [ ] 书架管理 — 本地 EPUB 扫描、封面、进度持久化
- [ ] 文件选择器 — 替代硬编码路径
- [ ] UI 美化
- [ ] 前端书架组件 (src/lib/bookshelf/ 占位)
- [ ] 前端词典面板 (src/lib/dict/ 占位)

### 已知问题

- [ ] 当前 Open EPUB 仍使用硬编码测试 EPUB 路径
- [ ] 封面图片未显示（cover_href 已提取但前端未渲染）
- [ ] dict/ffi.rs 有 17 个 dead_code 警告（FFI 函数未被实际调用，等编译链接后消除）

## Hoshi reader Android 版架构一览(作为参考)

```
hoshi-reader-android/
├── Rust: hoshiepub/          ← EPUB 解析，5KB 精炼代码，用 rbook crate
├── C++: CMakeLists.txt       ← hoshidicts 词典库入口
├── Kotlin:
│   ├── webview/              ← 阅读渲染 (WebView，和 Tauri 同源!)
│   ├── features/
│   │   ├── anki/             ← Anki 制卡
│   │   ├── audio/            ← 音频播放
│   │   ├── bookshelf/        ← 书架管理
│   │   ├── reader/           ← 阅读器
│   │   ├── sasayaki/         ← 有声书
│   │   ├── settings/         ← 设置
│   │   ├── sync/             ← 同步
│   │   └── ...
│   ├── dictionary/           ← 词典集成
│   └── epub/                 ← EPUB 处理 (调用 Rust hoshiepub)
```

Mac 版是 Swift + WKWebView，Android 版是 **Kotlin + WebView + Rust**。关键是——**Tauri 就是 Rust + WebView**，和 Android 版是同构的！

---

## 三版对比，最终结论

|                | Mac 版          | Android 版              | ebook-reader |
| -------------- | --------------- | ----------------------- | ------------ |
| 后端语言       | Swift           | **Kotlin + Rust**       | JS/TS        |
| 阅读渲染       | WKWebView       | **WebView**             | Svelte DOM   |
| EPUB 解析      | EPUBKit (Swift) | **Rust hoshiepub**      | JS epub.js   |
| 词典           | hoshidicts      | **hoshidicts C++**      | Yomitan JS   |
| 可用于 Windows | ❌ 0%            | **🟢 Rust 部分直接复用** | 🟡 要大改     |

**Android 版才是正确的参考**：

- `hoshiepub` Rust crate 可以直接搬到 Tauri，EPUB 解析零工作量
- hoshidicts C++ → Rust FFI 的桥接模式 Android 版已经趟过路了
- WebView 渲染架构和 Tauri 一模一样——Kotlin 的逻辑翻译成 Rust 命令即可
- `features/` 模块划分比 Mac 版更细（多了 backup、diagnostics、update），结构更清晰

---

## 修正后的方案

```
源码层:
  hoshiepub (Rust, 从 Android 版直接复用)  →  EPUB 解析
  hoshidicts (C++, Android 已集成)         →  词典查询
  reader.js (Mac 版)                       →  阅读渲染逻辑

架构层:
  参考 Android 版 features/ 模块划分
  参考 Mac 版 reader.js 渲染细节

壳:
  Tauri (Rust + WebView) → Windows .exe
```

**三步走：**
1. 把 `hoshiepub` 从 UniFFI 改成 Tauri command，EPUB 能力立刻到手
2. 接上 hoshidicts C++ → Rust FFI，词典查词搞定
3. 用 Mac 版 reader.js 的渲染逻辑做 WebView 前端

## 项目结构

```
hoshi-reader-windows/
├── src/
│   ├── App.svelte                # 主界面 (书架 / 阅读器)
│   ├── main.ts                   # Svelte mount 入口
│   ├── app.css                   # 全局样式占位
│   └── lib/
│       ├── types.ts              # 共享类型
│       ├── reader.ts             # 阅读核心 (字符计数, TreeWalker, CJK_REGEX)
│       ├── reader/               # 阅读器组件
│       │   └── Reader.svelte     # 分页/滚动/键盘/位置恢复/设置面板
│       ├── bookshelf/            # 书架组件 (占位，待实现)
│       └── dict/                 # 词典前端面板 (占位，待实现)
├── src-tauri/
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── src/
│       ├── lib.rs                # Tauri Builder: 状态管理、命令注册
│       ├── main.rs               # Windows 子系统入口
│       ├── epub/
│       │   ├── mod.rs
│       │   ├── types.rs          # EpubMeta, ManifestItem, SpineItem, TocNode
│       │   ├── book.rs           # EpubBook (ZIP解压 + rbook解析 + Drop清理)
│       │   └── commands.rs       # epub_open/read_chapter/get_chapter_path/close
│       └── dict/
│           ├── mod.rs
│           ├── dict_capi.h       # C API 头文件
│           ├── dict_capi.cpp     # C++ 实现 (DictionaryQuery/Deinflector/Lookup 包装)
│           ├── ffi.rs            # Rust FFI extern 声明
│           └── commands.rs       # dict_lookup/dict_status (占位)
├── index.html
├── package.json
└── vite.config.ts
```

## 核心依赖

| 层 | 依赖 | 版本 |
|---|---|---|
| 前端 | Svelte | 5.55.5 |
| 前端 | TypeScript | 6.0.2 |
| 前端 | Vite | 8.0.12 |
| 前端 | @tauri-apps/api | 2.11.0 |
| 后端 | tauri | 2.11.2 |
| 后端 | rbook (EPUB) | 0.7 |
| 后端 | zip | 0.6 |
| 后端 | serde / serde_json | 1.0 |

## 构建状态

`cargo check` 通过 (0 errors, 17 warnings — 全部来自 dict/ffi.rs 未使用的 FFI 声明)

## 开发命令

```powershell
# 开发模式
cmd /c npx.cmd tauri dev

# 仅前端构建
npm run build

# 仅后端检查
cd src-tauri
cargo check

# 回归测试
cd src-tauri
cargo test reopening_same_epub_keeps_new_extraction_alive
```