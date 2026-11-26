import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits as P } from "discord.js";
import { config } from "./config.js";
import { STAFF } from "./layout.js";
import { welcomeDM } from "./extras.js";
import { bucket, guildData, guildSettings, savedId, setData, touch } from "./store.js";

const brand = () => new EmbedBuilder().setColor(config.brand.color);
const ch = (guild, key) => guild.channels.cache.get(savedId(guild.id, key));
const isStaff = (member) =>
  member?.permissions.has(P.ManageMessages) || STAFF.some((k) => member?.roles.cache.has(savedId(member.guild.id, `role:${k}`)));

/* ------------------------------------------------------------------ registros */
export function logTo(guild, payload) {
  if (!guild) return;
  const c = ch(guild, "ch:registros") || guild.channels.cache.get(guildSettings(guild).logChannelId);
  if (c) c.send(typeof payload === "string" ? { content: payload, allowedMentions: { parse: [] } } : { ...payload, allowedMentions: { parse: [] } }).catch(() => {});
}

/* ------------------------------------------------------------------ boas-vindas e contador */
export async function onJoin(member) {
  const g = member.guild;
  const gate = guildData(g.id).gate !== false;
  const welcome = ch(g, "ch:boas-vindas");
  if (welcome) {
    const regras = ch(g, "ch:regras"), baixar = ch(g, "ch:baixar"), cargos = ch(g, "ch:cargos");
    const embed = brand()
      .setAuthor({ name: `${member.user.username} chegou!`, iconURL: member.user.displayAvatarURL() })
      .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
      .setImage(config.art("bemvindo.jpg"))
      .setDescription(
        `Seja bem-vindo(a), ${member}! Você é o membro **#${g.memberCount}** da comunidade. 🐐\n\n` +
          (gate ? `**1.** Leia e aceite as ${regras ?? "regras"} para liberar o servidor\n` : "") +
          `**${gate ? 2 : 1}.** Baixe o app em ${baixar ?? config.siteUrl}\n**${gate ? 3 : 2}.** Escolha seu elo em ${cargos ?? "#cargos"}`,
      );
    welcome.send({ content: `${member}`, embeds: [embed] }).catch(() => {});
  }
  // Sem verificação: já entra como Membro.
  if (!gate) {
    const role = g.roles.cache.get(savedId(g.id, "role:membro"));
    if (role) member.roles.add(role).catch(() => {});
  }
  welcomeDM(member);
  logTo(g, `📥 **Entrou:** ${member} (${member.user.tag}) · conta criada <t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`);
  scheduleCounter(g);
}

export function onLeave(member) {
  logTo(member.guild, `📤 **Saiu:** ${member.user.tag} (${member.id})`);
  scheduleCounter(member.guild);
}

const counterTimers = new Map();
/** O Discord só deixa renomear canal 2x a cada 10 min: agrupa as mudanças. */
export function scheduleCounter(guild, delay = 15_000) {
  if (counterTimers.has(guild.id)) return;
  counterTimers.set(
    guild.id,
    setTimeout(async () => {
      counterTimers.delete(guild.id);
      const c = ch(guild, "ch:contador");
      const name = `👥 Membros: ${guild.memberCount}`;
      if (c && c.name !== name) {
        await c.setName(name).catch(() => {
          counterTimers.set(guild.id, setTimeout(() => (counterTimers.delete(guild.id), scheduleCounter(guild, 0)), 6 * 60_000));
        });
      }
    }, delay),
  );
}

/* ------------------------------------------------------------------ sugestões */
function suggestionRow(id, up, down) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`vote:up:${id}`).setLabel(String(up)).setEmoji("👍").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`vote:down:${id}`).setLabel(String(down)).setEmoji("👎").setStyle(ButtonStyle.Danger),
  );
}

export async function handleSuggestionMessage(message) {
  const text = message.content.trim();
  if (text.length < 8) {
    const r = await message.reply("Escreva a sugestão com um pouco mais de detalhe (pelo menos uma frase). 🙂").catch(() => null);
    setTimeout(() => (message.delete().catch(() => {}), r?.delete().catch(() => {})), 8000);
    return;
  }
  const embed = brand()
    .setAuthor({ name: message.author.username, iconURL: message.author.displayAvatarURL() })
    .setTitle("💡 Sugestão")
    .setDescription(text.slice(0, 3800))
    .setFooter({ text: "Vote nos botões · comente no tópico" })
    .setTimestamp();
  const posted = await message.channel.send({ embeds: [embed], components: [suggestionRow("x", 0, 0)] });
  await posted.edit({ components: [suggestionRow(posted.id, 0, 0)] });
  bucket(message.guild.id, "votes")[posted.id] = { up: [], down: [], author: message.author.id };
  touch();
  await posted.startThread({ name: `💬 ${text.slice(0, 80)}`, autoArchiveDuration: 10080 }).catch(() => {});
  await message.delete().catch(() => {});
}

export async function handleVote(interaction) {
  const [, dir, id] = interaction.customId.split(":");
  const votes = bucket(interaction.guild.id, "votes");
  const v = (votes[id] ??= { up: [], down: [] });
  const uid = interaction.user.id;
  const other = dir === "up" ? "down" : "up";
  v[other] = v[other].filter((x) => x !== uid);
  if (v[dir].includes(uid)) v[dir] = v[dir].filter((x) => x !== uid);
  else v[dir].push(uid);
  touch();
  return interaction.update({ components: [suggestionRow(id, v.up.length, v.down.length)] });
}

/* ------------------------------------------------------------------ clipes */
export async function handleClip(message) {
  const hasMedia = message.attachments.size > 0 || /https?:\/\/\S+\.(mp4|mov|webm)|youtu\.?be|medal\.tv|streamable|tiktok|twitch\.tv/i.test(message.content);
  if (!hasMedia) return;
  await message.react("🔥").catch(() => {});
  await message.startThread({ name: `💬 Clipe de ${message.author.username}`.slice(0, 90), autoArchiveDuration: 4320 }).catch(() => {});
}

/* ------------------------------------------------------------------ anti-spam e anti-convite */
const recent = new Map(); // userId -> timestamps
const INVITE = /(discord\.gg|discord(app)?\.com\/invite)\/\S+/i;

/** Devolve true se a mensagem foi barrada. */
export async function automod(message) {
  const m = message.member;
  if (!m || isStaff(m)) return false;
  const g = message.guild;
  const punish = async (why, minutes) => {
    await message.delete().catch(() => {});
    if (minutes) await m.timeout(minutes * 60_000, why).catch(() => {});
    const warn = await message.channel.send({ content: `${m}, ${why}${minutes ? ` Você ficou ${minutes} min sem poder falar.` : ""}`, allowedMentions: { users: [m.id] } }).catch(() => null);
    setTimeout(() => warn?.delete().catch(() => {}), 10_000);
    logTo(g, `🛡️ **Automod** · ${m.user.tag}: ${why}${minutes ? ` (castigo ${minutes} min)` : ""} em ${message.channel}`);
    return true;
  };
  if (INVITE.test(message.content)) return punish("convites de outros servidores não são permitidos aqui.", 0);
  if (message.mentions.users.size + message.mentions.roles.size >= 6 || message.mentions.everyone) return punish("nada de marcar um monte de gente de uma vez.", 10);
  const now = Date.now();
  const list = (recent.get(m.id) ?? []).filter((t) => now - t < 8000);
  list.push(now);
  recent.set(m.id, list);
  if (list.length >= 7) {
    recent.delete(m.id);
    return punish("calma! Muitas mensagens seguidas.", 5);
  }
  return false;
}

/* ------------------------------------------------------------------ registros de mensagens */
export function onMessageDelete(message) {
  if (!message.guild || message.author?.bot || !message.content) return;
  if (message.channelId === savedId(message.guild.id, "ch:registros")) return;
  logTo(message.guild, {
    embeds: [
      new EmbedBuilder()
        .setColor(0xff4d6d)
        .setTitle("🗑️ Mensagem apagada")
        .setDescription(`**Autor:** ${message.author} · **Canal:** ${message.channel}\n\n${message.content.slice(0, 1800)}`),
    ],
  });
}

export function onMessageEdit(before, after) {
  if (!after.guild || after.author?.bot || !before.content || before.content === after.content) return;
  logTo(after.guild, {
    embeds: [
      new EmbedBuilder()
        .setColor(0xffa94d)
        .setTitle("✏️ Mensagem editada")
        .setDescription(`**Autor:** ${after.author} · ${after.url}\n\n**Antes:** ${before.content.slice(0, 900)}\n**Depois:** ${after.content.slice(0, 900)}`),
    ],
  });
}

/* ------------------------------------------------------------------ aviso de versão nova */
async function fetchJson(url) {
  const r = await fetch(url, { headers: { "User-Agent": "GoatFilterBot" } });
  if (!r.ok) throw new Error(`${url} respondeu ${r.status}`);
  return r.json();
}

/** Notas da versão no GitHub (se o repositório for público); senão, texto padrão. */
async function releaseNotes(version) {
  try {
    const rel = await fetchJson("https://api.github.com/repos/Fidelisss07/GOAT-FILTER-/releases/latest");
    if (rel?.tag_name?.replace(/^v/, "") === version && rel.body) return rel.body.slice(0, 1500);
  } catch {
    /* repositório privado ou fora do ar */
  }
  return "Abra o app: ele atualiza sozinho. Se preferir, baixe de novo pelo site.";
}

export async function announceVersion(guild, v, { force = false } = {}) {
  const d = guildData(guild.id);
  if (!force && d.lastVersion === v.version) return false;
  const first = !d.lastVersion;
  setData(guild.id, { lastVersion: v.version });
  if (first && !force) return false; // primeira leitura: só guarda, não anuncia versão velha
  const c = ch(guild, "ch:atualizacoes");
  if (!c) return false;
  const role = guild.roles.cache.get(savedId(guild.id, "role:notif:atualizacoes"));
  const embed = brand()
    .setTitle(`🆕 Goat Filter v${v.version} saiu!`)
    .setImage(config.art("atualizacoes.jpg"))
    .setDescription((await releaseNotes(v.version)) + `\n\n⬇️ ${config.siteUrl}`)
    .setTimestamp();
  await c.send({ content: role ? `${role}` : undefined, embeds: [embed], allowedMentions: { roles: role ? [role.id] : [] } });
  return true;
}

export function startVersionWatcher(client) {
  const tick = async () => {
    try {
      const v = await fetchJson(`${config.siteUrl}/download/latest.json`);
      for (const g of client.guilds.cache.values()) await announceVersion(g, v).catch((e) => console.error("[versão]", e.message));
    } catch (e) {
      console.error("[versão] não consegui ler o site:", e.message);
    }
  };
  setTimeout(tick, 20_000);
  setInterval(tick, 10 * 60_000);
}
