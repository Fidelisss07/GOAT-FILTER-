import { PermissionFlagsBits, REST, Routes, SlashCommandBuilder } from "discord.js";
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
        ),
    ),
  new SlashCommandBuilder().setName("versao").setDescription("Mostra a versão mais nova publicada do app."),
  new SlashCommandBuilder().setName("baixar").setDescription("Link oficial para baixar o Goat Filter."),
  new SlashCommandBuilder()
    .setName("configurar")
    .setDescription("(Admin) Cria os canais de suporte, registros, boas-vindas e o cargo da equipe.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName("painel")
    .setDescription("(Equipe) Publica o painel de abrir tickets neste canal.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
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
