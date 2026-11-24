import scene from "../assets/cenario-hd.webp";

/**
 * Fundo vivo: a cena do jogo ocupa a janela inteira. O vibrance "pinta" a cena
 * a partir do centro — quanto maior o valor, maior o círculo colorido — e a borda
 * do círculo brilha. É só ilustração; não mede o ajuste real do monitor.
 * Segurar "ver antes" (data-compare no <html>) apaga a cor para comparar.
 */
export function Scene({ saturation, reveal, dim }: { saturation: number; reveal: number; dim: boolean }) {
  return (
    <div
      className={`scene${dim ? " is-dim" : ""}`}
      style={{ ["--reveal" as string]: reveal.toFixed(3) }}
      aria-hidden
    >
      <img className="scene-base" src={scene} alt="" draggable={false} />
      <img className="scene-color" src={scene} alt="" draggable={false} style={{ filter: `saturate(${saturation.toFixed(3)})` }} />
      <div className="scene-ring" />
      <div className="scene-shade" />
    </div>
  );
}
