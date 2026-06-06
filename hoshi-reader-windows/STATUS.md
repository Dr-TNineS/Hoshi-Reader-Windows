# Hoshi Reader Windows Status

更新时间：2026-06-02

> 目标：在 Windows 上做一个以日语 EPUB 小说阅读为核心的 Hoshi Reader。当前技术栈是 Tauri 2 + Svelte 5 + Rust + TypeScript 6 + Vite 8。

## 当前结论

项目不需要推倒重来。EPUB 打开、章节读取、资源路径、竖排分页、基础书架这些底座已经能跑，问题集中在“小说展示/排版”还没有完全对齐目标阅读器。

当前策略是保留现有 Tauri + Rust EPUB 解析 + Svelte Reader 的骨架，下一步专注重做/收敛 Reader 的竖排分页布局。不要再凭截图猜 `safe-left`，要对照参考实现，把页面尺寸、内容容器、页距、内容边界计算作为一套契约处理。

## 参考项目

| 项目 | 当前定位 |
| --- | --- |
| [Manhhao/Hoshi-Reader](https://github.com/Manhhao/Hoshi-Reader) | Hoshi 的产品气质和源头行为参考。重点看阅读、查词、制卡、音频/跟读等学习工作流如何串起来。 |
| `hoshi-reader-mac` / Hoshi Mac | 桌面端 Hoshi 的近亲参考。重点看桌面窗口、键盘操作、阅读区域、文件导入、书架和桌面端产品取舍；不按 Swift/macOS 工程实现逐行移植。 |
| [HuangAntimony/Hoshi-Reader-Android](https://github.com/HuangAntimony/Hoshi-Reader-Android) | 当前最活跃的 Hoshi 工程参考。重点看 EPUB/CSS 清洗、资源处理、封面缓存、书架、字典和学习功能架构。当前本地 `main` 已 fetch 到 `origin/main`，远端最新曾显示到 `27fcbfa fix(reader): prevent epub writing-mode css crashes`。 |
| [ttu-ttu/ebook-reader](https://github.com/ttu-ttu/ebook-reader) | 排版引擎老师。重点参考 paginated reader 的 DOM/CSS/PageManager、`vertical-rl`、CSS columns、页数/页距/滚动轴处理和复杂 EPUB 的阅读稳定性。 |
| [W1ght/Hoshi-Reader-Windows](https://github.com/W1ght/Hoshi-Reader-Windows) | Windows/WebView2 小说 reader 参考。重点看 `NovelReaderContentStyles.cs`、`reader-bridge.js`；只参考小说部分，原项目还有漫画残留。 |
| [Manhhao/hoshidicts](https://github.com/Manhhao/hoshidicts) | 后续字典引擎来源。 |

定位原则：

- `ebook-reader` 负责回答“EPUB 页面怎么排稳”。
- Hoshi Android 负责回答“现代 Hoshi 怎么处理 EPUB、书架、字典和学习功能”。
- Hoshi Mac 负责回答“桌面端 Hoshi 应该怎么用”。
- Hoshi 原版/iOS 负责回答“Hoshi 的产品味道和学习链路是什么”。
- Windows 版当前目标是把 Hoshi 的学习型产品方向和 `ebook-reader` 的排版经验，收敛成 Tauri 桌面日语阅读/学习工具。

## 已完成并提交

最近几个关键提交：

- `36e8a04 fix(reader): load svg cover images`
- `2c7a831 fix(reader): restore vertical page keyboard navigation`
- `a1bdd05 fix(reader): stabilize short vertical pages`
- `3ff72b9 fix(reader): handle epub chapter links`
- `b248319 fix(reader): ignore empty vertical spacer`
- `753d78a refactor(reader): align vertical page geometry`
- `a586768 feat(windows): add epub picker and minimal bookshelf`

实际已完成内容：

- Tauri + Svelte 5 项目骨架。
- Rust EPUB 解析与 Tauri command：
  - `epub_open`
  - `epub_read_chapter`
  - `epub_get_chapter_path`
  - `epub_close`
- 最小书架/打开 EPUB：
  - 系统文件选择器打开 `.epub`
  - 最近打开列表
  - localStorage 保存最近书籍和章节进度
  - 启动时尝试恢复上次阅读
- Reader 已收敛成竖排 paginated-only：
  - 已移除横排切换
  - 已移除 scroll/continuous 模式
  - 已移除字体大小、页间距等临时自定义设置
  - 已移除右上角绿色章节显示
- EPUB 章节资源处理：
  - 章节 HTML 中 `src` / `srcset` / `href` / `poster` / `xlink:href` 会按章节路径重写
  - 单图 SVG 封面页会转换成普通 `<img>`，避免 `xlink:href` 和 100% 高度 SVG 在 Tauri WebView 中不可见
  - Tauri asset protocol 已启用，scope 限定到 `$TEMP/**`
  - `img.gaiji` / `img.gaiji-line` 设置 eager/sync 和尺寸，避免小字形图片加载后大幅跳版
- 竖排阅读布局当前状态：
  - 当前实现仍是 `writing-mode: vertical-rl`
  - 使用 CSS columns + 纵向 `scrollTop` 分页
  - 通过 `ResizeObserver` 和初始 layout stabilization 计算页数
  - 图片加载后会重新计算页数并回到当前页
  - 左键下一页，右键上一页；章节边界处普通左右键可跨章；`Ctrl+左右键` 直接切章节
- 已验证过：
  - `npm run check`
  - `npm run build`
  - 之前涉及 Rust/Tauri 配置时跑过 `cargo check`

## 当前真实实现

当前 Reader 核心文件：

- `src/lib/reader/Reader.svelte`
- `src/App.svelte`
- `src/lib/reader.ts`

当前 `Reader.svelte` 的分页模型：

- 容器 `.rv`：纵向滚动、隐藏横向滚动。
- 内容 `.rct`：固定为视口宽度，竖排，CSS columns。
- 页尺寸来自 `containerEl.clientHeight`。
- 总页数用 `containerEl.scrollHeight / pageSize` 估算。
- 翻页通过设置 `containerEl.scrollTop`。
- `column-width` 使用阅读内容高度，`column-gap` 使用上下安全边距之和，让竖排 columns 的 pitch 和页面高度对齐。

这套模型已经让基本翻页、章节边界切换和短章节分页可用，但视觉位置和 EPUB CSS 清洗仍需要继续收敛。

## 最近排查结论

### 已修好的问题

- `kagami.epub` 之前多章节跳版明显，主要由图片/外字资源加载和布局重新计算触发。
- 启用 asset protocol、重写资源路径、处理 gaiji 图片后，用户确认：
  - `kagami` 大部分章节已经正常
  - 图片加载后的位移已经很小
  - 后续又确认“已经正常了”
- 左右键最初会直接切章节，后来改为普通左右键翻页，章节边界处跨章，`Ctrl+左右键` 直接切章。
- 开头 SVG 封面图路径与显示问题已处理，相关提交为 `36e8a04`。

### 当前未解决的问题

- 小说展示位置仍没有达到 `ebook-reader` 红框效果。
- 当前黑底布局与目标相比：
  - 短章节/标题页位置不对
  - 目录页和正文页的阅读区域还需要重新校准
  - 目前只能算“样式接近”，布局契约还不对

### 运行环境观察

- 用户运行时偶尔会看到 Codex 桌面端自身弹窗：
  - 标题：`A JavaScript error occurred in the main process`
  - 异常：`Error: AttachConsole failed`
  - 路径来自 `C:\Program Files\WindowsApps\OpenAI.Codex_...\app\...`
- 判断：这是 Codex/Electron 主进程尝试挂接 Windows 控制台失败，不是当前 Hoshi Reader/Tauri 项目代码报错。
- 现象：弹窗过一会会自己关闭，项目仍能继续启动/运行；目前作为外部工具问题记录，不列入项目代码待修项。
- 若该弹窗阻塞运行，可临时从项目目录手动启动：
  - `cmd /c npx.cmd tauri dev`

### 已尝试但回滚的方向

1. **短章节特殊 CSS**
   - 尝试按字数和 `.inline-height` 给短页单独右移。
   - 结果：位置仍不对，且属于按截图猜测，不可靠。
   - 已回滚。

2. **早期直接把竖排分页从 `scrollLeft` 改成 `scrollTop`**
   - 想参考 `ebook-reader` / W1ght 的竖排分页轴。
   - 结果修坏：
     - 顶部出现横向散字
     - 短章节出现假页，例如 Ch.2 显示 `P.2/2`
     - 需要连续按两次左/右键才能翻页
   - 原因判断：
     - 只改滚动轴，没有一起迁移参考实现的容器尺寸、页距、section 边界和内容边界计算。
     - `max-height` / `height:auto` 与竖排 CSS columns 组合不稳定。
   - 后续已重新按参考实现的容器尺寸、页距和纵向滚动轴一起迁移；当前代码包含新的稳定 `scrollTop` 分页模型，不是这次坏改动的版本。

## 下一步计划

优先级只放在小说竖排展示，不动背景颜色和控制条。

1. **先对齐最新 Hoshi 参考**
   - 本地 `hoshi-reader-android` 已 fetch，当前远端 `origin/main` 比本地旧版本领先很多。
   - 优先阅读 Android 最新与 Reader/EPUB 相关提交：
     - `fix(reader): prevent epub writing-mode css crashes`
     - `fix: sanitize calibre epub css`
     - `chore: sync iOS upstream reference`
     - `fix: cache bookshelf cover thumbnails`
   - 再对照 Hoshi Mac 的桌面阅读行为，避免只按 Web reader 的思路做产品。

2. **建立可验证的布局基线**
   - 用 `kagami.epub` 的 Ch.2-Ch.6、正文长章节、含图片章节作为固定样本。
   - 记录当前实现的页数、内容 rect、scrollHeight、clientHeight、首个文字 rect、封面页是否加载。
   - 之后每次改 Reader 都对比这些数据，避免靠肉眼猜。

3. **收紧 EPUB CSS/HTML 清洗**
   - 重点迁移 Android 最新的 calibre / writing-mode CSS sanitize 思路。
   - 目标是 EPUB 自带 CSS 不再轻易打破 Reader 的竖排分页契约。
   - 继续增强资源重写：CSS `url(...)`、复杂 SVG、封面图、图片页居中。

4. **拆清楚参考实现的布局契约**
   - `ebook-reader`：
     - `book-reader-paginated.svelte`
     - `page-manager-paginated.ts`
     - `styles.scss`
   - W1ght：
     - `Hoshi/Services/Novels/NovelReaderContentStyles.cs`
     - `Hoshi/Web/NovelReader/reader-bridge.js`
   - 重点看：
     - 哪个元素是 scroll container
     - 哪个元素承载 columns
     - page size 和 gap 怎么定义
     - 短章节如何避免假页
     - 内容首尾边界如何决定可翻页范围

5. **小步重构 Reader 布局**
   - 保持当前已经可用的纵向分页轴。
   - 优先修正内容区域的尺寸和页距，让 `column pitch == viewport/pageSize` 的契约稳定。
   - 对短章节不要再按字数硬分支，改为基于实际内容 rect 判断可翻页范围。

6. **再处理视觉位置**
   - 先保证页数、翻页、章节切换稳定。
   - 再把标题页、说明页、词条页、目录页、正文页的位置向 `ebook-reader` 红框效果靠近。

7. **每轮验证**
   - 至少跑：
     - `npm run check`
     - `npm run build`
   - 若修改 Tauri/Rust/config，再跑：
     - `cd src-tauri && cargo check`
   - 需要用户肉眼确认的排版调整，先不急着 commit。

## 当前工作树注意事项

- 当前仅 `STATUS.md` 有未提交修改。
- `../debug-epubs/` 是本地调试 EPUB 目录，未跟踪，不应提交。
- 本次更新只修改 `STATUS.md`。

## 暂缓事项

这些先不做，避免分散 Reader 排版主线：

- 背景色主题
- 控制条/按钮 UI
- 自定义字体大小、页间距设置
- 横排阅读
- scroll/continuous 模式
- 字典查询 UI
- AnkiConnect
- Sasayaki 有声书
- 完整书架美化

## 开发命令

```powershell
# 前端检查
npm run check

# 前端构建
npm run build

# Tauri/Rust 检查
cd src-tauri
cargo check

# 开发启动
cmd /c npx.cmd tauri dev
```
