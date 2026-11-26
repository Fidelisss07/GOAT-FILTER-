import "dotenv/config";

/** Lê e valida as configurações do .env. Para a execução cedo com mensagem clara se faltar o essencial. */
function required(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`\n[config] Falta a variável ${name} no .env. Veja o .env.example.\n`);
    process.exit(1);
  }
  return v;
}

export const config = {
  token: required("DISCORD_TOKEN"),
  clientId: required("CLIENT_ID"),
  /** Opcional: os canais e o cargo vêm do /configurar (veja store.js). */
  guildId: process.env.GUILD_ID || "",
  siteUrl: process.env.SITE_URL || "https://www.goatfilter.xyz",
  brand: {
    name: "Goat Filter",
    color: 0xad78ff,
    icon: "https://www.goatfilter.xyz/assets/marca/goat-filter-roxo-simbolo.svg",
    support: "suporte-contato@goatfilter.xyz",
  },
};
