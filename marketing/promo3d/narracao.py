#!/usr/bin/env python3
"""Encaixa as frases da narração (ElevenLabs) nas cenas do vídeo.

Uso: python3 narracao.py && ./build.sh out/narracao.wav
Os tempos de cada frase vieram da transcrição palavra por palavra (eleven_scribe_v1),
que bateu 100% com o roteiro.
"""
import subprocess

SRC = "assets/voz/narracao-marianne.mp3"   # voz feminina "Marianne" (propaganda, natural)
TEMPO = 1.05                                # 5% mais rápida, sem mudar o tom
# (início, fim na voz) -> segundo do vídeo em que a frase entra
SEG = [
    (0.00, 2.10, 0.35),    # Seu Valorant tá sem cor?
    (2.25, 7.28, 3.30),    # Com o Goat Filter, o Digital Vibrance vai até duzentos por cento.
    (7.40, 11.35, 8.25),   # Seus clipes saem lisinhos, sem perder FPS.
    (11.42, 15.72, 12.05), # E em três minutos, você descobre a sua sensibilidade ideal.
    (15.90, 18.84, 16.25), # Tudo num app leve, que não mexe no jogo.
    (18.93, 23.72, 20.30), # Baixe grátis em goatfilter.xyz.
]
fc = []
for i, (a, b, d) in enumerate(SEG):
    fc.append(f"[0:a]atrim={a}:{b},asetpts=PTS-STARTPTS,atempo={TEMPO},afade=t=in:d=0.03,afade=t=out:st={(b - a) / TEMPO - 0.06:.3f}:d=0.06,adelay={int(d * 1000)}|{int(d * 1000)}[s{i}]")
fc.append("".join(f"[s{i}]" for i in range(len(SEG))) + f"amix=inputs={len(SEG)}:normalize=0,apad=whole_dur=25,atrim=0:25[o]")
subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", SRC, "-filter_complex", ";".join(fc),
                "-map", "[o]", "-ar", "48000", "-ac", "1", "out/narracao.wav"], check=True)
print("out/narracao.wav")
