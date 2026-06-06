# Hoshi Reader Windows 状态

## 用途

本文档是 `hoshi-reader-windows` 的当前工程状态快照。
它不是 agent 指令来源、路线图权威或产品定位文档。

内容基于当前代码和配置检查；无法从当前代码确认的项目事实需要标注为
`unknown` / `not verified`。

## 当前范围

- 当前主项目：`hoshi-reader-windows`。
- 技术栈：Tauri 2、Svelte 5、TypeScript、Vite、Rust。
- 当前桌面目标：面向 Windows 的 Tauri 应用；其他平台未验证。
- 当前数据模型：本地 Windows/Tauri 应用数据。导入的 EPUB 会复制到
  app-owned library；阅读进度仍保存在浏览器 `localStorage`。

## 已实现

- Tauri 应用壳：
  - 可调整大小的主窗口。
  - dialog plugin。
  - debug log plugin。
  - 针对临时 EPUB 解压路径启用 asset protocol。
- EPUB 打开与读取：
  - 通过系统文件选择器选择 `.epub`。
  - 将 EPUB 解压到临时目录后交给 `rbook` 读取。
  - 读取 title、cover href、manifest、spine、TOC、章节路径。
  - 按 spine index 读取章节 HTML。
  - 解压后 CSS sanitizer，并有 Rust sanitizer 测试。
- App-owned EPUB library：
  - 导入 EPUB 时复制到 app data 下的 `library/books/<book_id>/book.epub`。
  - app-owned library 通过 `library/manifest.json` 记录。
  - `book_id` 基于 EPUB 内容 hash；重复导入同一内容会复用同一记录。
  - 新导入书籍可通过 `book_id` 打开，不再依赖原始 EPUB 路径。
- 最小书架：
  - 导入 EPUB。
  - 最近阅读记录保存在 `localStorage`。
  - 从保存进度继续阅读。
  - Tauri 运行时启动后尝试恢复上次阅读 session。
  - 旧版 path-only recent book 记录仍兼容；原文件仍存在时可以继续打开。
- Reader：
  - 日语竖排阅读布局。
  - 基于 `scrollTop`、`.rv.clientHeight`、`.rct.scrollHeight` 的分页章节显示。
  - CSS column-based vertical pagination。
  - 上一章 / 下一章控制。
  - 键盘翻页和章节边界导航。
  - Ctrl / Meta + arrow 章节导航。
  - Escape 返回书架。
  - TOC overlay 和章节内部链接导航。
  - 解压 EPUB asset URL rewriting。
  - 基础图片加载处理和 layout recalculation。
  - 单图 SVG cover 替换为 image element。
  - 基础 gaiji 图片和较大 block image 处理。
  - 捕获 reader 内文本 selection，并上报选中文本、位置和章节 index。
- Dictionary popup shell：
  - 选中 reader 正文后显示轻量 lookup popup。
  - 支持桌面端 hover 文字后按 Shift，从指针位置扫描并选中短文本；非日文 token 会向左扩到词起点。
  - 支持按住 Shift 后移动鼠标连续重扫选词。
  - Popup 优先贴在 selection 高亮块左/右侧，空间不足时回退到上下方。
  - 通过 `dict_status` / `dict_lookup` 进入最小 lookup 状态机；backend 未 ready 时显示明确 not-ready 状态。
  - Backend ready 且返回结果时显示最小 expression、reading、matched 和 glossary 列表。
  - 翻页、切章、TOC 跳转、返回书架或关闭 popup 时清除 selection popup。
- Dictionary backend：
  - Rust dictionary state 会在启动时扫描 app data 下的 `dictionaries/imported/*`。
  - 已导入的 hoshidicts term dictionary 目录需要包含 `.hoshidicts_1`、`index.json`、`hash.table` 和 `blobs.bin`。
  - 构建环境存在 CMake/C++ 工具链时，`build.rs` 会尝试编译链接 `hoshidicts` 和现有 C API bridge。
  - 当前环境未找到 CMake 时，backend 会保持 not-ready，Rust 构建仍可通过并给出 warning。
- 阅读进度：
  - Rust 侧书籍和章节字数 metadata。
  - 前端基于可见文本位置计算 reader progress。
  - 在 `localStorage` 保存章节 index、章节进度、已读字数、总字数和百分比。

## 未实现 / Stub

- 尚无 durable database；app-owned library metadata 当前是 JSON。
- 尚无 dictionary import、dictionary management 或 dictionary settings UI。
- 尚无已验证的 dictionary zip import flow；当前只读取 app data 中已导入的 hoshidicts 目录。
- 尚无 Anki 集成。
- 尚无 sync 实现。
- 尚无 settings 或 appearance panel。
- 尚无已验证的 app-owned cover thumbnail cache。
- 尚无已验证的 release packaging flow；identifier/version 仍包含 `com.tauri.dev` 等开发默认值。

## 已知问题

- 旧版 path-only bookshelf 记录在原 EPUB 文件被移动、重命名或删除后可能无法重新打开。
- 当前机器未安装 CMake/C++ 构建工具时，hoshidicts backend 不会链接，Dictionary 功能保持 not-ready。
- 没有 app data `dictionaries/imported/*` 下的已导入 hoshidicts term dictionary 时，`dict_status` 为 false。
- Reader layout 对任意 EPUB 的正确性尚未充分验证。
- Rust 侧字数统计和前端 DOM-based progress 的口径一致性尚未充分验证。
- Cover 和图片渲染依赖 EPUB 解压路径映射和 asset URL rewriting 成功。
- 脱离 Tauri 直接运行前端只具备部分可用性，因为 native EPUB commands 需要 Tauri runtime。
- 尚无 pagination、final-page alignment、image reflow 的自动视觉回归覆盖。

## 风险区域

- Reader pagination 和 restore：
  - DOM measurement。
  - CSS columns。
  - `scrollTop` page movement。
  - Final-page `scroll-tail` alignment。
- 图片加载和 reflow：
  - Cover images。
  - SVG image replacement。
  - Gaiji 与 block image 分类。
  - Late image load 改变页面测量。
- EPUB CSS sanitization：
  - Publisher CSS 可能包含当前 sanitizer tests 未覆盖的 layout rules。
  - Non-UTF-8 CSS 处理有限。
  - Inline style cleanup 与 Rust-side CSS file sanitization 是分开的。
- Asset 与 path handling：
  - EPUB assets 依赖临时解压目录。
  - 新导入书籍依赖 app-owned copied EPUB files 和 manifest JSON。
  - 旧版 bookshelf records 仍依赖原始 EPUB file path。
- 阅读进度：
  - Text measurement 使用 DOM ranges 和 viewport geometry。
  - Ruby / furigana 处理需要在计数和显示之间保持一致。
- 后续 dictionary 集成：
  - Rust command surface 已存在；真实 lookup 依赖 hoshidicts 构建链接和已导入 dictionary 目录。

## 验证命令

- `npm run check`
- `npm run build`
- `npm run dev`
- `cmd /c npx.cmd tauri dev`
- `cd src-tauri; cargo check`
- `cd src-tauri; cargo test --lib`

## 下一候选任务

- 为 dictionary backend 添加 Yomitan zip import / management flow。
- 在有真实 dictionary 数据的环境中验证 `dict_lookup("学校")` 等主路径结果。
- 为 reader pagination、final-page alignment、image pages、chapter-boundary keyboard behavior
  添加最小自动回归探针。
- 如 bookshelf flow 需要，添加 cover thumbnail generation 或 cache。
- Lookup 行为稳定后添加 Anki 集成。
- Local model/storage 行为稳定后添加 sync。
- Core import、reader、lookup 主路径验证后添加 settings。
