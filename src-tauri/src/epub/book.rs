use crate::epub::sanitizer::sanitize_css_files;
use crate::epub::types::*;
use regex::Regex;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use std::time::{SystemTime, UNIX_EPOCH};

static RUBY_REGEX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?s)<rt[^>]*>.*?</rt>").unwrap());
static BODY_REGEX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?s)<body.*?</body>").unwrap());
static SCRIPT_REGEX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?s)<script[^>]*>.*?</script>").unwrap());
static STYLE_REGEX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?s)<style[^>]*>.*?</style>").unwrap());
static TAG_REGEX: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?is)<[^>]+>").unwrap());

pub struct EpubBook {
    pub epub: rbook::Epub,
    pub root_dir: PathBuf,
    pub extracted_dir: Option<PathBuf>,
}

fn extract_epub(epub_path: &str) -> Result<PathBuf, String> {
    let file = fs::File::open(epub_path).map_err(|e| format!("Cannot open epub: {e}"))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("Cannot read zip: {e}"))?;

    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("Cannot read system time: {e}"))?
        .as_nanos();
    let dest = std::env::temp_dir().join(format!("hoshi_epub_{}_{}", std::process::id(), stamp));
    fs::create_dir(&dest).map_err(|e| format!("Cannot create temp dir: {e}"))?;

    for i in 0..archive.len() {
        let mut file = archive
            .by_index(i)
            .map_err(|e| format!("Zip entry error: {e}"))?;
        let out_path = match file.enclosed_name() {
            Some(p) => dest.join(p),
            None => continue,
        };
        if file.name().ends_with('/') {
            fs::create_dir_all(&out_path).map_err(|e| format!("Cannot create dir: {e}"))?;
        } else {
            if let Some(parent) = out_path.parent() {
                fs::create_dir_all(parent).map_err(|e| format!("Cannot create parent: {e}"))?;
            }
            let mut outfile =
                fs::File::create(&out_path).map_err(|e| format!("Cannot create file: {e}"))?;
            std::io::copy(&mut file, &mut outfile).map_err(|e| format!("Cannot extract: {e}"))?;
        }
    }
    sanitize_css_files(&dest)?;
    Ok(dest)
}

impl EpubBook {
    pub fn open(epub_path: &str) -> Result<Self, String> {
        let extracted = extract_epub(epub_path)?;
        let root = extracted.clone();
        let epub = rbook::Epub::open(&root).map_err(|e| {
            let _ = fs::remove_dir_all(&extracted);
            format!("rbook open error: {e}")
        })?;
        Ok(EpubBook {
            epub,
            root_dir: root,
            extracted_dir: Some(extracted),
        })
    }

    pub fn title(&self) -> Option<String> {
        self.epub.metadata().title().map(|t| t.value().to_string())
    }

    pub fn cover_href(&self) -> Option<String> {
        self.epub
            .manifest()
            .cover_image()
            .map(|e| e.href_raw().to_string())
    }

    pub fn cover_absolute_path(&self) -> Option<PathBuf> {
        let cover = self.epub.manifest().cover_image()?;
        let href = cover.href().decode();
        contained_cover_path(&self.root_dir, &self.root_dir.join(href.trim_start_matches('/')))
    }

    pub fn manifest(&self) -> Vec<ManifestItem> {
        self.epub
            .manifest()
            .iter()
            .map(|entry| {
                let props = entry.properties().to_string();
                ManifestItem {
                    id: entry.id().to_string(),
                    href: entry.href_raw().to_string(),
                    media_type: entry.media_type().to_string(),
                    properties: if props.is_empty() { None } else { Some(props) },
                }
            })
            .collect()
    }

    pub fn spine(&self) -> Vec<SpineItem> {
        self.epub
            .spine()
            .iter()
            .map(|entry| SpineItem {
                idref: entry.idref().to_string(),
                linear: entry.is_linear(),
            })
            .collect()
    }

    pub fn toc(&self) -> Vec<TocNode> {
        match self.epub.toc().contents() {
            Some(root) => root.iter().map(|e| Self::convert_toc_entry(&e)).collect(),
            None => vec![],
        }
    }

    pub fn book_info(&self) -> BookInfo {
        let mut current_total = 0;
        let mut chapter_info = Vec::new();

        for spine_index in 0..self.epub.spine().len() {
            let chapter_count = self
                .read_spine_item_text(spine_index as u32)
                .map(|html| count_reader_chars(&html))
                .unwrap_or(0);
            chapter_info.push(ChapterInfo {
                spine_index,
                current_total,
                chapter_count,
            });
            current_total += chapter_count;
        }

        BookInfo {
            character_count: current_total,
            chapter_info,
        }
    }

    pub fn chapter_absolute_path(&self, spine_index: u32) -> Result<Option<String>, String> {
        let spine_entry = self
            .epub
            .spine()
            .get(spine_index as usize)
            .ok_or_else(|| format!("Spine index {spine_index} out of range"))?;
        let Some(manifest_entry) = self.epub.manifest().by_id(spine_entry.idref()) else {
            return Ok(None);
        };
        let href = manifest_entry.href().decode();
        let path = self.root_dir.join(href.trim_start_matches('/'));
        Ok(Some(path.to_string_lossy().to_string()))
    }

    pub fn read_spine_item_text(&self, spine_index: u32) -> Result<String, String> {
        let spine_entry = self
            .epub
            .spine()
            .get(spine_index as usize)
            .ok_or_else(|| format!("Spine index {spine_index} out of range"))?;
        let idref = spine_entry.idref();
        let manifest_entry = self
            .epub
            .manifest()
            .by_id(idref)
            .ok_or_else(|| format!("Manifest item not found for idref: {idref}"))?;
        manifest_entry.read_str().map_err(|e| {
            format!(
                "Cannot read spine item {spine_index} idref={idref} href={} raw_href={}: {e}",
                manifest_entry.href(),
                manifest_entry.href_raw()
            )
        })
    }

    fn convert_toc_entry(entry: &rbook::epub::toc::EpubTocEntry) -> TocNode {
        TocNode {
            label: entry.label().to_string(),
            href: entry.href_raw().map(|h| h.to_string()),
            children: entry.iter().map(|e| Self::convert_toc_entry(&e)).collect(),
        }
    }
}

fn contained_cover_path(root: &Path, candidate: &Path) -> Option<PathBuf> {
    let root = fs::canonicalize(root).ok()?;
    let candidate = fs::canonicalize(candidate).ok()?;
    if candidate.is_file() && candidate.starts_with(root) {
        Some(candidate)
    } else {
        None
    }
}

fn count_reader_chars(html: &str) -> usize {
    visible_reader_text(html)
        .chars()
        .filter(|ch| is_reader_char(*ch))
        .count()
}

fn visible_reader_text(html: &str) -> String {
    let body = BODY_REGEX
        .find(html)
        .map(|matched| matched.as_str())
        .unwrap_or(html);
    let without_ruby = RUBY_REGEX.replace_all(body, "");
    let without_script = SCRIPT_REGEX.replace_all(&without_ruby, "");
    let without_style = STYLE_REGEX.replace_all(&without_script, "");
    let without_tags = TAG_REGEX.replace_all(&without_style, "");
    without_tags
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
}

fn is_reader_char(ch: char) -> bool {
    let code = ch as u32;
    matches!(
        code,
        0x30..=0x39
            | 0x41..=0x5a
            | 0x61..=0x7a
            | 0x25cb
            | 0x25ef
            | 0x3005..=0x3007
            | 0x303b
            | 0x3041..=0x3096
            | 0x309d..=0x309e
            | 0x30a1..=0x30fa
            | 0x30fc
            | 0xff10..=0xff19
            | 0xff21..=0xff3a
            | 0xff41..=0xff5a
            | 0xff66..=0xff9d
            | 0x2e80..=0x2fdf
            | 0x3400..=0x4dbf
            | 0x4e00..=0x9fff
            | 0x20000..=0x2a6df
            | 0x2a700..=0x2b73f
            | 0x2b740..=0x2b81f
            | 0x2b820..=0x2ceaf
            | 0x2ceb0..=0x2ebef
            | 0x30000..=0x3134f
            | 0x31350..=0x323af
    )
}

impl Drop for EpubBook {
    fn drop(&mut self) {
        if let Some(ref dir) = self.extracted_dir {
            let _ = fs::remove_dir_all(dir);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::write::FileOptions;

    fn test_stamp() -> u128 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    }

    fn write_test_epub(path: &std::path::Path) {
        let file = fs::File::create(path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        let options = FileOptions::default();

        zip.start_file("mimetype", options).unwrap();
        zip.write_all(b"application/epub+zip").unwrap();
        zip.start_file("META-INF/container.xml", options).unwrap();
        zip.write_all(
            br#"<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>"#,
        )
        .unwrap();
        zip.start_file("content.opf", options).unwrap();
        zip.write_all(
            br#"<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">test-book</dc:identifier>
    <dc:title>Test Book</dc:title>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="chapter1" href="text/chapter1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="chapter1"/>
  </spine>
</package>"#,
        )
        .unwrap();
        zip.start_file("nav.xhtml", options).unwrap();
        zip.write_all(br#"<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>Nav</title></head>
  <body><nav epub:type="toc" xmlns:epub="http://www.idpf.org/2007/ops"><ol><li><a href="text/chapter1.xhtml">Chapter</a></li></ol></nav></body>
</html>"#).unwrap();
        zip.start_file("text/chapter1.xhtml", options).unwrap();
        zip.write_all(
            br#"<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>Chapter</title></head>
  <body><p>Chapter one text.</p></body>
</html>"#,
        )
        .unwrap();
        zip.finish().unwrap();
    }

    #[test]
    fn reopening_same_epub_keeps_new_extraction_alive() {
        let epub_path =
            std::env::temp_dir().join(format!("hoshi_reader_test_{}.epub", test_stamp()));
        write_test_epub(&epub_path);
        let epub_path = epub_path.to_string_lossy().to_string();

        let first = EpubBook::open(&epub_path).unwrap();
        let second = EpubBook::open(&epub_path).unwrap();
        assert_ne!(first.root_dir, second.root_dir);

        drop(first);
        assert!(second.root_dir.exists());
        assert!(second
            .read_spine_item_text(0)
            .unwrap()
            .contains("Chapter one text."));

        let second_root = second.root_dir.clone();
        drop(second);
        assert!(!second_root.exists());
        let _ = fs::remove_file(epub_path);
    }

    #[test]
    fn contained_cover_path_rejects_missing_and_escaped_files() {
        let root = std::env::temp_dir().join(format!("hoshi_cover_guard_{}", test_stamp()));
        let images = root.join("images");
        fs::create_dir_all(&images).unwrap();
        let inside = images.join("cover.jpg");
        fs::write(&inside, b"cover").unwrap();
        let outside = root.with_extension("outside.jpg");
        fs::write(&outside, b"outside").unwrap();

        assert_eq!(contained_cover_path(&root, &inside), Some(inside.canonicalize().unwrap()));
        assert_eq!(contained_cover_path(&root, &images.join("missing.jpg")), None);
        assert_eq!(contained_cover_path(&root, &outside), None);

        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_file(&outside);
    }

    #[test]
    fn reader_char_count_ignores_markup_and_ruby() {
        let html = r#"<p>五月<ruby>雨<rt>あめ</rt><rp>（</rp></ruby>&nbsp;A1</p>"#;
        assert_eq!(count_reader_chars(html), 5);
    }

    #[test]
    fn reader_char_count_matches_hsa_visible_text_filter() {
        let html = r#"
<html>
  <head><style>漢字Ａ1</style></head>
  <body>
    <script>漢字Ｂ2</script>
    <p>日々○◯〻ぁゖゝゞァヺー０９ＡＺａｚｦﾝ⺀⿟㐀䶿一鿿𠀀𪛟𪜀𫜿𫝀𫠟𫠠𬺯𬺰𮯯𰀀𱍏𱍐𲎯</p>
    <p>。、!? &amp; &lt; &gt; &nbsp; &#x65e5; &quot;</p>
  </body>
</html>
"#;
        assert_eq!(count_reader_chars(html), 49);
    }

    #[test]
    fn reader_visible_text_prefers_body_when_available() {
        let html = r#"<html><head><title>外</title></head><body><p>内A</p></body></html>"#;
        assert_eq!(count_reader_chars(html), 2);
    }
}
