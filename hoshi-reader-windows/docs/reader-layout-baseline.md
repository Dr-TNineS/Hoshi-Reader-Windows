# Reader Layout Baseline

更新时间：2026-05-31

## 目的

这份文档用于固定当前竖排 Reader 的排版基线，避免继续靠截图猜 `safe-left` / `safe-right`。后续修改 `Reader.svelte` 前，应先确认改动打算影响哪一个测量项；修改后再用同一组 EPUB 章节复查。

当前重点只看小说竖排 paginated 模式，不处理背景颜色、控制条、横排、scroll/continuous 模式和自定义字体设置。

## 当前实现快照

文件：`src/lib/reader/Reader.svelte`

当前分页模型：

- `.rv` 是滚动容器。
- `.rct` 是 EPUB 内容容器。
- `.rct` 固定 `writing-mode: vertical-rl`。
- `.rct` 使用 CSS columns。
- `pageSize()` 使用 `.rv.clientWidth`。
- `measureTotalPages()` 使用 `ceil(.rv.scrollWidth / pageSize)`。
- 翻页通过设置 `.rv.scrollLeft`。
- 初始布局等待 `document.fonts.ready`，最多等待 120ms，然后等待 `scrollWidth/pages` 稳定。
- 图片加载后会 `recalc()` 并 `goPage(currentPage)`。

当前关键 CSS 变量：

```css
--font-size: 21px;
--line-height: 1.86;
--safe-top: clamp(24px, 3.4vh, 42px);
--safe-bottom: clamp(32px, 5.2vh, 64px);
--safe-left: clamp(320px, 27vw, 540px);
--safe-right: clamp(150px, 11vw, 240px);
--content-width: calc(page-width - safe-left - safe-right);
--column-gap: calc(safe-left + safe-right);
--content-height: calc(page-height - safe-top - safe-bottom);
```

当前模型优点：

- `kagami.epub` 已不再出现最早那种明显跳版。
- gaiji 图片加载后的位移已明显缩小。
- 普通章节的章节切换空白时间已降低。

当前模型问题：

- 与 `ebook-reader` 红框参考相比，标题页、说明页、词条页、目录页、正文页的位置仍不对。
- 当前页距与内容区域是手调出来的，不是从明确的 page contract 推导出来的。
- 短章节不能再按字数做特殊分支，否则容易误伤目录和其他短内容。

## 固定测试 EPUB

本地调试目录：

- `../debug-epubs/kagami.epub`
- `../debug-epubs/Re0.epub`

注意：`../debug-epubs/` 是未跟踪调试目录，不应提交。

主要排版样本使用 `kagami.epub`：

| App 章节 | EPUB 文件 | 类型 | 观察点 |
| --- | --- | --- | --- |
| Ch.2 | `text/part0000.html` | 标题页 | 书名和作者应在右侧窄区域内，作者靠下。 |
| Ch.3 | `text/part0001.html` | 阅读说明页 | 两列说明文字应接近 `ebook-reader` 红框位置。 |
| Ch.4 | `text/part0002.html` | 词条页 | 词条正文和出处应在同一窄区域内，出处靠下。 |
| Ch.5 | `text/part0003.html` | 正文起始页 | 长正文应正常分栏，不应被短页规则影响。 |
| Ch.6 | `text/part0004.html` | 目录页 | 目录页虽短，但应保持宽排版区域，不应被误判成标题/词条窄页。 |
| Ch.11+ | `text/part0009.html` 起 | 普通长正文 | 验证分页、翻页和内容边界稳定性。 |

## 已知失败模式

### 1. 短章节特殊 CSS

曾尝试按 `charCount <= 80` 和 `.inline-height` 给短章节单独设置更大的左安全区。

结果：

- 位置仍不对。
- 规则过于依赖 `kagami` 的局部结构。
- 属于截图驱动的猜测，不适合作为后续方向。

状态：已回滚。

### 2. 直接切换到 `scrollTop`

曾尝试把竖排分页轴从 `.rv.scrollLeft` 改成 `.rv.scrollTop`，并用内容高度作为 `column-width`。

结果：

- 顶部出现横向散字。
- 短章节出现假页，例如 Ch.2 显示 `P.2/2`。
- 需要连续按两次左/右键才能翻页。

原因判断：

- 只迁移了参考实现的“纵向滚动轴”表象，没有一起迁移其 scroll container、content container、page step、column gap、section 边界和内容首尾边界计算。
- `height:auto` / `max-height` 与 vertical CSS columns 组合不稳定。

状态：已回滚。

## 参考实现拆解重点

### ebook-reader

重点文件：

- `apps/web/src/lib/components/book-reader/book-reader.svelte`
- `apps/web/src/lib/components/book-reader/book-reader-paginated/book-reader-paginated.svelte`
- `apps/web/src/lib/components/book-reader/book-reader-paginated/page-manager-paginated.ts`
- `apps/web/src/lib/components/book-reader/styles.scss`

目前读到的关键点：

- `BookReader` 外层先根据 viewport 和 padding 计算内容 viewport。
- `BookReaderPaginated` 中 `scrollEl` 和 `contentEl` 分开。
- 竖排时 `.book-content-container` 使用 `column-width: var(--book-content-child-height)`。
- PageManager 用 `height` 作为竖排 viewport size，并把 page gap 纳入翻页 offset。
- 它还有 section 边界和 translate fallback，不只是单纯 CSS columns。

### W1ght/Hoshi-Reader-Windows

重点文件：

- `Hoshi/Services/Novels/NovelReaderContentStyles.cs`
- `Hoshi/Web/NovelReader/reader-bridge.js`

目前读到的关键点：

- 内容 CSS 中定义 `--page-width`、`--page-height`、`--reader-safe-inline`、`--reader-safe-block`、`--reader-content-width`、`--reader-column-gap`。
- `reader-bridge.js` 会区分 vertical/horizontal scroll context。
- 有 `contentFirstPageScroll()` / `contentLastPageScroll()`，用于用实际内容 rect 计算可翻页边界。
- 这能避免短章节因为容器空白、padding、gap 产生假页。

## 下一步验收口径

每次 Reader 布局改动至少检查：

- Ch.2 不应出现假页。
- Ch.3/Ch.4 不应需要按两次方向键才能切章或翻页。
- Ch.5 长正文不应被短章节布局规则影响。
- Ch.6 目录页不应被误判为标题/词条窄页。
- 含 gaiji 图片章节不应重新出现明显跳版。
- `npm run check` 通过。
- `npm run build` 通过。

建议下一步先加临时诊断输出或测试辅助函数，记录：

- `.rv.clientWidth`
- `.rv.scrollWidth`
- `.rct.getBoundingClientRect()`
- 首个可读文字 rect
- 最后一个可读文字 rect
- 计算出的 `totalPages`
- 当前 `scrollLeft`

这些数据稳定后，再考虑移动排版位置。
