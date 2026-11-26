import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder } from "discord.js";
import { config } from "./config.js";
import { ROLES, RULES } from "./layout.js";
import { savedId } from "./store.js";

const brand = () => new EmbedBuilder().setColor(config.brand.color);
const RANKS = ROLES.filter((r) => r.rank);
const NOTIFS = ROLES.filter((r) => r.notify);

/** #regras: lista de regras + botão de aceitar (libera o servidor). */
export function rulesPanel(gate) {
  const embed = brand()
    .setTitle("📜 Regras da comunidade Goat Filter")
    .setDescription(
      RULES.map(([emoji, title, text], i) => `**${i + 1}. ${emoji} ${title}**\n${text}`).join("\n\n") +
        (gate ? "\n\n**Leu tudo? Clique no botão abaixo para liberar o servidor.**" : ""),
    );
  const components = gate
    ? [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("verify").setLabel("Li e aceito as regras").setEmoji("✅").setStyle(ButtonStyle.Success))]
    : [];
  return { embeds: [embed], components };
}

/** #baixar: link oficial, passo a passo e o aviso do Windows. */
export function downloadPanel() {
  const embed = brand()
    .setTitle("⬇️ Baixar o Goat Filter")
    .setDescription(
      "**Grátis, sem conta e sem anúncio.** Windows 10 e 11, NVIDIA, AMD e Intel.\n\n" +
        "**Como instalar**\n" +
        `**1.** Baixe pelo site oficial: ${config.siteUrl}\n` +
        "**2.** Abra o instalador.\n" +
        "**3.** Se aparecer *“O Windows protegeu o computador”*, clique em **Mais informações** › **Executar assim mesmo**. " +
        "Isso acontece com apps novos sem assinatura paga; o Goat Filter é seguro.\n" +
        "**4.** Pronto: o app se atualiza sozinho quando sai versão nova (aviso em #🆕・atualizações).\n\n" +
        "⚠️ Baixe **só** pelo site oficial. Arquivos mandados por outras pessoas podem ter vírus.",
    );
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Baixar no site oficial").setEmoji("⬇️").setURL(config.siteUrl),
  );
  return { embeds: [embed], components: [row] };
}

/** #cargos: notificações (liga/desliga) e elo (um só). */
export function rolesPanel() {
  const embed = brand()
    .setTitle("🎭 Escolha seus cargos")
    .setDescription(
      "**🔔 Avisos:** clique para ligar ou desligar.\n" +
        NOTIFS.map((n) => `• **${n.name}**: ${n.desc}`).join("\n") +
        "\n\n**🏆 Seu elo no Valorant:** escolha no menu (aparece do lado do seu nome).",
    );
  const buttons = new ActionRowBuilder().addComponents(
    NOTIFS.map((n) =>
      new ButtonBuilder()
        .setCustomId(`role:${n.key}`)
        .setLabel(n.name.replace(/^\S+\s/, ""))
        .setEmoji(n.name.split(" ")[0])
        .setStyle(ButtonStyle.Secondary),
    ),
  );
  const select = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("rank")
      .setPlaceholder("Escolha seu elo…")
      .addOptions([...RANKS].reverse().map((r) => ({ label: r.name, value: r.key })).concat([{ label: "Tirar meu elo", value: "none", emoji: "✖️" }])),
  );
  return { embeds: [embed], components: [buttons, select] };
}

/** #boas-vindas: apresentação do servidor (fixada). */
export function welcomeIntro(ch) {
  const embed = brand()
    .setTitle("🐐 Bem-vindo à comunidade Goat Filter")
    .setDescription(
      "O Goat Filter deixa as cores do Valorant mais vivas (Digital Vibrance até 200%), otimiza o PC, grava seus melhores lances e treina sua mira.\n\n" +
        `**Comece por aqui**\n• ${ch["ch:regras"]}: leia e aceite para liberar o servidor\n• ${ch["ch:baixar"]}: link oficial e como instalar\n• ${ch["ch:cargos"]}: escolha seu elo e os avisos\n• ${ch["ch:duvidas"]}: pergunte o que quiser\n• ${ch["ch:abrir-ticket"]}: problema com o app? fale com a equipe`,
    );
  return { embeds: [embed], components: [] };
}

/* ------------------------------------------------------------------ cliques */
function roleFor(guild, key) {
  return guild.roles.cache.get(savedId(guild.id, `role:${key}`)) || guild.roles.cache.find((r) => r.name === ROLES.find((x) => x.key === key)?.name);
}

export async function handleVerify(interaction) {
  const role = roleFor(interaction.guild, "membro");
  if (!role) return interaction.reply({ content: "O servidor ainda não foi montado. Avise a equipe.", ephemeral: true });
  if (interaction.member.roles.cache.has(role.id)) return interaction.reply({ content: "Você já está liberado. 😉", ephemeral: true });
  await interaction.member.roles.add(role, "Aceitou as regras");
  return interaction.reply({ content: "✅ Pronto, servidor liberado! Passa no #🎭・cargos para escolher seu elo e os avisos.", ephemeral: true });
}

export async function handleRoleToggle(interaction) {
  const key = interaction.customId.slice("role:".length);
  const role = roleFor(interaction.guild, key);
  if (!role) return interaction.reply({ content: "Cargo não encontrado. Peça para a equipe rodar /configurar.", ephemeral: true });
  const has = interaction.member.roles.cache.has(role.id);
  if (has) await interaction.member.roles.remove(role);
  else await interaction.member.roles.add(role);
  return interaction.reply({ content: has ? `🔕 Você não vai mais receber **${role.name}**.` : `🔔 Ativado: **${role.name}**.`, ephemeral: true });
}

export async function handleRankSelect(interaction) {
  const pick = interaction.values[0];
  const all = RANKS.map((r) => roleFor(interaction.guild, r.key)).filter(Boolean);
  await interaction.member.roles.remove(all.filter((r) => interaction.member.roles.cache.has(r.id))).catch(() => {});
  if (pick === "none") return interaction.reply({ content: "Elo removido.", ephemeral: true });
  const role = roleFor(interaction.guild, pick);
  await interaction.member.roles.add(role);
  return interaction.reply({ content: `🏆 Elo definido: **${role.name}**.`, ephemeral: true });
}
