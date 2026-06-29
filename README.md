<div align="center">
 
 # Hoshi Reader Windows

![Language](https://img.shields.io/github/languages/top/Dr-TNineS/Hoshi-Reader-Windows)
![Platform](https://img.shields.io/badge/platform-Windows-0078D4)
![License](https://img.shields.io/github/license/Dr-TNineS/Hoshi-Reader-Windows)

Hoshi Reader Windows is a Japanese EPUB reader with Yomitan dictionary support, built for desktop immersion learning on Windows.

It brings together vertical Japanese reading, popup dictionary lookup, AnkiConnect mining, local EPUB library management, and desktop-oriented keyboard and mouse interaction in a Windows/Tauri application.

The reading and lookup experience is primarily aligned with [Hoshi Reader Android](https://github.com/HuangAntimony/Hoshi-Reader-Android), while the desktop UI, panel layout, and interaction design also draw inspiration from [Hoshi Reader Mac](https://github.com/W1ght/Hoshi-Reader-Mac).

> **Work in progress:** Hoshi Reader Windows is actively developed. The core reading, dictionary, and Anki workflow is available, while sync, statistics, Sasayaki audiobook support, horizontal layout, and broader release validation are still in progress.

<!--
<p align="center">
    <img src="Pictures/books_windows.png" width="32%" alt="Bookshelf">
    <img src="Pictures/reader_windows.png" width="32%" alt="Reader">
    <img src="Pictures/popup_dict_windows.png" width="32%" alt="Popup dictionary">
</p>
<p align="center">
    <img src="Pictures/dictionaries_windows.png" width="32%" alt="Dictionary management">
    <img src="Pictures/appearance_windows.png" width="32%" alt="Appearance settings">
    <img src="Pictures/anki_windows.png" width="32%" alt="Anki settings">
</p>
-->

</div>

## Status

Hoshi Reader Windows is currently intended for local development and testing.

There is not yet a fully verified public release pipeline. You can build the application locally from source, or create a portable ZIP through the included packaging script.

## Features

- **Vertical** (縦書き) paginated EPUB reading for Japanese novels and other EPUB content
- Desktop bookshelf with EPUB import, app-owned library storage, cover display, reading progress, resume support, and duplicate-content reuse
- Table of contents, internal chapter-link navigation, page navigation, chapter navigation, and progress restoration
- Yomitan-style popup dictionary with **deinflection support**
- Import and manage Yomitan **term**, **frequency**, and **pitch** dictionaries
- Dictionary enable/disable controls, per-category ordering, refresh, and safe deletion of app-owned imported data
- `Shift` hover lookup that scans from the pointer position
- Left-click lookup in reader text and dictionary glossary text
- Nested lookup inside popup glossary content
- Popup rendering for expressions, readings, glossaries, matched/deinflected text, rules, dictionary labels, frequency data, pitch information, dictionary styles, and supported dictionary media
- Configurable popup width, height, and content scale
- Light and dark reader themes
- Optional startup restore for the last reading session
- Built-in shortcuts panel with editable global selected-text lookup shortcut and read-only reader/Sasayaki shortcut reference
- AnkiConnect configuration, deck and note-type selection, field templates, field preview, duplicate handling, and note creation from lookup results
- Initial support for dictionary media, book-cover media, local word audio, and ordered remote word-audio sources during Anki export

## Windows Interaction

Hoshi Reader Windows is designed around desktop reading and lookup behavior:

- The bookshelf keeps `Library`, `Dictionaries`, `Anki`, `Appearance`, `Advanced`, and `Shortcuts` available as separate panels.
- Imported EPUBs are copied into an app-owned library. Removing a book from HSW does not delete the original EPUB file.
- `Esc` first clears an active lookup selection, then closes the table of contents, then returns to the bookshelf.
- Arrow keys navigate pages.
- `Ctrl` / `Meta` chapter navigation is supported in the reader.
- Hold `Shift` while hovering Japanese text to trigger lookup from the pointer position.
- Left-click text to open a dictionary popup without performing normal drag selection.
- Dictionary popups prefer the left or right side of selected text, with top and bottom fallback when space is limited.

## Anki On Windows

Card creation uses [AnkiConnect](https://ankiweb.net/shared/info/2055492159) running on the same computer.

1. Install Anki and the AnkiConnect add-on.

2. Start Anki.

3. Open Hoshi Reader Windows and select `Anki` from the bookshelf sidebar.

4. Set or confirm the local endpoint:

   ```text
   http://127.0.0.1:8765
   ```

5. Test the connection.

6. Fetch available decks and note types.

7. Select a deck and note type, then map HSW fields to your Anki fields.

8. Open a dictionary popup in the reader and use the Anki action to create a note.

For safety, HSW only accepts local AnkiConnect HTTP endpoints such as `localhost` and `127.0.0.1`.

## Dictionary Setup

Hoshi Reader Windows uses Yomitan-format dictionary archives.

1. Open the `Dictionaries` panel from the bookshelf.
2. Choose **Import Dictionary**.
3. Select a Yomitan `.zip` dictionary.
4. Confirm the dictionary appears under one or more categories:
   - Term
   - Frequency
   - Pitch
5. Enable it and adjust its order if needed.
6. Return to the reader and trigger a lookup.

The dictionary backend requires the bundled `hoshidicts` native dependency to build successfully. If the engine is unavailable, HSW will show a dedicated dictionary-engine state instead of returning fake results.

## Keyboard And Mouse Shortcuts

| Action                         | Default                                                      |
| ------------------------------ | ------------------------------------------------------------ |
| Previous page                  | `←`                                                          |
| Next page                      | `→`                                                          |
| Chapter navigation             | `Ctrl` / `Meta` + arrow keys                                 |
| Close selection / TOC / reader | `Esc`                                                        |
| Hover / Click lookup           | Hold `Shift` / Left Click over reader text or popup glossary text |
| Global selected-text lookup    | `Ctrl` + `Alt` + `H`                                         |

The global selected-text lookup shortcut can be recorded and reset from the Shortcuts or Advanced panel. Reader and Sasayaki shortcuts are still informational.

## Current Limitations

The following areas are not implemented yet, deliberately limited, or still need wider real-world validation:

- Horizontal (横書き) paginated reading
- Continuous reading mode
- Reading statistics
- Cross-device sync
- Google Drive or cloud sync
- Sasayaki audiobook playback and cue matching
- Custom themes, custom fonts, custom reader CSS, and user dictionary CSS editing
- Full release packaging and update delivery
- Full runtime validation with a broad range of media-heavy Yomitan dictionaries
- Full runtime validation for every Anki media, word-audio, popup playback, and sync combination

Some Windows compatibility dictionary imports may skip problematic media entries when legacy filename encoding prevents a safe import. Lookup data remains available in that compatibility path.

## Development

### Requirements

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://www.rust-lang.org/) 1.77.2+
- Visual Studio Build Tools or Visual Studio with:
  - Desktop development with C++
  - MSVC toolchain
  - Windows SDK
  - CMake

For native dictionary support, use an **x64 Visual Studio Developer Command Prompt** or another shell where CMake and the MSVC C++ toolchain are available.

### Clone

Clone the repository together with its submodules:

```bash
git clone --recurse-submodules https://github.com/Dr-TNineS/Hoshi-Reader-Windows.git
cd Hoshi-Reader-Windows
npm install
```

If the repository was cloned without submodules:

```bash
git submodule update --init --recursive
```

### Run

```bash
npm exec tauri dev
```

You can also run:

```bash
npx tauri dev
```

Running only Vite in a browser does not provide the complete application experience, because EPUB import, app-owned storage, native dictionary lookup, and AnkiConnect features require the Tauri runtime.

### Build

Build the frontend:

```bash
npm run build
```

Build the Tauri application:

```bash
npm exec tauri build
```

Create a local portable ZIP package:

```bash
npm run package
```

The portable ZIP is written under:

```text
release/
```

## Validation Commands

```bash
# Svelte and TypeScript checks
npm run check

# Production frontend build
npm run build

# Bookshelf regression checks
npm run check:bookshelf

# Dictionary management regression checks
npm run check:dictionary-management

# Dictionary popup regression checks
npm run check:lookup-popup

# Lookup performance checks
npm run check:lookup-performance

# Reader visual regression checks
npm run check:reader-visual

# Reader table-of-contents regression checks
npm run check:reader-toc

# Appearance and Advanced settings checks
npm run check:settings-state

# AnkiConnect panel checks
npm run check:anki-connect
```

For Rust-side checks:

```bash
cd src-tauri
cargo check
cargo test --lib
```

## Relationship To Hoshi Reader

Hoshi Reader Windows is an independent Windows/Tauri implementation of the Hoshi Reader reading and dictionary workflow.

[Hoshi Reader Android](https://github.com/HuangAntimony/Hoshi-Reader-Android) is the primary reference for user-visible reading, lookup, dictionary, and Anki behavior.

[Hoshi Reader Mac](https://github.com/W1ght/Hoshi-Reader-Mac) is an important supplementary reference for desktop-oriented UI design, bookshelf and settings-panel organization, window-based interaction, and other macOS-to-Windows desktop adaptation ideas.

HSW does not directly copy the Android or Mac implementation. It adapts relevant observable behavior and interaction patterns to the Windows desktop environment and the Tauri, Rust, Svelte, and TypeScript stack.

## Libraries

| Name                                                | License          |
| --------------------------------------------------- | ---------------- |
| [hoshidicts](https://github.com/Manhhao/hoshidicts) | GPLv3            |
| [rbook](https://github.com/philips77/rbook)         | MIT              |
| [Tauri](https://github.com/tauri-apps/tauri)        | Apache-2.0 / MIT |
| [Svelte](https://github.com/sveltejs/svelte)        | MIT              |
| [Vite](https://vitejs.dev/)                         | MIT              |
| [Bits UI](https://bits-ui.com/)                     | MIT              |

## Attribution

| Name                                                         | Description                                                  | License      |
| ------------------------------------------------------------ | ------------------------------------------------------------ | ------------ |
| [Hoshi Reader Android](https://github.com/HuangAntimony/Hoshi-Reader-Android) | Primary reference for visible reading and lookup behavior    | GPLv3        |
| [Hoshi Reader Mac](https://github.com/W1ght/Hoshi-Reader-Mac) | Supplementary reference for desktop UI, panel organization, and desktop interaction design | GPLv3        |
| [Hoshi Reader](https://github.com/Manhhao/Hoshi-Reader)      | Original Hoshi Reader ecosystem                              | GPLv3        |
| [hoshidicts](https://github.com/Manhhao/hoshidicts)          | Native Yomitan dictionary backend                            | GPLv3        |
| [Yomitan](https://github.com/yomidevs/yomitan)               | Dictionary format ecosystem and popup-dictionary inspiration | GPLv3        |
| [ッツ Ebook Reader](https://github.com/ttu-ttu/ebook-reader) | Reader experience inspiration                                | BSD-3-Clause |
| [rbook](https://github.com/philips77/rbook)                  | EPUB parsing and reading support                             | MIT          |

## Special Thanks

- **[Manhhao/Hoshi-Reader](https://github.com/Manhhao/Hoshi-Reader)** — for the original Hoshi Reader project and the ecosystem this project builds alongside.
- **[HuangAntimony/Hoshi-Reader-Android](https://github.com/HuangAntimony/Hoshi-Reader-Android)** — for serving as the primary behavior reference for HSW.
- [**W1ght/Hoshi-Reader-Mac**](https://github.com/W1ght/Hoshi-Reader-Mac) — for providing valuable reference material for adapting Hoshi Reader into a desktop-oriented interface and interaction model.
- **[Yomitan](https://github.com/yomidevs/yomitan)** — for making Japanese dictionary lookup and mining workflows much more approachable.
- **[TheMoeWay](https://learnjapanese.moe/)** — for helping make immersion learning more accessible to learners around the world.
- **[ッツ Ebook Reader](https://github.com/ttu-ttu/ebook-reader)** — for inspiring parts of the desktop reading experience.

## License

Distributed under the [GNU General Public License v3.0](https://chatgpt.com/g/g-p-6a2d17920aa481918206ad24a5c7feff/c/LICENSE).
