import fs from "node:fs";
import path from "node:path";

/**
 * Configuração por servidor (canais, cargo e categoria) criada pelo /configurar.
 * Fica num arquivo JSON; se ele sumir (ex.: hospedagem que apaga arquivos a cada
 * deploy), o bot reencontra tudo pelos nomes dos canais.
 */
const FILE = process.env.DATA_FILE || path.resolve("data", "guilds.json");

function load() {
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    return {};
  }
}

let cache = load();

/** Nomes usados pelo /configurar (e para reencontrar sem o arquivo). */
export const NAMES = {
  role: "Equipe Goat Filter",
  category: "Tickets",
  support: "suporte",
  logs: "registros",
  welcome: "boas-vindas",
};

/** Configuração do servidor: o que foi salvo, ou o .env, ou o que achar pelos nomes. */
export function guildSettings(guild) {
  const id = guild?.id ?? guild;
  const saved = cache[id] || {};
  const g = typeof guild === "object" ? guild : null;
  const byName = (type, name) => g?.channels.cache.find((c) => c.type === type && c.name === name)?.id || "";
  return {
    staffRoleId: saved.staffRoleId || process.env.STAFF_ROLE_ID || g?.roles.cache.find((r) => r.name === NAMES.role)?.id || "",
    ticketCategoryId: saved.ticketCategoryId || process.env.TICKET_CATEGORY_ID || byName(4, NAMES.category),
    logChannelId: saved.logChannelId || process.env.LOG_CHANNEL_ID || byName(0, NAMES.logs),
    welcomeChannelId: saved.welcomeChannelId || process.env.WELCOME_CHANNEL_ID || byName(0, NAMES.welcome),
    supportChannelId: saved.supportChannelId || byName(0, NAMES.support),
  };
}

export function saveGuild(guildId, patch) {
  cache[guildId] = { ...(cache[guildId] || {}), ...patch };
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(cache, null, 2));
  } catch (err) {
    console.error("[store] não consegui salvar a configuração:", err.message);
  }
}
