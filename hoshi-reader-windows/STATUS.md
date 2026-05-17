# Hoshi Reader Windows

> 基于三款 Hoshi Reader 移植到 Windows 平台的项目。
> 技术栈: Tauri v2 + Svelte 5 + Rust + TypeScript

## 参考项目

| 项目 | 用途 |
|---|---|
| [W1ght/Hoshi-Reader-Mac](https://github.com/W1ght/Hoshi-Reader-Mac) | 功能蓝图，Reader WebView 渲染逻辑 (reader.js) |
| [HuangAntimony/Hoshi-Reader-Android](https://github.com/HuangAntimony/Hoshi-Reader-Android) | 架构参考，hoshiepub Rust EPUB 解析模块直接移植 |
| [Manhhao/Hoshi-Reader](https://github.com/Manhhao/Hoshi-Reader) | iOS 原版，功能参考 |
| [Manhhao/hoshidicts](https://github.com/Manhhao/hoshidicts) | 词典引擎 (C++)，待集成 |
| [ttu-ttu/ebook-reader](https://github.com/ttu-ttu/ebook-reader) | 仅参考 Yomitan 对接方式，未采用其代码 |

## 进度

### 已完成

- [x] Tauri + Svelte 5 项目骨架
- [x] EPUB 解析 (移植 Android 版 hoshiepub Rust crate)
  - ZIP 解压提取
  - rbook 元数据/目录/spine 读取
  - 章节 HTML 读取改为使用 rbook manifest resource API，避免手动拼 `content_dir + href`
  - 临时目录生命周期管理：每次打开生成唯一解压目录，避免刷新/重复打开时旧实例 Drop 删除新实例目录
  - 已加回归测试：连续打开同一本 EPUB 后旧实例释放，新实例仍可读取章节
- [x] 阅读器前端
  - 竖排/横排切换
  - 分页模式 (CSS columns, 竖排/横排均支持方向键翻页)
  - 滚动模式
  - 键盘快捷键 (方向键翻页, Ctrl+方向键翻章, M 切换模式, Esc 回书架)
  - 横排阅读时左右键翻页，Ctrl+左右键切换章节
  - 字符数统计
  - 刷新自动恢复阅读位置 (localStorage)
- [x] 词典模块骨架
  - hoshidicts C++ 包装层 (dict_capi.h/cpp)
  - Rust FFI 绑定 (ffi.rs)
  - Tauri 命令占位

### 待完成

- [ ] hoshidicts C++ 编译链接 — C API 和 Rust 绑定已写，需在 build.rs 配置 CMake
- [ ] AnkiConnect 制卡 — HTTP POST localhost:8765，后端一条 reqwest 的事
- [ ] Sasayaki 有声书 — 音频播放 + cue 高亮同步
- [ ] 书架管理 — 本地 EPUB 扫描、封面、进度持久化
- [ ] 文件选择器 — 替代当前硬编码路径
- [ ] UI 美化 — 当前为功能验证用暗色极简 UI

### 已知问题

- [ ] zip crate 版本冲突 (0.6 vs 8.6) — 两种版本共存于依赖树，需统一
- [ ] 当前 Open EPUB 仍使用 `src/App.svelte` 中的硬编码测试 EPUB 路径，后续需接入文件选择器

## 项目结构

```
hoshi-reader-windows/
├── src/                          # Svelte 前端
│   ├── App.svelte                # 主界面 (书架 ↔ 阅读器)
│   ├── main.ts                   # 入口 (Svelte 5 mount)
│   └── lib/
│       ├── types.ts              # 共享类型
│       ├── reader.ts             # 阅读核心 (字符计数, TreeWalker)
│       └── reader/Reader.svelte  # 阅读器组件
├── src-tauri/                    # Rust 后端
│   ├── Cargo.toml                # 依赖: tauri, rbook, serde, zip
│   ├── tauri.conf.json           # Tauri 配置
│   └── src/
│       ├── lib.rs                # 入口, 注册 Tauri 命令
│       ├── epub/
│       │   ├── types.rs          # 数据结构 (ManifestItem, TocNode...)
│       │   ├── book.rs           # EpubBook 实现 (解压, 解析, 读取)
│       │   └── commands.rs       # Tauri 命令
│       └── dict/
│           ├── dict_capi.h/cpp   # hoshidicts C 包装层
│           ├── ffi.rs            # Rust FFI 绑定
│           └── commands.rs       # Tauri 命令 (待实现)
├── index.html
├── package.json
└── vite.config.ts
```

## 开发命令

```powershell
# 开发模式
cmd /c npx.cmd tauri dev

# 仅前端构建
npm run build

# 仅后端检查
cd src-tauri
$env:LIB = "..."   # 需 MSVC 环境
$env:INCLUDE = "..."
cargo check

# 回归测试：重复打开 EPUB 的临时目录生命周期
cd src-tauri
cargo test reopening_same_epub_keeps_new_extraction_alive
```
