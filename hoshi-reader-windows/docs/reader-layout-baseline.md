# Reader Layout Baseline

更新时间：2026-06-05

## 目的

这份文档固定当前 Windows Reader 的竖排分页基线，避免继续靠截图猜 `safe-left` / `safe-right`。后续修改 `src/lib/reader/Reader.svelte` 前，应先确认改动影响哪一个测量项；修改后用同一组 EPUB 章节复查。

当前只覆盖小说竖排 paginated 模式。不处理背景主题、控制栏、横排、continuous/scroll 模式和 Appearance 设置面板。

## 当前分页模型

核心文件：`src/lib/reader/Reader.svelte`

- `.rv` 是滚动容器，使用纵向 `scrollTop` 分页。
- `.rct` 是 EPUB 内容容器，固定 `writing-mode: vertical-rl` 并使用 CSS columns。
- `pageSize()` 使用 `.rv.clientHeight`。
- 正文长度使用 `.rct.scrollHeight - pageSize()` 计算，不用 `.rv.scrollHeight`，避免末页补偿元素污染页数。
- 总页数使用正文长度对齐到整页后的值：`Math.round(contentMaxScroll / pageSize) + 1`。
- 翻页通过设置 `.rv.scrollTop`。
- 末页如果浏览器最大滚动值不足一个整页边界，会在 `.rv` 内放置绝对定位的不可见 `.scroll-tail`，只补滚动上限，不改变正文排版。
- `ResizeObserver` 只观察 `.rv`，不观察 `.rct`，避免尾部补偿触发布局循环和频闪。

## 当前默认排版参数

这些参数对齐 Hoshi Android / Hoshi Mac 的默认阅读配置：`fontSize=22`、`lineHeight=1.65`、`horizontalPadding=5`。Hoshi 系列的 `horizontalPadding=5` 表示总横向 padding 为 `5vw`，也就是每侧约 `2.5vw`。

```css
--font-size: 22px;
--line-height: 1.65;
--safe-top: clamp(24px, 3.4vh, 42px);
--safe-bottom: clamp(32px, 5.2vh, 64px);
--safe-left: clamp(40px, 2.5vw, 72px);
--safe-right: clamp(40px, 2.5vw, 72px);
--content-height: max(1px, calc(var(--page-height, 100vh) - var(--safe-top) - var(--safe-bottom)));
--column-gap: calc(var(--safe-top) + var(--safe-bottom));
```

在 1920px 宽屏上，左右 padding 应约为 `48px`。这比之前的 `27vw / 11vw` 留白更接近 Hoshi 系列默认值，也避免左侧出现大块空白。

## 固定回归样本

优先使用当前正在调试的小说 EPUB，以及本地调试 EPUB：

- 当前用户正在验证的长正文小说章节，用于检查左右留白、长正文分页和末页对齐。
- `../debug-epubs/kagami.epub`，用于标题页、说明页、词条页、目录页和正文页。
- `../debug-epubs/Re0.epub`，用于普通长正文和资源加载回归。

`../debug-epubs/` 是本地未跟踪调试目录，不应提交。

## 最小验收清单

- 长正文页：分页正常，左右留白不出现大面积空白。
- 章节末尾：最后一页内容不截断、不下移，上一页和最后一页的可见文字 `minTop` 应一致或只差 1px。
- 章节边界：普通左右键在章节开头/末尾可跨章节，`Ctrl+左右键` 仍直接切章节。
- 封面/图片页：封面和图片页可见，不回退到空白或明显跳版。
- 构建检查：`npm run check` 和 `npm run build` 通过。

## 浏览器探针基线

当前探针在 1920px 宽屏下应确认：

- `.rct` 左右 padding 实际值约为 `48px`。
- 长正文上一页和最后一页的 `minTop` 对齐。
- `.rv.scrollHeight - .rv.clientHeight` 至少达到对齐后的 `contentMaxScroll`，避免浏览器把最后一页 scroll clamp 到上一行。

示例已验证数据：

```text
safeLeftValue: 48px
safeRightValue: 48px
fontSize: 22px
lineHeight: 36.3px
prev.minTop: 52
last.minTop: 52
```

## 已知非目标

这轮不加入 Appearance 设置面板，也不复刻 ebook-reader 的完整 PageManager。当前目标是让现有 Tauri + Svelte Reader 的竖排分页稳定、可验证、可提交。
