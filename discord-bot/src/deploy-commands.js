import { REST, Routes, SlashCommandBuilder } from "discord.js";
import { config } from "./config.js";

/** Registra os comandos de barra (/) no servidor. Rode uma vez, e de novo quando mudar os comandos: npm run deploy */
const commands = [
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
    .setName("painel")
    .setDescription("(Equipe) Publica o painel de abrir tickets neste canal.")
    .setDefaultMemberPermissions(0), // só quem tem permissão de administrar (Manage Guild) vê
].map((c) => c.toJSON());

const rest = new REST({ version: "10" }).setToken(config.token);

try {
  console.log(`Registrando ${commands.length} comandos no servidor ${config.guildId}…`);
  await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body: commands });
  console.log("Comandos registrados. Pode levar alguns segundos para aparecer no Discord.");
} catch (err) {
  console.error("Falha ao registrar comandos:", err);
  process.exit(1);
}
