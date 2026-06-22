# Hoshi Reader Windows Agent 指南

本文件记录 `hoshi-reader-windows` 的仓库级协作规则。内容应保持简洁、长期有效，并且只针对当前 Windows/Tauri 代码库。

`STATUS.md` 只是文档索引和当前优先级提示，不是 agent 指令来源。详细状态、路线图和行为基线应优先查阅 `docs/` 下的对应文档；做重要判断前必须回到当前代码核实。

## 工作原则

- HSW 是 Hoshi-Reader-Android（简称HSA）阅读体验在 Windows 平台上的迁移、复刻或再实现；核心阅读体验优先对齐 HSA 的用户可见行为。
- Android 平台特有 UI、权限、WebView、存储和系统 API 细节只作参考，必须按 Windows/Tauri 实际能力逐项判断。
- 默认推进顺序：model/storage -> bookshelf import -> reader -> dictionary popup -> Anki -> sync -> settings。
- 主路径优先闭环：bookshelf -> import EPUB -> open reader -> select text -> lookup。
- 当前 `hoshi-reader-windows` 代码是实现细节的真源。
- 改动行为前，先检查相关 frontend、Rust command、storage 边界，不要依赖早期项目笔记或记忆。
- Hoshi Reader Android 和 Hoshi Reader Mac 只能在任务明确需要时作为事实对照；不要默认继承它们的产品定位或架构。
- 修改范围应贴合当前任务。除非用户明确要求一个完整切片，否则不要把 reader、storage、dictionary、settings、packaging 改动混在一起。
- 如果实现改动导致 `docs/` 下的状态、路线图或行为基线不准确，应在同一任务里同步更新最小相关文档；`STATUS.md` 只保留索引级信息。
- 文档里不确定或未验证的项目事实必须标注为 `unknown` / `not verified`，不要猜。
- 对包含多个可独立交付 slice 的功能，在修改实现前必须先在 `docs/` 创建或更新一个专门的计划文档；可复用既有 feature plan/roadmap，但禁止只把完整路线留在聊天、临时 Todo 或 agent 上下文里。
- 计划文档至少记录目标/非目标、前置条件、按依赖排序的完整 slice 列表、每个 slice 的验收与验证方式，以及已完成/当前/待做状态；该文档是该功能完整路线的真源。
- `docs/TODO.md` 只记录当前工作和紧接着一个可执行的 next slice，并明确指向对应计划文档；不要把完整长期路线复制进 TODO。
- 实施时一次只推进一个 slice。开始编码前先把该 slice 写进 `docs/TODO.md`；完成后更新计划文档的状态，记录相关 commit 和验证结果，重新审视后再将下一个 slice 放进 TODO。

## 架构基线

### 当前技术栈

- Frontend：Svelte 5、TypeScript、Vite。
- Desktop shell：Tauri 2。
- Native backend：Rust。
- 当前持久化：浏览器 `localStorage`。
- 当前 EPUB 路径：Rust commands、`rbook`、临时解压目录、Tauri asset URL。

### Frontend 边界

- `src/App.svelte` 负责当前顶层应用流程：bookshelf、打开 EPUB、session restore、进入 reader、TOC overlay、章节导航。
- `src/lib/reader/Reader.svelte` 负责 reader layout、分页、键盘处理、进度上报、图片重排处理、内部章节链接处理。
- `src/lib/epub-assets.ts` 负责前端 HTML asset URL rewriting 和轻量 EPUB HTML normalization。
- `src/lib/storage.ts` 负责当前 `localStorage` bookshelf/session records。
- `src/lib/toc.ts` 负责 TOC flattening 和 href 到 spine 的匹配。
- `src/lib/types.ts` 负责前端共享 API shape。

### Rust 边界

- `src-tauri/src/lib.rs` 负责 Tauri plugins、state 和 command handlers wiring。
- `src-tauri/src/epub/commands.rs` 是 EPUB 操作的 Tauri command surface。
- `src-tauri/src/epub/book.rs` 负责 EPUB 解压、metadata access、chapter reading、chapter paths、book character metadata。
- `src-tauri/src/epub/sanitizer.rs` 负责解压后 CSS sanitization。
- `src-tauri/src/dict/commands.rs` 目前仍是 dictionary command stub；真实 dictionary backend 接入前，不要构建假定 lookup 已可用的 UI。

## 领域规则

### Bookshelf 与 Import

- 当前 bookshelf records 仍引用原始 EPUB 路径。代码真正把 EPUB copy 到 app-owned library 之前，不要把它描述成 app-owned import storage。
- 如果实现 app-owned import，应先建立明确的 model/storage 边界，不要把 path-copy 逻辑散落到 UI components 里。
- 修改 storage shape 时，需要考虑 session restore 和 recent-book compatibility。

### Reader

- 当前 reader pagination 使用 vertical layout，核心测量模型是 `scrollTop`、`.rv.clientHeight`、`.rct.scrollHeight`、CSS columns，以及 final-page tail alignment。
- DOM measurement、image loading、CSS column layout、progress restore 都是高风险区域。
- 修改 reader layout 后，需要验证普通页、最后一页、章节边界、cover/image 页和 progress reporting。
- 除非任务明确要求更大的 reader 改造，否则不要替换当前 pagination model。

### Dictionary 与 Lookup

- Dictionary commands 已存在，但真实 lookup 尚未实现。
- 不要把 fake dictionary-result UI 做成看起来已经可用的 lookup 功能。
- Selection 和 popup 工作应保持清晰边界：reader selection capture、lookup command invocation、result rendering 分开处理。

### Settings、Anki 与 Sync

- Settings、Anki、sync 当前尚未实现。
- 除非任务明确是用户可配置 settings，否则不要为了调整常量而提前加入 settings UI。
- 除非当前切片需要，否则不要把 Anki 或 sync 混入 reader/storage 工作。

## 文档规则

- 多 slice 功能在修改实现前，必须先在 `docs/` 创建或更新完整计划文档；完整路线不能只存在于聊天、临时 TODO 或 agent 上下文中。
- 计划文档记录完整 slice 路线、前置条件、验收标准、验证方式和当前状态，并作为该功能路线的真源。
- `docs/TODO.md` 只记录当前 slice 和紧接着的一个 next slice，并明确指向对应计划文档。
- 每完成一个 slice 后，更新计划文档中的状态、commit 和验证结果，再评估并写入下一个 slice。
- `docs/PROJECT_STATUS.md` 记录当前工程状态：已实现功能、stub、known issues、risk areas 和 validation commands。
- `docs/TODO.md` 记录短交接、当前工作和下一个可执行 slice，并指向对应的 feature plan；`docs/LOOKUP_ROADMAP.md` 记录 lookup 切片；`docs/READER_ENTRY_CHARACTERIZATION.md` 和 `docs/reader-layout-baseline.md` 记录 reader 行为基线。
- `STATUS.md` 只保留文档索引和当前优先级提示；如与 `docs/` 内容重合，保留 `docs/` 下的详细版本。
- `AGENTS.md` 记录未来 agent 需要长期遵守的仓库级规则。
- 长调查日志、临时 debugging 细节、一次性决策不应写入 `AGENTS.md`。
- 如果从 bug 中沉淀规则，只写能防止同类问题复发的最小可复用指令。
- HSW 文档维护任务不要修改参考项目。

## 用户可见 UI

- UI 改动应与当前 minimal desktop app 保持一致，除非任务明确要求更大 redesign。
- 用户可见错误应可理解、可行动；不要把原始内部异常文本当作主要 UI 文案展示。
- Reader UI 不应遮挡正文、不应意外改变页面测量、不应在正常阅读时引入 layout shift。
- 涉及 layout risk 的 frontend 改动，需要同时检查窄窗口和宽窗口。

## 验证与提交

- 文档-only 改动通常运行 `git diff --check` 即可。
- Frontend 或共享 TypeScript 改动运行 `npm run check`。
- Production frontend 改动运行 `npm run build`。
- Rust command、EPUB、sanitizer 或 dictionary backend 改动运行 `cd src-tauri; cargo check` 和相关 Rust tests。
- 对于cargo check，请运行
  call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvarsall.bat" x64
  cd /d D:\Hoshi-Reader-Windows\src-tauri
  cargo check
- Reader layout 改动还需要 runtime visual check，覆盖 pagination、final-page alignment、image/cover behavior、keyboard navigation。
- Commit message 使用 Conventional Commits。
- 每完成一个可独立交付的功能并通过相应验证后，自动创建一次 commit；除非用户明确要求暂不提交。
- 不要把无关的既有 worktree 改动混进 commit。
- 用户要求 commit 时，只 stage 本次完成任务相关文件。
- build + zip：npm run package
