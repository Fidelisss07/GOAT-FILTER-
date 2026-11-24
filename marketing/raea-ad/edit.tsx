// Anúncio do Goat Filter feito no raea (teste do motor). 1080x1920, 30 fps, 20 s.
// Cenas em compassos de 120 bpm (1 compasso = 60 quadros): gancho, cor, clipe, extras, final.
import { AbsoluteFill, Animate, Composition, Img, Mix, Sequence, Stagger, registerRoot, staticFile, tick, track } from "raea";

const simbolo = staticFile("simbolo.svg");
const lettering = staticFile("lettering.svg");
import * as Tone from "raea/tone";

const FPS = 30;
const BAR = 60; // quadros por compasso a 120 bpm
const PINK = "#ff48a8";
const PURPLE = "#ad78ff";
const CYAN = "#4fd6ff";
const INK = "#f5f5f7";
const MUTED = "#a1a1a6";
const BG = "#08070b";
const GRAD = `linear-gradient(100deg, ${PINK}, ${PURPLE} 45%, ${CYAN})`;

const S = { hook: 0, color: BAR, clip: 3 * BAR, extras: 5 * BAR, end: 7 * BAR, total: 10 * BAR };

const title: React.CSSProperties = { fontSize: 118, fontWeight: 800, letterSpacing: "-0.045em", lineHeight: 1.02, color: INK, textAlign: "center" };
const sub: React.CSSProperties = { fontSize: 40, fontWeight: 600, color: MUTED, textAlign: "center", lineHeight: 1.3 };
// background-clip: text ainda não existe no raea: cor sólida da marca.
const gradText: React.CSSProperties = { color: PINK };
const column: React.CSSProperties = { justifyContent: "center", alignItems: "center", flexDirection: "column", padding: "0 80px" };

// ---------------------------------------------------------------- música (Tone, compassos de 120 bpm)
Tone.getTransport().bpm.value = 120;
// Compressor no barramento: segura os picos do bumbo para o volume subir sem estourar.
const out = new Tone.Compressor({ threshold: -30, ratio: 8, attack: 0.002, release: 0.1 }).connect(new Tone.Limiter(-12).connect(Tone.buses.music));
const kick = new Tone.MembraneSynth({ pitchDecay: 0.05, octaves: 4, envelope: { attack: 0.002, decay: 0.24, sustain: 0 } }).connect(out);
const hat = new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.04, sustain: 0 } }).connect(new Tone.Filter(7000, "highpass").connect(out));
const snare = new Tone.NoiseSynth({ noise: { type: "pink" }, envelope: { attack: 0.001, decay: 0.16, sustain: 0 } }).connect(new Tone.Filter(1800, "bandpass").connect(out));
const bass = new Tone.MonoSynth({ oscillator: { type: "triangle" }, filter: { Q: 0.7, type: "lowpass" }, filterEnvelope: { attack: 0.005, decay: 0.15, sustain: 0.2, baseFrequency: 120, octaves: 2.5 }, envelope: { attack: 0.005, decay: 0.2, sustain: 0.5, release: 0.1 } }).connect(out);
const keys = new Tone.PolySynth(Tone.Synth, { oscillator: { type: "triangle" }, envelope: { attack: 0.01, decay: 0.3, sustain: 0.25, release: 0.6 } }).connect(new Tone.Reverb({ decay: 2.2, wet: 0.25 }).connect(out));
const lead = new Tone.Synth({ oscillator: { type: "triangle" }, envelope: { attack: 0.005, decay: 0.12, sustain: 0.1, release: 0.2 } }).connect(new Tone.FeedbackDelay("8n.", 0.25).connect(out));
const fx = new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.6, decay: 0.05, sustain: 0 } }).connect(new Tone.Filter(3000, "bandpass").connect(Tone.buses.sfx));
const blip = new Tone.Synth({ oscillator: { type: "sine" }, envelope: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.05 } }).connect(Tone.buses.sfx);
kick.volume.value = -12;
hat.volume.value = -30;
snare.volume.value = -24;
bass.volume.value = -14;
keys.volume.value = -18;
lead.volume.value = -19;
fx.volume.value = -22;
blip.volume.value = -20;

const sec = (frame: number) => frame / FPS;
// Gancho: só dois blips e um sopro subindo até a cor entrar.
blip.triggerAttackRelease("E6", 0.08, sec(8));
blip.triggerAttackRelease("A6", 0.08, sec(30));
fx.triggerAttackRelease(1.4, sec(S.color) - 1.4);
// Batida do compasso 1 ao 7 (cor, clipe, extras), com respiro antes do F8.
const CHORDS = [["A3", "C4", "E4"], ["F3", "A3", "C4"], ["C3", "E3", "G3"], ["G3", "B3", "D4"]];
const ROOTS = ["A1", "F1", "C2", "G1"];
for (let bar = 1; bar < 7; bar++) {
  const t0 = sec(bar * BAR);
  const chord = CHORDS[(bar - 1) % 4];
  keys.triggerAttackRelease(chord, 1.6, t0);
  for (let b = 0; b < 4; b++) {
    const t = t0 + b * 0.5;
    const breath = bar === 3 && b >= 2; // "Aquele clutch?" segura antes do F8
    if (!breath) kick.triggerAttackRelease("C1", 0.2, t);
    if (!breath && (b === 1 || b === 3)) snare.triggerAttackRelease(0.12, t);
    hat.triggerAttackRelease(0.03, t + 0.25);
    bass.triggerAttackRelease(ROOTS[(bar - 1) % 4], 0.22, t);
    bass.triggerAttackRelease(ROOTS[(bar - 1) % 4], 0.1, t + 0.375);
  }
}
// Motivo (5 notas) na cor, respondido na cena dos extras.
const MOTIF: [number, string][] = [[0, "A4"], [0.25, "C5"], [0.5, "E5"], [1.0, "D5"], [1.25, "C5"]];
for (const [dt, n] of MOTIF) lead.triggerAttackRelease(n, 0.18, sec(S.color + 30) + dt);
for (const [dt, n] of MOTIF) lead.triggerAttackRelease(Tone.Frequency(n).transpose(-2).toNote(), 0.18, sec(S.extras + 30) + dt);
// F8: clique e acorde de confirmação.
blip.triggerAttackRelease("C7", 0.04, sec(S.clip + 50));
keys.triggerAttackRelease(["E5", "A5", "C6"], 0.5, sec(S.clip + 52));
// Final: acorde "botão" no logo e resolução.
kick.triggerAttackRelease("C1", 0.3, sec(S.end));
keys.triggerAttackRelease(["A3", "E4", "A4", "C5", "E5"], 3.5, sec(S.end));
for (const [dt, n] of MOTIF.slice(0, 3)) lead.triggerAttackRelease(n, 0.2, sec(S.end + 20) + dt);
lead.triggerAttackRelease("A5", 0.9, sec(S.end + 20) + 0.75);

// ---------------------------------------------------------------- cenas
function Hook() {
  return (
    <AbsoluteFill style={{ ...column, background: "#141414", gap: 10 }}>
      <Animate enter="rise" at={4} exit="fade" exitAt={56} style={{ ...title, color: "#bdbdbd" }}>Seu Valorant</Animate>
      <Animate enter="slam" at={24} exit="fade" exitAt={56} style={{ ...title, color: "#8a8a8a" }}>tá sem cor?</Animate>
    </AbsoluteFill>
  );
}

// Cena "jogo" desenhada: céu, prédios e chão. A versão cinza fica embaixo; a colorida entra por cima.
function Scene({ vivid }: { vivid: boolean }) {
  const f = vivid ? "none" : "grayscale(1) brightness(0.8)";
  return (
    <AbsoluteFill style={{ filter: f, overflow: "hidden", borderRadius: 48 }}>
      <AbsoluteFill style={{ background: `linear-gradient(180deg, #2a0f4a 0%, #7a2bd1 38%, ${PINK} 62%, #ff9a3d 78%)` }} />
      <AbsoluteFill style={{ background: `radial-gradient(40% 25% at 70% 40%, rgba(255,214,41,.9), transparent 70%)` }} />
      {[0, 1, 2, 3, 4, 5].map((i) => {
        const w = 120 + ((i * 53) % 70);
        const h = 260 + ((i * 97) % 260);
        return (
          <div key={i} style={{ position: "absolute", left: i * 150 - 20, bottom: 300, width: w, height: h, borderRadius: 10,
            background: i % 2 ? "#1b1036" : "#24124a", boxShadow: `inset 0 0 0 3px rgba(79,214,255,.35)` }} />
        );
      })}
      <AbsoluteFill style={{ top: "auto", height: 320, background: `linear-gradient(180deg, ${CYAN}, #0e5f7a)` }} />
      <div style={{ position: "absolute", left: 100, right: 100, bottom: 150, height: 10, borderRadius: 5, background: "#ffd629" }} />
    </AbsoluteFill>
  );
}

const reveal = { clipRight: track({ 0: 100, 40: 0 }, "in-out-cubic") };
const glowLine = { x: track({ 0: 0, 40: 900 }, "in-out-cubic"), opacity: track({ 0: 1, 36: 1, 44: 0 }) };

function Color() {
  return (
    <AbsoluteFill style={{ background: BG }}>
      <Animate enter="rise" at={56} exit="fade" exitAt={114} style={{ position: "absolute", top: 230, left: 0, right: 0, ...title, fontSize: 104 }}>
        Cor de <span style={gradText}>verdade.</span>
      </Animate>
      <Animate enter="pop" at={2} exit="fade" exitAt={114} style={{ position: "absolute", left: 90, right: 90, top: 450, height: 800 }}>
        <Scene vivid={false} />
        <Animate at={14} animate={reveal} style={{ position: "absolute", inset: 0 }}>
          <Scene vivid />
        </Animate>
        <Animate at={14} animate={glowLine} style={{ position: "absolute", top: -20, bottom: -20, left: 0, width: 8, borderRadius: 4, background: "#fff", boxShadow: "0 0 40px 10px rgba(255,255,255,.8)" }} />
        <Animate enter="fade" at={2} exit="fade" exitAt={34} style={{ position: "absolute", top: 30, left: 30, padding: "10px 22px", borderRadius: 14, background: "rgba(0,0,0,.6)", color: INK, fontSize: 30, fontWeight: 800 }}>ANTES</Animate>
        <Animate enter="fade" at={50} exit="fade" exitAt={114} style={{ position: "absolute", top: 30, right: 30, padding: "10px 22px", borderRadius: 14, background: PURPLE, color: "#130c1d", fontSize: 30, fontWeight: 800 }}>DEPOIS</Animate>
      </Animate>
      <Animate enter="fade" at={10} exit="fade" exitAt={114} style={{ position: "absolute", top: 1290, left: 0, right: 0, ...sub, color: INK }}>Digital Vibrance</Animate>
      <Animate enter={tick({ from: 100, to: 200, suffix: "%", frames: 40 })} at={14} exit="fade" exitAt={114}
        style={{ position: "absolute", top: 1340, left: 0, right: 0, textAlign: "center", fontSize: 150, fontWeight: 800, letterSpacing: "-0.05em", color: INK }} />
    </AbsoluteFill>
  );
}

function Clip() {
  return (
    <AbsoluteFill style={{ background: BG }}>
      <Animate enter="rise" at={4} exit="fade" exitAt={46} style={{ position: "absolute", top: 520, left: 0, right: 0, ...title }}>Aquele clutch?</Animate>
      <Animate enter="slam" at={52} exit="fade" exitAt={114} style={{ position: "absolute", top: 520, left: 0, right: 0, ...title }}>
        Já tá <span style={gradText}>salvo.</span>
      </Animate>
      <Animate enter="pop" at={26} exit="fade" exitAt={114}
        animate={{ y: track({ 48: 0, 50: 16, 54: 0 }), borderColor: track({ 49: "rgba(255,255,255,.14)", 50: PURPLE, 80: "rgba(255,255,255,.14)" }) }}
        style={{ position: "absolute", left: 420, top: 820, width: 240, height: 240, borderRadius: 44, border: "3px solid rgba(255,255,255,.14)",
          background: "linear-gradient(180deg, #2b2a30, #18171b)", boxShadow: "0 18px 0 #0b0a0d, 0 30px 60px rgba(0,0,0,.6)",
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 96, fontWeight: 800, color: "#fff" }}>F8</Animate>
      <div style={{ position: "absolute", left: 160, right: 160, top: 1160, height: 16 }}>
        <Animate enter="fill" at={56} exit="fade" exitAt={114} style={{ height: 16, borderRadius: 8, backgroundImage: GRAD }} />
      </div>
      <Animate enter="fade" at={56} exit="fade" exitAt={114} style={{ position: "absolute", left: 160, right: 160, top: 1190, display: "flex", justifyContent: "space-between", fontSize: 30, fontWeight: 600, color: MUTED }}>
        <span>−30 s</span><span>agora</span>
      </Animate>
      <Animate enter="slide" at={70} exit="fade" exitAt={114}
        style={{ position: "absolute", left: 140, right: 140, top: 1290, display: "flex", alignItems: "center", gap: 24, padding: "28px 34px", borderRadius: 32,
          background: "rgba(40,38,46,.9)", border: "2px solid rgba(255,255,255,.14)" }}>
        <div style={{ width: 76, height: 76, borderRadius: 22, backgroundImage: GRAD, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 44, fontWeight: 800 }}>✓</div>
        <div>
          <div style={{ fontSize: 38, fontWeight: 800, color: INK }}>Clipe salvo</div>
          <div style={{ fontSize: 28, fontWeight: 600, color: MUTED, marginTop: 4 }}>Últimos 30 segundos</div>
        </div>
      </Animate>
    </AbsoluteFill>
  );
}

const EXTRAS = ["Miras de pro com um clique", "Acha todos os seus jogos", "Resolução esticada", "Sem risco de ban"];

function Extras() {
  return (
    <AbsoluteFill style={{ background: BG }}>
      <Animate enter="rise" at={4} exit="fade" exitAt={114} style={{ position: "absolute", top: 420, left: 0, right: 0, ...title, fontSize: 96 }}>
        E ainda <span style={gradText}>tem mais.</span>
      </Animate>
      <div style={{ position: "absolute", top: 660, left: 100, right: 100, display: "flex", flexDirection: "column", gap: 30 }}>
        <Stagger each={8} enter="slide" at={20}>
          {EXTRAS.map((e) => (
            <div key={e} style={{ display: "flex", alignItems: "center", gap: 28, padding: "34px 40px", borderRadius: 32, background: "#17151c", border: "2px solid rgba(255,255,255,.08)" }}>
              <div style={{ width: 22, height: 22, borderRadius: 11, backgroundImage: GRAD, flex: "none" }} />
              <div style={{ fontSize: 46, fontWeight: 800, color: INK, letterSpacing: "-0.02em" }}>{e}</div>
            </div>
          ))}
        </Stagger>
      </div>
    </AbsoluteFill>
  );
}

const endPush = { scale: track({ 0: 0.97, 180: 1.05 }, "linear") };

function End() {
  return (
    <AbsoluteFill style={{ background: `radial-gradient(70% 45% at 50% 38%, rgba(173,120,255,.35), ${BG} 70%)` }}>
    <Animate animate={endPush} style={{ position: "absolute", inset: 0, display: "flex", ...column }}>
      <Animate enter="pop" at={2} style={{ width: 360, height: 370 }}><Img src={simbolo} style={{ width: 360, height: 370 }} /></Animate>
      <Animate enter="rise" at={14} style={{ marginTop: 40, width: 740, height: 152 }}><Img src={lettering} style={{ width: 740, height: 152 }} /></Animate>
      <Animate enter="fade" at={30} style={{ ...sub, color: INK, fontSize: 46, marginTop: 50 }}>Grátis para Windows.</Animate>
      <Animate enter="pop" at={42} style={{ marginTop: 50, padding: "30px 70px", borderRadius: 999, background: "#fff", color: "#12091d", fontSize: 48, fontWeight: 800 }}>Baixe agora</Animate>
      <Animate enter="fade" at={54} style={{ ...sub, fontSize: 36, marginTop: 40 }}>goatfilter.xyz</Animate>
    </Animate>
    </AbsoluteFill>
  );
}

function Ad() {
  return (
    <AbsoluteFill style={{ background: BG }}>
      <Sequence from={S.hook} durationInFrames={S.color - S.hook}><Hook /></Sequence>
      <Sequence from={S.color} durationInFrames={S.clip - S.color}><Color /></Sequence>
      <Sequence from={S.clip} durationInFrames={S.extras - S.clip}><Clip /></Sequence>
      <Sequence from={S.extras} durationInFrames={S.end - S.extras}><Extras /></Sequence>
      <Sequence from={S.end} durationInFrames={S.total - S.end}><End /></Sequence>
      <Mix lufs={-14.9} ceiling={-2} />
    </AbsoluteFill>
  );
}

registerRoot(() => <Composition id="anuncio" component={Ad} width={1080} height={1920} fps={FPS} durationInFrames={S.total} />);
