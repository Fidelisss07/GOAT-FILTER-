import { ChannelType, EmbedBuilder, PermissionFlagsBits as P } from "discord.js";
import { config } from "./config.js";
import { LAYOUT, ROLES, STAFF } from "./layout.js";
import { downloadPanel, rolesPanel, rulesPanel, welcomeIntro } from "./panels.js";
import { guildData, savedId, saveId, setData } from "./store.js";
import { panelComponents } from "./tickets.js";

const MARK = (k) => `goat:${k}`; // rodapé que marca as mensagens fixas do bot

/** Acha um cargo pelo ID salvo ou pelo nome; cria se não existir. */
async function ensureRole(guild, spec, report) {
  let role = guild.roles.cache.get(savedId(guild.id, `role:${spec.key}`)) || guild.roles.cache.find((r) => r.name === spec.name);
  const data = {
    name: spec.name,
    color: spec.color ?? 0,
    hoist: !!spec.hoist,
    mentionable: !!spec.mentionable || !!spec.notify,
    permissions: spec.perms ?? [],
  };
  // Sem Administrador, o bot só pode dar ao cargo as permissões que ele mesmo tem.
  const mine = guild.members.me.permissions;
  data.permissions = data.permissions.filter((p) => mine.has(p));
  try {
    if (!role) {
      role = await guild.roles.create({ ...data, reason: "Goat Filter: montagem do servidor" });
      report.created.push(`cargo **${spec.name}**`);
    } else if (role.editable) {
      await role.edit(data).catch((e) => report.warn.push(`cargo ${spec.name}: ${e.message}`));
    }
  } catch (e) {
    report.warn.push(`não consegui criar o cargo ${spec.name}: ${e.message}`);
    return null;
  }
  saveId(guild.id, `role:${spec.key}`, role.id);
  return role;
}

/** Permissões de cada modo de canal. */
function overwrites(guild, mode, roles, gate) {
  const everyone = guild.roles.everyone.id;
  const me = guild.members.me.id;
  const member = roles.membro?.id ?? everyone;
  const staff = STAFF.map((k) => roles[k]?.id).filter(Boolean);
  const view = [P.ViewChannel, P.ReadMessageHistory];
  const talk = [P.SendMessages, P.AddReactions, P.AttachFiles, P.EmbedLinks, P.CreatePublicThreads, P.SendMessagesInThreads, P.UseApplicationCommands];
  const voice = [P.Connect, P.Speak, P.Stream, P.UseVAD];
  const bot = { id: me, allow: [...view, ...talk, P.ManageChannels, P.ManageMessages, P.ManageThreads, P.Connect, P.ManageRoles] };
  const staffFull = staff.map((id) => ({ id, allow: [...view, ...talk, P.ManageMessages, P.ManageThreads, ...voice] }));
  // Antes de aceitar as regras: o @everyone não vê; com a verificação desligada, vê tudo.
  const memberView = gate ? [{ id: everyone, deny: [P.ViewChannel] }, { id: member, allow: view }] : [{ id: everyone, allow: view }];
  switch (mode) {
    case "portaria":
      return [{ id: everyone, allow: view, deny: [P.SendMessages, P.AddReactions, P.CreatePublicThreads] }, bot, ...staffFull];
    case "leitura":
      return [...memberView.map((o) => ({ ...o, deny: [...(o.deny ?? []), P.SendMessages, P.CreatePublicThreads] })), bot, ...staffFull];
    case "publico":
      return [...memberView.map((o) => (o.allow ? { ...o, allow: [...o.allow, ...talk] } : o)), bot, ...staffFull];
    case "voz":
      return [...memberView.map((o) => (o.allow ? { ...o, allow: [...o.allow, ...voice] } : o)), bot, ...staffFull];
    case "contador":
      return [{ id: everyone, allow: [P.ViewChannel], deny: [P.Connect] }, bot];
    case "equipe":
    default:
      return [{ id: everyone, deny: [P.ViewChannel] }, bot, ...staffFull];
  }
}

async function ensureCategory(guild, spec, report) {
  let cat =
    guild.channels.cache.get(savedId(guild.id, spec.key)) ||
    guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && [spec.name, ...(spec.aliases ?? [])].includes(c.name));
  if (!cat) {
    try {
      cat = await guild.channels.create({ name: spec.name, type: ChannelType.GuildCategory });
      report.created.push(`categoria **${spec.name}**`);
    } catch (e) {
      report.warn.push(`não consegui criar a categoria ${spec.name}: ${e.message}`);
      return null;
    }
  } else if (cat.name !== spec.name) {
    await cat.setName(spec.name).catch(() => {});
  }
  saveId(guild.id, spec.key, cat.id);
  return cat;
}

async function ensureChannel(guild, spec, parent, roles, gate, report) {
  const type = spec.type === "voice" ? ChannelType.GuildVoice : ChannelType.GuildText;
  const legacy = guildData(guild.id);
  const legacyId = { "ch:boas-vindas": legacy.welcomeChannelId, "ch:registros": legacy.logChannelId, "ch:abrir-ticket": legacy.supportChannelId }[spec.key];
  let ch =
    guild.channels.cache.get(savedId(guild.id, spec.key)) ||
    (legacyId && guild.channels.cache.get(legacyId)) ||
    guild.channels.cache.find((c) => c.type === type && (c.name === spec.name || (spec.aliases ?? []).includes(c.name)));
  const opts = {
    name: spec.name,
    type,
    parent: parent?.id,
    permissionOverwrites: overwrites(guild, spec.mode, roles, gate),
    ...(type === ChannelType.GuildText ? { topic: spec.topic ?? null, rateLimitPerUser: spec.slowmode ?? 0 } : {}),
    ...(spec.limit ? { userLimit: spec.limit } : {}),
  };
  if (!ch) {
    try {
      ch = await guild.channels.create(opts);
      report.created.push(`${type === ChannelType.GuildVoice ? "voz" : "canal"} ${ch}`);
    } catch (e) {
      report.warn.push(`não consegui criar ${spec.name}: ${e.message}`);
      return null;
    }
  } else {
    const { type: _t, ...edit } = opts;
    if (spec.mode === "contador") delete edit.name; // o nome é o contador
    await ch.edit(edit).catch((e) => report.warn.push(`não consegui ajustar ${ch}: ${e.message}`));
  }
  saveId(guild.id, spec.key, ch.id);
  return ch;
}

/** Posta (ou atualiza) uma mensagem fixa do bot, marcada pelo rodapé. */
async function ensurePinned(channel, key, payload, report) {
  if (!channel) return null;
  try {
    return await postPinned(channel, key, payload, report);
  } catch (e) {
    report.warn.push(`mensagem fixa em ${channel}: ${e.message}`);
    return null;
  }
}

async function postPinned(channel, key, payload, report) {
  const msgs = await channel.messages.fetch({ limit: 30 }).catch(() => null);
  const mine = msgs?.find((m) => m.author.id === channel.client.user.id && m.embeds[0]?.footer?.text?.includes(MARK(key)));
  payload.embeds?.forEach((e) => e.setFooter({ text: `Goat Filter · ${MARK(key)}` }));
  if (mine) {
    await mine.edit(payload).catch(() => {});
    return mine;
  }
  const m = await channel.send(payload);
  await m.pin().catch(() => {});
  report.created.push(`mensagem fixa em ${channel}`);
  return m;
}

/**
 * Monta o servidor inteiro. `gate` = verificação por regras; `cleanup` = apaga os
 * canais padrão do Discord ("geral", "Geral" e suas categorias) se estiverem vazios.
 */
export async function buildServer(guild, { gate = true, cleanup = false } = {}, progress = async () => {}) {
  const report = { created: [], warn: [] };
  await guild.channels.fetch();
  await guild.roles.fetch();

  await progress("Criando cargos…");
  const roles = {};
  for (const spec of ROLES) roles[spec.key] = await ensureRole(guild, spec, report);
  // Ordem dos cargos: logo abaixo do cargo do bot, na ordem da lista.
  const top = guild.members.me.roles.highest.position;
  const positions = ROLES.filter((spec) => roles[spec.key])
    .map((spec, i) => ({ role: roles[spec.key].id, position: Math.max(1, top - 1 - i) }))
    .filter((p) => guild.roles.cache.get(p.role)?.editable);
  await guild.roles.setPositions(positions).catch((e) => report.warn.push(`ordem dos cargos: ${e.message}`));

  await progress("Criando categorias e canais…");
  const channels = {};
  for (const cat of LAYOUT) {
    const parent = await ensureCategory(guild, cat, report);
    if (cat.ticketCategory && parent) {
      await parent.edit({ permissionOverwrites: overwrites(guild, "equipe", roles, gate) }).catch(() => {});
    }
    for (const spec of cat.channels) channels[spec.key] = await ensureChannel(guild, spec, parent, roles, gate, report);
  }
  // Ordem das categorias: as do Goat Filter primeiro.
  await guild.channels
    .setPositions(LAYOUT.map((c, i) => ({ channel: savedId(guild.id, c.key), position: i })))
    .catch(() => {});

  if (cleanup) {
    await progress("Removendo os canais padrão do Discord…");
    const defaults = guild.channels.cache.filter(
      (c) =>
        (c.type === ChannelType.GuildText && c.name === "geral") ||
        (c.type === ChannelType.GuildVoice && c.name === "Geral") ||
        (c.type === ChannelType.GuildText && c.name === "general") ||
        (c.type === ChannelType.GuildVoice && c.name === "General"),
    );
    for (const c of defaults.values()) await c.delete("Goat Filter: troca pelos canais da comunidade").catch(() => {});
    for (const name of ["Canais de Texto", "Canais de Voz", "Text Channels", "Voice Channels"]) {
      const cat = guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name === name);
      if (cat && guild.channels.cache.filter((c) => c.parentId === cat.id).size === 0) await cat.delete().catch(() => {});
    }
  }

  await progress("Postando regras, download, cargos e painel de tickets…");
  await ensurePinned(channels["ch:regras"], "regras", rulesPanel(gate), report);
  await ensurePinned(channels["ch:baixar"], "baixar", downloadPanel(), report);
  await ensurePinned(channels["ch:cargos"], "cargos", rolesPanel(), report);
  await ensurePinned(channels["ch:boas-vindas"], "intro", welcomeIntro(channels), report);
  await ensurePinned(channels["ch:abrir-ticket"], "tickets", panelComponents(), report);

  // Canal do sistema do Discord (mensagens automáticas de entrada) -> boas-vindas do bot cuida disso.
  await guild.setSystemChannel(null).catch(() => {});
  setData(guild.id, { gate, builtAt: Date.now() });

  // Quem já está no servidor (fora bots) recebe "Membro" para não perder o acesso.
  if (gate) {
    await progress("Liberando quem já está no servidor…");
    const members = await guild.members.fetch().catch(() => null);
    if (roles.membro)
      for (const m of members?.values() ?? []) if (!m.user.bot && !m.roles.cache.has(roles.membro.id)) await m.roles.add(roles.membro).catch(() => {});
  }
  return { report, roles, channels };
}

export function buildSummary(guild, { report, roles, channels }, gate) {
  const lines = [
    `**Canais:** ${["ch:regras", "ch:anuncios", "ch:atualizacoes", "ch:baixar", "ch:cargos", "ch:geral", "ch:clipes", "ch:sugestoes", "ch:duvidas", "ch:abrir-ticket", "ch:registros"].map((k) => channels[k]).filter(Boolean).join(" · ")}`,
    `**Cargos da equipe:** ${[roles.admin, roles.mod, roles.equipe].filter(Boolean).join(" ")}`,
    gate
      ? `**Verificação ligada:** quem entrar só vê ${channels["ch:regras"]} até clicar em *Aceitar*. Quem já estava aqui ganhou ${roles.membro}.`
      : "**Verificação desligada:** todo mundo vê tudo ao entrar.",
    report.created.length ? `\n**Criado agora (${report.created.length}):** ${report.created.slice(0, 25).join(", ")}${report.created.length > 25 ? "…" : ""}` : "\nNada novo para criar: tudo já existia e foi ajustado.",
    report.warn.length ? `\n⚠️ ${report.warn.slice(0, 5).join("\n⚠️ ")}` : "",
    `\n**Falta você:** dar os cargos da equipe para quem vai ajudar (Configurações › Membros).`,
  ];
  return new EmbedBuilder().setColor(config.brand.color).setTitle("✅ Servidor da comunidade montado").setDescription(lines.join("\n").slice(0, 4000));
}
