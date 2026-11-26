import { PermissionFlagsBits as P } from "discord.js";

/**
 * Planta do servidor da comunidade Goat Filter. O /configurar cria o que falta
 * e ajusta o que já existe (pelo ID salvo ou pelo nome), sem duplicar.
 *
 * Modos de canal:
 *  - "portaria": todo mundo vê, mesmo antes de aceitar as regras (só leitura).
 *  - "leitura": membros veem, só a equipe escreve.
 *  - "publico": membros veem e conversam.
 *  - "equipe": só Admin, Moderador e Equipe.
 *  - "voz": membros entram e falam.
 *  - "contador": canal de voz trancado que mostra o número de membros.
 */

/** Cargos, do mais alto para o mais baixo. */
export const ROLES = [
  { key: "admin", name: "Admin", color: 0xff4d6d, hoist: true, perms: [P.Administrator] },
  {
    key: "mod",
    name: "Moderador",
    color: 0xffa94d,
    hoist: true,
    perms: [P.ModerateMembers, P.KickMembers, P.BanMembers, P.ManageMessages, P.ManageThreads, P.MuteMembers, P.MoveMembers, P.ViewAuditLog],
  },
  { key: "equipe", name: "Equipe Goat Filter", color: 0xad78ff, hoist: true, mentionable: true, perms: [P.ManageThreads] },
  { key: "criador", name: "Criador de Conteúdo", color: 0x4fd6ff, hoist: true },
  { key: "parceiro", name: "Parceiro", color: 0x3ddc97, hoist: true },
  { key: "pro", name: "Goat Pro", color: 0xffd34d, hoist: true },
  { key: "membro", name: "Membro", color: 0x9aa3b5 },
  // Elos (escolhidos pela pessoa em #cargos).
  { key: "elo:radiante", name: "Radiante", color: 0xfff2a8, rank: true },
  { key: "elo:imortal", name: "Imortal", color: 0xe0385e, rank: true },
  { key: "elo:ascendente", name: "Ascendente", color: 0x2fb77a, rank: true },
  { key: "elo:diamante", name: "Diamante", color: 0xc68ff5, rank: true },
  { key: "elo:platina", name: "Platina", color: 0x39a6b8, rank: true },
  { key: "elo:ouro", name: "Ouro", color: 0xe8b64a, rank: true },
  { key: "elo:prata", name: "Prata", color: 0xb7c0c9, rank: true },
  { key: "elo:bronze", name: "Bronze", color: 0xa86f3e, rank: true },
  { key: "elo:ferro", name: "Ferro", color: 0x6e6e6e, rank: true },
  // Notificações (ligam e desligam em #cargos).
  { key: "notif:atualizacoes", name: "🔔 Atualizações", notify: true, desc: "Aviso quando sair versão nova do app" },
  { key: "notif:eventos", name: "🎉 Eventos e sorteios", notify: true, desc: "Campeonatos, sorteios e lives" },
  { key: "notif:videos", name: "🎬 Vídeos novos", notify: true, desc: "Vídeos e tutoriais novos" },
];

export const STAFF = ["admin", "mod", "equipe"];

/** Categorias e canais, na ordem em que aparecem. `aliases` = nomes antigos para reaproveitar. */
export const LAYOUT = [
  {
    key: "cat:inicio",
    name: "📌 INÍCIO",
    channels: [
      { key: "ch:boas-vindas", name: "👋・boas-vindas", mode: "portaria", topic: "Quem chega no servidor aparece aqui.", aliases: ["boas-vindas"] },
      { key: "ch:regras", name: "📜・regras", mode: "portaria", topic: "Leia e aceite as regras para liberar o servidor." },
      { key: "ch:anuncios", name: "📢・anúncios", mode: "leitura", topic: "Novidades oficiais do Goat Filter." },
      { key: "ch:atualizacoes", name: "🆕・atualizações", mode: "leitura", topic: "Versões novas do app, postadas automaticamente." },
      { key: "ch:baixar", name: "⬇️・baixar", mode: "leitura", topic: "Link oficial e passo a passo para instalar." },
      { key: "ch:cargos", name: "🎭・cargos", mode: "leitura", topic: "Escolha seu elo e o que você quer receber de aviso." },
      { key: "ch:contador", name: "👥 Membros: 0", type: "voice", mode: "contador" },
    ],
  },
  {
    key: "cat:comunidade",
    name: "💬 COMUNIDADE",
    channels: [
      { key: "ch:geral", name: "💬・geral", mode: "publico", topic: "Papo livre sobre Valorant, setup e o app." },
      { key: "ch:clipes", name: "🎬・clipes", mode: "publico", topic: "Mande seus clipes. Cada um vira um tópico de comentários.", slowmode: 30 },
      { key: "ch:setups", name: "🖥️・setups", mode: "publico", topic: "Mostre seu setup, monitor e configuração." },
      { key: "ch:mira", name: "🎯・mira-e-sens", mode: "publico", topic: "Códigos de mira, sensibilidade e dicas de treino." },
      { key: "ch:memes", name: "😂・memes", mode: "publico" },
      { key: "ch:sugestoes", name: "💡・sugestões", mode: "publico", topic: "Escreva uma ideia: o bot transforma em votação.", slowmode: 60 },
    ],
  },
  {
    key: "cat:suporte",
    name: "🛠️ SUPORTE",
    channels: [
      { key: "ch:duvidas", name: "❓・dúvidas", mode: "publico", topic: "Pergunte aqui: o bot responde as dúvidas comuns na hora." },
      { key: "ch:abrir-ticket", name: "🎫・abrir-ticket", mode: "leitura", topic: "Abra um ticket privado com a equipe.", aliases: ["suporte"] },
    ],
  },
  {
    key: "cat:voz",
    name: "🔊 VOZ",
    channels: [
      { key: "ch:voz-papo", name: "🔊 Bate-papo", type: "voice", mode: "voz" },
      { key: "ch:voz-jogo1", name: "🎮 Jogando 1", type: "voice", mode: "voz", limit: 5 },
      { key: "ch:voz-jogo2", name: "🎮 Jogando 2", type: "voice", mode: "voz", limit: 5 },
      { key: "ch:voz-afk", name: "💤 AFK", type: "voice", mode: "voz" },
    ],
  },
  {
    key: "cat:equipe",
    name: "🔒 EQUIPE",
    channels: [
      { key: "ch:staff", name: "🛡️・staff", mode: "equipe", topic: "Conversa da equipe." },
      { key: "ch:registros", name: "📜・registros", mode: "equipe", topic: "Registros do bot: tickets, moderação, entradas e saídas.", aliases: ["registros"] },
    ],
  },
  { key: "cat:tickets", name: "🎫 TICKETS", channels: [], aliases: ["Tickets"], ticketCategory: true },
];

/** Regras (texto próprio da comunidade). */
export const RULES = [
  ["🤝", "Respeito acima de tudo", "Nada de ofensa, preconceito, assédio ou ataque pessoal. Discordar pode; humilhar não."],
  ["🚫", "Sem trapaça", "Não divulgue, venda nem peça cheats, macros ou qualquer coisa que quebre as regras dos jogos. O Goat Filter não é cheat e a comunidade também não é lugar disso."],
  ["📵", "Sem spam e sem divulgação", "Nada de flood, correntes, convites de outros servidores ou propaganda sem autorização da equipe."],
  ["🔞", "Conteúdo apropriado", "Sem conteúdo adulto, violento ou chocante, em texto, imagem ou apelido."],
  ["🗂️", "Cada assunto no seu canal", "Clipes em #clipes, dúvidas em #dúvidas, problemas com o app em ticket."],
  ["🔐", "Segurança", "Nunca peça nem passe senha, código de verificação ou dados de cartão. A equipe nunca vai pedir isso."],
  ["⬇️", "Download só pelo site oficial", "goatfilter.xyz é o único lugar oficial. Links de outros lugares podem ter vírus."],
  ["🛡️", "A equipe decide", "Moderadores podem avisar, silenciar ou banir quem quebrar as regras. Dúvida sobre uma punição? Abra um ticket."],
];
