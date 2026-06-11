<div align="center">

# Hoshi Reader Windows

![Platform](https://img.shields.io/badge/platform-Windows-blue)
![License](https://img.shields.io/badge/license-GPLv3-blue)

Hoshi Reader Windows is a Japanese EPUB reader for Windows desktop, built for immersion learning with Yomitan dictionary lookup. It is a native Windows recreation of [Hoshi Reader Android](https://github.com/HuangAntimony/Hoshi-Reader-Android) and [Hoshi Reader](https://github.com/Manhhao/Hoshi-Reader).

</div>

## Features

### Bookshelf

- Import EPUBs and track reading progress from the bookshelf.
- App-owned library with content-based deduplication.
- Session restore on startup.

### Reading

- Vertical (纵書き) text with paginated layout.
- Keyboard navigation: arrow keys for pages, Ctrl/Meta for chapters.
- Table of contents overlay and internal chapter-link navigation.
- Escape to return to bookshelf.

### Lookup

- Import Yomitan term, frequency, and pitch dictionaries.
- Select text in the reader for pop-up dictionary lookup with deinflection support.
- Shift hover for quick text selection and continuous reselection.
- Renders expression, reading, glossary, frequency, and pitch results.

### Not Yet Implemented

- Settings and appearance customization.
- Horizontal (横書き) text with paginated layout.
- Anki card mining (frontend boundary exists, not wired).
- Sync, audiobook read-along, reading statistics.
- Custom themes, fonts, and CSS.

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://www.rust-lang.org/) 1.77+
- [VS Build Tools](https://visualstudio.microsoft.com/downloads/) with C++ and CMake (for the dictionary backend)

### Setup

```bash
git clone https://github.com/Dr-TNineS/Hoshi-Reader-Windows.git
cd Hoshi-Reader-Windows
npm install
```

### Run

```bash
npx tauri dev
```

### Build

```bash
npx tauri build
```

## Libraries

| Name | License |
| :--- | :--- |
| [hoshidicts](https://github.com/Manhhao/hoshidicts) | GPLv3 |
| [rbook](https://github.com/philips77/rbook) | MIT |
| [Tauri](https://github.com/tauri-apps/tauri) | Apache-2.0 / MIT |
| [Svelte](https://github.com/sveltejs/svelte) | MIT |
| [Vite](https://github.com/vitejs/vite) | MIT |

## Attribution

Hoshi Reader Windows builds on this ecosystem:

- [Hoshi Reader Android](https://github.com/HuangAntimony/Hoshi-Reader-Android) and [Hoshi Reader iOS](https://github.com/Manhhao/Hoshi-Reader) as the reference implementations.
- [hoshidicts](https://github.com/Manhhao/hoshidicts) for Yomitan dictionary support.
- [Yomitan](https://github.com/yomidevs/yomitan) for dictionary format and lookup inspiration.
- [ッツ Ebook Reader](https://github.com/ttu-ttu/ebook-reader) for reader experience inspiration.

## License

Distributed under the GNU General Public License v3.0. See [LICENSE](LICENSE) for details.
