import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  Partials,
  StringSelectMenuBuilder,
} from "discord.js";
import { config } from "./config.js";
import { FAQ, faqById, matchFaq } from "./faq.js";
import {
  handleClosePrompt,
  handleCloseCancel,
  handleCloseConfirm,
  handleModalSubmit,
  handleOpenSelect,
  panelComponents,
} from "./tickets.js";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

/* ----------------------------------------------------------------- registros */
const log = {
  async send(content, files = []) {
    if (!config.logChannelId) return;
    try {
      const ch = await client.channels.fetch(config.logChannelId);
      await ch.send({ content, files });
    } catch {
      /* canal de log indisponível: não trava o bot */
    }
  },
  ticket(msg, files = []) {
    return this.send(msg, files);
  },
  error(msg, err) {
    console.error(msg, err);
    return this.send(`⚠️ **${msg}**\n\`\`\`${String(err?.stack || err).slice(0, 1600)}\`\`\``);
  },
};

const brandEmbed = () => new EmbedBuilder().setColor(config.brand.color);

/* ------------------------------------------------------------------- helpers */
async function latestVersion() {
  const res = await fetch(`${config.siteUrl}/download/latest.json`, { cache: "no-store" });
  if (!res.ok) throw new Error(`site respondeu ${res.status}`);
  return res.json(); // { version, file, sha256, size }
}

function faqMenuEmbed() {
  const embed = brandEmbed()
    .setTitle("❓ Ajuda rápida · Goat Filter")
    .setDescription("Escolha a sua dúvida no menu abaixo. Se não resolver, abra um ticket no canal de suporte.");
  const menu = new StringSelectMenuBuilder()
    .setCustomId("faq_pick")
    .setPlaceholder("Escolha a sua dúvida…")
    .addOptions(FAQ.map((f) => ({ label: f.title.slice(0, 95), value: f.id, emoji: f.emoji })));
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)], ephemeral: true };
}

function faqAnswerEmbed(item) {
  return brandEmbed().setTitle(`${item.emoji} ${item.title}`).setDescription(item.answer);
}

/* --------------------------------------------------------------------- ready */
client.once(Events.ClientReady, (c) => {
  console.log(`✅ Bot online como ${c.user.tag}`);
  c.user.setPresence({ activities: [{ name: "goatfilter.xyz", type: 3 }], status: "online" }); // type 3 = Watching
});

/* ------------------------------------------------------------ boas-vindas */
client.on(Events.GuildMemberAdd, async (member) => {
  if (!config.welcomeChannelId) return;
  try {
    const ch = await member.guild.channels.fetch(config.welcomeChannelId);
    const embed = brandEmbed()
      .setTitle(`Bem-vindo, ${member.user.username}! 🐐`)
      .setDescription(
        `Esse é o servidor do **Goat Filter**.\n\n` +
          `• Dúvidas? Use **/ajuda**.\n` +
          `• Problema? Abra um ticket no canal de suporte.\n` +
          `• Baixe o app em ${config.siteUrl}`,
      );
    await ch.send({ content: `${member}`, embeds: [embed] });
  } catch (err) {
    log.error("Falha nas boas-vindas", err);
  }
});

/* ------------------------------------------------------------ interações */
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    // Comandos de barra
    if (interaction.isChatInputCommand()) {
      const name = interaction.commandName;
      if (name === "ajuda") return interaction.reply(faqMenuEmbed());
      if (name === "faq") return interaction.reply({ embeds: [faqAnswerEmbed(faqById(interaction.options.getString("assunto")))], ephemeral: true });
      if (name === "baixar")
        return interaction.reply({
          embeds: [brandEmbed().setTitle("⬇️ Baixar o Goat Filter").setDescription(`Grátis, Windows 10 e 11:\n${config.siteUrl}`)],
        });
      if (name === "versao") {
        await interaction.deferReply();
        try {
          const v = await latestVersion();
          return interaction.editReply({
            embeds: [brandEmbed().setTitle("📦 Versão mais nova").setDescription(`**v${v.version}**\nBaixe em ${config.siteUrl}`)],
          });
        } catch (err) {
          return interaction.editReply("Não consegui consultar a versão agora. Tente de novo em instantes.");
        }
      }
      if (name === "painel") {
        await interaction.channel.send(panelComponents());
        return interaction.reply({ content: "Painel publicado neste canal. ✅", ephemeral: true });
      }
      return;
    }

    // Menus de seleção
    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === "ticket_open") return handleOpenSelect(interaction);
      if (interaction.customId === "faq_pick") return interaction.update({ embeds: [faqAnswerEmbed(faqById(interaction.values[0]))], components: [] });
      return;
    }

    // Modais
    if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith("ticket_modal:")) return handleModalSubmit(interaction, log);
      return;
    }

    // Botões
    if (interaction.isButton()) {
      if (interaction.customId === "ticket_close") return handleClosePrompt(interaction);
      if (interaction.customId === "ticket_close_confirm") return handleCloseConfirm(interaction, log);
      if (interaction.customId === "ticket_close_cancel") return handleCloseCancel(interaction);
      return;
    }
  } catch (err) {
    log.error("Erro ao tratar interação", err);
    // Tenta avisar a pessoa sem quebrar.
    const msg = { content: "Deu um erro aqui. Já registrei para a equipe — tente de novo.", ephemeral: true };
    if (interaction.deferred || interaction.replied) interaction.followUp(msg).catch(() => {});
    else interaction.reply(msg).catch(() => {});
  }
});

/* ------------------------------------------------ ajuda automática no chat */
const cooldown = new Map(); // userId -> timestamp, para não responder demais
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot || !message.guild) return;
  if (message.channel.topic?.startsWith("ticket|")) return; // dentro de ticket a equipe cuida
  const item = matchFaq(message.content);
  if (!item) return;
  const last = cooldown.get(message.author.id) || 0;
  if (Date.now() - last < 60_000) return;
  cooldown.set(message.author.id, Date.now());
  try {
    await message.reply({
      embeds: [faqAnswerEmbed(item).setFooter({ text: "Resposta automática · use /ajuda para ver tudo" })],
      allowedMentions: { repliedUser: false },
    });
  } catch {
    /* sem permissão de responder: ignora */
  }
});

/* --------------------------------------------- confiabilidade / erros globais */
client.on(Events.Error, (err) => log.error("Erro do cliente Discord", err));
client.on(Events.ShardError, (err) => log.error("Erro de conexão (shard)", err));
process.on("unhandledRejection", (err) => log.error("Promessa rejeitada sem tratamento", err));
process.on("uncaughtException", (err) => log.error("Exceção não capturada", err));

client.login(config.token).catch((err) => {
  console.error("Não consegui conectar. Confira o DISCORD_TOKEN no .env.", err);
  process.exit(1);
});
