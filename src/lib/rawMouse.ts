/**
 * Movimento do mouse igual ao do Valorant: contagens brutas lidas pelo próprio
 * Windows (Raw Input, no lado nativo do app), sem aceleração e sem efeito da
 * escala de tela. Se o lado nativo não estiver disponível (navegador, testes),
 * quem chama continua usando o movementX do navegador.
 */
import { getNative } from "./native";

type Api = Awaited<ReturnType<typeof getNative>>;
let api: Api | null = null;
let ok: boolean | null = null;

/** O Raw Input do app está funcionando? (descobre uma vez só) */
export async function rawMouseAvailable(): Promise<boolean> {
  if (ok != null) return ok;
  try {
    api = await getNative();
    ok = (await api.mouseDelta()) != null;
  } catch {
    ok = false;
  }
  return ok;
}

/** Joga fora o movimento acumulado (ex.: logo depois de travar o mouse). */
export async function flushRawMouse(): Promise<void> {
  if (ok && api) await api.mouseDelta().catch(() => null);
}

/**
 * Lê o movimento a cada quadro e entrega em `onDelta(dx, dy)` enquanto
 * `active()` for verdadeiro. Devolve a função que para a leitura.
 */
export function pumpRawMouse(active: () => boolean, onDelta: (dx: number, dy: number) => void): () => void {
  let stop = false;
  let busy = false;
  let raf = 0;
  const tick = () => {
    if (stop) return;
    if (!busy && ok && api) {
      busy = true;
      api
        .mouseDelta()
        .then((d) => {
          if (d && active() && (d[0] || d[1])) onDelta(d[0], d[1]);
        })
        .catch(() => {})
        .finally(() => (busy = false));
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => {
    stop = true;
    cancelAnimationFrame(raf);
  };
}
