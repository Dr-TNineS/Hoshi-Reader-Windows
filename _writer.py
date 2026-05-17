import os

content = r'''use std::path::PathBuf;
use std::sync::Mutex;
use serde::Serialize;
use tauri::State;

#[derive(Debug, Clone, Serialize)]
pub struct ManifestItem {{
    pub id: String,
    pub href: String,
    pub media_type: String,
    pub properties: Option<String>,
}}

#[derive(Debug, Clone, Serialize)]
pub struct SpineItem {{
    pub idref: String,
    pub linear: bool,
}}

#[derive(Debug, Clone, Serialize)]
pub struct TocNode {{
    pub label: String,
    pub href: Option<String>,
    pub children: Vec<TocNode>,
}}

#[derive(Debug, Clone, Serialize)]
pub struct EpubMeta {{
    pub title: Option<String>,
    pub cover_href: Option<String>,
    pub manifest: Vec<ManifestItem>,
    pub spine: Vec<SpineItem>,
    pub toc: Vec<TocNode>,
}}

pub struct EpubBook {{
    epub: rbook::Epub,
    root_dir: PathBuf,
    content_dir: PathBuf,
}}

impl EpubBook {{
    fn open(root_dir: &str) -> Result<Self, String> {{
        let root = PathBuf::from(root_dir);
        let epub = rbook::Epub::open(&root).map_err(|e| e.to_string())?;
        let pkg_dir = epub.package().directory().decode();
        let content_dir = root.join(pkg_dir.trim_start_matches(char::from(0x2F)));
        Ok(EpubBook {{ epub, root_dir, content_dir }})
    }}

    fn title(&self) -> Option<String> {{
        self.epub.metadata().title().map(|t| t.value().to_string())
    }}

    fn cover_href(&self) -> Option<String> {{
        self.epub.manifest().cover_image().map(|e| e.href_raw().to_string())
    }}

    fn manifest(&self) -> Vec<ManifestItem> {{
        self.epub.manifest().iter().map(|entry| {{
            let props = entry.properties().to_string();
            ManifestItem {{
                id: entry.id().to_string(),
                href: entry.href_raw().to_string(),
                media_type: entry.media_type().to_string(),
                properties: if props.is_empty() {{ None }} else {{ Some(props) }},
            }}
        }}).collect()
    }}

    fn spine(&self) -> Vec<SpineItem> {{
        self.epub.spine().iter().map(|entry| SpineItem {{
            idref: entry.idref().to_string(),
            linear: entry.is_linear(),
        }}).collect()
    }}

    fn toc(&self) -> Vec<TocNode> {{
        match self.epub.toc().contents() {{
            Some(root) => root.iter().map(|e| Self::convert_toc_entry(e)).collect(),
            None => vec![],
        }}
    }}
'''

target = r'C:\\Users\\Wxm\\Documents\\New project\\hoshi-reader-windows\\src-tauri\\src\\epub\\mod_part1.rs'
# Replace escaped newlines with real newlines, and double braces with single
content = content.replace('\\n', '\n').replace('{{', '{').replace('}}', '}')
with open(target, 'w', encoding='utf-8') as f:
    f.write(content)
print('Part 1 written')