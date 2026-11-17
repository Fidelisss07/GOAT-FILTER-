import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveLang, translate } from "../lib/i18n";
import { EN } from "../lib/i18n-en";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === "test" ? [] : files(p);
    return /\.tsx?$/.test(f) && !f.startsWith("i18n-en") ? [p] : [];
  });
}

describe("inglês", () => {
  it("toda frase passada a t()/tr() tem tradução", () => {
    const missing: string[] = [];
    for (const f of files("src")) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/\b(?:t|tr)\(\s*"((?:[^"\\]|\\.)*)"/g)) {
        const key = m[1].replace(/\\"/g, '"');
        if (!(key in EN)) missing.push(`${f}: ${key}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("troca variáveis e cai no português se faltar", () => {
    expect(translate("en", "Aplicado: {v}%", { v: 80 })).toBe("Applied: 80%");
    expect(translate("pt", "Aplicado: {v}%", { v: 80 })).toBe("Aplicado: 80%");
    expect(translate("en", "frase sem tradução")).toBe("frase sem tradução");
    expect(resolveLang("en")).toBe("en");
    expect(resolveLang("pt")).toBe("pt");
  });
});
