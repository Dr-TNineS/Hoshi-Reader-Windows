# Hoshi Reader Windows Agent 指南

Hoshi Reader Windows（HSW）是 Hoshi Reader 阅读体验的 Windows/Tauri 实现项目。目标是在 Windows 桌面平台完成稳定、可维护的阅读、词典查词与 Anki 工作流，并在明确需要时对齐 Hoshi Reader Android（HSA）的用户可见行为。

本文件只记录需要在未来会话中长期遵守的仓库级规则。当前实现状态、功能完成度、风险和任务进度不以本文件为准，必须回到当前代码和对应 `docs/` 文档核实。

## 工作原则

- `hoshi-reader-windows` 当前代码是“当前实现事实”的唯一真源：用于确认现有数据流、状态所有者、模块边界和兼容风险。它不自动定义目标用户体验；当任务涉及用户可见行为对齐时，应以 HSA 的已验证行为为主要参考，并结合 HSM 的桌面端行为与 Windows 平台约束决定最终方案。
- 当前 HSW 行为如与 HSA 的已验证核心体验冲突，不得仅因“现有代码如此实现”而保留；应先明确差异属于 bug、未完成迁移、合理的 Windows 平台适配，还是 HSW 有意形成的独立产品决策。
- 开始修改前，先检查相关 Svelte、TypeScript、Rust command、storage 和测试/probe。
- HSA 是需要对齐用户可见行为时的主要事实参考；HSM 仅作为补充参考。不要默认继承参考项目的产品定位、架构、平台 API、存储方案或实现细节。
- 需要对齐 HSA/HSM 时，先确认任务涉及的具体交互、状态流、边界行为和可观察结果，再决定 HSW 的最小 Windows/Tauri 实现；不要只复制代码表面结构。
- 修复跨层、状态相关、可重复出现或原因不明的问题时，先追踪状态来源、生命周期、调用链和失败边界，优先修正根因。对范围明确、无状态影响的局部样式、文案或静态渲染缺陷，可在确认影响面后直接做最小修复。
- 当任务引入或修改不熟悉、版本敏感、平台相关或安全边界相关的 Tauri、Rust、Svelte、Bits UI、Windows 文件系统、网络、打包或依赖 API 时，优先查官方文档或仓库已有用法。对已有稳定调用点的局部样式、文案、纯逻辑修复，先以当前代码和已有测试为准，不要求为此额外调研。
- 修改范围应贴合当前任务。除非用户明确要求完整功能切片，否则不要将 reader、storage、dictionary、Anki、settings、packaging 等无关区域混入同一改动。
- 主路径优先保证闭环：bookshelf -> import EPUB -> open reader -> select text -> lookup -> optional Anki export。
- 预计跨会话、跨模块、需要多个独立 commit，或会影响 Reader、storage、dictionary、Anki、sync 等高风险边界的功能，应先创建或更新 feature plan。
- 小型且边界明确的两三步改动，可直接在任务说明、issue 或 `docs/TODO.md` 中记录最小计划；不要为了形式单独创建长期路线文档。
- 在同一功能中优先按可验证的 slice 推进，但用户明确要求一次完成的紧密耦合改动可以作为一个整体交付。
- 不得把未核实的项目状态、参考项目行为或运行时结论表述为已验证事实。当这些结论会写入真源文档、交付说明、验证结果或影响后续决策时，应明确标记为 `unknown` 或 `not verified`。

## Reference Submodules

- 长期需要对照的上游参考项目通过 Git submodule 固定在 `reference/` 下：`reference/Hoshi-Reader-Android` 是 HSA 主参考，`reference/hoshi-reader-mac` 与 `reference/ttu/ebook-reader` 是补充参考。

- 新 clone 或缺少参考源码的 worktree 先从 HSW 根目录执行：

  ```text
  git submodule update --init --recursive
  ```

- 需要更新 HSA/HSM 对照版本时，在对应 submodule 内 fetch 并 checkout 目标 commit，再在 HSW 中提交更新后的 gitlink；不要只依赖本机未追踪 checkout、在线版本、过期摘录或臆测行为。

- 参考项目只作为用户可见行为对照来源，视为只读。不要修改 `reference/` 下的参考项目，也不要把它们的源码展开复制、构建产物、个人本地配置或其他临时参考目录提交到 HSW。

- 除 HSA/HSM/TTU 外，不要向 `reference/` 添加新的长期参考项目，除非任务明确扩展参考范围并同步更新 `.gitmodules`、`reference/README.md` 与本规则。

## 架构基线

### 平台与分层

- Frontend：Svelte 5、TypeScript、Vite。
- Desktop shell：Tauri 2。
- Native backend：Rust。
- 用户可见功能应由明确的 frontend state、Tauri command surface 和 Rust storage/backend 边界组成；不要把文件系统、app-data 路径、native 资源访问或安全判断散落到 Svelte component 中。
- 修改跨层功能前，先确认现有 command payload、共享 TypeScript type、Rust model 和错误 shape；不要在 frontend 与 Rust 两侧各自发明不一致的结构。
- 新增 Tauri command 时，保持 command 职责窄、参数可验证、错误可行动；不要把内部异常或未过滤文件路径直接暴露给 UI。

### Frontend

- `src/App.svelte` 负责顶层应用流程和 reader/shelf 切换。除非任务明确是应用壳层重构，不要把新的领域逻辑持续塞回 `App.svelte`。
- Reader、bookshelf、dictionary、Anki、settings 的复杂状态应优先放在对应 feature 边界或既有 state/controller 中，而不是通过跨组件布尔值和隐式副作用传播。
- 修改既有 Bits UI 控件覆盖的界面时，优先扩展或保留该 primitive 的 keyboard、focus、portal 和 dismissal 行为；不要为同一交互再造一套平行的手写实现。
- 不要为了无关任务而进行整片 UI 组件库迁移、全局样式重写或大规模视觉 redesign。

### Rust、App Data 与文件边界

- EPUB、词典、Anki 设置、阅读状态和其他 app-owned 数据的读写应经过既有 Rust storage/command 边界。
- 修改 app-owned library、manifest、reading state、dictionary manifest、Anki settings 或迁移逻辑时，先追踪旧记录兼容、失败回滚、session restore 和数据丢失边界。
- 文件导入、复制、删除和路径解析必须保留 containment、路径规范化和失败时不破坏原记录的原则。
- 不要为了快捷而让 UI 直接依赖原始本机路径、临时解压路径或假设某个目录永远存在。
- `third_party/hoshidicts` 是第三方构建输入。除非任务明确涉及依赖升级、桥接修复或上游同步，不要直接修改其源码来规避 HSW 的边界问题。

## 领域边界

### Bookshelf、Import 与 Reading State

- EPUB 导入、app-owned library、recent books、progress、session restore 和 legacy migration 是一组相互关联的状态边界。
- 修改导入或删除逻辑时，必须区分原始用户 EPUB、app-owned 副本、manifest 记录和阅读状态；不得误删用户原文件。
- 修改 storage shape、book id、library manifest 或阅读状态时，必须考虑既有记录迁移、损坏数据降级和重新打开旧书的兼容性。
- 不要把 path copy、manifest 写入或 re-import recovery 分散到 UI component 中。

### Reader

- Reader 的分页、DOM 测量、CSS columns、`scrollTop`、图片重排、progress restore 和章节跳转都是高风险区域。
- 除非任务明确是更大规模的 reader 架构改造，否则不要替换当前分页模型。
- Reader layout、chapter navigation、TOC、selection、lookup popup 与 reading progress 的改动必须明确各自状态所有者；不要通过偶然的 DOM 副作用让它们彼此耦合。
- Reader UI 不得遮挡正文、意外改变页面测量或在正常阅读中引入无关 layout shift。
- 涉及横竖排、窄窗口、图片页、章节边界、最后一页、焦点恢复或键盘导航的改动，应视为 reader 行为改动，不是单纯 CSS 微调。

### Dictionary 与 Lookup

- Dictionary import、manifest、enabled/order state、native runtime、lookup result、popup rendering 和 dictionary media/style 是连续链路；修改其中任一部分前，先确认上下游当前 shape。
- Dictionary role 以 Term、Frequency、Pitch 为边界。一个导入词典可能在多个角色中出现；删除、启用、排序和重建 runtime 时必须保持各角色与共享 import 数据的一致性。
- Lookup popup 必须保持 loading、no dictionary、engine unavailable、empty、error、ready 等状态可区分；不要用假结果、静态成功 UI 或模糊错误掩盖真实 backend 状态。
- Selection capture、lookup invocation、result rendering、nested glossary lookup、media/style loading 和 Anki payload 构建应保持明确边界；不要把它们折叠成无法定位问题的大型 component 副作用。
- 词典导入、C++ bridge、hoshidicts 构建或 native lookup 改动时，必须考虑 Windows/VS toolchain、engine unavailable 降级和真实词典验证边界。

### Anki 与 Audio

- Anki 配置、note payload、field template、媒体导出、audio、duplicate handling 和 sync 是独立边界；不要把它们混入无关的 reader 或 dictionary 任务。
- AnkiConnect endpoint 必须保持本机安全边界。不要放宽 host、协议、重定向、文件路径、媒体类型或请求大小限制来“让测试通过”。
- Lookup popup 只有在当前配置完整且后端能力准备好时才应开放 add-note 操作；未配置状态应保持明确、可行动的禁用边界。
- 修改 audio、dictionary media、book cover 或 Anki export 时，先确认失败是否应阻断建卡、仅返回 warning，或允许降级继续；不要改变已有错误语义而不更新对应验证。
- sync、Sasayaki 和未完成的音频能力必须以当前代码与 feature plan 为准；不要把计划能力展示为已实现。

### Settings 与 UI State

- 只有用户确实需要配置的行为才增加 settings UI；不要为了调整内部常量而提前扩张设置面板。
- 设置改动必须确认默认值、损坏/旧值回退、持久化位置、即时生效范围和启动恢复行为。
- 修改已有 Appearance、Advanced、Anki 或 dictionary settings 时，优先复用既有 controller/storage 边界；不要让 component 直接各自写不同 key 或重复维护同一状态。

## 真源文档

- `docs/PROJECT_STATUS.md`：当前实现事实、known issues、risk areas 和验证入口。它不是产品路线图，也不能代替当前代码核实。
- `docs/TODO.md`：当前正在进行的 slice 与紧接着一个可执行的 next slice；完整长期路线不得堆进此文件。
- feature plan / roadmap 文档：记录某一功能的目标、非目标、前置条件、完整 slice 顺序、验收、验证和状态。涉及多 slice 工作时，它们是该功能路线真源。
- `docs/LOOKUP_ROADMAP.md`、`docs/REAL_LOOKUP_VALIDATION_PLAN.md`：lookup 与真实词典验证相关路线。
- `docs/ANKI_HSA_WINDOWS_ALIGNMENT.md`、`docs/ANKI_MEDIA_EXPORT_PLAN.md`、`docs/ANKI_AUDIO_SYNC_PLAN.md`：Anki 对齐、媒体和音频相关路线。
- `docs/READER_ENTRY_CHARACTERIZATION.md`、`docs/reader-layout-baseline.md`：reader 行为基线与已验证边界。
- `STATUS.md`：仅作为文档索引和当前优先级提示，不记录详细实现事实。
- `AGENTS.md`：只记录未来 agent 需要长期遵守的仓库级规则，不记录短期任务状态或会快速过期的实现结论。

只有任务实际改变某个文档所负责的真源内容时，才更新该文档。

## 经验沉淀

- 如果一次错误定位出未来会反复出现的正确做法，将最小、可执行、低歧义的规则写入正确的真源文档。
- 需要所有会话长期遵守的跨任务规则才写入 `AGENTS.md`。
- 当前实现事实、模块边界和风险写入 `docs/PROJECT_STATUS.md` 或对应 feature 文档；完整路线写入 feature plan；当前交接写入 `docs/TODO.md`。
- 不要把一次性调查日志、临时 workaround、命令输出、个人机器路径、任务进度或只对当前 bug 成立的细节写进 `AGENTS.md`。
- 沉淀规则前先检查是否已有等价规则；存在时更新原规则，避免重复和互相矛盾。

## 用户可见 UI

- 保持 HSW 当前 minimal desktop app 的视觉与交互范围，除非任务明确要求更大 redesign。
- 用户可见文案应沿用当前界面的语言和表达风格；不要在同一页面混入无关语言、内部术语或原始异常文本。
- 用户可见错误必须可理解且可行动。主 UI 应展示明确状态、下一步或恢复方式，而不是直接渲染 native exception、Rust debug text 或路径细节。
- 对话框、menu、Tabs、Select、Switch、Tooltip 和 popup 必须维持鼠标、键盘、Escape、focus restore 和窄窗口边界行为。
- 新增图标时优先使用既有图标方案或明确的品牌资产；不要用临时 Unicode、拼接字符或难以识别的自绘图标代替交互含义。
- 修改 reader、dictionary popup、TOC、Anki panel、dictionary management 或设置面板时，必须考虑窄窗口与宽窗口；不得只验证当前开发窗口尺寸。

## 验证与提交

- 文档-only 改动至少运行：

  ```text
  git diff --check
  ```

- Frontend、Svelte、TypeScript 或共享 type 改动运行：

  ```text
  npm run check
  ```

- 用户可见 frontend 改动或准备交付时运行：

  ```text
  npm run build
  ```

- 修改已有专项 probe 覆盖的功能时，除通用检查外，必须运行对应 `check:<feature>` 脚本。`npm run check` 与 `npm run build` 不能替代专项行为验证。

- 当前专项 probe 包括 bookshelf、dictionary management、lookup popup、lookup performance、reader visual、reader TOC、settings state 和 AnkiConnect；实际命令以当前 `package.json` 为准。

- Rust command、EPUB、library/storage、dictionary backend、Anki backend、sanitizer 或 native bridge 改动，必须从**当前 worktree** 的 `src-tauri` 目录运行 `cargo check`，并在存在相关测试时运行对应 Rust tests。

- 依赖 hoshidicts/C++ 工具链的 Rust 验证必须通过仓库根目录的 `scripts\vs-x64-cargo.cmd` 进入 VS x64 developer environment 或等价的 MSVC/CMake/Ninja 环境；常用命令为 `npm run check:tauri-linked`、`npm run test:dict-linked`，或 `scripts\vs-x64-cargo.cmd test --lib <test-filter>`。该脚本会从当前 worktree 推导 `HSW_HOSHIDICTS_DIR`；不得为了验证而切换到硬编码主 checkout 路径。

- Reader layout、selection、popup placement、TOC、focus、keyboard、图片重排或进度恢复相关改动，必须运行对应 probe，并进行必要的 Tauri runtime visual check。

- 涉及真实字典、AnkiConnect、媒体、音频或 sync 的改动，只有在本机依赖和测试数据确实可用时才运行 runtime validation；不可用时如实记录 `not verified`，不要伪称完成。

- `npm run package` 属于打包验证，不是每次普通改动的默认检查；仅在用户要求打包、发版验证或任务明确涉及 packaging 时运行。

- Commit message 使用 Conventional Commits。

- 完成一个可独立交付的功能 slice 并通过必要验证后，自动创建一次仅包含本次任务相关文件的 commit；用户明确要求暂不提交、保留未提交改动或仅调查时除外。

- 不要将无关既有 worktree 改动、参考项目改动、构建产物、个人本地配置或 ignored test data 混入 commit。

- 小型、低风险、边界清楚的修复可在当前分支完成；较大功能、跨模块重构、高风险 reader/storage 改动应使用独立 `codex/` 分支或 worktree。
