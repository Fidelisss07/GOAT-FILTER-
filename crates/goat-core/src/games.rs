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

/// Código de mira do Valorant: começa com "0;" e só tem letras, números, ";", "." e "-".
pub fn is_crosshair_code(code: &str) -> bool {
    let c = code.trim();
    c.len() <= 400 && c.starts_with("0;") && c.chars().all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, ';' | '.' | '-'))
}

/// Riot Client, para abrir o Valorant pelo caminho oficial.
pub fn riot_client_from_installs(json: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(json).ok()?;
    let p = v.get("rc_default").or_else(|| v.get("rc_live"))?.as_str()?;
    Some(p.replace('/', "\\"))
}

/// Abre o jogo de um perfil. Valorant vai pelo Riot Client.
pub fn launch_game(executable: &str) -> Result<(), String> {
    let file = executable.rsplit(['\\', '/']).next().unwrap_or("").to_lowercase();
    if file == "valorant.exe" || file == "valorant-win64-shipping.exe" {
        let rc = std::fs::read_to_string(r"C:\ProgramData\Riot Games\RiotClientInstalls.json")
            .ok()
            .and_then(|s| riot_client_from_installs(&s))
            .filter(|p| std::path::Path::new(p).is_file())
            .ok_or("Riot Client não encontrado")?;
        std::process::Command::new(rc)
            .args(["--launch-product=valorant", "--launch-patchline=live"])
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    } else {
        if !std::path::Path::new(executable).is_file() {
            return Err("executável do perfil não encontrado".into());
        }
        let dir = std::path::Path::new(executable).parent().map(|d| d.to_path_buf());
        let mut cmd = std::process::Command::new(executable);
        if let Some(d) = dir {
            cmd.current_dir(d);
        }
        cmd.spawn().map(|_| ()).map_err(|e| e.to_string())
    }
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
    /// Onde foi encontrado: Steam, Epic, Riot, EA, Ubisoft, GOG, Battle.net, Rockstar, Xbox ou Pasta.
    #[serde(default)]
    pub source: String,
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
            found.push(FoundGame { id: g.id.into(), name: g.name.into(), executable: exe, source: String::new() });
        }
    }
    found
}

/// Dados de um `appmanifest_*.acf` da Steam: (appid, nome, pasta em common).
pub fn parse_acf(text: &str) -> Option<(String, String, String)> {
    let mut appid = None;
    let mut name = None;
    let mut dir = None;
    for l in text.lines() {
        let parts: Vec<&str> = l.split('"').collect();
        // linha `"chave"\t\t"valor"` → ["", chave, tabs, valor, ""]
        if parts.len() < 5 {
            continue;
        }
        let (k, v) = (parts[1].to_ascii_lowercase(), parts[3].to_string());
        match k.as_str() {
            "appid" if appid.is_none() => appid = Some(v),
            "name" if name.is_none() => name = Some(v),
            "installdir" if dir.is_none() => dir = Some(v),
            _ => {}
        }
    }
    Some((appid?, name?, dir?))
}

/// Ferramentas que os lançadores instalam e não são jogos.
pub fn is_not_a_game(name: &str) -> bool {
    let n = name.to_lowercase();
    [
        "redistributable", "steamworks", "proton", "steam linux runtime", "steamvr", "dedicated server",
        " sdk", "soundtrack", "wallpaper engine", "benchmark", "unreal engine", "launcher", "ea app",
        "battle.net", "riot client", "social club", "ubisoft connect", "directx", "vc++", "editor",
    ]
    .iter()
    .any(|k| n.contains(k))
        || n.ends_with("sdk")
}

fn squash(s: &str) -> String {
    s.chars().filter(|c| c.is_ascii_alphanumeric()).collect::<String>().to_lowercase()
}

/// Pastas que nunca têm o executável do jogo.
fn skip_dir(name: &str) -> bool {
    let n = name.to_lowercase();
    [
        "redist", "_commonredist", "commonredist", "directx", "vcredist", "dotnet", "support", "installer",
        "__installer", "easyanticheat", "battleye", "thirdparty", "crashreport", "prereq", "tools", "_cleanup",
        "launcher", "webhelper", "cef", "dxsetup", "physx", "uninstall", "mods", "logs", "screenshots",
    ]
    .iter()
    .any(|k| n == *k || n.starts_with(k))
}

/// Nomes de .exe que não são o jogo.
fn bad_exe(stem: &str) -> bool {
    let n = stem.to_lowercase();
    [
        "unins", "setup", "install", "crash", "report", "redist", "dxsetup", "helper", "updater", "update",
        "easyanticheat", "battleye", "beservice", "cefprocess", "webhelper", "benchmark", "config",
        "settings", "server", "editor", "touchup", "cleanup", "dotnet", "python", "node", "7z", "prereq",
        "uploader", "overlay", "sandbox", "dump", "diagnostic", "repair", "register", "activation", "vc_redist",
        "unitycrashhandler", "notification", "elevate", "service", "browser", "converter", "patch",
    ]
    .iter()
    .any(|k| n.contains(k))
}

/// Escolhe o executável principal do jogo entre os .exe da pasta.
/// `exes` traz (caminho relativo com `\`, tamanho em bytes).
pub fn pick_main_exe(game_name: &str, dir_name: &str, exes: &[(String, u64)]) -> Option<String> {
    let gn = squash(game_name);
    let dn = squash(dir_name);
    let score = |rel: &str, size: u64| -> i64 {
        let file = rel.rsplit('\\').next().unwrap_or(rel);
        let stem = file.strip_suffix(".exe").or_else(|| file.strip_suffix(".EXE")).unwrap_or(file);
        let lower = rel.to_lowercase();
        let mut core = stem.to_lowercase();
        for suf in ["-win64-shipping", "-wingdk-shipping", "-shipping", "-win64", "_x64", "64"] {
            if let Some(c) = core.strip_suffix(suf) {
                core = c.to_string();
            }
        }
        let s = squash(&core);
        let mut v: i64 = 0;
        if !s.is_empty() && ((!gn.is_empty() && (gn.contains(&s) || s.contains(&gn))) || (!dn.is_empty() && (dn.contains(&s) || s.contains(&dn)))) {
            v += 60;
        }
        if lower.contains("shipping") {
            v += 35;
        }
        if lower.contains("win64") || lower.contains("x64") {
            v += 10;
        }
        // Executáveis minúsculos costumam ser só um atalho para o de verdade.
        if size < 1_000_000 {
            v -= 20;
        }
        if lower.contains("launcher") {
            v -= 30;
        }
        if lower.contains("32") && !lower.contains("win64") {
            v -= 5;
        }
        v -= 4 * rel.matches('\\').count() as i64;
        // Tamanho: 1 ponto por dobra a partir de 256 KB (jogos são grandes).
        v += (64 - (size.max(1)).leading_zeros() as i64 - 18).max(0) * 2;
        v
    };
    exes.iter()
        .filter(|(rel, _)| {
            let file = rel.rsplit('\\').next().unwrap_or(rel);
            !bad_exe(file.trim_end_matches(".exe"))
        })
        .max_by_key(|(rel, size)| score(rel, *size))
        .map(|(rel, _)| rel.clone())
}

/// Lista os .exe de uma pasta (até 4 níveis, com limite de itens).
pub fn list_exes(dir: &std::path::Path) -> Vec<(String, u64)> {
    let mut out = Vec::new();
    let mut stack: Vec<(std::path::PathBuf, String, usize)> = vec![(dir.to_path_buf(), String::new(), 0)];
    let mut seen = 0usize;
    while let Some((path, rel, depth)) = stack.pop() {
        let Ok(rd) = std::fs::read_dir(&path) else { continue };
        for e in rd.flatten() {
            seen += 1;
            if seen > 6000 {
                return out;
            }
            let name = e.file_name().to_string_lossy().to_string();
            let r = if rel.is_empty() { name.clone() } else { format!("{rel}\\{name}") };
            let Ok(ft) = e.file_type() else { continue };
            if ft.is_dir() {
                if depth < 4 && !skip_dir(&name) {
                    stack.push((e.path(), r, depth + 1));
                }
            } else if name.to_lowercase().ends_with(".exe") {
                let size = e.metadata().map(|m| m.len()).unwrap_or(0);
                out.push((r, size));
            }
        }
    }
    out
}

/// Caminho do executável principal dentro da pasta de um jogo.
pub fn main_exe_in(dir: &std::path::Path, game_name: &str) -> Option<String> {
    let dir_name = dir.file_name().map(|d| d.to_string_lossy().to_string()).unwrap_or_default();
    let exes = list_exes(dir);
    let rel = pick_main_exe(game_name, &dir_name, &exes)?;
    let mut p = dir.to_path_buf();
    for part in rel.split('\\') {
        p.push(part);
    }
    Some(p.to_string_lossy().to_string())
}

/// Junta os jogos achados, sem repetir executável nem nome.
pub fn merge_found(lists: Vec<Vec<FoundGame>>) -> Vec<FoundGame> {
    let mut out: Vec<FoundGame> = Vec::new();
    for g in lists.into_iter().flatten() {
        if g.executable.is_empty() || is_not_a_game(&g.name) {
            continue;
        }
        let exe = g.executable.to_lowercase();
        if out.iter().any(|o| o.executable.to_lowercase() == exe || o.id == g.id) {
            continue;
        }
        out.push(g);
    }
    out
}

fn slug(s: &str) -> String {
    let mut out = String::new();
    for c in s.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
        } else if !out.ends_with('-') && !out.is_empty() {
            out.push('-');
        }
    }
    out.trim_end_matches('-').to_string()
}

/// Jogos da Steam a partir dos manifestos das bibliotecas.
pub fn steam_games(libraries: &[String]) -> Vec<FoundGame> {
    let mut out = Vec::new();
    for lib in libraries {
        let apps = std::path::Path::new(lib).join("steamapps");
        let Ok(rd) = std::fs::read_dir(&apps) else { continue };
        for e in rd.flatten() {
            let n = e.file_name().to_string_lossy().to_lowercase();
            if !(n.starts_with("appmanifest_") && n.ends_with(".acf")) {
                continue;
            }
            let Some((appid, name, dir)) = std::fs::read_to_string(e.path()).ok().and_then(|t| parse_acf(&t)) else { continue };
            if is_not_a_game(&name) || appid == "228980" {
                continue;
            }
            let gdir = apps.join("common").join(&dir);
            // Jogo conhecido: executável certo.
            let known = KNOWN_GAMES.iter().find(|k| k.steam.map(|(f, _)| f.eq_ignore_ascii_case(&dir)).unwrap_or(false));
            if let Some(k) = known {
                let (_, rel) = k.steam.unwrap();
                let mut p = gdir.clone();
                for part in rel.split('\\') {
                    p.push(part);
                }
                if p.is_file() {
                    out.push(FoundGame { id: k.id.into(), name: k.name.into(), executable: p.to_string_lossy().into(), source: "Steam".into() });
                    continue;
                }
            }
            if let Some(exe) = main_exe_in(&gdir, &name) {
                out.push(FoundGame { id: format!("steam-{appid}"), name, executable: exe, source: "Steam".into() });
            }
        }
    }
    out
}

/// Jogos da Epic (todos os manifestos que forem jogos).
pub fn epic_games(manifest_dir: &std::path::Path) -> Vec<FoundGame> {
    let mut out = Vec::new();
    let Ok(rd) = std::fs::read_dir(manifest_dir) else { return out };
    for e in rd.flatten() {
        if !e.path().extension().map(|x| x.eq_ignore_ascii_case("item")).unwrap_or(false) {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(e.path()) else { continue };
        let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) else { continue };
        if let Some(cats) = v.get("AppCategories").and_then(|c| c.as_array()) {
            if !cats.iter().any(|c| c.as_str() == Some("games")) {
                continue;
            }
        }
        let Some((name, exe)) = parse_epic_manifest(&text) else { continue };
        let known = KNOWN_GAMES.iter().find(|k| k.epic.map(|n| n.eq_ignore_ascii_case(&name)).unwrap_or(false));
        let id = known.map(|k| k.id.to_string()).unwrap_or_else(|| {
            format!("epic-{}", slug(v.get("AppName").and_then(|a| a.as_str()).unwrap_or(&name)))
        });
        if std::path::Path::new(&exe).is_file() {
            out.push(FoundGame { id, name, executable: exe, source: "Epic".into() });
        }
    }
    out
}

/// Jogos em pastas soltas (cada subpasta é um jogo), como `XboxGames` ou `Jogos`.
/// `marker`: só aceita subpastas que tenham este arquivo (ex.: `.build.info` do Battle.net).
pub fn folder_games(root: &std::path::Path, source: &str, marker: Option<&str>, sub: Option<&str>) -> Vec<FoundGame> {
    let mut out = Vec::new();
    let Ok(rd) = std::fs::read_dir(root) else { return out };
    for e in rd.flatten() {
        if !e.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let dir = e.path();
        if let Some(m) = marker {
            if !dir.join(m).is_file() {
                continue;
            }
        }
        let name = e.file_name().to_string_lossy().to_string();
        let low = name.to_lowercase();
        let launcher_dir = [
            "steam", "steamlibrary", "epic games", "riot games", "xboxgames", "gog galaxy", "origin", "ubisoft",
            "battle.net", "ea desktop", "rockstar games", "windowsapps",
        ]
        .contains(&low.as_str());
        if launcher_dir || is_not_a_game(&name) || skip_dir(&name) {
            continue;
        }
        let search = sub.map(|s| dir.join(s)).filter(|p| p.is_dir()).unwrap_or_else(|| dir.clone());
        if let Some(exe) = main_exe_in(&search, &name) {
            out.push(FoundGame { id: format!("{}-{}", slug(source), slug(&name)), name, executable: exe, source: source.into() });
        }
    }
    out
}

/// Procura todos os jogos desta máquina: Steam, Epic, Riot, EA, Ubisoft, GOG,
/// Battle.net, Rockstar, Xbox e pastas de jogos comuns. Só lê arquivos e o
/// registro; nunca abre nenhum jogo.
#[cfg(windows)]
pub fn find_installed_games() -> Vec<FoundGame> {
    use std::path::Path;
    let mut lists: Vec<Vec<FoundGame>> = Vec::new();

    // Riot: Valorant e League of Legends.
    let mut riot = Vec::new();
    if let Some(v) = find_valorant() {
        riot.push(FoundGame { id: "valorant".into(), name: "Valorant".into(), executable: v, source: "Riot".into() });
    }
    if let Ok(raw) = std::fs::read_to_string(r"C:\ProgramData\Riot Games\RiotClientInstalls.json") {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) {
            if let Some(map) = v.get("associated_client").and_then(|m| m.as_object()) {
                for dir in map.keys() {
                    let d = dir.replace('/', "\\");
                    let d = d.trim_end_matches('\\');
                    if d.to_lowercase().contains("league of legends") {
                        let exe = format!(r"{d}\Game\League of Legends.exe");
                        if Path::new(&exe).is_file() {
                            riot.push(FoundGame { id: "lol".into(), name: "League of Legends".into(), executable: exe, source: "Riot".into() });
                        }
                    }
                }
            }
        }
    }
    lists.push(riot);

    // Steam: todas as bibliotecas.
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
    lists.push(steam_games(&libs));

    // Epic.
    lists.push(epic_games(Path::new(r"C:\ProgramData\Epic\EpicGamesLauncher\Data\Manifests")));

    // Registro: GOG, Ubisoft, EA, Rockstar.
    lists.push(reg::gog());
    lists.push(reg::by_install_dir(r"SOFTWARE\WOW6432Node\Ubisoft\Launcher\Installs", "InstallDir", "Ubisoft"));
    for base in [r"SOFTWARE\WOW6432Node\Electronic Arts", r"SOFTWARE\WOW6432Node\EA Games", r"SOFTWARE\Electronic Arts"] {
        lists.push(reg::by_install_dir(base, "Install Dir", "EA"));
    }
    lists.push(reg::by_install_dir(r"SOFTWARE\WOW6432Node\Rockstar Games", "InstallFolder", "Rockstar"));

    // Jogos conhecidos em caminhos fixos (Overwatch, Apex, Fortnite…).
    lists.push(resolve_games(&[], &[], |p| Path::new(p).is_file()));

    // Pastas: Battle.net (com `.build.info`), Xbox e pastas de jogos.
    let drives: Vec<String> = ('C'..='Z').map(|d| format!("{d}:\\")).filter(|d| Path::new(d).is_dir()).collect();
    for pf in [r"C:\Program Files (x86)", r"C:\Program Files"] {
        lists.push(folder_games(Path::new(pf), "Battle.net", Some(".build.info"), None));
    }
    for d in &drives {
        lists.push(folder_games(&Path::new(d).join("XboxGames"), "Xbox", None, Some("Content")));
        for f in ["Games", "Jogos", "Program Files\\EA Games", "Program Files (x86)\\Origin Games", "Program Files\\Epic Games", "GOG Games", "Riot Games"] {
            lists.push(folder_games(&Path::new(d).join(f), "Pasta", None, None));
        }
    }
    merge_found(lists)
}

#[cfg(windows)]
mod reg {
    use super::{main_exe_in, slug, FoundGame};
    use windows::core::{HSTRING, PWSTR};
    use windows::Win32::System::Registry::{
        RegCloseKey, RegEnumKeyExW, RegGetValueW, RegOpenKeyExW, HKEY, HKEY_LOCAL_MACHINE, KEY_READ, RRF_RT_REG_SZ,
    };

    fn subkeys(path: &str) -> Vec<String> {
        let mut out = Vec::new();
        unsafe {
            let mut key = HKEY::default();
            if RegOpenKeyExW(HKEY_LOCAL_MACHINE, &HSTRING::from(path), 0, KEY_READ, &mut key).is_err() {
                return out;
            }
            for i in 0..512u32 {
                let mut buf = [0u16; 256];
                let mut len = buf.len() as u32;
                if RegEnumKeyExW(key, i, PWSTR(buf.as_mut_ptr()), &mut len, None, PWSTR::null(), None, None).is_err() {
                    break;
                }
                out.push(String::from_utf16_lossy(&buf[..len as usize]));
            }
            let _ = RegCloseKey(key);
        }
        out
    }

    fn value(path: &str, name: &str) -> Option<String> {
        let mut buf = [0u16; 1024];
        let mut len = (buf.len() * 2) as u32;
        let r = unsafe {
            RegGetValueW(
                HKEY_LOCAL_MACHINE,
                &HSTRING::from(path),
                &HSTRING::from(name),
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
        let s = String::from_utf16_lossy(&buf[..end]).trim().replace('/', "\\");
        (!s.is_empty()).then_some(s)
    }

    /// Cada subchave tem a pasta do jogo num valor; o nome é a subchave ou a pasta.
    pub fn by_install_dir(base: &str, value_name: &str, source: &str) -> Vec<FoundGame> {
        let mut out = Vec::new();
        for k in subkeys(base) {
            let Some(dir) = value(&format!(r"{base}\{k}"), value_name) else { continue };
            let p = std::path::Path::new(dir.trim_end_matches('\\'));
            if !p.is_dir() {
                continue;
            }
            let name = if k.chars().all(|c| c.is_ascii_digit()) {
                p.file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or(k.clone())
            } else {
                k.clone()
            };
            if let Some(exe) = main_exe_in(p, &name) {
                out.push(FoundGame { id: format!("{}-{}", slug(source), slug(&name)), name, executable: exe, source: source.into() });
            }
        }
        out
    }

    /// GOG Galaxy guarda o nome e o .exe de cada jogo.
    pub fn gog() -> Vec<FoundGame> {
        let base = r"SOFTWARE\WOW6432Node\GOG.com\Games";
        let mut out = Vec::new();
        for k in subkeys(base) {
            let key = format!(r"{base}\{k}");
            let Some(name) = value(&key, "gameName") else { continue };
            let exe = value(&key, "exe").filter(|e| std::path::Path::new(e).is_file()).or_else(|| {
                value(&key, "path").and_then(|d| main_exe_in(std::path::Path::new(&d), &name))
            });
            if let Some(exe) = exe {
                out.push(FoundGame { id: format!("gog-{k}"), name, executable: exe, source: "GOG".into() });
            }
        }
        out
    }
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

    #[test]
    fn crosshair_codes() {
        assert!(is_crosshair_code("0;P;c;5;h;0;0l;4;0o;2;0a;1;0f;0;1b;0"));
        assert!(!is_crosshair_code("P;c;5"));
        assert!(!is_crosshair_code("0;P;<script>"));
    }

    #[test]
    fn riot_client_path() {
        let j = r#"{"rc_default": "C:/Riot Games/Riot Client/RiotClientServices.exe"}"#;
        assert_eq!(riot_client_from_installs(j).as_deref(), Some(r"C:\Riot Games\Riot Client\RiotClientServices.exe"));
    }
    #[test]
    fn le_manifesto_da_steam() {
        let acf = "\"AppState\"\n{\n\t\"appid\"\t\t\"1172470\"\n\t\"name\"\t\t\"Apex Legends\"\n\t\"installdir\"\t\t\"Apex Legends\"\n\t\"InstalledDepots\"\n\t{\n\t}\n}";
        assert_eq!(parse_acf(acf), Some(("1172470".into(), "Apex Legends".into(), "Apex Legends".into())));
        assert!(parse_acf("lixo").is_none());
        assert!(is_not_a_game("Steamworks Common Redistributables"));
        assert!(is_not_a_game("Proton 9.0"));
        assert!(!is_not_a_game("Elden Ring"));
    }

    #[test]
    fn escolhe_o_exe_do_jogo() {
        let exes = vec![
            ("unins000.exe".to_string(), 3_000_000),
            ("EasyAntiCheat\\EasyAntiCheat_EOS_Setup.exe".to_string(), 50_000_000),
            ("Launcher.exe".to_string(), 8_000_000),
            ("Game\\eldenring.exe".to_string(), 80_000_000),
            ("Game\\start_protected_game.exe".to_string(), 1_000_000),
        ];
        assert_eq!(pick_main_exe("ELDEN RING", "ELDEN RING", &exes).as_deref(), Some("Game\\eldenring.exe"));
        let ue = vec![
            ("Hell.exe".to_string(), 400_000),
            ("Hell\\Binaries\\Win64\\Hell-Win64-Shipping.exe".to_string(), 90_000_000),
            ("Engine\\Binaries\\Win64\\CrashReportClient.exe".to_string(), 20_000_000),
        ];
        assert_eq!(pick_main_exe("Hell Let Loose", "Hell Let Loose", &ue).as_deref(), Some("Hell\\Binaries\\Win64\\Hell-Win64-Shipping.exe"));
        assert!(pick_main_exe("x", "x", &[("unins000.exe".into(), 1)]).is_none());
    }

    #[test]
    fn acha_jogos_em_pastas() {
        let t = tempfile::tempdir().unwrap();
        let g = t.path().join("Hollow Knight");
        std::fs::create_dir_all(g.join("_CommonRedist")).unwrap();
        std::fs::write(g.join("hollow_knight.exe"), vec![0u8; 2_000_000]).unwrap();
        std::fs::write(g.join("UnityCrashHandler64.exe"), vec![0u8; 1_000_000]).unwrap();
        std::fs::write(g.join("_CommonRedist").join("vc_redist.x64.exe"), vec![0u8; 3_000_000]).unwrap();
        std::fs::create_dir_all(t.path().join("Vazio")).unwrap();
        let found = folder_games(t.path(), "Pasta", None, None);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].name, "Hollow Knight");
        assert!(found[0].executable.ends_with("hollow_knight.exe"));
        assert_eq!(found[0].id, "pasta-hollow-knight");
        // Battle.net: só pastas com .build.info.
        assert!(folder_games(t.path(), "Battle.net", Some(".build.info"), None).is_empty());
    }

    #[test]
    fn steam_com_manifestos() {
        let t = tempfile::tempdir().unwrap();
        let apps = t.path().join("steamapps");
        let game = apps.join("common").join("Terraria");
        std::fs::create_dir_all(&game).unwrap();
        std::fs::write(game.join("Terraria.exe"), vec![0u8; 500_000]).unwrap();
        std::fs::write(apps.join("appmanifest_105600.acf"), "\"AppState\"\n{\n\"appid\" \"105600\"\n\"name\" \"Terraria\"\n\"installdir\" \"Terraria\"\n}").unwrap();
        std::fs::write(apps.join("appmanifest_228980.acf"), "\"AppState\"\n{\n\"appid\" \"228980\"\n\"name\" \"Steamworks Common Redistributables\"\n\"installdir\" \"Steamworks Shared\"\n}").unwrap();
        let found = steam_games(&[t.path().to_string_lossy().to_string()]);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].id, "steam-105600");
        assert_eq!(found[0].source, "Steam");
    }

    #[test]
    fn junta_sem_repetir() {
        let g = |id: &str, n: &str, e: &str| FoundGame { id: id.into(), name: n.into(), executable: e.into(), source: String::new() };
        let m = merge_found(vec![
            vec![g("cs2", "Counter-Strike 2", r"D:\cs2.exe")],
            vec![g("pasta-cs", "CS", r"D:\CS2.EXE"), g("x", "Riot Client", r"C:\rc.exe"), g("y", "Celeste", r"C:\c.exe")],
        ]);
        assert_eq!(m.iter().map(|x| x.id.as_str()).collect::<Vec<_>>(), vec!["cs2", "y"]);
    }

}
