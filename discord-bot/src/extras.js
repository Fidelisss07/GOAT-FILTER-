import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder } from "discord.js";
import { config } from "./config.js";

const brand = () => new EmbedBuilder().setColor(config.brand.color);

/* ------------------------------------------------------------------ #dúvidas em tópicos */
export async function handleQuestion(message) {
  const title = message.content.replace(/\s+/g, " ").trim().slice(0, 80) || "Dúvida";
  const thread = await message.startThread({ name: `❓ ${title}`, autoArchiveDuration: 1440 }).catch(() => null);
  if (!thread) return null;
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`solved:${message.author.id}`).setLabel("Resolvido").setEmoji("✅").setStyle(ButtonStyle.Success),
  );
  await thread.send({
    content: `${message.author}, sua dúvida virou este tópico. Quem souber responde aqui. Quando resolver, clique em **Resolvido**.`,
    components: [row],
  });
  return thread;
}

export async function handleSolved(interaction) {
  const owner = interaction.customId.split(":")[1];
  const staff = interaction.member?.permissions.has("ManageMessages");
  if (interaction.user.id !== owner && !staff) return interaction.reply({ content: "Só quem perguntou (ou a equipe) pode marcar como resolvido.", ephemeral: true });
  const thread = interaction.channel;
  await interaction.update({ content: `✅ Resolvido por ${interaction.user}.`, components: [] });
  if (thread?.type === ChannelType.PublicThread) {
    await thread.setName(`✅ ${thread.name.replace(/^❓\s*/, "")}`.slice(0, 100)).catch(() => {});
    await thread.setLocked(true).catch(() => {});
    await thread.setArchived(true).catch(() => {});
  }
}

/* ------------------------------------------------------------------ boas-vindas por mensagem direta */
export async function welcomeDM(member) {
  const embed = brand()
    .setTitle("🐐 Bem-vindo à comunidade Goat Filter!")
    .setImage(config.art("bemvindo.jpg"))
    .setDescription(
      `Valeu por entrar no servidor **${member.guild.name}**. Guia rápido:\n\n` +
        "**1.** Aceite as regras no canal 📜・regras para liberar o servidor\n" +
        `**2.** Baixe o app (grátis): ${config.siteUrl}\n` +
        "**3.** Escolha seu elo e os avisos em 🎭・cargos\n" +
        "**4.** Problema com o app? Abra um ticket em 🎫・abrir-ticket\n\n" +
        "Comandos úteis no servidor: `/ajuda`, `/faq` e `/baixar`.",
    );
  await member.send({ embeds: [embed] }).catch(() => {}); // DM fechada: ignora
}
