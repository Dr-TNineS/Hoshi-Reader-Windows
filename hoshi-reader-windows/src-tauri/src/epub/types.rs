use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct ManifestItem {
    pub id: String,
    pub href: String,
    pub media_type: String,
    pub properties: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SpineItem {
    pub idref: String,
    pub linear: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct TocNode {
    pub label: String,
    pub href: Option<String>,
    pub children: Vec<TocNode>,
}

#[derive(Debug, Clone, Serialize)]
pub struct EpubMeta {
    pub title: Option<String>,
    pub cover_href: Option<String>,
    pub manifest: Vec<ManifestItem>,
    pub spine: Vec<SpineItem>,
    pub toc: Vec<TocNode>,
}
