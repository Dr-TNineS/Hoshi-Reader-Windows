use crate::epub::sanitizer::sanitize_css_files;
use crate::epub::types::*;
use regex::Regex;
use std::fs;
use std::path::PathBuf;
use std::sync::LazyLock;
use std::time::{SystemTime, UNIX_EPOCH};

static RUBY_REGEX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?is)<r[tp]\b[^>]*>.*?</r[tp]>").unwrap());
static TAG_REGEX: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?is)<[^>]+>").unwrap());
static ENTITY_REGEX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"&#(?:x[0-9a-f]+|[0-9]+);|&[a-z][a-z0-9]+;").unwrap());

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

fn count_reader_chars(html: &str) -> usize {
    let without_ruby = RUBY_REGEX.replace_all(html, "");
    let without_tags = TAG_REGEX.replace_all(&without_ruby, "");
    let decoded = decode_basic_entities(&without_tags);
    decoded.chars().filter(|ch| is_reader_char(*ch)).count()
}

fn decode_basic_entities(text: &str) -> String {
    ENTITY_REGEX
        .replace_all(text, |caps: &regex::Captures| match &caps[0] {
            "&amp;" => "&".to_string(),
            "&lt;" => "<".to_string(),
            "&gt;" => ">".to_string(),
            "&quot;" => "\"".to_string(),
            "&apos;" => "'".to_string(),
            "&nbsp;" => "".to_string(),
            entity if entity.starts_with("&#x") || entity.starts_with("&#X") => {
                u32::from_str_radix(&entity[3..entity.len() - 1], 16)
                    .ok()
                    .and_then(char::from_u32)
                    .map(|ch| ch.to_string())
                    .unwrap_or_default()
            }
            entity if entity.starts_with("&#") => entity[2..entity.len() - 1]
                .parse::<u32>()
                .ok()
                .and_then(char::from_u32)
                .map(|ch| ch.to_string())
                .unwrap_or_default(),
            _ => "".to_string(),
        })
        .into_owned()
}

fn is_reader_char(ch: char) -> bool {
    ch.is_ascii_alphanumeric()
        || ('\u{3040}'..='\u{30ff}').contains(&ch)
        || ('\u{31f0}'..='\u{31ff}').contains(&ch)
        || ('\u{3400}'..='\u{9fff}').contains(&ch)
        || ('\u{f900}'..='\u{faff}').contains(&ch)
        || ('\u{ff10}'..='\u{ff9f}').contains(&ch)
        || matches!(ch, '々' | '〆' | '〻' | '〇' | '○' | '◯')
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
    fn reader_char_count_ignores_markup_and_ruby() {
        let html = r#"<p>五月<ruby>雨<rt>あめ</rt><rp>（</rp></ruby>&nbsp;A1</p>"#;
        assert_eq!(count_reader_chars(html), 5);
    }
}
