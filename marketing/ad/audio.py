#!/usr/bin/env python3
"""Trilha e efeitos do vídeo, sintetizados do zero (sem samples de terceiros).

Uso: python3 audio.py out/audio.wav
Trilha do anúncio; os momentos seguem o index.html.
"""
import sys
import wave

import numpy as np

SR = 48_000
DUR = 36.0
BPM = 120
BEAT = 60 / BPM
N = int(SR * DUR)
rng = np.random.default_rng(7)

L = np.zeros(N)  # música
X = np.zeros(N)  # efeitos


def at(buf, t, sig, gain=1.0):
    i = int(t * SR)
    if i >= N:
        return
    j = min(N, i + len(sig))
    buf[i:j] += sig[: j - i] * gain


def env(n, a=0.002, d=0.2, curve=1.0):
    t = np.arange(n) / SR
    e = np.minimum(1, t / max(a, 1e-4)) * np.exp(-t / max(d, 1e-4)) ** curve
    return e


def fft_filter(sig, lo=None, hi=None):
    """Passa-faixa simples no domínio da frequência."""
    S = np.fft.rfft(sig)
    f = np.fft.rfftfreq(len(sig), 1 / SR)
    m = np.ones_like(f)
    if lo:
        m *= 1 / (1 + (lo / np.maximum(f, 1)) ** 4)
    if hi:
        m *= 1 / (1 + (f / hi) ** 4)
    return np.fft.irfft(S * m, len(sig))


def sweep_noise(dur, f0, f1, width=0.6):
    """Ruído com faixa que anda de f0 até f1 (whoosh/riser)."""
    n = int(dur * SR)
    noise = rng.standard_normal(n)
    hop = 1024
    out = np.zeros(n + hop * 2)
    win = np.hanning(hop * 2)
    for k, start in enumerate(range(0, n, hop)):
        seg = noise[start : start + hop * 2]
        if len(seg) < hop * 2:
            seg = np.pad(seg, (0, hop * 2 - len(seg)))
        p = start / n
        fc = f0 * (f1 / f0) ** p
        out[start : start + hop * 2] += fft_filter(seg * win, fc * (1 - width), fc * (1 + width))
    return out[:n] / (np.max(np.abs(out)) + 1e-9)


# ---------------------------------------------------------------- instrumentos
def kick(gain=1.0):
    n = int(0.45 * SR)
    t = np.arange(n) / SR
    f = 45 + 95 * np.exp(-t / 0.04)
    ph = 2 * np.pi * np.cumsum(f) / SR
    click = fft_filter(rng.standard_normal(n), hi=4000) * np.exp(-t / 0.003) * 0.25
    return (np.sin(ph) * np.exp(-t / 0.16) + click) * gain


def snare():
    n = int(0.3 * SR)
    t = np.arange(n) / SR
    body = np.sin(2 * np.pi * 190 * t) * np.exp(-t / 0.05)
    noise = fft_filter(rng.standard_normal(n), lo=1500, hi=9000) * np.exp(-t / 0.09)
    return body * 0.5 + noise * 0.9


def hat(open_=False):
    n = int((0.18 if open_ else 0.05) * SR)
    t = np.arange(n) / SR
    return fft_filter(rng.standard_normal(n), lo=7000) * np.exp(-t / (0.06 if open_ else 0.015))


def tone(freq, dur, harmonics=6, decay=0.6, attack=0.005, detune=0.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    s = np.zeros(n)
    for h in range(1, harmonics + 1):
        s += np.sin(2 * np.pi * freq * h * (1 + detune * (h % 2)) * t) / h
    e = np.minimum(1, t / attack) * np.exp(-t / decay)
    return s * e


def pad(freqs, dur):
    n = int(dur * SR)
    t = np.arange(n) / SR
    s = np.zeros(n)
    for f in freqs:
        for d in (-0.004, 0.0, 0.004):
            s += np.sin(2 * np.pi * f * (1 + d) * t) + 0.3 * np.sin(4 * np.pi * f * (1 + d) * t)
    e = np.minimum(1, t / 0.4) * np.minimum(1, (dur - t) / 0.4)
    return s * e / (len(freqs) * 3)


def note(n):
    return 440 * 2 ** ((n - 69) / 12)



# ---------------------------------------------------------------- música
# Abertura tensa (só grave e ticks) → drop quando a cor entra (5,05 s) → pausa no
# "Aquele ace?" → volta no F8 → acorde final no logo (31,6 s).
def click(t, g=0.8):
    at(X, t, fft_filter(rng.standard_normal(int(0.035 * SR)), lo=1800, hi=9000) * env(int(0.035 * SR), d=0.007), g)
    at(X, t, tone(2100, 0.04, harmonics=1, decay=0.008), g * 0.3)

def pop(t, n=79, g=0.25):
    at(X, t, tone(note(n), 0.14, harmonics=2, decay=0.05), g)

def chime(t, notes, g=0.3):
    for j, n in enumerate(notes):
        at(X, t + j * 0.09, tone(note(n), 0.6, harmonics=2, decay=0.25), g)

def whoosh(t, dur=0.45, g=0.3):
    at(X, t - dur * 0.55, sweep_noise(dur, 4500, 350) * np.hanning(int(dur * SR)), g)

def boom(t, g=0.5):
    at(X, t, kick(1.0) * 0.9 + fft_filter(rng.standard_normal(int(0.45 * SR)), hi=700) * env(int(0.45 * SR), d=0.14) * 0.5, g)

def sub(t, dur, f=41.2, g=0.4):
    n = int(dur * SR); tt = np.arange(n) / SR
    at(L, t, np.sin(2 * np.pi * f * tt) * np.minimum(1, tt / 0.05) * np.exp(-tt / (dur * 0.5)), g)

CH = [(57, [57, 60, 64, 67]), (53, [53, 57, 60, 64]), (48, [55, 60, 64, 67]), (55, [55, 59, 62, 67])]
DROP, BREAK_A, BREAK_B, END = 5.05, 13.8, 15.45, 31.6

# Abertura: pulso grave + tick em cada palavra.
for t in (0.0, 0.8, 1.6, 2.4):
    sub(t, 0.75, 41.2, 0.55)
for j in range(4):
    pop(0.25 + j * 0.14, 84, 0.12)
for j in range(4):
    pop(1.75 + j * 0.14, 86 if j < 3 else 91, 0.14)
at(L, 0.0, pad([note(45), note(52), note(57)], 3.3), 0.3)
# Riser até a cor + varredura do slider.
at(X, 2.6, sweep_noise(2.45, 250, 9000) * np.linspace(0, 1, int(2.45 * SR)) ** 2.2, 0.42)
for j in range(16):
    at(X, 3.6 + j * 0.09, tone(1200 + j * 120, 0.03, harmonics=1, decay=0.01), 0.06 + j * 0.006)
boom(DROP, 0.75)
at(X, DROP, sweep_noise(1.6, 9000, 300) * np.exp(-np.arange(int(1.6 * SR)) / SR / 0.5), 0.25)
chime(DROP + 0.02, [81, 88, 93], 0.18)

# Batida (120 BPM a partir do drop).
beat, i = DROP, 0
while beat < END - 0.01:
    pos = i % 4
    brk = BREAK_A - 0.2 <= beat < BREAK_B - 0.01
    chord = CH[(i // 4) % 4]
    if not brk:
        at(L, beat, kick(), 0.9)
        if pos in (1, 3):
            at(L, beat, snare(), 0.36)
        at(L, beat + BEAT / 2, hat(), 0.13)
        at(L, beat + BEAT / 4, hat(), 0.05)
        at(L, beat + 3 * BEAT / 4, hat(), 0.05)
        root = chord[0] - 24
        at(L, beat, tone(note(root), BEAT * 0.95, harmonics=6, decay=0.3), 0.36)
        for k in range(2):
            n = chord[1][(i * 2 + k) % 4] + 12
            at(L, beat + k * BEAT / 2, tone(note(n), 0.3, harmonics=3, decay=0.12), 0.06)
    if pos == 0:
        at(L, beat, pad([note(n) for n in chord[1]], BEAT * 4), 0.16 if not brk else 0.22)
    beat += BEAT
    i += 1

# Pausa do "Aquele ace?": relógio + respiração, tudo volta no F8.
for j in range(int((BREAK_B - BREAK_A) / 0.25)):
    at(X, BREAK_A + 0.1 + j * 0.25, tone(3200 if j % 2 else 2600, 0.02, harmonics=1, decay=0.006), 0.12)
at(X, 14.6, sweep_noise(0.85, 300, 6000) * np.linspace(0, 1, int(0.85 * SR)) ** 2, 0.3)
click(15.4, 1.1)
boom(15.45, 0.7)
# Linha do tempo voltando e "clipe salvo".
at(X, 16.1, sweep_noise(1.1, 6000, 900) * np.hanning(int(1.1 * SR)), 0.14)
chime(17.25, [81, 85, 88], 0.3)
# Desempenho: REC e números.
pop(19.95, 76, 0.2)
for j in range(14):
    at(X, 20.1 + j * 0.035, tone(1800 + j * 90, 0.02, harmonics=1, decay=0.006), 0.1)
# Cortes.
for c in (8.6, 13.8, 19.8, 24.4, 28.9):
    whoosh(c, 0.5, 0.26)
    boom(c, 0.18)
# Janela do app: brilho passando.
at(X, 10.0, sweep_noise(1.3, 2000, 9000) * np.hanning(int(1.3 * SR)), 0.08)
for j in range(3):
    pop(11.0 + j * 0.15, 81 + j * 2, 0.16)
# Cartões e interruptores.
for j in range(4):
    whoosh(24.6 + j * 1.05 + 0.2, 0.35, 0.2)
for j in range(4):
    click(26.7 + 0.3 + j * 0.13 + 0.08, 0.45)
# Confiança: um ding por linha.
for j in range(3):
    pop(29.0 + j * 0.32 + 0.1, 79 + j * 3, 0.28)
# Final: acorde grande e cauda.
at(X, 30.9, sweep_noise(0.75, 400, 8000) * np.linspace(0, 1, int(0.75 * SR)) ** 2, 0.3)
boom(END, 0.8)
at(L, END, pad([note(n) for n in (45, 57, 60, 64, 69, 76)], 4.4), 0.5)
chime(END + 0.05, [81, 88, 93, 100], 0.2)
for j, t in enumerate((32.2, 32.8, 33.2, 33.5)):
    pop(t, 88 + j * 2, 0.08)

# ---------------------------------------------------------------- mixagem
def reverb(sig, secs=1.6, mix=0.18):
    n = int(secs * SR)
    ir = rng.standard_normal(n) * np.exp(-np.arange(n) / SR / (secs / 5))
    ir = fft_filter(ir, hi=6000)
    size = len(sig) + n
    wet = np.fft.irfft(np.fft.rfft(sig, size) * np.fft.rfft(ir, size), size)[: len(sig)]
    wet /= np.max(np.abs(wet)) + 1e-9
    return sig + wet * mix * np.max(np.abs(sig))


music = reverb(L, 1.2, 0.12)
fx = reverb(X, 1.8, 0.25)
mixl = music * 0.8 + fx
mixr = music * 0.8 + fx
# Leve abertura estéreo nos efeitos.
d = int(0.012 * SR)
mixr[d:] = music[d:] * 0.8 + fx[:-d]
st = np.stack([mixl, mixr], axis=1)
# Fade e limitador suave.
fade = np.ones(N)
fade[-int(0.45 * SR):] = np.linspace(1, 0, int(0.45 * SR))
st *= fade[:, None]
st /= np.max(np.abs(st)) + 1e-9
st = np.tanh(st * 1.6) / np.tanh(1.6) * 0.95

out = sys.argv[1] if len(sys.argv) > 1 else "out/audio.wav"
with wave.open(out, "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((st * 32767).astype("<i2").tobytes())
print(out, f"{DUR:.1f}s")
