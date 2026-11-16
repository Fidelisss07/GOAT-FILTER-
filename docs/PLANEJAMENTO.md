# Goat Filter — Planejamento completo

> Utilitário para Windows (`.exe`) que ajusta a intensidade das cores (Digital Vibrance e
> "Super Vibrance" acima de 100%) por monitor e ativa um perfil automaticamente ao abrir o
> Valorant — sem tocar no processo do jogo.

Referências visuais: `design/telas/*.png` · Logos: `design/logos/*.svg` · Especificação de telas: `design/prompts/*.md`.

## Status (atualizado)

Decisões confirmadas: precisa funcionar em **NVIDIA, AMD e Intel**, no **Windows 10 e 11**,
e o slider vai de **0 a 200%**. O PC de referência tem uma RTX 3090, Windows 11 e um monitor
Redragon de 144 Hz.

| Item | Situação |
|---|---|
| 3 telas fiéis aos mockups, 3 temas, modo demonstração | ✅ feito |
| Núcleo Rust com NVIDIA (NVAPI), AMD (ADL) e camada Super | ✅ feito, compila para Windows |
| Camada Super via Magnification API (todas as GPUs, Win 10/11) | ✅ feita, **falta testar no Valorant** |
| Detecção do Valorant, aplicar ao abrir, restaurar ao fechar | ✅ feito |
| Recuperação após crash (`session.json`) | ✅ feito |
| Bandeja, iniciar com o Windows, instância única | ✅ feito |
| Instalador `.exe` pelo GitHub Actions | ✅ workflow criado |
| Camada Super via perfil MHC2 (Win 11, zero lag, tela cheia) | ✅ feita (v0.2), **falta testar no hardware** |
| Escolha do método nas Configurações | ✅ feito (v0.2) |
| Atalhos globais (Ctrl+Alt+G, Ctrl+Alt+↑/↓) | ✅ feito (v0.2) |
| Log em arquivo para diagnóstico | ✅ feito (v0.2) |
| Intel via IGCL (vibrance no driver) | ⏳ fase 2 (hoje o Intel usa a camada Super) |
| Realce da cor do inimigo (vermelho/amarelo/roxo) | ✅ feito (v0.3) |
| Brilho, contraste e gama por perfil | ✅ feito (v0.3) |
| Só com o jogo em foco (alt-tab volta ao normal) | ✅ feito (v0.3) |
| Exportar/importar perfis, botão "Testar agora" | ✅ feito (v0.3) |
| Controle do monitor pelo cabo (DDC/CI) por perfil | ✅ feito (v0.5) |
| Valorant encontrado automaticamente em qualquer pasta/disco | ✅ feito (v0.5) |
| Intel IGCL | ❌ descartado: grava no driver e não dá para testar sem risco; a Intel usa a camada Super |
| Correções após teste em hardware real | ⏳ v0.4 (depende do teste) |
| Aviso de nova versão, publicação em Releases, "Sobre" com logs | ✅ feito (v1.0) |
| Assinatura gratuita (SignPath / Microsoft Store / winget) | 🟡 pronta no workflow; depende do dono criar a conta (docs/ASSINATURA.md) |

A Magnification API foi implementada primeiro porque funciona em **qualquer GPU e no
Windows 10 e 11**. O MHC2 só existe no Windows 11 e o formato precisa ser validado em
hardware real.

---

## 1. Objetivo e princípios

| # | Princípio | Por quê |
|---|-----------|---------|
| 1 | **Nunca tocar no processo do jogo** (sem injeção, hook de DirectX, overlay ou leitura de memória) | O Vanguard (anti-cheat do Valorant) roda em kernel e bane esse tipo de coisa. Todo ajuste é feito no driver da GPU, no Windows ou no monitor. |
| 2 | **Sempre devolver as cores originais** | Se o app fechar ou travar, o Windows não pode ficar com as cores estouradas. |
| 3 | **Passar de 100% de vibrance** | O usuário já usa 100% no painel da NVIDIA e quer mais. Isso exige uma segunda camada de saturação além do driver. |
| 4 | **Mostrar a verdade** | Nunca confundir a prévia (CSS) com o ajuste real; deixar claro quando algo não é suportado pelo hardware. |
| 5 | **Leve** | Fica na bandeja gastando ~0% de CPU e pouca RAM durante as partidas. |

---

## 2. Como passar de 100% (as três camadas)

```
Valorant renderiza a imagem
        │
        ▼
[1] Driver da GPU ─ Digital Vibrance 0–100%
        │           NVIDIA: NVAPI (DVC)   AMD: ADL/ADLX (Saturation)   Intel: IGCL
        ▼
[2] Super Vibrance ─ matriz de saturação 100–200%   ← é aqui que passa do limite
        │           A) Windows 11: perfil de cor ICC com matriz MHC2 (pipeline de hardware, 0 FPS, 0 input lag)
        │           B) Fallback: Magnification API (MagSetFullscreenColorEffect) — só modo janela, pode somar lag
        ▼
[3] Monitor ─ saturação/brilho/contraste pelo cabo (DDC/CI, VCP 0x8A/0x10/0x12), se o monitor suportar
        │
        ▼
     Sua tela
```

**Na interface** isso vira um único slider:

- `0% → 100%`: só a camada 1 (igual ao painel da NVIDIA).
- `100% → 200%`: camada 1 travada em 100% + camada 2 aumentando.
- Uma marca no trilho em 100% com o texto "limite do driver" e o trecho acima pintado com o acento mais forte ("Super").

> ⚠️ Decisão de design: os mockups mostram o slider 0–100%. A proposta é manter o mesmo
> visual e **estender a escala até 200%** (marcas 0% · 100% · 200%), habilitando a faixa
> "Super" só quando a camada 2 estiver disponível.

**Saturação por cor (fase 3):** a matriz permite reforçar mais vermelho/amarelo/roxo (cores de
contorno de inimigo) e menos o resto, evitando que tudo "estoure".

---

## 3. Stack técnica

| Parte | Escolha | Motivo |
|-------|---------|--------|
| Shell do app | **Tauri 2** | Gera `.exe` pequeno (~5–10 MB), usa WebView2 do Windows, back-end em Rust. Indicado pelo kit. |
| Interface | **React + TypeScript + Vite** | Componentes reais para as 3 telas e 3 temas. |
| Estilo | CSS Modules + variáveis CSS (tokens) | Troca de tema instantânea só trocando o acento. |
| Estado da UI | Zustand | Simples, persiste via plugin store. |
| Back-end | **Rust** + crate `windows` (Win32) | Acesso a driver, gamma, DDC/CI, processos, registro. |
| GPU | `libloading` para `nvapi64.dll`, `atiadlxx.dll`/ADLX, `ControlLib.dll` (Intel) | Carrega em tempo de execução; se não existir, o backend fica "indisponível". |
| Plugins Tauri | `tray-icon`, `autostart`, `store`, `single-instance`, `window-state`, `dialog`, `global-shortcut`, `updater` | Bandeja, iniciar com Windows, persistência, uma instância, escolher `.exe`, atalhos, atualização. |
| Instalador | **NSIS** (`GoatFilter_x.y.z_x64-setup.exe`) + versão portátil | O "app .exe no PC". |
| Testes | `cargo test` (backends com mock), Vitest (UI), Playwright (capturas vs mockups) | |
| CI | GitHub Actions `windows-latest` | Compila e gera o `.exe` a cada push. |

---

## 4. Arquitetura

```
┌──────────────────────── Interface (React) ────────────────────────┐
│  Sidebar + Tema │ Visão geral │ Perfis │ Configurações │ Prévia   │
└───────────────────────────────┬───────────────────────────────────┘
                     comandos Tauri (invoke) / eventos
┌───────────────────────────────▼───────────────────────────────────┐
│                         Núcleo (Rust)                             │
│  ┌──────────────┐  ┌─────────────────┐  ┌──────────────────────┐  │
│  │ MonitorMgr   │  │ VibranceEngine  │  │ GameWatcher          │  │
│  │ lista/hotplug│  │ compõe camadas  │  │ processo + foco      │  │
│  └──────┬───────┘  └────────┬────────┘  └──────────┬───────────┘  │
│         │       ┌───────────┴──────────┐           │              │
│         │       │  SessionGuard        │◄──────────┘              │
│         │       │  salva originais,    │                          │
│         │       │  restaura em crash   │                          │
│         │       └───────────┬──────────┘                          │
│  ┌──────▼───────────────────▼─────────────────────────────────┐   │
│  │ Backends (trait ColorBackend)                               │  │
│  │ NvapiBackend │ AdlBackend │ IgclBackend │ Mhc2Backend │     │  │
│  │ MagnifierBackend │ DdcBackend │ MockBackend (demo/testes)   │  │
│  └─────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────┘
```

### 4.1 Contrato dos backends (Rust)

```rust
pub trait ColorBackend: Send + Sync {
    fn id(&self) -> BackendId;
    fn capabilities(&self, m: &MonitorId) -> Capabilities; // vibrance? faixa? default do driver?
    fn read(&self, m: &MonitorId) -> Result<Level>;
    fn write(&self, m: &MonitorId, level: Level) -> Result<()>;
    fn driver_default(&self, m: &MonitorId) -> Option<Level>;
}
```

O `VibranceEngine` recebe um valor de **0–200%** e distribui:
`driver = min(v, 100)`, `super = max(v - 100, 0)` → camada 2. Se a camada 2 não existir,
o slider trava em 100% e a UI mostra o motivo.

### 4.2 Segurança das cores (SessionGuard)

1. Antes do **primeiro** ajuste em um monitor, grava o valor original em `session.json`.
2. Ao fechar o app, fechar o jogo (se "Restaurar ao fechar") ou sair do Windows → restaura.
3. Se o app travar: na próxima abertura, encontra `session.json` "sujo" e restaura.
4. Hook de pânico do Rust + `WM_QUERYENDSESSION` também restauram.
5. Monitor desconectado: descarta a alteração pendente dele e mantém uma seleção válida.

### 4.3 Detecção do Valorant (GameWatcher)

- Processo real do jogo: **`VALORANT-Win64-Shipping.exe`** (o `VALORANT.exe` é só o lançador).
  O perfil aceita o caminho escolhido e também reconhece o executável `-Shipping`.
- Verifica processos a cada ~1 s (`CreateToolhelp32Snapshot`) e a janela em foco por evento
  (`SetWinEventHook(EVENT_SYSTEM_FOREGROUND)`) — custo praticamente zero.
- Fluxo: jogo abriu → salva originais → aplica perfil. Alt-tab (opcional) → volta ao normal.
  Jogo fechou → restaura (se habilitado).
- Reaplica 2–3 s depois de o jogo ganhar foco, porque a tela cheia às vezes reseta cores.

---

## 5. Telas (seguindo o kit)

Janela 1280×800, sem moldura do Windows (barra customizada com minimizar/maximizar/fechar),
sidebar ~240 px, cantos chanfrados e linha de acento no topo como nos mockups.

**Tokens:** fundo `#111118` · superfície `#191922` · borda `#3B3B48` · texto `#F4F4FA` ·
texto secundário `#BBBBCA` · acentos **roxo `#AD78FF`** (padrão), **rosa `#FF48A8`**, **amarelo `#FFD629`**.
Texto escuro em botões sólidos. Fonte Inter/Segoe UI.

### Sidebar (todas as telas)
Logo SVG do tema ativo · Visão geral · Perfis · Configurações · seletor de Tema (rosa, roxo, amarelo — com ✓, foco visível e nome acessível).

### Visão geral (`design/telas/01..03`)
- Cartão **Monitor**: seletor de monitor, valor grande (ex.: 75%), slider com marcas, **Aplicar** e **Restaurar padrão**.
  - Valor editado ≠ valor aplicado (indicador "não aplicado").
  - Restaurar padrão usa o default do driver; se não existir, "Restaurar anterior".
- Cartão **Perfil do Valorant**: Aplicar ao abrir · Restaurar ao fechar · status (Aguardando jogo / Ativo / Indisponível).
- **Antes/Depois**: `cenario-preview.png` nos dois lados, `filter: saturate()` + `clip-path`, divisor arrastável e por teclado (←/→), aviso "prévia ilustrativa".

### Perfis (`design/telas/04`)
Lista (Valorant, + Novo perfil) · Editor: Nome, Executável (com botão de pasta), Digital Vibrance, Aplicar ao abrir, Restaurar ao fechar, **Salvar perfil**. Validação de nome vazio e caminho inválido no próprio campo. Rascunho não se perde ao trocar tema.

### Configurações (`design/telas/05`)
- **Aparência**: Violeta, Rosa, Amarelo (mesmo estado do seletor lateral).
- **Inicialização**: Iniciar com o Windows · Minimizar para a bandeja (mostra o estado real; se falhar, volta e avisa).
- **Monitor e ajustes**: Monitor padrão · Restaurar cores ao sair.
- **Novo (proposto)**: seção **Avançado** — método do Super Vibrance (MHC2 / Magnificação), controle do monitor via DDC/CI, atalhos globais.

### Bandeja do sistema
Ícone com o símbolo do bode · menu: Abrir · Perfil ativo ✓ · Ligar/Desligar filtro · Sair (restaurando cores).

---

## 6. Logo e ícone do `.exe`

- Wordmark e símbolo vêm prontos em `design/logos/` (SVG em curvas, não redesenhar).
- Ícone do app/instalador/bandeja: gerar a partir de `goat-filter-roxo-simbolo.svg` com
  `npx tauri icon` → `.ico` (16–256 px), `.png` e variantes.
- No tamanho 16 px da bandeja, testar legibilidade; se precisar, versão simplificada do símbolo.

---

## 7. Estrutura de pastas

```
GOAT-FILTER-/
├─ design/                  kit visual (referência)
├─ docs/PLANEJAMENTO.md     este arquivo
├─ src/                     interface React
│  ├─ app/                  shell, rotas, barra de título
│  ├─ components/           Slider, Toggle, Select, Card, ThemePicker, BeforeAfter…
│  ├─ pages/                Overview, Profiles, Settings
│  ├─ state/                store (tema, perfis, monitores, sessão)
│  ├─ theme/tokens.css
│  └─ lib/native.ts         wrapper tipado dos comandos Tauri (+ modo demo)
├─ src-tauri/
│  ├─ src/
│  │  ├─ main.rs / lib.rs   comandos, bandeja, plugins
│  │  ├─ engine.rs          VibranceEngine
│  │  ├─ session.rs         SessionGuard
│  │  ├─ watcher.rs         GameWatcher
│  │  ├─ monitors.rs
│  │  └─ backends/          nvapi.rs, adl.rs, igcl.rs, mhc2.rs, magnifier.rs, ddc.rs, mock.rs
│  ├─ icons/
│  └─ tauri.conf.json
└─ .github/workflows/build.yml   gera o .exe no Windows
```

---

## 8. Fases e critérios de pronto

### Fase 0 — Protótipo técnico (provar o "passar de 100%")
- [ ] Programa de linha de comando em Rust: lê/escreve DVC na NVIDIA.
- [ ] Aplica matriz de saturação 1.5× via MHC2 (Win 11) e via Magnificação.
- [ ] **Teste no Valorant**: funciona em "Tela cheia" e "Janela em tela cheia"? Mede FPS e input lag. Vanguard não reclama?
- **Pronto quando:** sabemos qual método da camada 2 usar.

### Fase 1 — MVP `.exe`
- [ ] Projeto Tauri + React com as **3 telas fiéis aos mockups** e os **3 temas** persistidos.
- [ ] Backend NVIDIA + Super Vibrance (método vencedor da fase 0) + Mock/demonstração.
- [ ] Slider 0–200%, Aplicar, Restaurar padrão, seletor de monitor.
- [ ] Perfil do Valorant com detecção automática, aplicar ao abrir e restaurar ao fechar.
- [ ] SessionGuard (restauração em crash), bandeja, iniciar com Windows.
- [ ] Instalador NSIS gerado pelo GitHub Actions.
- **Pronto quando:** instala, abre o Valorant, as cores sobem sozinhas e voltam ao fechar.

### Fase 2 — v1.0
- [ ] Backends AMD e Intel.
- [ ] Múltiplos perfis (CS2, Fortnite…), validação de formulário completa.
- [ ] DDC/CI do monitor (saturação/brilho/contraste quando suportado).
- [ ] Atalhos globais (`Ctrl+Alt+G` liga/desliga, `Ctrl+Alt+1/2/3` perfis).
- [ ] Atualização automática.

### Fase 3 — Extras
- [ ] Saturação por cor (reforçar vermelho/amarelo/roxo).
- [ ] Brilho/gama/contraste para ver melhor em cantos escuros.
- [ ] Exportar/importar perfis.
- [ ] Assinatura de código do `.exe` (evita alerta do SmartScreen).

---

## 9. Testes

| O quê | Como |
|-------|------|
| Lógica de camadas, sessão, restauração | `cargo test` com `MockBackend` |
| Componentes (slider, toggles, validação) | Vitest + Testing Library |
| Fidelidade visual | Playwright no modo demonstração, capturas das 3 telas × 3 temas comparadas com `design/telas/` |
| Teclado/acessibilidade | Navegação por Tab, setas no slider e no divisor, foco visível |
| Hardware real | Checklist manual em Windows com NVIDIA (e depois AMD/Intel): aplicar, restaurar, crash, monitor desconectado, Valorant aberto/fechado |

> O desenvolvimento e a UI podem ser testados em qualquer máquina (modo demonstração).
> Os ajustes reais de GPU só podem ser validados em Windows com placa compatível.

---

## 10. Riscos

| Risco | Mitigação |
|-------|-----------|
| Vanguard interpretar algo como trapaça | Nada de injeção/hook no jogo; só APIs de driver/Windows/monitor, como o VibranceGUI. |
| MHC2 não se comportar bem no Valorant em tela cheia | Fase 0 testa antes; fallback Magnificação + recomendação de "Janela em tela cheia". |
| Funções de vibrance da NVAPI usadas não são todas documentadas | Detectar falha e desabilitar com mensagem clara; testar em várias versões de driver. |
| Saturação alta "estoura" e perde detalhe | Prévia, limite em 200%, saturação por cor na fase 3. |
| Cores presas após crash | SessionGuard com arquivo de sessão e restauração na próxima abertura. |
| `.exe` sem assinatura gera alerta do Windows/antivírus | Assinatura de código na fase 3; até lá, documentar. |

---

## 11. Perguntas em aberto

1. Placa de vídeo? (NVIDIA / AMD / Intel) — define o primeiro backend.
2. Windows 10 ou 11? — MHC2 (melhor método da camada 2) é do Windows 11.
3. Modelo do monitor? — para saber se aceita saturação via DDC/CI.
4. Ok estender o slider para 0–200% na mesma aparência do mockup?
