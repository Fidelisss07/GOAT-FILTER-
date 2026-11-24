#!/usr/bin/env python3
"""Encaixa as frases da narração (ElevenLabs, voz "Vilaca") nas cenas do vídeo.

Uso: python3 narracao.py && ./build.sh out/narracao.wav
Os tempos de cada frase vieram da transcrição palavra por palavra (eleven_scribe_v1),
que bateu 100% com o roteiro.
"""
import subprocess

SRC = "assets/voz/narracao-vilaca.mp3"
# (início, fim na voz) -> segundo do vídeo em que a frase entra
SEG = [
    (0.00, 1.80, 0.40),    # Seu Valorant tá sem cor?
    (1.72, 6.55, 3.30),    # Com o Goat Filter, o Digital Vibrance vai até duzentos por cento.
    (6.58, 10.52, 8.20),   # Clipe as suas melhores jogadas sem perder FPS.
    (10.58, 14.62, 12.20), # Descubra a sua sensibilidade ideal em três minutos.
    (14.62, 17.75, 16.30), # Tudo num app leve, que não mexe no jogo.
    (17.82, 22.18, 20.55), # Baixe grátis em goatfilter.xyz.
]
fc = []
for i, (a, b, d) in enumerate(SEG):
    fc.append(f"[0:a]atrim={a}:{b},asetpts=PTS-STARTPTS,afade=t=in:d=0.03,afade=t=out:st={b - a - 0.06:.3f}:d=0.06,adelay={int(d * 1000)}|{int(d * 1000)}[s{i}]")
fc.append("".join(f"[s{i}]" for i in range(len(SEG))) + f"amix=inputs={len(SEG)}:normalize=0,apad=whole_dur=25,atrim=0:25[o]")
subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", SRC, "-filter_complex", ";".join(fc),
                "-map", "[o]", "-ar", "48000", "-ac", "1", "out/narracao.wav"], check=True)
print("out/narracao.wav")
