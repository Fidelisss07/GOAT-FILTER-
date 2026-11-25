import { config } from "./config.js";

const site = config.siteUrl;

/**
 * Base de conhecimento. Cada item alimenta:
 *  - o comando /ajuda (menu com todos),
 *  - a ajuda automática (quando alguém escreve algo que bate nas `keywords`).
 * `answer` aceita markdown do Discord.
 */
export const FAQ = [
  {
    id: "aviso",
    emoji: "🛡️",
    title: "O Windows mostra “O Windows protegeu o computador”",
    keywords: ["aviso azul", "deu aviso", "aviso", "smartscreen", "protegeu", "windows protegeu", "nao deixa instalar", "não deixa instalar", "nao instala", "não instala", "virus", "vírus", "bloqueou", "executar assim", "mais informações", "mais informacoes"],
    answer:
      "Isso é **normal** num app novo que ainda não tem assinatura digital (ela é cara). É seguro. Para instalar:\n" +
      "**1.** Clique em **Mais informações**\n" +
      "**2.** Clique em **Executar assim mesmo**\n\n" +
      "O Goat Filter não injeta nada no jogo e não mexe nos arquivos do Valorant. O aviso vai sumindo conforme mais gente baixa.",
  },
  {
    id: "ban",
    emoji: "🎯",
    title: "Dá ban no Valorant?",
    keywords: ["tomar ban", "vai dar ban", "dar ban", "da ban", "ban", "banir", "banido", "vac", "vanguard", "anticheat", "anti-cheat", "é seguro", "e seguro", "detecta"],
    answer:
      "O Goat Filter **não injeta código** no jogo, **não lê a memória** dele e **não desenha nada por cima** da tela. " +
      "Ele usa as mesmas funções do painel da NVIDIA/AMD e recursos normais do Windows (perfil de cor, curva de gama). " +
      "Para saber se o jogo está aberto, só olha a lista de programas, como o Gerenciador de Tarefas.\n\n" +
      "É o mesmo tipo de ajuste de tela que jogadores usam há anos. Nenhum app de terceiros tem garantia oficial da Riot, mas o Goat Filter foi feito de propósito para não tocar no jogo.",
  },
  {
    id: "placa",
    emoji: "🖥️",
    title: "Funciona com AMD e Intel?",
    keywords: ["funciona com amd", "funciona com intel", "com amd", "com intel", "amd", "intel", "radeon", "placa de video", "placa de vídeo", "gpu", "funciona na minha"],
    answer:
      "Sim. Na **NVIDIA** e na **AMD** o vibrance vai direto no driver. Na **Intel**, e em qualquer placa acima de 100%, o app usa a camada **Super** (uma matriz de cor aplicada pelo Windows). Funciona no **Windows 10 e 11**.",
  },
  {
    id: "super",
    emoji: "🌈",
    title: "Como passa de 100% (até 200%)?",
    keywords: ["200", "super", "passar de 100", "acima de 100", "limite", "mais cor", "digital vibrance"],
    answer:
      "Até 100% é o Digital Vibrance do driver. Acima disso entra uma **segunda camada de saturação**, aplicada pelo Windows depois do jogo. " +
      "No Windows 11 dá para usar o perfil de cor **MHC2** (aplicado pela própria placa, sem input lag e também em tela cheia).",
  },
  {
    id: "clipes",
    emoji: "🎬",
    title: "A gravação de clipes pesa no FPS?",
    keywords: ["clipe", "clipes", "gravar", "gravação", "gravacao", "replay", "fps", "lag", "trava", "pesado"],
    answer:
      "Quase nada. A tela é capturada pela própria placa de vídeo e quem codifica é o chip dela (NVENC/AMF/Quick Sync), separado do que roda o jogo. " +
      "Por padrão o replay só fica ligado com o jogo aberto, e salvar um clipe só junta pedaços já gravados.",
  },
  {
    id: "sensibilidade",
    emoji: "🖱️",
    title: "Como o app acha minha sensibilidade ideal?",
    keywords: ["sensibilidade", "sens", "mira", "dpi", "edpi"],
    answer:
      "O app abre uma cena com o **mesmo campo de visão e o mesmo cálculo de mira do Valorant** e lê o mouse sem a aceleração do Windows. " +
      "Em algumas rodadas você joga testes curtos às cegas; ele mede tempo, erros e se você passa do alvo, e estreita a faixa até achar a sua. O resultado sai no **número exato** para colocar no jogo.",
  },
  {
    id: "restaurar",
    emoji: "↩️",
    title: "Como volto as cores ao normal?",
    keywords: ["restaurar", "voltar", "cores normais", "desfazer", "tirar o filtro", "normal de volta"],
    answer:
      'Use **“Restaurar padrão”** no app, **“Restaurar cores originais”** na bandeja, ou simplesmente **feche o app** (ele devolve as cores ao sair). ' +
      "Se o PC desligar no meio de uma partida, as cores voltam na próxima vez que o app abrir.",
  },
  {
    id: "gratis",
    emoji: "💜",
    title: "É grátis?",
    keywords: ["gratis", "grátis", "preço", "preco", "pagar", "custa", "pago"],
    answer: `Sim, sem conta e sem anúncios. O app se atualiza sozinho quando sai versão nova. Baixe em ${site}`,
  },
  {
    id: "download",
    emoji: "⬇️",
    title: "Onde baixo / como atualizo?",
    keywords: ["baixar", "download", "atualizar", "atualização", "atualizacao", "onde baixo", "como instalo", "link do app"],
    answer: `Baixe sempre pelo site oficial: ${site}\nO app avisa e se atualiza sozinho quando sai versão nova.`,
  },
];

export const faqById = (id) => FAQ.find((f) => f.id === id);

/** Acha o item de FAQ que melhor casa com um texto livre (ajuda automática). */
export function matchFaq(text) {
  const t = text.toLowerCase();
  let best = null;
  let bestScore = 0;
  for (const f of FAQ) {
    let score = 0;
    for (const k of f.keywords) if (t.includes(k)) score += k.length;
    if (score > bestScore) {
      bestScore = score;
      best = f;
    }
  }
  // Exige um mínimo para não responder a qualquer mensagem solta.
  return bestScore >= 3 ? best : null;
}
