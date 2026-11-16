//! Encontra onde o Valorant está instalado (o Riot Client registra os jogos
//! em `C:\ProgramData\Riot Games\RiotClientInstalls.json`).

/// Extrai a pasta do Valorant do `RiotClientInstalls.json`.
pub fn valorant_from_riot_installs(json: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(json).ok()?;
    let mut candidates: Vec<String> = Vec::new();
    if let Some(map) = v.get("associated_client").and_then(|m| m.as_object()) {
        candidates.extend(map.keys().cloned());
    }
    for key in ["rc_default", "rc_live", "patchlines"] {
        if let Some(s) = v.get(key).and_then(|x| x.as_str()) {
            candidates.push(s.to_string());
        }
    }
    let dir = candidates.into_iter().find(|p| p.to_lowercase().contains("valorant"))?;
    let dir = dir.replace('/', "\\");
    let dir = dir.trim_end_matches('\\');
    Some(format!(r"{dir}\VALORANT.exe"))
}

/// Caminho do `VALORANT.exe` nesta máquina, se encontrado.
pub fn find_valorant() -> Option<String> {
    let exists = |p: &str| std::path::Path::new(p).is_file();
    if let Ok(raw) = std::fs::read_to_string(r"C:\ProgramData\Riot Games\RiotClientInstalls.json") {
        if let Some(p) = valorant_from_riot_installs(&raw) {
            if exists(&p) {
                return Some(p);
            }
        }
    }
    for drive in ['C', 'D', 'E', 'F', 'G', 'H'] {
        for base in [r"Riot Games", r"Games\Riot Games", r"Jogos\Riot Games", r"Program Files\Riot Games"] {
            let p = format!(r"{drive}:\{base}\VALORANT\live\VALORANT.exe");
            if exists(&p) {
                return Some(p);
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_riot_installs() {
        let json = r#"{
            "associated_client": {
                "D:/Jogos/Riot Games/VALORANT/live/": "D:/Jogos/Riot Games/Riot Client/RiotClientServices.exe"
            },
            "rc_default": "D:/Jogos/Riot Games/Riot Client/RiotClientServices.exe"
        }"#;
        assert_eq!(
            valorant_from_riot_installs(json).as_deref(),
            Some(r"D:\Jogos\Riot Games\VALORANT\live\VALORANT.exe")
        );
        assert!(valorant_from_riot_installs("{}").is_none());
        assert!(valorant_from_riot_installs("lixo").is_none());
    }
}
