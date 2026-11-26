import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { config } from "./config.js";
import { guildSettings } from "./store.js";

const CATEGORIES = {
  suporte: { label: "Suporte geral", emoji: "💬", desc: "Dúvidas de uso, instalação, configuração." },
  bug: { label: "Erro / bug", emoji: "🐞", desc: "Algo quebrou, travou ou deu erro." },
  pagamento: { label: "Pagamento / Pro", emoji: "💜", desc: "Assinatura, cobrança, acesso ao Pro." },
  sugestao: { label: "Sugestão", emoji: "💡", desc: "Ideia ou pedido de recurso." },
};

/** Embed + menu que fica fixo no canal de abrir ticket. */
export function panelComponents() {
  const embed = new EmbedBuilder()
    .setColor(config.brand.color)
    .setTitle("🎫 Central de Suporte · Goat Filter")
    .setDescription(
      "Precisa de ajuda? Abra um ticket e a equipe fala com você **em particular**.\n\n" +
        "Escolha o assunto no menu abaixo. Antes, dá uma olhada se a sua dúvida já não está respondida com **/ajuda**.",
    )
    .setFooter({ text: "Goat Filter · suporte" });

  const menu = new StringSelectMenuBuilder()
    .setCustomId("ticket_open")
    .setPlaceholder("Abrir um ticket…")
    .addOptions(
      Object.entries(CATEGORIES).map(([value, c]) => ({
        label: c.label,
        value,
        emoji: c.emoji,
        description: c.desc,
      })),
    );

  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] };
}

/** Já existe um ticket aberto desse usuário? Marcamos pelo `topic` do canal. */
function existingTicket(guild, userId) {
  return guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildText && c.topic === `ticket|${userId}`,
  );
}

/** Seleção do assunto -> abre um modal para a pessoa descrever. */
export async function handleOpenSelect(interaction) {
  const category = interaction.values[0];
  const existing = existingTicket(interaction.guild, interaction.user.id);
  if (existing) {
    return interaction.reply({ content: `Você já tem um ticket aberto: ${existing}.`, ephemeral: true });
  }
  const modal = new ModalBuilder().setCustomId(`ticket_modal:${category}`).setTitle("Abrir ticket");
  const input = new TextInputBuilder()
    .setCustomId("descricao")
    .setLabel("Conte o que está acontecendo")
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder("Ex.: o Windows bloqueou a instalação / o vibrance não aplica…")
    .setMinLength(5)
    .setMaxLength(900)
    .setRequired(true);
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  await interaction.showModal(modal);
}

/** Envio do modal -> cria o canal privado do ticket. */
export async function handleModalSubmit(interaction, log) {
  const category = interaction.customId.split(":")[1];
  const cat = CATEGORIES[category] || CATEGORIES.suporte;
  const descricao = interaction.fields.getTextInputValue("descricao");

  const existing = existingTicket(interaction.guild, interaction.user.id);
  if (existing) {
    return interaction.reply({ content: `Você já tem um ticket aberto: ${existing}.`, ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });
  const gs = guildSettings(interaction.guild);

  const overwrites = [
    { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: interaction.user.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.ReadMessageHistory],
    },
    { id: interaction.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels] },
  ];
  if (gs.staffRoleId) {
    overwrites.push({
      id: gs.staffRoleId,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.ReadMessageHistory],
    });
  }

  let channel;
  try {
    channel = await interaction.guild.channels.create({
      name: `${cat.emoji}ticket-${interaction.user.username}`.slice(0, 95),
      type: ChannelType.GuildText,
      parent: gs.ticketCategoryId || undefined,
      topic: `ticket|${interaction.user.id}`,
      permissionOverwrites: overwrites,
    });
  } catch (err) {
    log?.error("Não consegui criar o canal do ticket", err);
    return interaction.editReply(
      "Não consegui criar o seu ticket. Avise a equipe que faltou permissão **Gerenciar Canais** para o bot.",
    );
  }

  const embed = new EmbedBuilder()
    .setColor(config.brand.color)
    .setAuthor({ name: `${interaction.user.tag}`, iconURL: interaction.user.displayAvatarURL() })
    .setTitle(`${cat.emoji} ${cat.label}`)
    .setDescription(descricao)
    .setFooter({ text: "Para encerrar, use o botão abaixo." })
    .setTimestamp();

  const closeRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("ticket_close").setLabel("Fechar ticket").setEmoji("🔒").setStyle(ButtonStyle.Danger),
  );

  const mention = gs.staffRoleId ? `<@&${gs.staffRoleId}>` : "";
  await channel.send({
    content: `${interaction.user} ${mention}`.trim(),
    embeds: [embed],
    components: [closeRow],
  });

  await interaction.editReply(`Pronto! Seu ticket foi aberto em ${channel}.`);
  log?.ticket(`🎫 Ticket aberto por **${interaction.user.tag}** — ${cat.label} (${channel})`);
}

/** Botão fechar -> pede confirmação. */
export async function handleClosePrompt(interaction) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("ticket_close_confirm").setLabel("Confirmar e fechar").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("ticket_close_cancel").setLabel("Cancelar").setStyle(ButtonStyle.Secondary),
  );
  await interaction.reply({ content: "Tem certeza que quer fechar este ticket?", components: [row], ephemeral: true });
}

export async function handleCloseCancel(interaction) {
  await interaction.update({ content: "Ok, o ticket continua aberto.", components: [] });
}

/** Confirmou -> gera transcrição, manda pro log e apaga o canal. */
export async function handleCloseConfirm(interaction, log) {
  const channel = interaction.channel;
  if (!channel?.topic?.startsWith("ticket|")) {
    return interaction.reply({ content: "Isto não é um canal de ticket.", ephemeral: true });
  }
  await interaction.update({ content: "Fechando o ticket e salvando a conversa…", components: [] });

  const transcript = await buildTranscript(channel);
  const ownerId = channel.topic.split("|")[1];
  await log?.ticket(
    `🔒 Ticket fechado por **${interaction.user.tag}** (dono: <@${ownerId}>).`,
    transcript ? [{ attachment: Buffer.from(transcript, "utf8"), name: `${channel.name}.txt` }] : [],
  );

  setTimeout(() => channel.delete().catch(() => {}), 4000);
}

/** Junta as mensagens do canal num texto simples para arquivar. */
async function buildTranscript(channel) {
  try {
    const all = [];
    let before;
    for (let i = 0; i < 10; i++) {
      const batch = await channel.messages.fetch({ limit: 100, before });
      if (batch.size === 0) break;
      all.push(...batch.values());
      before = batch.last().id;
      if (batch.size < 100) break;
    }
    all.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
    const lines = all.map((m) => {
      const when = new Date(m.createdTimestamp).toISOString().replace("T", " ").slice(0, 19);
      const content = m.content || (m.embeds.length ? `[embed] ${m.embeds[0].description ?? ""}` : "");
      const files = m.attachments.size ? ` [anexos: ${[...m.attachments.values()].map((a) => a.name).join(", ")}]` : "";
      return `[${when}] ${m.author.tag}: ${content}${files}`;
    });
    return `Transcrição do ticket ${channel.name}\n\n${lines.join("\n")}\n`;
  } catch {
    return null;
  }
}
