# Goat Filter

Utilitário para Windows que aumenta a intensidade das cores (**Digital Vibrance**) e
vai **além dos 100% do driver** com a camada **Super Vibrance**. Também ativa sozinho um
perfil quando o **Valorant** abre e devolve as cores quando o jogo fecha.

![Visão geral](design/telas/01-visao-geral-roxo.png)

## Como funciona

| Faixa do slider | O que acontece |
|---|---|
| **0–100%** | Digital Vibrance do driver. NVIDIA via NVAPI e AMD via ADL. 50% = cores normais, 100% = máximo do painel. |
| **100–200%** | O driver fica em 100% e uma matriz de saturação do Windows soma por cima (até 2×). |
| **Intel / sem driver** | O slider inteiro usa a matriz do Windows (50% = normal). |

O Goat Filter **nunca toca no processo do jogo**: não injeta código, não usa overlay e
não lê memória. Só usa APIs do driver e do Windows, assim como o painel da NVIDIA ou da AMD.

Segurança das cores:
- Os valores originais ficam salvos em `session.json` antes de qualquer alteração. Se o app
  travar ou o PC desligar, eles são restaurados na próxima abertura.
- A camada Super pertence ao processo: se o app fechar, o Windows remove o efeito.
- Com "Restaurar cores ao sair", tudo volta ao original quando você sai pela bandeja.

### Dois métodos para passar de 100% (Configurações → Super Vibrance)

| Método | Onde funciona | Observação |
|---|---|---|
| **Matriz do Windows** (padrão) | Qualquer GPU, Windows 10 e 11 | Aplicada pela composição do Windows. No Valorant, use **"Janela em tela cheia"**. Some sozinha se o app fechar. |
| **Perfil de cor MHC2** (experimental) | Windows 11 | O app gera um perfil de cor com a matriz, e a própria GPU aplica: sem input lag e também em tela cheia exclusiva. É por monitor. Ao desligar, o perfil de cor anterior volta; se o app travar, ele é desfeito na próxima abertura. |

### Ajustes finos por perfil (Perfis → Ajustes finos)

| Ajuste | O que faz |
|---|---|
| **Realçar cor do inimigo** | Escolha vermelho, amarelo ou roxo, a mesma cor do contorno configurada no Valorant. Essa cor ganha saturação extra e as outras quase não mudam; o brilho é mantido. Usa a camada Super (qualquer método). |
| **Brilho / Contraste / Gama** | Curva de gama do Windows, por monitor. Gama acima de 1,00 clareia as sombras. |
| **Só com o jogo em foco** | No alt-tab, o Discord e o navegador voltam às cores normais; ao voltar para o jogo, o perfil é reaplicado. Não abre o processo do jogo: só compara a janela da frente com a lista de processos. |
| **Monitor (pelo cabo, DDC/CI)** | Brilho, contraste e (se o modelo aceitar) saturação do **próprio monitor**, como nos botões dele. Volta ao valor anterior quando o perfil sai. Se o monitor não responder, ligue a opção "DDC/CI" no menu dele. |
| **Testar agora** | Aplica o perfil no monitor padrão sem precisar abrir o jogo. **Restaurar padrão** volta tudo. |

Os perfis podem ser **exportados e importados** (arquivo `.goatfilter.json`) para compartilhar.

### Atalhos (funcionam com o jogo aberto)

| Atalho | Ação |
|---|---|
| `Ctrl` + `Alt` + `G` | Liga/desliga o filtro (volta às cores originais e depois reaplica) |
| `Ctrl` + `Alt` + `↑` / `↓` | Sobe/desce 10% no monitor padrão |

### Log para diagnóstico

`%LOCALAPPDATA%\com.goatfilter.app\logs\goat-filter.log` registra o que foi detectado
(placa, monitores, métodos disponíveis) e cada ajuste aplicado.

## Roteiro de teste

1. Abra o app e vá em **Visão geral**. O seletor de monitor deve mostrar o nome do seu
   monitor e a etiqueta **Driver NVIDIA**.
2. Coloque **100%** e clique em **Aplicar**. O Painel da NVIDIA deve mostrar 100% de vibrance.
3. Coloque **150%** e clique em **Aplicar**. As cores devem ficar mais fortes do que em 100%.
4. Em **Configurações → Super Vibrance**, troque para **Perfil de cor MHC2**. Com 150%
   aplicado, as cores devem continuar fortes. Volte para 50% e confira se o normal voltou.
5. Abra o Valorant em **tela cheia** e em **janela em tela cheia** com cada método e veja
   onde a faixa acima de 100% aparece.
6. No jogo, teste `Ctrl+Alt+G` e `Ctrl+Alt+↑/↓`.
7. Em **Perfis → Ajustes finos**, escolha a cor do realce e suba a gama. Clique em
   **Testar agora** e depois em **Restaurar padrão** na Visão geral.
8. Em **Ajustes finos → Monitor (pelo cabo)**, veja quais controles o seu monitor aceita,
   marque **Brilho do monitor**, mude o valor e clique em **Testar agora**.
9. Ligue **Só com o jogo em foco**, abra o Valorant e dê alt-tab: o Windows deve voltar ao
   normal e o perfil deve voltar quando você retornar ao jogo.
10. Saia pela bandeja (**Sair**) e confira se as cores originais voltaram.

## Baixar o `.exe`

A cada push, o GitHub Actions compila no Windows e publica o artefato
**goat-filter-windows** (aba *Actions* → execução mais recente → *Artifacts*). Ele contém:

- `Goat Filter_0.5.0_x64-setup.exe`: o instalador
- `goat-filter.exe`: a versão portátil

O `.exe` ainda não tem assinatura digital, então o Windows SmartScreen pode avisar.
Clique em "Mais informações" → "Executar assim mesmo".

## Desenvolvimento

Pré-requisitos no Windows: [Node 22](https://nodejs.org), [Rust](https://rustup.rs) e
as Build Tools do Visual Studio (C++). O WebView2 já vem no Windows 10/11.

```bash
npm install
npm run tauri dev      # abre o app com recarregamento automático
npm run tauri build    # gera o instalador em target/release/bundle/nsis/
```

Só a interface, em qualquer sistema (modo demonstração, sem mexer nas cores):

```bash
npm run dev            # http://localhost:1420
```

Testes:

```bash
npm run typecheck && npm test   # interface (Vitest)
cargo test -p goat-core         # núcleo: camadas, sessão, detecção do jogo
```

## Estrutura

```
src/                 interface React + TypeScript (3 telas, 3 temas)
crates/goat-core/    núcleo em Rust, sem interface
  backends/nvapi.rs      NVIDIA Digital Vibrance
  backends/adl.rs        AMD saturação
  backends/magnifier.rs  camada Super: matriz de cor do Windows
  backends/mhc2.rs       camada Super: perfil de cor MHC2 (Windows 11)
  backends/icc.rs        gerador do perfil ICC com a tag MHC2
  backends/gamma.rs      brilho/contraste/gama (gamma ramp)
  backends/ddc.rs        controles do próprio monitor (DDC/CI)
  color.rs               matrizes de saturação e realce de cor, curvas
  games.rs               encontra onde o Valorant está instalado
  engine.rs              junta as camadas e restaura os originais
  session.rs             recuperação após crash
  watcher.rs             detecta o jogo abrindo/fechando
src-tauri/           app Tauri: janela, bandeja, inicialização com o Windows
design/              kit visual (logos, mockups, especificação)
docs/PLANEJAMENTO.md planejamento completo
```
