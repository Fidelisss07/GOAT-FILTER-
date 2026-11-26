import fs from "node:fs";
import path from "node:path";

/**
 * Dados por servidor (IDs dos canais/cargos criados pelo /configurar, votos de
 * sugestões, avisos de moderação, última versão anunciada). Fica num JSON; se
 * ele sumir, o bot reencontra canais e cargos pelos nomes.
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
let saveTimer = null;

function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(FILE), { recursive: true });
      fs.writeFileSync(FILE, JSON.stringify(cache, null, 2));
    } catch (err) {
      console.error("[store] não consegui salvar:", err.message);
    }
  }, 300);
}

export function guildData(guildId) {
  cache[guildId] ??= {};
  cache[guildId].ids ??= {};
  return cache[guildId];
}

export function setData(guildId, patch) {
  Object.assign(guildData(guildId), patch);
  persist();
}

/** ID salvo de um canal/cargo do layout (ex.: "ch:regras", "role:membro"). */
export function savedId(guildId, key) {
  return guildData(guildId).ids[key] || "";
}

export function saveId(guildId, key, id) {
  guildData(guildId).ids[key] = id;
  persist();
}

/** Guarda qualquer coisa de um servidor (votos, avisos...). */
export function bucket(guildId, name) {
  const d = guildData(guildId);
  d[name] ??= {};
  return d[name];
}

export function touch() {
  persist();
}

/** Atalhos usados por tickets, registros e boas-vindas (com nomes antigos como reserva). */
export function guildSettings(guild) {
  const id = guild?.id ?? guild;
  const d = guildData(id);
  const g = typeof guild === "object" ? guild : null;
  const ch = (key, ...names) =>
    d.ids[key] || d[`${key}Legacy`] || g?.channels.cache.find((c) => names.includes(c.name))?.id || "";
  return {
    staffRoleId: d.ids["role:equipe"] || d.staffRoleId || process.env.STAFF_ROLE_ID || g?.roles.cache.find((r) => r.name === "Equipe Goat Filter")?.id || "",
    ticketCategoryId: d.ids["cat:tickets"] || d.ticketCategoryId || process.env.TICKET_CATEGORY_ID || "",
    logChannelId: d.ids["ch:registros"] || d.logChannelId || process.env.LOG_CHANNEL_ID || ch("ch:registros", "📜・registros", "registros"),
    welcomeChannelId: d.ids["ch:boas-vindas"] || d.welcomeChannelId || process.env.WELCOME_CHANNEL_ID || ch("ch:boas-vindas", "👋・boas-vindas", "boas-vindas"),
    supportChannelId: d.ids["ch:abrir-ticket"] || d.supportChannelId || ch("ch:abrir-ticket", "🎫・abrir-ticket", "suporte"),
  };
}
