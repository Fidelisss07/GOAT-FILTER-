import { ActionRowBuilder, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from "discord.js";
import { config } from "./config.js";
import { logTo } from "./community.js";
import { bucket, savedId, touch } from "./store.js";

const ok = (interaction, content) => interaction.reply({ content, ephemeral: true });

async function canTarget(interaction, target) {
  if (!target) return "Membro não encontrado.";
  if (target.id === interaction.user.id) return "Você não pode fazer isso com você mesmo.";
  if (target.id === interaction.client.user.id) return "Não dá para fazer isso comigo. 🙃";
  if (!target.moderatable) return "Não consigo agir nesse membro (cargo dele é igual ou maior que o meu).";
  if (interaction.member.roles.highest.comparePositionTo(target.roles.highest) <= 0 && interaction.guild.ownerId !== interaction.user.id)
    return "Esse membro tem um cargo igual ou maior que o seu.";
  return null;
}

export async function cmdLimpar(interaction) {
  const n = interaction.options.getInteger("quantidade", true);
  const del = await interaction.channel.bulkDelete(n, true).catch(() => null);
  logTo(interaction.guild, `🧹 **${interaction.user.tag}** apagou ${del?.size ?? 0} mensagens em ${interaction.channel}`);
  return ok(interaction, `🧹 Apaguei ${del?.size ?? 0} mensagens (mensagens com mais de 14 dias o Discord não deixa apagar em massa).`);
}

export async function cmdCastigo(interaction) {
  const target = interaction.options.getMember("membro");
  const min = interaction.options.getInteger("minutos", true);
  const why = interaction.options.getString("motivo") ?? "sem motivo informado";
  const err = await canTarget(interaction, target);
  if (err) return ok(interaction, err);
  await target.timeout(min * 60_000, why);
  logTo(interaction.guild, `🔇 **Castigo** ${target.user.tag} por ${min} min · por ${interaction.user.tag} · ${why}`);
  return ok(interaction, `🔇 ${target} ficou ${min} min sem poder falar.`);
}

export async function cmdAviso(interaction) {
  const target = interaction.options.getMember("membro");
  const why = interaction.options.getString("motivo", true);
  const err = await canTarget(interaction, target);
  if (err) return ok(interaction, err);
  const warns = bucket(interaction.guild.id, "warns");
  warns[target.id] = [...(warns[target.id] ?? []), { why, by: interaction.user.id, at: Date.now() }];
  touch();
  const n = warns[target.id].length;
  await target.send(`⚠️ Você recebeu um aviso no servidor **${interaction.guild.name}**: ${why} (aviso ${n}).`).catch(() => {});
  let extra = "";
  if (n >= 3) {
    await target.timeout(60 * 60_000, "3 avisos").catch(() => {});
    extra = " Chegou a 3 avisos: castigo de 1 hora.";
  }
  logTo(interaction.guild, `⚠️ **Aviso ${n}** para ${target.user.tag} · por ${interaction.user.tag} · ${why}${extra}`);
  return ok(interaction, `⚠️ Aviso ${n} para ${target}.${extra}`);
}

export async function cmdExpulsar(interaction) {
  const target = interaction.options.getMember("membro");
  const why = interaction.options.getString("motivo") ?? "sem motivo informado";
  const err = await canTarget(interaction, target);
  if (err) return ok(interaction, err);
  await target.kick(why);
  logTo(interaction.guild, `👢 **Expulso** ${target.user.tag} · por ${interaction.user.tag} · ${why}`);
  return ok(interaction, `👢 ${target.user.tag} foi expulso.`);
}

export async function cmdBanir(interaction) {
  const target = interaction.options.getMember("membro");
  const why = interaction.options.getString("motivo") ?? "sem motivo informado";
  const err = await canTarget(interaction, target);
  if (err) return ok(interaction, err);
  await target.ban({ reason: why, deleteMessageSeconds: 24 * 3600 });
  logTo(interaction.guild, `🔨 **Banido** ${target.user.tag} · por ${interaction.user.tag} · ${why}`);
  return ok(interaction, `🔨 ${target.user.tag} foi banido.`);
}

/** /anunciar: abre um formulário e posta em #anúncios. */
export async function cmdAnunciar(interaction) {
  const ping = interaction.options.getString("marcar") ?? "nada";
  const modal = new ModalBuilder().setCustomId(`announce:${ping}`).setTitle("Novo anúncio");
  modal.addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("titulo").setLabel("Título").setStyle(TextInputStyle.Short).setMaxLength(200).setRequired(true)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("texto").setLabel("Texto").setStyle(TextInputStyle.Paragraph).setMaxLength(3500).setRequired(true)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("imagem").setLabel("Link de imagem (opcional)").setStyle(TextInputStyle.Short).setRequired(false)),
  );
  return interaction.showModal(modal);
}

export async function handleAnnounceModal(interaction) {
  const ping = interaction.customId.split(":")[1];
  const c = interaction.guild.channels.cache.get(savedId(interaction.guild.id, "ch:anuncios"));
  if (!c) return ok(interaction, "Canal de anúncios não encontrado. Rode /configurar.");
  const embed = new EmbedBuilder()
    .setColor(config.brand.color)
    .setTitle(interaction.fields.getTextInputValue("titulo"))
    .setDescription(interaction.fields.getTextInputValue("texto"))
    .setAuthor({ name: interaction.user.username, iconURL: interaction.user.displayAvatarURL() })
    .setTimestamp();
  const img = interaction.fields.getTextInputValue("imagem")?.trim();
  if (img && /^https?:\/\//.test(img)) embed.setImage(img);
  let content;
  const allowed = { parse: [], roles: [] };
  if (ping === "todos") {
    content = "@everyone";
    allowed.parse = ["everyone"];
  } else if (ping !== "nada") {
    const role = interaction.guild.roles.cache.get(savedId(interaction.guild.id, `role:${ping}`));
    if (role) {
      content = `${role}`;
      allowed.roles = [role.id];
    }
  }
  const m = await c.send({ content, embeds: [embed], allowedMentions: allowed });
  if (c.type === 5) await m.crosspost().catch(() => {}); // canal de anúncios "seguível"
  logTo(interaction.guild, `📢 **${interaction.user.tag}** postou um anúncio: ${m.url}`);
  return ok(interaction, `📢 Anúncio postado em ${c}.`);
}
