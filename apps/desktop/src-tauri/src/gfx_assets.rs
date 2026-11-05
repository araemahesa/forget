use crate::storage::{GfxSpec, StorageError};
use png::{Decoder, Limits};
use quick_xml::{events::Event, Reader, XmlVersion};
use std::io::Cursor;

pub fn validate_assets(spec: &GfxSpec, svg: &str, png: &[u8]) -> Result<(), StorageError> {
    validate_svg(spec, svg)?;
    validate_png(spec.width, spec.height, png)
}

pub(crate) fn validate_png(width: u32, height: u32, png: &[u8]) -> Result<(), StorageError> {
    if png.len() > 72 * 1024 * 1024 {
        return Err(invalid("PNG melebihi 72 MiB"));
    }
    let decoder = Decoder::new_with_limits(
        Cursor::new(png),
        Limits {
            bytes: 80 * 1024 * 1024,
        },
    );
    let mut reader = decoder.read_info().map_err(|_| invalid("PNG tidak sah"))?;
    if reader.info().width != width || reader.info().height != height {
        return Err(invalid("Dimensi PNG tidak sesuai dengan spesifikasi"));
    }
    let length = reader
        .output_buffer_size()
        .ok_or_else(|| invalid("PNG terlalu besar"))?;
    if length > 4096 * 4096 * 4 {
        return Err(invalid("Data PNG hasil dekode terlalu besar"));
    }
    let mut pixels = vec![0; length];
    reader
        .next_frame(&mut pixels)
        .map_err(|_| invalid("Data piksel PNG tidak sah"))?;
    reader.finish().map_err(|_| invalid("PNG tidak lengkap"))?;
    Ok(())
}

fn invalid(message: &str) -> StorageError {
    StorageError::InvalidInput(message.to_owned())
}

pub(crate) fn is_xml_char(character: char) -> bool {
    matches!(character, '\t' | '\n' | '\r' | '\u{20}'..='\u{d7ff}' | '\u{e000}'..='\u{fffd}' | '\u{10000}'..='\u{10ffff}')
}

fn validate_svg(spec: &GfxSpec, svg: &str) -> Result<(), StorageError> {
    if svg.len() > 128 * 1024 {
        return Err(invalid("SVG melebihi 128 KiB"));
    }
    if !svg.chars().all(is_xml_char) {
        return Err(invalid("SVG mengandung karakter XML yang tidak sah"));
    }
    let mut reader = Reader::from_str(svg);
    let mut depth = 0usize;
    let mut root_seen = false;
    let mut closed = false;
    loop {
        match reader
            .read_event()
            .map_err(|_| invalid("Struktur SVG tidak sah"))?
        {
            Event::Start(tag) | Event::Empty(tag) => {
                let empty = svg
                    .as_bytes()
                    .get(reader.buffer_position().saturating_sub(2) as usize)
                    == Some(&b'/');
                let name = tag.name();
                let name = name.as_ref();
                if !matches!(name, "svg" | "rect" | "g" | "circle" | "path" | "text") || closed {
                    return Err(invalid("SVG mengandung elemen yang tidak didukung"));
                }
                if depth == 0 && (root_seen || name != "svg" || empty) {
                    return Err(invalid(
                        "SVG harus memiliki satu elemen akar yang tidak kosong",
                    ));
                }
                if depth > 0 && name == "svg" {
                    return Err(invalid("SVG bersarang tidak didukung"));
                }
                let mut attributes = std::collections::BTreeMap::new();
                for attribute in tag.attributes() {
                    let attribute = attribute.map_err(|_| invalid("Atribut SVG tidak sah"))?;
                    let key = attribute.key.as_ref();
                    if !matches!(
                        key,
                        "xmlns"
                            | "width"
                            | "height"
                            | "viewBox"
                            | "role"
                            | "aria-label"
                            | "fill"
                            | "data-layout"
                            | "cx"
                            | "cy"
                            | "r"
                            | "opacity"
                            | "d"
                            | "stroke"
                            | "stroke-width"
                            | "stroke-linecap"
                            | "stroke-linejoin"
                            | "x"
                            | "y"
                            | "text-anchor"
                            | "font-family"
                            | "font-size"
                            | "font-weight"
                    ) {
                        return Err(invalid("SVG mengandung atribut yang tidak didukung"));
                    }
                    let value = attribute
                        .normalized_value(XmlVersion::Implicit1_0)
                        .map_err(|_| invalid("Nilai atribut SVG tidak sah"))?;
                    if !value.chars().all(is_xml_char) {
                        return Err(invalid(
                            "Atribut SVG mengandung karakter XML yang tidak sah",
                        ));
                    }
                    if matches!(key, "fill" | "stroke")
                        && value != "none"
                        && !(value.len() == 7
                            && value.starts_with('#')
                            && value[1..].bytes().all(|byte| byte.is_ascii_hexdigit()))
                    {
                        return Err(invalid("Warna SVG harus berupa kode warna, bukan URL"));
                    }
                    if key == "xmlns" && value != "http://www.w3.org/2000/svg" {
                        return Err(invalid("Namespace SVG tidak sah"));
                    }
                    attributes.insert(key.to_owned(), value.into_owned());
                }
                if depth == 0 {
                    for (key, expected) in [
                        ("xmlns", "http://www.w3.org/2000/svg".to_owned()),
                        ("width", spec.width.to_string()),
                        ("height", spec.height.to_string()),
                        ("viewBox", format!("0 0 {} {}", spec.width, spec.height)),
                        ("aria-label", spec.title.clone()),
                    ] {
                        if attributes.get(key) != Some(&expected) {
                            return Err(invalid("Elemen akar SVG tidak sesuai dengan spesifikasi"));
                        }
                    }
                    root_seen = true;
                }
                if !empty {
                    depth += 1;
                }
                if depth > 16 {
                    return Err(invalid("Kedalaman SVG melebihi batas"));
                }
            }
            Event::End(_) => {
                depth = depth
                    .checked_sub(1)
                    .ok_or_else(|| invalid("Tag penutup SVG tidak sesuai"))?;
                if depth == 0 {
                    closed = true;
                }
            }
            Event::Text(text) if depth == 0 && !text.trim().is_empty() => {
                return Err(invalid("Teks berada di luar SVG"))
            }
            Event::GeneralRef(reference) => {
                if depth == 0 {
                    return Err(invalid("Referensi entitas di luar SVG"));
                }
                match reference
                    .resolve_char_ref()
                    .map_err(|_| invalid("Referensi karakter SVG tidak sah"))?
                {
                    Some(character) if is_xml_char(character) => {}
                    None if matches!(reference.as_ref(), "amp" | "lt" | "gt" | "quot" | "apos") => {
                    }
                    _ => return Err(invalid("Entitas SVG tidak sah atau tidak didukung")),
                }
            }
            Event::Text(_) => {}
            Event::Eof => break,
            _ => return Err(invalid("Deklarasi SVG dan konten aktif tidak didukung")),
        }
    }
    if !root_seen || !closed || depth != 0 {
        return Err(invalid("SVG tidak lengkap"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec() -> GfxSpec {
        GfxSpec {
            schema_version: 1,
            title: "ForgeKit".into(),
            subtitle: "".into(),
            background: "#101216".into(),
            accent: "#94ACFF".into(),
            layout: "centered".into(),
            width: 128,
            height: 128,
        }
    }

    fn svg(content: &str) -> String {
        format!(
            r#"<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128" aria-label="ForgeKit">{content}</svg>"#
        )
    }

    #[test]
    fn xml_rejects_illegal_literal_text_and_attributes() {
        for character in ['\0', '\u{1}', '\u{b}', '\u{1f}', '\u{fffe}', '\u{ffff}'] {
            for content in [
                format!("<text>{character}</text>"),
                format!(r#"<text font-family="font{character}"/>"#),
            ] {
                assert!(
                    validate_svg(&spec(), &svg(&content)).is_err(),
                    "{content:?}"
                );
            }
        }
    }

    #[test]
    fn xml_rejects_illegal_numeric_references() {
        for reference in [
            "&#0;",
            "&#1;",
            "&#x1F;",
            "&#65534;",
            "&#xFFFF;",
            "&#xD800;",
            "&#x110000;",
        ] {
            for content in [
                format!(r#"<text font-family="{reference}"/>"#),
                format!("<text>{reference}</text>"),
            ] {
                assert!(validate_svg(&spec(), &svg(&content)).is_err(), "{content}");
            }
        }
    }

    #[test]
    fn xml_accepts_legal_unicode_and_escaped_entities() {
        for text in [
            "\t\r\n \u{7f}\u{85}\u{d7ff}\u{e000}\u{fffd}\u{10000}🚀\u{10ffff}",
            "&amp;&lt;&gt;&quot;&apos;&amp;#0;",
            "&#9;&#10;&#13;&#32;&#xD7FF;&#xE000;&#xFFFD;&#x10000;&#128640;&#x10FFFF;",
        ] {
            let content = format!(r#"<text font-family="{text}">{text}</text>"#);
            assert!(validate_svg(&spec(), &svg(&content)).is_ok(), "{content:?}");
        }
        let mut spec = spec();
        spec.title = "Judul & < > \" ' 🚀".into();
        let escaped = svg("<text>Judul &amp; &lt; &gt; &quot; &apos; 🚀</text>").replace(
            "aria-label=\"ForgeKit\"",
            "aria-label=\"Judul &amp; &lt; &gt; &quot; &apos; 🚀\"",
        );
        assert!(validate_svg(&spec, &escaped).is_ok());
    }

    #[test]
    fn xml_rejects_references_outside_root() {
        for reference in ["&amp;", "&#32;"] {
            assert!(validate_svg(&spec(), &format!("{reference}{}", svg(""))).is_err());
            assert!(validate_svg(&spec(), &format!("{}{reference}", svg(""))).is_err());
        }
    }
}
