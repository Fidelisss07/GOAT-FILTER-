import { ChannelType, EmbedBuilder, PermissionFlagsBits } from "discord.js";
import { config } from "./config.js";
import { guildSettings, NAMES, saveGuild } from "./store.js";
import { panelComponents } from "./tickets.js";

/**
 * /configurar: cria (ou reaproveita, se já existirem) o cargo da equipe, a
 * categoria dos tickets e os canais de suporte, registros e boas-vindas.
 * Pode rodar de novo sem duplicar nada.
 */
export async function runSetup(interaction) {
  const guild = interaction.guild;
  const me = guild.members.me;
  if (!me.permissions.has(PermissionFlagsBits.ManageChannels) || !me.permissions.has(PermissionFlagsBits.ManageRoles)) {
    return interaction.reply({
      content: "Preciso das permissões **Gerenciar Canais** e **Gerenciar Cargos** para configurar. Ajuste o cargo do bot e rode de novo.",
      ephemeral: true,
    });
  }
  await interaction.deferReply({ ephemeral: true });
  await guild.channels.fetch();
  await guild.roles.fetch();

  const done = [];
  const findText = (name) => guild.channels.cache.find((c) => c.type === ChannelType.GuildText && c.name === name);

  // Cargo da equipe.
  let role = guild.roles.cache.find((r) => r.name === NAMES.role);
  if (!role) {
    role = await guild.roles.create({ name: NAMES.role, color: config.brand.color, mentionable: true, reason: "Goat Filter: equipe de suporte" });
    done.push(`cargo ${role}`);
  }

  const everyone = guild.roles.everyone.id;
  const bot = me.id;
  const staffOnly = [
    { id: everyone, deny: [PermissionFlagsBits.ViewChannel] },
    { id: role.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
    { id: bot, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.AttachFiles] },
  ];
  const readOnly = [
    { id: everyone, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory], deny: [PermissionFlagsBits.SendMessages] },
    { id: bot, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks] },
  ];

  // Categoria dos tickets (só a equipe vê; cada ticket libera o dono).
  let category = guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name === NAMES.category);
  if (!category) {
    category = await guild.channels.create({ name: NAMES.category, type: ChannelType.GuildCategory, permissionOverwrites: staffOnly });
    done.push(`categoria **${NAMES.category}**`);
  }

  // Canais.
  let support = findText(NAMES.support);
  if (!support) {
    support = await guild.channels.create({ name: NAMES.support, type: ChannelType.GuildText, topic: "Abra um ticket no menu abaixo.", permissionOverwrites: readOnly });
    done.push(`canal ${support}`);
  }
  let logs = findText(NAMES.logs);
  if (!logs) {
    logs = await guild.channels.create({ name: NAMES.logs, type: ChannelType.GuildText, topic: "Registros do bot: tickets e erros.", permissionOverwrites: staffOnly });
    done.push(`canal ${logs}`);
  }
  let welcome = findText(NAMES.welcome);
  if (!welcome) {
    welcome = await guild.channels.create({ name: NAMES.welcome, type: ChannelType.GuildText, permissionOverwrites: readOnly });
    done.push(`canal ${welcome}`);
  }

  saveGuild(guild.id, {
    staffRoleId: role.id,
    ticketCategoryId: category.id,
    supportChannelId: support.id,
    logChannelId: logs.id,
    welcomeChannelId: welcome.id,
  });

  // Painel de tickets no canal de suporte (só se ainda não houver um do bot).
  const recent = await support.messages.fetch({ limit: 20 }).catch(() => null);
  const hasPanel = recent?.some((m) => m.author.id === bot && m.components?.length);
  if (!hasPanel) {
    await support.send(panelComponents());
    done.push("painel de tickets");
  }

  const s = guildSettings(guild);
  const embed = new EmbedBuilder()
    .setColor(config.brand.color)
    .setTitle("✅ Goat Filter configurado")
    .setDescription(
      (done.length ? `Criei: ${done.join(", ")}.\n\n` : "Tudo já estava criado; nada foi duplicado.\n\n") +
        `• Suporte: <#${s.supportChannelId}>\n• Registros: <#${s.logChannelId}>\n• Boas-vindas: <#${s.welcomeChannelId}>\n• Equipe: <@&${s.staffRoleId}>\n\n` +
        `Agora dê o cargo **${NAMES.role}** para quem vai atender os tickets.`,
    );
  return interaction.editReply({ embeds: [embed] });
}
