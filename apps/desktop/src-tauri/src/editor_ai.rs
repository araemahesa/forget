use crate::ai::{self, AiProviderProfile, StreamLease};
use serde_json::{json, Value};

fn extract_color<'a>(text: &str, default_color: &'a str) -> &'a str {
    let p = text.to_lowercase();
    if p.contains("merah") || p.contains("red") {
        "#ff2244"
    } else if p.contains("biru") || p.contains("blue") {
        "#2266ff"
    } else if p.contains("hijau") || p.contains("green") {
        "#22bb55"
    } else if p.contains("kuning") || p.contains("yellow") || p.contains("emas") || p.contains("gold") {
        "#ffd166"
    } else if p.contains("ungu") || p.contains("purple") {
        "#8833dd"
    } else if p.contains("oranye") || p.contains("orange") {
        "#ff7700"
    } else if p.contains("putih") || p.contains("white") {
        "#f4f6fa"
    } else if p.contains("hitam") || p.contains("black") || p.contains("gelap") || p.contains("dark") {
        "#101216"
    } else if p.contains("sian") || p.contains("cyan") || p.contains("neon") {
        "#00f0ff"
    } else {
        default_color
    }
}

fn valid_hex_color(val: &str) -> bool {
    val.len() == 7 && val.starts_with('#') && val[1..].chars().all(|c| c.is_ascii_hexdigit())
}

pub fn sanitize_color(val: Option<&Value>, fallback: &str) -> String {
    if let Some(s) = val.and_then(|v| v.as_str()) {
        if valid_hex_color(s) {
            return s.to_string();
        }
    }
    fallback.to_string()
}

pub fn local_editor_recipe(kind: &str, prompt: &str, _parent: Option<&Value>) -> Result<Value, String> {
    let p = prompt.trim();
    let lower = p.to_lowercase();
    match kind {
        "gfx" => {
            let bg = extract_color(&lower, "#101216");
            let accent = if bg == "#ff2244" { "#ffd166" } else { extract_color(&lower, "#ff0033") };
            let layout = if lower.contains("split") {
                "split"
            } else if lower.contains("tumpuk") || lower.contains("stack") {
                "stacked"
            } else {
                "centered"
            };
            let title = if p.len() > 60 { &p[..60] } else { p };
            Ok(json!({
                "schemaVersion": 1,
                "title": if title.is_empty() { "ForgeKit Studio" } else { title },
                "subtitle": "Karya visual Roblox",
                "background": bg,
                "accent": accent,
                "layout": layout,
                "width": 1200,
                "height": 800
            }))
        }
        "icon" => {
            let glyph = if lower.contains("pedang") || lower.contains("sword") {
                "sword"
            } else if lower.contains("tameng") || lower.contains("shield") {
                "shield"
            } else if lower.contains("panah") || lower.contains("bow") {
                "bow"
            } else if lower.contains("kapak") || lower.contains("axe") {
                "axe"
            } else if lower.contains("tengkorak") || lower.contains("skull") {
                "skull"
            } else if lower.contains("ramuan") || lower.contains("potion") {
                "potion"
            } else if lower.contains("koin") || lower.contains("coin") {
                "coin"
            } else if lower.contains("permata") || lower.contains("gem") {
                "gem"
            } else if lower.contains("peti") || lower.contains("chest") {
                "chest"
            } else if lower.contains("kunci") || lower.contains("key") {
                "key"
            } else if lower.contains("tas") || lower.contains("bag") {
                "bag"
            } else if lower.contains("hati") || lower.contains("heart") {
                "heart"
            } else if lower.contains("bintang") || lower.contains("star") {
                "star"
            } else if lower.contains("api") || lower.contains("flame") {
                "flame"
            } else if lower.contains("petir") || lower.contains("bolt") {
                "bolt"
            } else if lower.contains("mahkota") || lower.contains("crown") {
                "crown"
            } else {
                "sword"
            };
            let shape = if lower.contains("perisai") {
                "shield"
            } else if lower.contains("bulat") || lower.contains("circle") {
                "circle"
            } else if lower.contains("rounded") || lower.contains("kotak") {
                "rounded"
            } else if lower.contains("hexagon") {
                "hexagon"
            } else {
                "circle"
            };
            let style = if lower.contains("solid") {
                "solid"
            } else if lower.contains("outline") || lower.contains("garis") {
                "outline"
            } else {
                "duotone"
            };
            let primary = extract_color(&lower, "#ff405f");
            let secondary = if primary == "#ffd166" { "#ff405f" } else { "#ffd166" };
            Ok(json!({
                "schemaVersion": 1,
                "name": if p.is_empty() { "Ikon Baru" } else { p },
                "glyph": glyph,
                "shape": shape,
                "style": style,
                "background": "#171417",
                "primaryColor": primary,
                "secondaryColor": secondary,
                "strokeWidth": 2,
                "padding": 6,
                "size": 64
            }))
        }
        "clothing" => {
            let clothing_kind = if lower.contains("celana") || lower.contains("pants") {
                "pants"
            } else if lower.contains("t-shirt") || lower.contains("tshirt") || lower.contains("kaos") {
                "tshirt"
            } else {
                "shirt"
            };
            let pattern = if lower.contains("garis") || lower.contains("stripe") {
                "stripes"
            } else if lower.contains("denim") || lower.contains("jeans") {
                "denim"
            } else if lower.contains("camo") || lower.contains("loreng") {
                "camo"
            } else if lower.contains("hoodie") {
                "hoodie"
            } else if lower.contains("kotak") || lower.contains("plaid") {
                "plaid"
            } else {
                "solid"
            };
            let base = extract_color(&lower, "#1a1c23");
            let accent = extract_color(&lower, "#e02444");
            Ok(json!({
                "schemaVersion": 1,
                "name": if p.is_empty() { "Pakaian Baru" } else { p },
                "kind": clothing_kind,
                "baseColor": base,
                "accentColor": accent,
                "pattern": pattern,
                "neckStyle": if lower.contains("v-neck") { "v_neck" } else { "round" },
                "pocket": lower.contains("saku") || lower.contains("pocket"),
                "cuffColor": base,
                "shading": true,
                "templateGuide": false
            }))
        }
        "texture" => {
            let pattern = if lower.contains("bata") || lower.contains("brick") {
                "bricks"
            } else if lower.contains("kayu") || lower.contains("wood") {
                "wood"
            } else if lower.contains("besi") || lower.contains("metal") || lower.contains("grid") {
                "metal_grid"
            } else if lower.contains("hex") {
                "hex_tiles"
            } else if lower.contains("kain") || lower.contains("fabric") {
                "fabric"
            } else if lower.contains("batu") || lower.contains("stone") {
                "stone"
            } else {
                "noise"
            };
            let base = extract_color(&lower, "#4a5568");
            let accent = extract_color(&lower, "#2d3748");
            Ok(json!({
                "schemaVersion": 1,
                "name": if p.is_empty() { "Tekstur Baru" } else { p },
                "pattern": pattern,
                "baseColor": base,
                "accentColor": accent,
                "roughness": 0.6,
                "metalness": if pattern == "metal_grid" { 0.8 } else { 0.1 },
                "scale": 2.0,
                "seed": 42,
                "resolution": 512
            }))
        }
        "sfx" => {
            let category = if lower.contains("koin") || lower.contains("coin") {
                "coin"
            } else if lower.contains("ledakan") || lower.contains("explosion") {
                "explosion"
            } else if lower.contains("lompat") || lower.contains("jump") {
                "jump"
            } else if lower.contains("powerup") || lower.contains("bonus") {
                "powerup"
            } else if lower.contains("pukul") || lower.contains("hit") {
                "hit"
            } else if lower.contains("klik") || lower.contains("click") {
                "ui_click"
            } else if lower.contains("langkah") || lower.contains("step") {
                "footstep"
            } else {
                "laser"
            };
            let (waveform, dur, f_start, f_end, att, dec, sus, rel, cutoff, noise) = match category {
                "coin" => ("sine", 180, 987, 1318, 5, 30, 0.4, 80, 8000, 0.0),
                "explosion" => ("noise", 650, 220, 40, 10, 120, 0.3, 300, 1200, 0.85),
                "jump" => ("triangle", 200, 150, 600, 10, 50, 0.3, 100, 3000, 0.0),
                "powerup" => ("sawtooth", 450, 300, 1200, 10, 60, 0.5, 150, 6000, 0.0),
                "hit" => ("square", 140, 350, 80, 2, 30, 0.2, 60, 2500, 0.3),
                "ui_click" => ("sine", 40, 800, 400, 2, 15, 0.1, 20, 5000, 0.0),
                "footstep" => ("noise", 110, 180, 80, 5, 25, 0.1, 50, 1500, 0.7),
                _ => ("sawtooth", 240, 1200, 200, 5, 40, 0.2, 100, 4000, 0.0),
            };
            Ok(json!({
                "schemaVersion": 1,
                "name": if p.is_empty() { "Efek Suara Baru" } else { p },
                "category": category,
                "waveform": waveform,
                "durationMs": dur,
                "frequencyStart": f_start,
                "frequencyEnd": f_end,
                "attackMs": att,
                "decayMs": dec,
                "sustain": sus,
                "releaseMs": rel,
                "filterCutoff": cutoff,
                "noiseMix": noise,
                "volume": 0.8,
                "loop": false,
                "seed": 42
            }))
        }
        _ => Err("Jenis editor tidak didukung.".into()),
    }
}

pub fn validate_editor_recipe(kind: &str, recipe: &mut Value) -> Result<(), String> {
    if !recipe.is_object() {
        return Err("Spesifikasi harus berupa objek JSON.".into());
    }
    recipe["schemaVersion"] = json!(1);
    match kind {
        "gfx" => {
            let bg = sanitize_color(recipe.get("background"), "#101216");
            let accent = sanitize_color(recipe.get("accent"), "#ff0033");
            recipe["background"] = json!(bg);
            recipe["accent"] = json!(accent);
            let layout = recipe.get("layout").and_then(|v| v.as_str()).unwrap_or("centered");
            let layout = if matches!(layout, "centered" | "split" | "stacked") { layout } else { "centered" }.to_string();
            recipe["layout"] = json!(layout);
            let w = recipe.get("width").and_then(|v| v.as_u64()).unwrap_or(1200).clamp(400, 3840);
            let h = recipe.get("height").and_then(|v| v.as_u64()).unwrap_or(800).clamp(300, 2160);
            recipe["width"] = json!(w);
            recipe["height"] = json!(h);
            if recipe.get("title").and_then(|v| v.as_str()).is_none_or(|s| s.trim().is_empty()) {
                recipe["title"] = json!("ForgeKit GFX");
            }
            if recipe.get("subtitle").is_none() {
                recipe["subtitle"] = json!("");
            }
        }
        "icon" => {
            let glyph = recipe.get("glyph").and_then(|v| v.as_str()).unwrap_or("sword");
            let valid_glyphs = [
                "sword", "shield", "bow", "axe", "skull", "potion", "coin", "gem", "chest",
                "key", "bag", "heart", "star", "spark", "flame", "bolt", "compass", "crown",
            ];
            let glyph = if valid_glyphs.contains(&glyph) { glyph } else { "sword" }.to_string();
            recipe["glyph"] = json!(glyph);
            let shape = recipe.get("shape").and_then(|v| v.as_str()).unwrap_or("circle");
            let shape = if matches!(shape, "none" | "circle" | "rounded" | "squircle" | "hexagon" | "shield") { shape } else { "circle" }.to_string();
            recipe["shape"] = json!(shape);
            let style = recipe.get("style").and_then(|v| v.as_str()).unwrap_or("duotone");
            let style = if matches!(style, "outline" | "solid" | "duotone") { style } else { "duotone" }.to_string();
            recipe["style"] = json!(style);
            recipe["background"] = json!(sanitize_color(recipe.get("background"), "#171417"));
            recipe["primaryColor"] = json!(sanitize_color(recipe.get("primaryColor"), "#ff405f"));
            recipe["secondaryColor"] = json!(sanitize_color(recipe.get("secondaryColor"), "#ffd166"));
            recipe["strokeWidth"] = json!(recipe.get("strokeWidth").and_then(|v| v.as_u64()).unwrap_or(2).clamp(1, 6));
            recipe["padding"] = json!(recipe.get("padding").and_then(|v| v.as_u64()).unwrap_or(6).clamp(0, 20));
            recipe["size"] = json!(recipe.get("size").and_then(|v| v.as_u64()).unwrap_or(64).clamp(24, 1024));
            if recipe.get("name").and_then(|v| v.as_str()).is_none_or(|s| s.trim().is_empty()) {
                recipe["name"] = json!("Ikon Baru");
            }
        }
        "clothing" => {
            let ckind = recipe.get("kind").and_then(|v| v.as_str()).unwrap_or("shirt");
            let ckind = if matches!(ckind, "shirt" | "pants" | "tshirt") { ckind } else { "shirt" }.to_string();
            recipe["kind"] = json!(ckind);
            recipe["baseColor"] = json!(sanitize_color(recipe.get("baseColor"), "#1a1c23"));
            recipe["accentColor"] = json!(sanitize_color(recipe.get("accentColor"), "#e02444"));
            recipe["cuffColor"] = json!(sanitize_color(recipe.get("cuffColor"), "#1a1c23"));
            let pattern = recipe.get("pattern").and_then(|v| v.as_str()).unwrap_or("solid");
            let pattern = if matches!(pattern, "solid" | "stripes" | "denim" | "camo" | "hoodie" | "plaid") { pattern } else { "solid" }.to_string();
            recipe["pattern"] = json!(pattern);
            let neck = recipe.get("neckStyle").and_then(|v| v.as_str()).unwrap_or("round");
            let neck = if matches!(neck, "round" | "v_neck" | "collar" | "crew") { neck } else { "round" }.to_string();
            recipe["neckStyle"] = json!(neck);
            recipe["pocket"] = json!(recipe.get("pocket").and_then(|v| v.as_bool()).unwrap_or(false));
            recipe["shading"] = json!(recipe.get("shading").and_then(|v| v.as_bool()).unwrap_or(true));
            recipe["templateGuide"] = json!(recipe.get("templateGuide").and_then(|v| v.as_bool()).unwrap_or(false));
            if recipe.get("name").and_then(|v| v.as_str()).is_none_or(|s| s.trim().is_empty()) {
                recipe["name"] = json!("Pakaian Baru");
            }
        }
        "texture" => {
            let pat = recipe.get("pattern").and_then(|v| v.as_str()).unwrap_or("noise");
            let pat = if matches!(pat, "noise" | "bricks" | "wood" | "metal_grid" | "hex_tiles" | "fabric" | "stone") { pat } else { "noise" }.to_string();
            recipe["pattern"] = json!(pat);
            recipe["baseColor"] = json!(sanitize_color(recipe.get("baseColor"), "#4a5568"));
            recipe["accentColor"] = json!(sanitize_color(recipe.get("accentColor"), "#2d3748"));
            recipe["roughness"] = json!(recipe.get("roughness").and_then(|v| v.as_f64()).unwrap_or(0.6).clamp(0.0, 1.0));
            recipe["metalness"] = json!(recipe.get("metalness").and_then(|v| v.as_f64()).unwrap_or(0.1).clamp(0.0, 1.0));
            // Ranges mirror images.rs so an accepted AI spec can always be saved.
            recipe["scale"] = json!(recipe.get("scale").and_then(|v| v.as_f64()).unwrap_or(2.0).round().clamp(1.0, 16.0) as u64);
            recipe["seed"] = json!(recipe.get("seed").and_then(|v| v.as_i64()).unwrap_or(42).clamp(0, 999_999));
            let res = recipe.get("resolution").and_then(|v| v.as_u64()).unwrap_or(512);
            recipe["resolution"] = json!(if res <= 128 { 128 } else if res <= 256 { 256 } else { 512 });
            if recipe.get("name").and_then(|v| v.as_str()).is_none_or(|s| s.trim().is_empty()) {
                recipe["name"] = json!("Tekstur Baru");
            }
        }
        "sfx" => {
            let cat = recipe.get("category").and_then(|v| v.as_str()).unwrap_or("laser");
            let valid_cats = ["coin", "laser", "explosion", "jump", "powerup", "hit", "ui_click", "footstep"];
            let cat = if valid_cats.contains(&cat) { cat } else { "laser" }.to_string();
            recipe["category"] = json!(cat);
            let wave = recipe.get("waveform").and_then(|v| v.as_str()).unwrap_or("sawtooth");
            let wave = if matches!(wave, "sine" | "square" | "sawtooth" | "triangle" | "noise") { wave } else { "sawtooth" }.to_string();
            recipe["waveform"] = json!(wave);
            // Ranges mirror SfxRecipe::validate in sfx.rs so an accepted AI spec can always be saved.
            recipe["durationMs"] = json!(recipe.get("durationMs").and_then(|v| v.as_u64()).unwrap_or(240).clamp(50, 3000));
            recipe["frequencyStart"] = json!(recipe.get("frequencyStart").and_then(|v| v.as_f64()).unwrap_or(1200.0).clamp(20.0, 4000.0));
            recipe["frequencyEnd"] = json!(recipe.get("frequencyEnd").and_then(|v| v.as_f64()).unwrap_or(200.0).clamp(20.0, 4000.0));
            recipe["attackMs"] = json!(recipe.get("attackMs").and_then(|v| v.as_u64()).unwrap_or(5).clamp(0, 1000));
            recipe["decayMs"] = json!(recipe.get("decayMs").and_then(|v| v.as_u64()).unwrap_or(40).clamp(0, 2000));
            recipe["sustain"] = json!(recipe.get("sustain").and_then(|v| v.as_f64()).unwrap_or(0.2).clamp(0.0, 1.0));
            recipe["releaseMs"] = json!(recipe.get("releaseMs").and_then(|v| v.as_u64()).unwrap_or(100).clamp(10, 2000));
            recipe["filterCutoff"] = json!(recipe.get("filterCutoff").and_then(|v| v.as_f64()).unwrap_or(4000.0).clamp(100.0, 12000.0));
            recipe["noiseMix"] = json!(recipe.get("noiseMix").and_then(|v| v.as_f64()).unwrap_or(0.0).clamp(0.0, 1.0));
            recipe["volume"] = json!(recipe.get("volume").and_then(|v| v.as_f64()).unwrap_or(0.8).clamp(0.05, 1.0));
            recipe["loop"] = json!(recipe.get("loop").and_then(|v| v.as_bool()).unwrap_or(false));
            recipe["seed"] = json!(recipe.get("seed").and_then(|v| v.as_i64()).unwrap_or(42).clamp(0, 999_999));
            // SfxRecipe uses deny_unknown_fields; drop anything the model invented.
            const SFX_FIELDS: [&str; 16] = ["schemaVersion", "name", "category", "waveform", "durationMs", "frequencyStart", "frequencyEnd", "attackMs", "decayMs", "sustain", "releaseMs", "filterCutoff", "noiseMix", "volume", "loop", "seed"];
            if let Some(map) = recipe.as_object_mut() { map.retain(|key, _| SFX_FIELDS.contains(&key.as_str())); }
            if recipe.get("name").and_then(|v| v.as_str()).is_none_or(|s| s.trim().is_empty()) {
                recipe["name"] = json!("Efek Suara");
            }
        }
        _ => return Err("Jenis editor tidak didukung.".into()),
    }
    Ok(())
}

fn strip_markdown_fence(output: &str) -> &str {
    let s = output.trim();
    if let Some(rest) = s.strip_prefix("```json") {
        if let Some(inner) = rest.strip_suffix("```") {
            return inner.trim();
        }
    }
    if let Some(rest) = s.strip_prefix("```") {
        if let Some(inner) = rest.strip_suffix("```") {
            return inner.trim();
        }
    }
    s
}

pub fn compile_editor_recipe(
    kind: &str,
    prompt: &str,
    provider: Option<&AiProviderProfile>,
    lease: &StreamLease,
    max_seconds: u64,
    parent: Option<&Value>,
) -> Result<Value, String> {
    if let Some(profile) = provider {
        let system_prompt = format!(
            "Kamu penyusun spesifikasi desain Roblox profesional untuk fitur {kind}. \
             Aturan ketat: Balas HANYA dengan satu objek JSON mentah yang sah sesuai skema. \
             Jangan sertakan penjelasan, teks pembuka, teks penutup, atau markdown backticks.\n\
             Skema untuk {kind}:\n{}",
            match kind {
                "gfx" => "{\"schemaVersion\":1,\"title\":\"string max 60\",\"subtitle\":\"string max 80\",\"background\":\"#rrggbb\",\"accent\":\"#rrggbb\",\"layout\":\"centered\"|\"split\"|\"stacked\",\"width\":1200,\"height\":800}",
                "icon" => "{\"schemaVersion\":1,\"name\":\"string\",\"glyph\":\"sword\"|\"shield\"|\"bow\"|\"axe\"|\"skull\"|\"potion\"|\"coin\"|\"gem\"|\"chest\"|\"key\"|\"bag\"|\"heart\"|\"star\"|\"spark\"|\"flame\"|\"bolt\"|\"compass\"|\"crown\",\"shape\":\"none\"|\"circle\"|\"rounded\"|\"squircle\"|\"hexagon\"|\"shield\",\"style\":\"outline\"|\"solid\"|\"duotone\",\"background\":\"#rrggbb\",\"primaryColor\":\"#rrggbb\",\"secondaryColor\":\"#rrggbb\",\"strokeWidth\":2,\"padding\":6,\"size\":64}",
                "clothing" => "{\"schemaVersion\":1,\"name\":\"string\",\"kind\":\"shirt\"|\"pants\"|\"tshirt\",\"baseColor\":\"#rrggbb\",\"accentColor\":\"#rrggbb\",\"pattern\":\"solid\"|\"stripes\"|\"denim\"|\"camo\"|\"hoodie\"|\"plaid\",\"neckStyle\":\"round\"|\"v_neck\"|\"collar\"|\"crew\",\"pocket\":false,\"cuffColor\":\"#rrggbb\",\"shading\":true,\"templateGuide\":false}",
                "texture" => "{\"schemaVersion\":1,\"name\":\"string\",\"pattern\":\"noise\"|\"bricks\"|\"wood\"|\"metal_grid\"|\"hex_tiles\"|\"fabric\"|\"stone\",\"baseColor\":\"#rrggbb\",\"accentColor\":\"#rrggbb\",\"roughness\":0.6,\"metalness\":0.1,\"scale\":2.0,\"seed\":42,\"resolution\":512}",
                "sfx" => "{\"schemaVersion\":1,\"name\":\"string\",\"category\":\"coin\"|\"laser\"|\"explosion\"|\"jump\"|\"powerup\"|\"hit\"|\"ui_click\"|\"footstep\",\"waveform\":\"sine\"|\"square\"|\"sawtooth\"|\"triangle\"|\"noise\",\"durationMs\":240,\"frequencyStart\":1200,\"frequencyEnd\":200,\"attackMs\":5,\"decayMs\":40,\"sustain\":0.2,\"releaseMs\":100,\"filterCutoff\":4000,\"noiseMix\":0.0,\"volume\":0.8,\"loop\":false,\"seed\":42}",
                _ => "{}"
            }
        );
        let system_prompt = format!("{}\n{}", crate::agent::instructions_with_vault(prompt,kind,None,None)?,system_prompt);
        let user_content = json!({
            "prompt": prompt,
            "currentSpec": parent,
        }).to_string();
        let messages = [
            json!({"role": "system", "content": system_prompt}),
            json!({"role": "user", "content": user_content}),
        ];
        let raw_output = ai::execute_agent_limited(
            profile,
            lease,
            &messages,
            &[],
            max_seconds.min(60),
            4096,
            |_| Ok(()),
            |_| Err("Tool tidak tersedia.".into()),
        )?;
        let clean = strip_markdown_fence(&raw_output);
        let mut parsed: Value = serde_json::from_str(clean).map_err(|_| {
            "Output provider bukan format JSON spesifikasi yang sah.".to_string()
        })?;
        validate_editor_recipe(kind, &mut parsed)?;
        Ok(parsed)
    } else {
        let mut local = local_editor_recipe(kind, prompt, parent)?;
        validate_editor_recipe(kind, &mut local)?;
        Ok(local)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_editor_recipe_generates_valid_specs_for_all_five_kinds() {
        for kind in ["gfx", "icon", "clothing", "texture", "sfx"] {
            let mut recipe = local_editor_recipe(kind, "tema merah laser cyberpunk", None).expect("local recipe");
            assert_eq!(recipe["schemaVersion"], 1);
            validate_editor_recipe(kind, &mut recipe).expect("validate recipe");
        }
    }

    #[test]
    fn extracts_colors_and_clamps_ranges() {
        let mut gfx = json!({
            "schemaVersion": 1,
            "title": "Uji Gfx",
            "background": "#nothex",
            "accent": "#00ff00",
            "layout": "invalid_layout",
            "width": 99999,
            "height": 10
        });
        validate_editor_recipe("gfx", &mut gfx).unwrap();
        assert_eq!(gfx["background"], "#101216");
        assert_eq!(gfx["accent"], "#00ff00");
        assert_eq!(gfx["layout"], "centered");
        assert_eq!(gfx["width"], 3840);
        assert_eq!(gfx["height"], 300);
    }

    #[test]
    fn extreme_ai_specs_stay_within_save_validators() {
        let mut sfx = json!({
            "name": "Uji", "durationMs": 9000, "frequencyStart": 9000, "frequencyEnd": 5,
            "releaseMs": 0, "filterCutoff": 19000, "seed": 5_000_000, "reverb": 0.4
        });
        validate_editor_recipe("sfx", &mut sfx).unwrap();
        let recipe: crate::sfx::SfxRecipe = serde_json::from_value(sfx.clone()).expect("no unknown fields");
        assert_eq!(recipe.duration_ms, 3000.0);
        assert_eq!(recipe.frequency_start, 4000.0);
        assert_eq!(recipe.release_ms, 10.0);
        assert_eq!(recipe.filter_cutoff, 12000.0);
        assert_eq!(recipe.seed, 999_999);

        let mut icon = json!({"strokeWidth": 8, "padding": 24, "size": 4096});
        validate_editor_recipe("icon", &mut icon).unwrap();
        assert_eq!((icon["strokeWidth"].as_u64(), icon["padding"].as_u64(), icon["size"].as_u64()), (Some(6), Some(20), Some(1024)));

        let mut texture = json!({"scale": 0.2, "seed": -3});
        validate_editor_recipe("texture", &mut texture).unwrap();
        assert_eq!((texture["scale"].as_u64(), texture["seed"].as_i64()), (Some(1), Some(0)));
    }
}

pub fn messages(kind: &str, prompt: &str, parent: Option<&Value>) -> Result<Vec<Value>, String> {
    if !matches!(kind, "gfx" | "icon" | "clothing" | "texture" | "sfx") {
        return Err("[VALIDATION] Jenis editor tidak didukung.".into());
    }
    let system_prompt = format!(
            "Kamu penyusun spesifikasi desain Roblox profesional untuk fitur {kind}. \
             Aturan ketat: Balas HANYA dengan satu objek JSON mentah yang sah sesuai skema. \
             Jangan sertakan penjelasan, teks pembuka, teks penutup, atau markdown backticks.\n\
             Skema untuk {kind}:\n{}",
            match kind {
                "gfx" => "{\"schemaVersion\":1,\"title\":\"string max 60\",\"subtitle\":\"string max 80\",\"background\":\"#rrggbb\",\"accent\":\"#rrggbb\",\"layout\":\"centered\"|\"split\"|\"stacked\",\"width\":1200,\"height\":800}",
                "icon" => "{\"schemaVersion\":1,\"name\":\"string\",\"glyph\":\"sword\"|\"shield\"|\"bow\"|\"axe\"|\"skull\"|\"potion\"|\"coin\"|\"gem\"|\"chest\"|\"key\"|\"bag\"|\"heart\"|\"star\"|\"spark\"|\"flame\"|\"bolt\"|\"compass\"|\"crown\",\"shape\":\"none\"|\"circle\"|\"rounded\"|\"squircle\"|\"hexagon\"|\"shield\",\"style\":\"outline\"|\"solid\"|\"duotone\",\"background\":\"#rrggbb\",\"primaryColor\":\"#rrggbb\",\"secondaryColor\":\"#rrggbb\",\"strokeWidth\":2,\"padding\":6,\"size\":64}",
                "clothing" => "{\"schemaVersion\":1,\"name\":\"string\",\"kind\":\"shirt\"|\"pants\"|\"tshirt\",\"baseColor\":\"#rrggbb\",\"accentColor\":\"#rrggbb\",\"pattern\":\"solid\"|\"stripes\"|\"denim\"|\"camo\"|\"hoodie\"|\"plaid\",\"neckStyle\":\"round\"|\"v_neck\"|\"collar\"|\"crew\",\"pocket\":false,\"cuffColor\":\"#rrggbb\",\"shading\":true,\"templateGuide\":false}",
                "texture" => "{\"schemaVersion\":1,\"name\":\"string\",\"pattern\":\"noise\"|\"bricks\"|\"wood\"|\"metal_grid\"|\"hex_tiles\"|\"fabric\"|\"stone\",\"baseColor\":\"#rrggbb\",\"accentColor\":\"#rrggbb\",\"roughness\":0.6,\"metalness\":0.1,\"scale\":2.0,\"seed\":42,\"resolution\":512}",
                "sfx" => "{\"schemaVersion\":1,\"name\":\"string\",\"category\":\"coin\"|\"laser\"|\"explosion\"|\"jump\"|\"powerup\"|\"hit\"|\"ui_click\"|\"footstep\",\"waveform\":\"sine\"|\"square\"|\"sawtooth\"|\"triangle\"|\"noise\",\"durationMs\":240,\"frequencyStart\":1200,\"frequencyEnd\":200,\"attackMs\":5,\"decayMs\":40,\"sustain\":0.2,\"releaseMs\":100,\"filterCutoff\":4000,\"noiseMix\":0.0,\"volume\":0.8,\"loop\":false,\"seed\":42}",
                _ => "{}"
            }
        );
    let system_prompt = format!("{}\n{}\nJika permintaan tidak dapat diwakili schema, jelaskan keterbatasan; jangan menggantinya dengan preset. Semua field wajib, tidak ada field tambahan. Nama max 60 karakter. Ikuti batas validator. Batas texture scale integer 1..16, resolution 128/256/512. SFX duration 50..3000ms, frequency 20..4000Hz, release 10..2000ms. Icon strokeWidth 1..6, padding 0..20, size 24..1024.", crate::agent::instructions_with_vault(prompt,kind,None,None)?, system_prompt);
    let user_content = json!({
        "prompt": prompt,
        "currentSpec": parent,
    })
    .to_string();
    let messages = vec![
        json!({"role": "system", "content": system_prompt}),
        json!({"role": "user", "content": user_content}),
    ];
    Ok(messages)
}

pub fn parse(kind: &str, output: &str) -> Result<Value, String> {
    let mut parsed: Value = serde_json::from_str(strip_markdown_fence(output))
        .map_err(|e| format!("[VALIDATION] /: JSON tidak sah: {e}"))?;
    validate_editor_recipe(kind, &mut parsed)?;
    Ok(parsed)
}
