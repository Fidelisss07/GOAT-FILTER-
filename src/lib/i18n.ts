/**
 * Tradução simples: o texto em português é a chave; `EN` tem o inglês.
 * Variáveis entram como {nome}: t("Aplicado: {v}%", { v: 75 }).
 */
import { EN } from "./i18n-en";
import { Language } from "./types";

export type Lang = "pt" | "en";

export function resolveLang(l: Language | undefined): Lang {
  if (l === "pt" || l === "en") return l;
  const nav = typeof navigator !== "undefined" ? navigator.language || "" : "";
  return nav.toLowerCase().startsWith("pt") ? "pt" : "en";
}

export type Vars = Record<string, string | number>;

export function translate(lang: Lang, pt: string, vars?: Vars): string {
  const base = lang === "en" ? EN[pt] ?? pt : pt;
  if (!vars) return base;
  return base.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

export type T = (pt: string, vars?: Vars) => string;
