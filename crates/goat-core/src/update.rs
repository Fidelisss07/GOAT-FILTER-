//! Comparação de versões para o aviso de atualização (Releases do GitHub).

use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub current: String,
    pub latest: Option<String>,
    pub available: bool,
    pub url: Option<String>,
    pub notes: Option<String>,
}

/// "v1.2.3" / "1.2.3-beta" → (1, 2, 3). Partes ausentes viram 0.
pub fn parse(v: &str) -> Option<(u64, u64, u64)> {
    let v = v.trim().trim_start_matches(['v', 'V']);
    let core = v.split(['-', '+']).next()?;
    let mut it = core.split('.').map(|p| p.parse::<u64>());
    let a = it.next()?.ok()?;
    let b = it.next().unwrap_or(Ok(0)).ok()?;
    let c = it.next().unwrap_or(Ok(0)).ok()?;
    Some((a, b, c))
}

pub fn is_newer(latest: &str, current: &str) -> bool {
    match (parse(latest), parse(current)) {
        (Some(l), Some(c)) => l > c,
        _ => false,
    }
}

/// Monta o resultado a partir do JSON de `releases/latest`.
pub fn from_release_json(current: &str, json: &serde_json::Value) -> UpdateInfo {
    let tag = json.get("tag_name").and_then(|t| t.as_str()).map(str::to_string);
    let url = json.get("html_url").and_then(|t| t.as_str()).map(str::to_string);
    let notes = json.get("body").and_then(|t| t.as_str()).map(|s| s.chars().take(600).collect());
    let available = tag.as_deref().map(|t| is_newer(t, current)).unwrap_or(false);
    UpdateInfo { current: current.into(), latest: tag, available, url, notes }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compares_versions() {
        assert!(is_newer("v1.0.1", "1.0.0"));
        assert!(is_newer("v1.10.0", "1.9.9"));
        assert!(!is_newer("v1.0.0", "1.0.0"));
        assert!(!is_newer("v0.9.0", "1.0.0"));
        assert!(!is_newer("lixo", "1.0.0"));
        assert_eq!(parse("v2.1.0-beta.1"), Some((2, 1, 0)));
        assert_eq!(parse("3"), Some((3, 0, 0)));
    }

    #[test]
    fn reads_release_json() {
        let j = serde_json::json!({"tag_name": "v1.2.0", "html_url": "https://github.com/x/y/releases/tag/v1.2.0", "body": "novidades"});
        let u = from_release_json("1.0.0", &j);
        assert!(u.available);
        assert_eq!(u.latest.as_deref(), Some("v1.2.0"));
        let u = from_release_json("1.2.0", &j);
        assert!(!u.available);
    }
}
