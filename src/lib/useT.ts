import { useStore } from "../state/store";
import { resolveLang, T, translate } from "./i18n";

/** Hook de tradução: const t = useT(); t("Aplicar"). */
export function useT(): T {
  const lang = useStore((s) => resolveLang(s.settings.language));
  return (pt, vars) => translate(lang, pt, vars);
}
