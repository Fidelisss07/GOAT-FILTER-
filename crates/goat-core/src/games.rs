//! Encontra jogos instalados: Valorant (Riot Client), jogos da Steam
//! (bibliotecas em `libraryfolders.vdf`) e da Epic (manifestos `.item`).
//! Só lê arquivos de configuração dos lançadores; nunca abre os jogos.

use serde::{Deserialize, Serialize};

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

/// Jogo competitivo conhecido e onde procurá-lo.
pub struct KnownGame {
    pub id: &'static str,
    pub name: &'static str,
    /// Pasta em `steamapps/common` e caminho do .exe dentro dela.
    pub steam: Option<(&'static str, &'static str)>,
    /// Nome exibido pela Epic.
    pub epic: Option<&'static str>,
    /// Caminhos comuns fora dos lançadores.
    pub paths: &'static [&'static str],
}

pub const KNOWN_GAMES: &[KnownGame] = &[
    KnownGame {
        id: "cs2",
        name: "Counter-Strike 2",
        steam: Some(("Counter-Strike Global Offensive", r"game\bin\win64\cs2.exe")),
        epic: None,
        paths: &[],
    },
    KnownGame {
        id: "apex",
        name: "Apex Legends",
        steam: Some(("Apex Legends", "r5apex.exe")),
        epic: Some("Apex Legends"),
        paths: &[r"C:\Program Files\EA Games\Apex\r5apex.exe"],
    },
    KnownGame {
        id: "fortnite",
        name: "Fortnite",
        steam: None,
        epic: Some("Fortnite"),
        paths: &[r"C:\Program Files\Epic Games\Fortnite\FortniteGame\Binaries\Win64\FortniteClient-Win64-Shipping.exe"],
    },
    KnownGame {
        id: "overwatch",
        name: "Overwatch 2",
        steam: Some(("Overwatch", "Overwatch.exe")),
        epic: None,
        paths: &[r"C:\Program Files (x86)\Overwatch\_retail_\Overwatch.exe"],
    },
    KnownGame {
        id: "r6",
        name: "Rainbow Six Siege",
        steam: Some(("Tom Clancy's Rainbow Six Siege", "RainbowSix.exe")),
        epic: None,
        paths: &[],
    },
    KnownGame {
        id: "pubg",
        name: "PUBG: Battlegrounds",
        steam: Some(("PUBG", r"TslGame\Binaries\Win64\TslGame.exe")),
        epic: None,
        paths: &[],
    },
    KnownGame {
        id: "rocketleague",
        name: "Rocket League",
        steam: Some(("rocketleague", r"Binaries\Win64\RocketLeague.exe")),
        epic: Some("Rocket League"),
        paths: &[],
    },
];

/// Jogo encontrado nesta máquina.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FoundGame {
    pub id: String,
    pub name: String,
    pub executable: String,
}

/// Caminhos das bibliotecas da Steam em `libraryfolders.vdf`.
pub fn parse_library_folders(vdf: &str) -> Vec<String> {
    vdf.lines()
        .filter_map(|l| {
            let l = l.trim();
            let rest = l.strip_prefix("\"path\"")?.trim();
            let v = rest.trim_matches('"');
            (!v.is_empty()).then(|| v.replace("\\\\", "\\").replace('/', "\\"))
        })
        .collect()
}

/// (nome exibido, caminho completo do .exe) de um manifesto `.item` da Epic.
pub fn parse_epic_manifest(json: &str) -> Option<(String, String)> {
    let v: serde_json::Value = serde_json::from_str(json).ok()?;
    let name = v.get("DisplayName")?.as_str()?.to_string();
    let dir = v.get("InstallLocation")?.as_str()?.replace('/', "\\");
    let exe = v.get("LaunchExecutable")?.as_str()?.replace('/', "\\");
    Some((name, format!("{}\\{}", dir.trim_end_matches('\\'), exe.trim_start_matches('\\'))))
}

/// Junta os candidatos e devolve só o que existe em disco (sem repetir jogo).
pub fn resolve_games(
    steam_libraries: &[String],
    epic: &[(String, String)],
    exists: impl Fn(&str) -> bool,
) -> Vec<FoundGame> {
    let mut found = Vec::new();
    for g in KNOWN_GAMES {
        let mut candidates: Vec<String> = Vec::new();
        if let Some((folder, rel)) = g.steam {
            for lib in steam_libraries {
                candidates.push(format!("{}\\steamapps\\common\\{}\\{}", lib.trim_end_matches('\\'), folder, rel));
            }
        }
        if let Some(name) = g.epic {
            for (n, exe) in epic {
                if n.eq_ignore_ascii_case(name) {
                    candidates.push(exe.clone());
                }
            }
        }
        candidates.extend(g.paths.iter().map(|p| p.to_string()));
        if let Some(exe) = candidates.into_iter().find(|p| exists(p)) {
            found.push(FoundGame { id: g.id.into(), name: g.name.into(), executable: exe });
        }
    }
    found
}

/// Procura os jogos conhecidos nesta máquina.
#[cfg(windows)]
pub fn find_installed_games() -> Vec<FoundGame> {
    let mut libs: Vec<String> = Vec::new();
    if let Some(steam) = steam_path() {
        libs.push(steam.clone());
        if let Ok(vdf) = std::fs::read_to_string(format!(r"{steam}\steamapps\libraryfolders.vdf")) {
            for l in parse_library_folders(&vdf) {
                if !libs.iter().any(|x| x.eq_ignore_ascii_case(&l)) {
                    libs.push(l);
                }
            }
        }
    }
    let mut epic = Vec::new();
    if let Ok(dir) = std::fs::read_dir(r"C:\ProgramData\Epic\EpicGamesLauncher\Data\Manifests") {
        for e in dir.flatten() {
            if e.path().extension().map(|x| x.eq_ignore_ascii_case("item")).unwrap_or(false) {
                if let Some(m) = std::fs::read_to_string(e.path()).ok().and_then(|s| parse_epic_manifest(&s)) {
                    epic.push(m);
                }
            }
        }
    }
    let mut found = resolve_games(&libs, &epic, |p| std::path::Path::new(p).is_file());
    if let Some(v) = find_valorant() {
        found.insert(0, FoundGame { id: "valorant".into(), name: "Valorant".into(), executable: v });
    }
    found
}

#[cfg(not(windows))]
pub fn find_installed_games() -> Vec<FoundGame> {
    Vec::new()
}

#[cfg(windows)]
fn steam_path() -> Option<String> {
    use windows::core::w;
    use windows::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_SZ};
    let mut buf = [0u16; 520];
    let mut len = (buf.len() * 2) as u32;
    let r = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            w!(r"Software\Valve\Steam"),
            w!("SteamPath"),
            RRF_RT_REG_SZ,
            None,
            Some(buf.as_mut_ptr() as _),
            Some(&mut len),
        )
    };
    if r.is_err() {
        return None;
    }
    let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    Some(String::from_utf16_lossy(&buf[..end]).replace('/', "\\"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_steam_libraries() {
        let vdf = r#"
"libraryfolders"
{
	"0"
	{
		"path"		"C:\\Program Files (x86)\\Steam"
		"label"		""
	}
	"1"
	{
		"path"		"D:\\SteamLibrary"
	}
}"#;
        assert_eq!(parse_library_folders(vdf), vec![r"C:\Program Files (x86)\Steam".to_string(), r"D:\SteamLibrary".to_string()]);
    }

    #[test]
    fn parses_epic_manifest() {
        let j = r#"{"DisplayName":"Fortnite","InstallLocation":"E:/Epic Games/Fortnite","LaunchExecutable":"FortniteGame/Binaries/Win64/FortniteClient-Win64-Shipping.exe"}"#;
        let (n, exe) = parse_epic_manifest(j).unwrap();
        assert_eq!(n, "Fortnite");
        assert_eq!(exe, r"E:\Epic Games\Fortnite\FortniteGame\Binaries\Win64\FortniteClient-Win64-Shipping.exe");
        assert!(parse_epic_manifest("{}").is_none());
    }

    #[test]
    fn resolves_only_existing_games() {
        let libs = vec![r"D:\SteamLibrary".to_string()];
        let epic = vec![("Fortnite".to_string(), r"E:\Fortnite\f.exe".to_string())];
        let on_disk = [
            r"D:\SteamLibrary\steamapps\common\Counter-Strike Global Offensive\game\bin\win64\cs2.exe",
            r"E:\Fortnite\f.exe",
        ];
        let found = resolve_games(&libs, &epic, |p| on_disk.contains(&p));
        let ids: Vec<&str> = found.iter().map(|g| g.id.as_str()).collect();
        assert_eq!(ids, vec!["cs2", "fortnite"]);
        assert_eq!(found[1].executable, r"E:\Fortnite\f.exe");
    }

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
