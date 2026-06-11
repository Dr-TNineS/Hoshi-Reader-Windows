<div align="center">

# Hoshi Reader Windows

![Language](https://img.shields.io/github/languages/top/Dr-TNineS/Hoshi-Reader-Windows)
![Platform](https://img.shields.io/badge/platform-Windows-blue)
![License](https://img.shields.io/github/license/Dr-TNineS/Hoshi-Reader-Windows)

Hoshi Reader Windows is a Japanese EPUB reader with Yomitan dictionary support, made for immersion learning on Windows desktop.

</div>

## Features

- **Vertical** (縦書き) and horizontal (横書き) text
- Yomitan-compatible pop-up dictionary with **deinflection support**
- Support for Yomitan term, frequency and pitch dictionaries
- EPUB bookshelf with import and reading progress
- Keyboard navigation and TOC overlay
- App-owned EPUB library with content-based deduplication

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://www.rust-lang.org/) 1.77+
- [VS Build Tools](https://visualstudio.microsoft.com/downloads/) with C++ and CMake (for dictionary backend)

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

| Name | Description | License |
| :--- | :--- | :--- |
| [Yomitan](https://github.com/yomidevs/yomitan) | Various code from pop-up dictionary | GPLv3 |
| [Hoshi Reader (iOS)](https://github.com/Manhhao/Hoshi-Reader) | Primary reference implementation | GPLv3 |
| [永汁 Ebook Reader](https://github.com/ttu-ttu/ebook-reader) | Core reading experience inspiration | BSD-3 |
| [Ankiconnect Android](https://github.com/KamWithK/AnkiconnectAndroid) | Local audio reference | GPLv3 |
| [JMdict for Yomitan](https://github.com/yomidevs/jmdict-yomitan) | Recommended term dictionary | CC-BY-SA-4.0 |
| [Jitendex](https://github.com/stephenmk/Jitendex) | Recommended J-E dictionary | CC-BY-SA-4.0 |

## Special Thanks

* **[TheMoeWay](https://learnjapanese.moe/)** — Enabling immersion-based Japanese learning.
* **[Yomitan](https://github.com/yomidevs/yomitan)** — Primary inspiration for the pop-up dictionary.
* **[Hoshi Reader (iOS)](https://github.com/Manhhao/Hoshi-Reader)** — Reference implementation this project is ported from.
* **[永汁 Ebook Reader](https://github.com/ttu-ttu/ebook-reader)** — Inspiring the core reading experience.
* **[星街すいせい (Hoshimachi Suisei)](https://www.youtube.com/@HoshimachiSuisei)** — For the name (星読み).

## License

Distributed under the GNU General Public License v3.0. See [LICENSE](LICENSE) for more information.
