# Hoshi Reader Windows Agent 指南

Hoshi Reader Windows 是 Hoshi Reader 的 Windows/Tauri 版本。当前目标不是完整复刻任一上游仓库，而是在 Windows 桌面上把日语 EPUB 小说阅读、分页排版、查词和后续学习工作流逐步收拢成稳定可用的 Hoshi Reader。

技术栈：Tauri 2 + Svelte 5 + TypeScript + Vite + Rust。前端负责书架、阅读器 UI、章节 HTML 资源重写和分页交互；Rust/Tauri 负责 EPUB 解包、元数据、章节读取、CSS 清洗、字数统计和后续词典后端。

## 核心原则

- Windows 用户可见行为以本仓库为准；Hoshi Android、Hoshi Mac、Hoshi 原版/iOS、ebook-reader 和旧 HSW 参考实现都是参考，不是可以直接覆盖当前实现的真源。
- 修 Reader 问题时不要堆补丁。先确认是 EPUB CSS、资源路径、Tauri asset protocol、容器尺寸、CSS columns、滚动轴、末页边界、键盘事件还是保存进度导致，再改最小稳定方案。
- Reader 排版当前优先级最高。除非用户明确要求，不要把外观设置面板、横排阅读、continuous/scroll 模式、完整查词 UI、AnkiConnect 或 Sasayaki 提前混进 Reader 收尾任务。
- 遇到平台能力、Tauri 配置、asset protocol、文件权限、WebView 行为、Rust crate API 或构建发布流程时，优先查官方文档或项目现有配置，不凭印象改。
- 工作树可能包含用户或上一轮 agent 的未提交内容。不要回滚、重置或覆盖未明确属于当前任务的改动；提交时只 stage 本次任务相关文件和 hunk。
- Commit message 使用 Conventional Commits，例如 `feat(reader): add character progress`、`fix(reader): align final page`。用户没有要求 commit 时，不要主动提交。

## 参考项目定位

- `hoshi-reader-android` / HSA：当前最活跃的 Hoshi 工程参考。优先参考 EPUB/CSS 清洗、资源处理、书架、封面、字数进度、字典和学习功能架构。
- `hoshi-reader-mac` / Hoshi Mac：桌面端 Hoshi 体验参考。优先参考窗口、键盘、桌面阅读区、导入、书架、设置取舍和发布思路。
- `hoshi-reader-original` / Hoshi 原版或 iOS：产品气质和学习链路参考。用于判断 Hoshi 应该怎样把阅读、查词、制卡、音频和跟读串起来。
- `ebook-reader`：分页排版参考。重点看 paginated reader 的 DOM/CSS/PageManager、`vertical-rl`、CSS columns、页距、滚动轴和复杂 EPUB 稳定性。
- W1ght/Hoshi-Reader-Windows / 旧 HSW 参考实现：Windows/WebView2 小说 reader 参考。重点看 `reader-bridge.js`、小说样式、视口内字数进度和 Windows 端交互取舍。
- `hoshidicts`：后续词典引擎和词典数据处理参考。

定位原则：HSA 回答“现代 Hoshi 怎么处理 EPUB、书架、字典和学习功能”；Hoshi Mac 回答“桌面 Hoshi 应该怎么用”；ebook-reader 回答“EPUB 页面怎么排稳”；旧 HSW 参考实现回答“Windows 小说阅读器如何处理 WebView/视口/进度”；本项目负责把这些经验转译为 Tauri 桌面日语阅读工具。

## 项目结构

- `src/App.svelte`：应用入口、书架、EPUB 打开、章节加载、资源重写、阅读进度保存、TOC 和 Reader 接线。
- `src/lib/reader/Reader.svelte`：当前核心阅读器。负责竖排分页、键盘翻页、章节边界、末页对齐、布局稳定、字数进度回传。
- `src/lib/reader.ts`：Reader JS 工具函数，例如正文字符统计、furigana 过滤、文本 walker。
- `src/lib/types.ts`：前端 EPUB/Tauri 数据类型。
- `src-tauri/src/epub/`：Rust EPUB 模块。包含打开/解包、元数据、章节读取、章节路径、CSS sanitizer、字数统计和 Tauri commands。
- `src-tauri/src/dict/`：后续词典 FFI/commands。当前不是 Reader 排版主线，修改前先确认边界。
- `src-tauri/capabilities/default.json` 和 `src-tauri/tauri.conf.json`：Tauri 权限、asset protocol、窗口和 app 配置。
- `docs/reader-layout-baseline.md`：当前 Reader 排版基线和回归观察文档。修改分页模型、默认排版参数或验证口径时同步更新。
- `STATUS.md`：阶段性状态记录。不要把它当作精确架构真源；需要长期沉淀的规则放入 `AGENTS.md` 或 `docs/`。

## Reader 排版规则

- 当前 Reader 是竖排 paginated-only，不做横排、continuous/scroll 模式或临时外观设置。
- 当前分页模型是 `.rv` 纵向 `scrollTop` + `.rct` vertical-rl CSS columns。页尺寸来自 `.rv.clientHeight`，内容边界来自 `.rct.scrollHeight` 和实际 text/image rect。
- 默认排版基线来自 Hoshi 系列：字号 `22px`，行高 `1.65`，左右留白每侧 `clamp(40px, 2.5vw, 72px)`，保留上下安全区和末页 `scroll-tail` 对齐方案。
- 末页和短章节不能靠按字数猜测。优先用实际 scroll/content rect 判断可翻页范围，确保最后一页不截断、不下移、不错位。
- 左右键语义：竖排下 `ArrowLeft` 下一页，`ArrowRight` 上一页；章节边界处普通左右键可跨章节；`Ctrl`/`Meta` + 左右键直接切章节。
- 修改 Reader、CSS sanitizer、资源重写、图片加载或字数进度后，至少验证长正文页、章节末尾、章节边界、封面/图片页。
- 不要为了某一张截图硬塞 magic number。需要调整间距、padding、page size、column gap 或 scroll tail 时，先确认它们与当前分页模型的契约。

## EPUB 与资源处理

- Rust 侧打开 EPUB 后会解包到临时目录，Tauri asset scope 应限制在需要的本地路径范围内，不要启用宽泛 file URL 访问。
- 章节 HTML 的 `src`、`srcset`、`href`、`poster`、`xlink:href` 由前端按章节路径重写；内部章节链接应转为 `data-epub-href` 并走 Reader 导航。
- 单图 SVG 封面可以转成普通 `<img>`，避免 WebView 中 `xlink:href` 和 100% 高度 SVG 不可见。
- `img.gaiji` / `img.gaiji-line` 是行内字形资源，必须保持小尺寸和基线行为；大图才应标记为 block image。
- EPUB 自带 CSS 不能破坏 Reader 的 vertical-rl/page contract。清洗 calibre、writing-mode、过大 width/height 等规则时，优先参考 HSA，并给 Rust sanitizer 增加聚焦测试。
- 字符统计需要忽略 ruby/furigana，口径应尽量与前端 Reader `countChars` 一致；书籍总字数来自后端 `book_info`，当前页已读字数来自浏览器布局后的页前正文。

## 进度与持久化

- 阅读进度采用 HSA 风格：`已读字数 / 全书总字数 + 百分比`。当前页显示的已读字数是不包含当前页正文的“页前累计”；例如第 10 页统计前 9 页。
- 章节内恢复进度用 chapter progress；全书显示用章节起始累计字数 + 当前章节页前字数。
- 保存到 localStorage 的 session/recent book 数据需要兼容旧格式。新增字段必须可选，不能让旧书架记录打不开。
- 切章节、TOC 跳转、内部链接跳转、启动恢复、章节边界翻页都要检查是否错误覆盖已有进度。

## 文档真源

- `AGENTS.md`：仓库级长期协作规则，只写所有会话都应该遵守的约定。
- `docs/reader-layout-baseline.md`：Reader 排版模型、默认参数、已验证回归清单和 HSA/Mac/HSW/ebook-reader 对照结论。
- `STATUS.md`：阶段性状态、最近排查和下一步计划。它可以帮助接力，但过期内容要谨慎对待。
- 新增长期架构说明时放入 `docs/`，不要把长日志、命令输出或一次性调查过程写进 README。
- 只有任务改变了对应文档的事实内容时才更新文档；不要为了“看起来完整”重复已有规则。
- 如果 agent 犯错后定位到可复发的正确做法，先确认现有文档是否已有等价规则；需要长期常驻时，把最小可执行规则沉淀到 `AGENTS.md` 或对应 `docs/`，不要追加一次性调查过程。

## UI 与产品取舍

- 当前 UI 是工程可用骨架，不是最终产品。做用户可见 UI 时优先保持安静、紧凑、桌面工具感，不要做营销式 landing page。
- 新增可见文案时先确认是否需要中英文/本地化策略；当前项目尚未建立完整 i18n，不要把大量硬编码文案散落到多个模块。
- 书架、TOC、Reader chrome 和错误提示要保持低干扰。Reader 内容区域优先于装饰。
- 新增图标优先使用现有资产或成熟图标库；不要临时手绘复杂图标。
- 用户可见错误应转为明确状态或提示，不要直接把原始异常大段渲染进主要 UI。

## 测试与验证

常规前端改动至少运行：

```powershell
npm run check
npm run build
```

涉及 Rust/Tauri/EPUB 后端时再运行：

```powershell
cd src-tauri
cargo check
cargo test --lib
```

需要启动本地开发环境时：

```powershell
cmd /c npx.cmd tauri dev
```

Reader 相关手工或浏览器探针至少覆盖：

- 长正文页：分页、末页对齐、左右留白、字数进度。
- 章节末尾：最后一页不截断、不下移。
- 章节边界：普通左右键跨章节，`Ctrl`/`Meta` + 左右键直接切章节。
- 封面/图片页：图片可见，不跳版，不把 gaiji 当作大图。
- 启动恢复：章节和页内进度不被初始保存覆盖。

无法完成某项验证时，在回复中明确说明，不要声称未验证的 UI 已经可用。

## 提交策略

- 提交前先看 `git status --short`，确认工作树里是否有无关 dirty 文件或相邻 repo 改动。
- 对混有无关改动的文件使用分块 staging 或临时 index，只提交当前任务相关 hunk。
- 不要把 `STATUS.md`、package/Cargo 变化、sanitizer、Reader、词典、相邻仓库改动混进同一个 commit，除非它们确实属于同一个用户请求。
- 提交前优先运行相关检查，并至少执行 `git diff --cached --check`。
- 用户要求 commit 时再提交；提交后报告 commit hash 和验证命令。

## 工作方式

- 搜索优先使用 `rg` / `rg --files`。
- 手动编辑文件使用 `apply_patch`。
- 不使用 `git reset --hard` 或 `git checkout --` 回滚用户改动，除非用户明确要求。
- 涉及具体页面或视觉排版时，尽量用浏览器/截图/DOM rect 探针验证，不只凭肉眼描述。
- 回答用户时说明做了什么、验证了什么、哪些没有验证；遇到阻塞再请求决策。
