import { config } from "./config.js";
import { commands, registerGlobalCommands, registerGuildCommands } from "./commands.js";

/**
 * Registro manual dos comandos (opcional): o bot já registra sozinho em cada
 * servidor quando liga. Com GUILD_ID registra só nele; sem, registra global.
 */
try {
  if (config.guildId) {
    console.log(`Registrando ${commands.length} comandos no servidor ${config.guildId}…`);
    await registerGuildCommands(config.guildId);
  } else {
    console.log(`Registrando ${commands.length} comandos globais (podem levar até 1 hora para aparecer)…`);
    await registerGlobalCommands();
  }
  console.log("Comandos registrados.");
} catch (err) {
  console.error("Falha ao registrar comandos:", err);
  process.exit(1);
}
