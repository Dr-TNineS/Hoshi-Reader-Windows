use regex::{Captures, Regex};
use std::fs;
use std::path::Path;
use std::sync::OnceLock;

const READER_LINE_HEIGHT: &str = "1.65";

static CALIBRE_RULE_RE: OnceLock<Regex> = OnceLock::new();
static EPUB_PRIVATE_DECLARATION_RE: OnceLock<Regex> = OnceLock::new();
static PUBLISHER_WRITING_MODE_RE: OnceLock<Regex> = OnceLock::new();

pub fn sanitize_css_files(root: &Path) -> Result<(), String> {
    sanitize_css_files_inner(root)
}

fn sanitize_css_files_inner(path: &Path) -> Result<(), String> {
    for entry in fs::read_dir(path).map_err(|e| format!("Cannot scan extracted epub: {e}"))? {
        let entry = entry.map_err(|e| format!("Cannot read extracted epub entry: {e}"))?;
        let path = entry.path();
        if path.is_dir() {
            sanitize_css_files_inner(&path)?;
            continue;
        }
        if !is_css_file(&path) {
            continue;
        }

        let bytes =
            fs::read(&path).map_err(|e| format!("Cannot read css file {}: {e}", path.display()))?;
        let Ok(content) = String::from_utf8(bytes) else {
            continue;
        };
        let sanitized = sanitize_reader_css(&content);
        if sanitized != content {
            fs::write(&path, sanitized)
                .map_err(|e| format!("Cannot write css file {}: {e}", path.display()))?;
        }
    }
    Ok(())
}

fn is_css_file(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("css"))
}

pub fn sanitize_reader_css(css: &str) -> String {
    strip_publisher_writing_mode_css(&sanitize_epub_private_css(&sanitize_calibre_css(css)))
}

fn sanitize_calibre_css(css: &str) -> String {
    let mut did_strip_line_height = false;
    let result = calibre_rule_re().replace_all(css, |captures: &Captures| {
        let selector = captures.get(1).map_or("", |m| m.as_str());
        let declarations = captures.get(2).map_or("", |m| m.as_str());
        let declarations: Vec<&str> = declarations.split(';').collect();
        if declarations
            .iter()
            .any(|declaration| property_name(declaration) == "line-height")
        {
            did_strip_line_height = true;
        }
        let strip_height = declarations
            .iter()
            .any(|declaration| is_writing_mode_property(&property_name(declaration)));
        let cleaned = declarations
            .iter()
            .filter_map(|declaration| sanitize_calibre_declaration(declaration, strip_height))
            .collect::<Vec<_>>()
            .join(";");
        format!("{selector}{{{cleaned}}}")
    });

    if did_strip_line_height {
        format!("{result}\nbody {{ line-height: {READER_LINE_HEIGHT}; }}\n")
    } else {
        result.into_owned()
    }
}

fn sanitize_epub_private_css(css: &str) -> String {
    epub_private_declaration_re()
        .replace_all(css, |captures: &Captures| {
            let indent = captures.name("indent").map_or("", |m| m.as_str());
            let property = captures
                .name("property")
                .map_or("", |m| m.as_str())
                .trim()
                .to_ascii_lowercase();
            let value = captures.name("value").map_or("", |m| m.as_str()).trim();
            replacement_declarations(indent, &property, value)
        })
        .into_owned()
}

fn strip_publisher_writing_mode_css(css: &str) -> String {
    publisher_writing_mode_re()
        .replace_all(css, |captures: &Captures| {
            captures.get(1).map_or("", |m| m.as_str()).to_string()
        })
        .into_owned()
}

fn sanitize_calibre_declaration(declaration: &str, strip_height: bool) -> Option<String> {
    match property_name(declaration).as_str() {
        property if is_writing_mode_property(property) => None,
        "line-height" => None,
        "height" if strip_height => None,
        "text-indent" => {
            let value = declaration
                .split_once(':')
                .map_or("", |(_, value)| value)
                .trim();
            if value.starts_with('-') {
                Some(declaration.to_string())
            } else {
                Some(" text-indent: 0".to_string())
            }
        }
        _ => Some(declaration.to_string()),
    }
}

fn property_name(declaration: &str) -> String {
    declaration
        .split_once(':')
        .map_or(declaration, |(name, _)| name)
        .trim()
        .to_ascii_lowercase()
}

fn is_writing_mode_property(property: &str) -> bool {
    matches!(
        property,
        "writing-mode" | "-webkit-writing-mode" | "-epub-writing-mode"
    )
}

fn replacement_declarations(indent: &str, property: &str, value: &str) -> String {
    match property {
        "writing-mode" => String::new(),
        "line-break" => declarations(
            indent,
            &[("-webkit-line-break", value), ("line-break", value)],
        ),
        "word-break" => declarations(indent, &[("word-break", value)]),
        "hyphens" => declarations(indent, &[("-webkit-hyphens", value), ("hyphens", value)]),
        "text-underline-position" => declarations(indent, &[("text-underline-position", value)]),
        "text-combine" => {
            let upright = if value.eq_ignore_ascii_case("horizontal") {
                "all"
            } else {
                value
            };
            declarations(
                indent,
                &[
                    ("-webkit-text-combine", value),
                    ("text-combine-upright", upright),
                ],
            )
        }
        "text-orientation" => declarations(
            indent,
            &[
                ("-webkit-text-orientation", value),
                ("text-orientation", value),
            ],
        ),
        "text-emphasis-style" => declarations(
            indent,
            &[
                ("-webkit-text-emphasis-style", value),
                ("text-emphasis-style", value),
            ],
        ),
        "text-emphasis-color" => declarations(
            indent,
            &[
                ("-webkit-text-emphasis-color", value),
                ("text-emphasis-color", value),
            ],
        ),
        _ => String::new(),
    }
}

fn declarations(indent: &str, pairs: &[(&str, &str)]) -> String {
    pairs
        .iter()
        .map(|(property, value)| format!("{indent}{property}: {value};"))
        .collect::<Vec<_>>()
        .join("\n")
        + "\n"
}

fn calibre_rule_re() -> &'static Regex {
    CALIBRE_RULE_RE.get_or_init(|| {
        Regex::new(r"(?ms)^(\s*\.(?:calibre\d*|body|c\d*|p\d+)\s*)\{(.*?)\}")
            .expect("valid calibre rule regex")
    })
}

fn epub_private_declaration_re() -> &'static Regex {
    EPUB_PRIVATE_DECLARATION_RE.get_or_init(|| {
        Regex::new(r"(?im)^(?P<indent>[ \t]*)-epub-(?P<property>[^:;{}\r\n]+)[ \t]*:[ \t]*(?P<value>[^;{}\r\n]*)[ \t]*;[ \t]*(?:\r?\n)?")
            .expect("valid epub private declaration regex")
    })
}

fn publisher_writing_mode_re() -> &'static Regex {
    PUBLISHER_WRITING_MODE_RE.get_or_init(|| {
        Regex::new(r"(?i)(^|[;{])\s*(?:-webkit-)?writing-mode\s*:\s*[^;{}]+;?")
            .expect("valid publisher writing-mode regex")
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_dir() -> std::path::PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "hoshi_reader_css_sanitizer_{}_{}",
            std::process::id(),
            stamp
        ));
        fs::create_dir(&path).unwrap();
        path
    }

    #[test]
    fn normalizes_known_epub_private_declarations() {
        let css = r#"
.h-valign-width {
  display: inline-block;
  -epub-writing-mode: horizontal-tb;
  -epub-line-break: strict;
  -epub-word-break: keep-all;
  vertical-align: middle;
}
.vrtl {
  -webkit-writing-mode: vertical-rl;
  -epub-writing-mode: vertical-rl;
  -epub-hyphens: auto;
  -epub-text-underline-position: under left;
  -epub-text-emphasis-style: filled sesame;
  -epub-text-emphasis-color: #000000;
  -epub-unknown-property: ignored;
}
"#;

        let sanitized = sanitize_reader_css(css);

        assert!(!sanitized.contains("-epub-"), "{sanitized}");
        assert!(sanitized.contains("display: inline-block;"));
        assert!(!sanitized.contains("-webkit-writing-mode: vertical-rl;"));
        assert!(!sanitized.contains("writing-mode: horizontal-tb;"));
        assert!(sanitized.contains("line-break: strict;"));
        assert!(sanitized.contains("word-break: keep-all;"));
        assert!(sanitized.contains("-webkit-hyphens: auto;"));
        assert!(sanitized.contains("hyphens: auto;"));
        assert!(sanitized.contains("text-underline-position: under left;"));
        assert!(sanitized.contains("-webkit-text-emphasis-style: filled sesame;"));
        assert!(sanitized.contains("text-emphasis-style: filled sesame;"));
        assert!(sanitized.contains("-webkit-text-emphasis-color: #000000;"));
        assert!(sanitized.contains("text-emphasis-color: #000000;"));
        assert!(sanitized.contains("vertical-align: middle;"));
    }

    #[test]
    fn removes_calibre_layout_declarations_that_override_reader_layout() {
        let css = r#"
.calibre {
  display: block;
  writing-mode: vertical-rl;
  -webkit-writing-mode: vertical-rl;
  -epub-writing-mode: vertical-rl;
  line-height: 1.2;
  height: 100%;
  text-indent: 1.5em;
}
.p12 {
  margin: 0;
  text-indent: -1em;
}
.chapter {
  line-height: 2;
  height: 40px;
  text-indent: 2em;
}
"#;

        let sanitized = sanitize_reader_css(css);

        assert!(
            !sanitized.contains("writing-mode: vertical-rl"),
            "{sanitized}"
        );
        assert!(!sanitized.contains("-webkit-writing-mode: vertical-rl"));
        assert!(!sanitized.contains("-epub-writing-mode: vertical-rl"));
        assert!(!sanitized.contains("line-height: 1.2"));
        assert!(!sanitized.contains("height: 100%"));
        assert!(sanitized.contains(" text-indent: 0"));
        assert!(sanitized.contains("text-indent: -1em"));
        assert!(sanitized.contains(".chapter"));
        assert!(sanitized.contains("line-height: 2"));
        assert!(sanitized.contains("height: 40px"));
        assert!(sanitized.contains("text-indent: 2em"));
        assert!(sanitized.ends_with("\nbody { line-height: 1.65; }\n"));
    }

    #[test]
    fn preserves_non_calibre_layout_declarations() {
        let css = ".chapter { writing-mode: vertical-rl; line-height: 2; height: 40px; text-indent: 2em; }";

        let sanitized = sanitize_reader_css(css);

        assert!(!sanitized.contains("writing-mode: vertical-rl"));
        assert!(sanitized.contains("line-height: 2"));
        assert!(sanitized.contains("height: 40px"));
        assert!(sanitized.contains("text-indent: 2em"));
    }

    #[test]
    fn sanitizes_css_files_recursively_without_touching_non_utf8_css() {
        let root = test_dir();
        let nested = root.join("styles");
        fs::create_dir(&nested).unwrap();
        let css_path = nested.join("reader.css");
        let binary_css_path = nested.join("legacy.css");
        let html_path = nested.join("chapter.xhtml");

        fs::write(
            &css_path,
            ".calibre { writing-mode: vertical-rl; line-height: 1.2; height: 100%; }",
        )
        .unwrap();
        fs::File::create(&binary_css_path)
            .unwrap()
            .write_all(&[0x80, b'.', b'x', b'{', b'}'])
            .unwrap();
        fs::write(&html_path, ".calibre { writing-mode: vertical-rl; }").unwrap();

        sanitize_css_files(&root).unwrap();

        let sanitized = fs::read_to_string(&css_path).unwrap();
        assert!(!sanitized.contains("writing-mode"));
        assert!(!sanitized.contains("line-height: 1.2"));
        assert_eq!(fs::read(&binary_css_path).unwrap(), [0x80, b'.', b'x', b'{', b'}']);
        assert!(fs::read_to_string(&html_path).unwrap().contains("writing-mode"));

        let _ = fs::remove_dir_all(root);
    }
}
