import { PermissionFlagsBits as P, REST, Routes, SlashCommandBuilder } from "discord.js";
import { config } from "./config.js";

/** Comandos de barra (/) do bot. */
export const commands = [
  new SlashCommandBuilder().setName("ajuda").setDescription("Tira as dúvidas mais comuns do Goat Filter."),
  new SlashCommandBuilder()
    .setName("faq")
    .setDescription("Mostra a resposta de uma dúvida específica.")
    .addStringOption((o) =>
      o
        .setName("assunto")
        .setDescription("Qual dúvida?")
        .setRequired(true)
        .addChoices(
          { name: "Aviso do Windows ao instalar", value: "aviso" },
          { name: "Dá ban no Valorant?", value: "ban" },
          { name: "Funciona com AMD / Intel?", value: "placa" },
          { name: "Como passa de 100% (até 200%)", value: "super" },
          { name: "Gravação pesa no FPS?", value: "clipes" },
          { name: "Sensibilidade ideal", value: "sensibilidade" },
          { name: "Voltar cores ao normal", value: "restaurar" },
          { name: "É grátis?", value: "gratis" },
          { name: "Onde baixo / atualizo", value: "download" },
          { name: "Filtro não aparece ao compartilhar a tela", value: "compartilhar" },
          { name: "Clipe travado / FPS baixo", value: "travando" },
          { name: "Como funciona o treino de mira", value: "treino" },
        ),
    ),
  new SlashCommandBuilder().setName("versao").setDescription("Mostra a versão mais nova publicada do app."),
  new SlashCommandBuilder().setName("baixar").setDescription("Link oficial para baixar o Goat Filter."),
  new SlashCommandBuilder().setName("servidor").setDescription("Informações do servidor e da comunidade."),

  // ---- administração
  new SlashCommandBuilder()
    .setName("configurar")
    .setDescription("(Admin) Monta o servidor inteiro: cargos, categorias, canais, regras e painéis.")
    .setDefaultMemberPermissions(P.Administrator)
    .addBooleanOption((o) => o.setName("verificacao").setDescription("Quem entra só vê as regras até aceitar (padrão: sim)"))
    .addBooleanOption((o) => o.setName("limpar_padrao").setDescription("Apagar os canais padrão do Discord (#geral e Geral)"))
    .addBooleanOption((o) => o.setName("aparencia").setDescription("Trocar ícone (e banner, se tiver impulsos) pela arte do Goat Filter (padrão: sim)")),
  new SlashCommandBuilder()
    .setName("painel")
    .setDescription("(Equipe) Publica o painel de abrir tickets neste canal.")
    .setDefaultMemberPermissions(P.ManageGuild),
  new SlashCommandBuilder()
    .setName("anunciar")
    .setDescription("(Equipe) Posta um anúncio bonito em #anúncios.")
    .setDefaultMemberPermissions(P.ManageMessages)
    .addStringOption((o) =>
      o
        .setName("marcar")
        .setDescription("Quem marcar")
        .addChoices(
          { name: "Ninguém", value: "nada" },
          { name: "Quem quer aviso de atualização", value: "notif:atualizacoes" },
          { name: "Quem quer aviso de eventos", value: "notif:eventos" },
          { name: "Quem quer aviso de vídeos", value: "notif:videos" },
          { name: "Todo mundo (@everyone)", value: "todos" },
        ),
    ),
  new SlashCommandBuilder()
    .setName("anunciar-versao")
    .setDescription("(Equipe) Posta agora a versão mais nova em #atualizações.")
    .setDefaultMemberPermissions(P.ManageMessages),

  // ---- moderação
  new SlashCommandBuilder()
    .setName("limpar")
    .setDescription("(Moderação) Apaga as últimas mensagens deste canal.")
    .setDefaultMemberPermissions(P.ManageMessages)
    .addIntegerOption((o) => o.setName("quantidade").setDescription("De 1 a 100").setMinValue(1).setMaxValue(100).setRequired(true)),
  new SlashCommandBuilder()
    .setName("castigo")
    .setDescription("(Moderação) Deixa um membro sem falar por um tempo.")
    .setDefaultMemberPermissions(P.ModerateMembers)
    .addUserOption((o) => o.setName("membro").setDescription("Quem").setRequired(true))
    .addIntegerOption((o) => o.setName("minutos").setDescription("Quantos minutos").setMinValue(1).setMaxValue(40320).setRequired(true))
    .addStringOption((o) => o.setName("motivo").setDescription("Motivo")),
  new SlashCommandBuilder()
    .setName("aviso")
    .setDescription("(Moderação) Dá um aviso (3 avisos = 1 hora de castigo).")
    .setDefaultMemberPermissions(P.ModerateMembers)
    .addUserOption((o) => o.setName("membro").setDescription("Quem").setRequired(true))
    .addStringOption((o) => o.setName("motivo").setDescription("Motivo").setRequired(true)),
  new SlashCommandBuilder()
    .setName("expulsar")
    .setDescription("(Moderação) Expulsa um membro.")
    .setDefaultMemberPermissions(P.KickMembers)
    .addUserOption((o) => o.setName("membro").setDescription("Quem").setRequired(true))
    .addStringOption((o) => o.setName("motivo").setDescription("Motivo")),
  new SlashCommandBuilder()
    .setName("banir")
    .setDescription("(Moderação) Bane um membro.")
    .setDefaultMemberPermissions(P.BanMembers)
    .addUserOption((o) => o.setName("membro").setDescription("Quem").setRequired(true))
    .addStringOption((o) => o.setName("motivo").setDescription("Motivo")),
].map((c) => c.toJSON());

const rest = () => new REST({ version: "10" }).setToken(config.token);

/** Registra os comandos num servidor (aparecem na hora). */
export async function registerGuildCommands(guildId) {
  await rest().put(Routes.applicationGuildCommands(config.clientId, guildId), { body: commands });
}

/** Registra os comandos em todos os servidores (pode levar até 1 hora para aparecer). */
export async function registerGlobalCommands() {
  await rest().put(Routes.applicationCommands(config.clientId), { body: commands });
}
