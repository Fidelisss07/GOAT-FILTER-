import {
  ActionRowBuilder,
  ActivityType,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  Partials,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
} from "discord.js";
import { buildServer, buildSummary } from "./build.js";
import { registerGuildCommands } from "./commands.js";
import {
  announceVersion,
  automod,
  handleClip,
  handleSuggestionMessage,
  handleVote,
  logTo,
  onJoin,
  onLeave,
  onMessageDelete,
  onMessageEdit,
  scheduleCounter,
  startVersionWatcher,
} from "./community.js";
import { config } from "./config.js";
import { FAQ, faqById, matchFaq } from "./faq.js";
import { cmdAnunciar, cmdAviso, cmdBanir, cmdCastigo, cmdExpulsar, cmdLimpar, handleAnnounceModal } from "./moderation.js";
import { handleRankSelect, handleRoleToggle, handleVerify } from "./panels.js";
import { savedId } from "./store.js";
import {
  handleCloseCancel,
  handleCloseConfirm,
  handleClosePrompt,
  handleModalSubmit,
  handleOpenSelect,
  panelComponents,
} from "./tickets.js";

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel, Partials.Message],
});

/* ------------------------------------------------------------------ registros (para os tickets) */
function logFor(guild) {
  return {
    send: (content, files = []) => logTo(guild, { content, files }),
    ticket: (content, files = []) => logTo(guild, { content, files }),
    error(msg, err) {
      console.error(msg, err);
      logTo(guild, `⚠️ **${msg}**\n\`\`\`${String(err?.stack || err).slice(0, 1600)}\`\`\``);
    },
  };
}
function logAll(msg, err) {
  console.error(msg, err);
  for (const g of client.guilds.cache.values()) logFor(g).error(msg, err);
}

const brandEmbed = () => new EmbedBuilder().setColor(config.brand.color);

async function latestVersion() {
  const res = await fetch(`${config.siteUrl}/download/latest.json`, { cache: "no-store" });
  if (!res.ok) throw new Error(`site respondeu ${res.status}`);
  return res.json(); // { version, file, sha256, size }
}

function faqMenu() {
  const embed = brandEmbed()
    .setTitle("❓ Ajuda rápida · Goat Filter")
    .setDescription("Escolha a sua dúvida no menu abaixo. Se não resolver, abra um ticket.");
  const menu = new StringSelectMenuBuilder()
    .setCustomId("faq_pick")
    .setPlaceholder("Escolha a sua dúvida…")
    .addOptions(FAQ.map((f) => ({ label: f.title.slice(0, 95), value: f.id, emoji: f.emoji })));
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)], ephemeral: true };
}
const faqAnswer = (item) => brandEmbed().setTitle(`${item.emoji} ${item.title}`).setDescription(item.answer);

/* ------------------------------------------------------------------ ligar */
async function registerIn(guild) {
  try {
    await registerGuildCommands(guild.id);
    console.log(`Comandos registrados em ${guild.name}`);
  } catch (err) {
    console.error(`Não consegui registrar os comandos em ${guild.name}:`, err.message);
  }
}

client.once(Events.ClientReady, (c) => {
  console.log(`✅ Bot online como ${c.user.tag} em ${c.guilds.cache.size} servidor(es)`);
  c.user.setPresence({ activities: [{ name: "goatfilter.xyz", type: ActivityType.Watching }], status: "online" });
  for (const g of c.guilds.cache.values()) {
    registerIn(g);
    scheduleCounter(g, 5000);
  }
  startVersionWatcher(c);
});
client.on(Events.GuildCreate, (g) => registerIn(g));

/* ------------------------------------------------------------------ membros */
client.on(Events.GuildMemberAdd, (m) => onJoin(m).catch((e) => logFor(m.guild).error("Falha nas boas-vindas", e)));
client.on(Events.GuildMemberRemove, (m) => onLeave(m));

/* ------------------------------------------------------------------ interações */
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      switch (interaction.commandName) {
        case "ajuda":
          return interaction.reply(faqMenu());
        case "faq":
          return interaction.reply({ embeds: [faqAnswer(faqById(interaction.options.getString("assunto")))], ephemeral: true });
        case "baixar":
          return interaction.reply({ embeds: [brandEmbed().setTitle("⬇️ Baixar o Goat Filter").setDescription(`Grátis, Windows 10 e 11:\n${config.siteUrl}`)] });
        case "versao": {
          await interaction.deferReply();
          try {
            const v = await latestVersion();
            return interaction.editReply({ embeds: [brandEmbed().setTitle("📦 Versão mais nova").setDescription(`**v${v.version}**\nBaixe em ${config.siteUrl}`)] });
          } catch {
            return interaction.editReply("Não consegui consultar a versão agora. Tente de novo em instantes.");
          }
        }
        case "servidor": {
          const g = interaction.guild;
          return interaction.reply({
            embeds: [
              brandEmbed()
                .setTitle(`🐐 ${g.name}`)
                .setThumbnail(g.iconURL())
                .addFields(
                  { name: "Membros", value: String(g.memberCount), inline: true },
                  { name: "Criado", value: `<t:${Math.floor(g.createdTimestamp / 1000)}:D>`, inline: true },
                  { name: "Site", value: config.siteUrl, inline: true },
                ),
            ],
          });
        }
        case "configurar": {
          const gate = interaction.options.getBoolean("verificacao") ?? true;
          const cleanup = interaction.options.getBoolean("limpar_padrao") ?? false;
          const me = interaction.guild.members.me;
          if (!me.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({
              ephemeral: true,
              embeds: [
                brandEmbed()
                  .setTitle("⚠️ Preciso de Administrador")
                  .setDescription(
                    "Para montar o servidor (criar cargos, permissões e o cargo Admin), o bot precisa da permissão **Administrador**.\n\n" +
                      `**1.** Abra este link e autorize de novo neste servidor:\nhttps://discord.com/oauth2/authorize?client_id=${config.clientId}&permissions=8&integration_type=0&scope=bot+applications.commands\n` +
                      "**2.** Em *Configurações do servidor › Cargos*, arraste o cargo **Goat Filter Bot** para o **topo**.\n**3.** Rode **/configurar** de novo.",
                  ),
              ],
            });
          }
          await interaction.deferReply({ ephemeral: true });
          const progress = (t) => interaction.editReply(`⏳ ${t}`).catch(() => {});
          let result;
          try {
            result = await buildServer(interaction.guild, { gate, cleanup }, progress);
          } catch (err) {
            logFor(interaction.guild).error("Falha no /configurar", err);
            return interaction.editReply(`❌ Parei no meio: \`${String(err?.message || err).slice(0, 300)}\`\nManda um print disso para o suporte do bot.`);
          }
          scheduleCounter(interaction.guild, 2000);
          logTo(interaction.guild, `🏗️ **${interaction.user.tag}** montou/atualizou o servidor com /configurar.`);
          return interaction.editReply({ content: "", embeds: [buildSummary(interaction.guild, result, gate)] });
        }
        case "painel":
          await interaction.channel.send(panelComponents());
          return interaction.reply({ content: "Painel publicado neste canal. ✅", ephemeral: true });
        case "anunciar":
          return cmdAnunciar(interaction);
        case "anunciar-versao": {
          await interaction.deferReply({ ephemeral: true });
          const v = await latestVersion();
          const done = await announceVersion(interaction.guild, v, { force: true });
          return interaction.editReply(done ? `🆕 v${v.version} anunciada.` : "Não achei o canal de atualizações. Rode /configurar.");
        }
        case "limpar":
          return cmdLimpar(interaction);
        case "castigo":
          return cmdCastigo(interaction);
        case "aviso":
          return cmdAviso(interaction);
        case "expulsar":
          return cmdExpulsar(interaction);
        case "banir":
          return cmdBanir(interaction);
      }
      return;
    }

    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === "ticket_open") return handleOpenSelect(interaction);
      if (interaction.customId === "rank") return handleRankSelect(interaction);
      if (interaction.customId === "faq_pick") return interaction.update({ embeds: [faqAnswer(faqById(interaction.values[0]))], components: [] });
      return;
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith("ticket_modal:")) return handleModalSubmit(interaction, logFor(interaction.guild));
      if (interaction.customId.startsWith("announce:")) return handleAnnounceModal(interaction);
      return;
    }

    if (interaction.isButton()) {
      const id = interaction.customId;
      if (id === "verify") return handleVerify(interaction);
      if (id.startsWith("role:")) return handleRoleToggle(interaction);
      if (id.startsWith("vote:")) return handleVote(interaction);
      if (id === "ticket_close") return handleClosePrompt(interaction);
      if (id === "ticket_close_confirm") return handleCloseConfirm(interaction, logFor(interaction.guild));
      if (id === "ticket_close_cancel") return handleCloseCancel(interaction);
    }
  } catch (err) {
    logFor(interaction.guild).error("Erro ao tratar interação", err);
    const admin = interaction.member?.permissions?.has(PermissionFlagsBits.ManageGuild);
    const detail = admin ? `\nDetalhe: \`${String(err?.message || err).slice(0, 300)}\`` : "";
    const msg = { content: `Deu um erro aqui. Já registrei para a equipe — tente de novo.${detail}`, ephemeral: true };
    if (interaction.deferred || interaction.replied) interaction.followUp(msg).catch(() => {});
    else interaction.reply(msg).catch(() => {});
  }
});

/* ------------------------------------------------------------------ mensagens */
const cooldown = new Map();
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot || !message.guild) return;
  try {
    if (await automod(message)) return;
    const id = message.channelId;
    const g = message.guild.id;
    if (id === savedId(g, "ch:sugestoes")) return handleSuggestionMessage(message);
    if (id === savedId(g, "ch:clipes")) return handleClip(message);
    if (message.channel.topic?.startsWith("ticket|")) return; // dentro de ticket a equipe cuida
    // Ajuda automática (em qualquer canal público, mais solta em #dúvidas).
    const item = matchFaq(message.content);
    if (!item) return;
    const last = cooldown.get(message.author.id) || 0;
    if (Date.now() - last < 60_000) return;
    cooldown.set(message.author.id, Date.now());
    await message.reply({
      embeds: [faqAnswer(item).setFooter({ text: "Resposta automática · use /ajuda para ver tudo" })],
      allowedMentions: { repliedUser: false },
    });
  } catch (err) {
    logFor(message.guild).error("Erro ao tratar mensagem", err);
  }
});
client.on(Events.MessageDelete, (m) => onMessageDelete(m));
client.on(Events.MessageUpdate, (a, b) => onMessageEdit(a, b));

/* ------------------------------------------------------------------ confiabilidade */
client.on(Events.Error, (err) => logAll("Erro do cliente Discord", err));
process.on("unhandledRejection", (err) => logAll("Promessa rejeitada sem tratamento", err));
process.on("uncaughtException", (err) => logAll("Exceção não capturada", err));

client.login(config.token).catch((err) => {
  console.error("Não consegui conectar. Confira o DISCORD_TOKEN no .env.", err);
  process.exit(1);
});
