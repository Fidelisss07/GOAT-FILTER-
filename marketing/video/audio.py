#!/usr/bin/env python3
"""Trilha e efeitos do vídeo, sintetizados do zero (sem samples de terceiros).

Uso: python3 audio.py out/audio.wav
Os momentos dos efeitos seguem a linha do tempo do index.html.
"""
import sys
import wave

import numpy as np

SR = 48_000
DUR = 45.0
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
# Lá menor → Fá → Dó → Sol (2 s cada). Drop em 3 s, respiro no Raio-X (24–25 s).
CHORDS = [(57, [57, 60, 64]), (53, [53, 57, 60]), (48, [52, 55, 60]), (55, [55, 59, 62])]
DROP = 3.0
END = 44.0
BREAK = (24.0, 25.0)

at(L, 0.0, pad([note(45), note(52)], 3.1), 0.55)
beat = DROP
i = 0
while beat < END - 0.01:
    bar_pos = i % 4
    in_break = BREAK[0] <= beat < BREAK[1]
    if not in_break:
        at(L, beat, kick(), 0.95)
        if bar_pos in (1, 3):
            at(L, beat, snare(), 0.42)
        at(L, beat + BEAT / 2, hat(), 0.16)
        at(L, beat, hat(), 0.07)
        if i % 8 == 7:
            at(L, beat + BEAT * 0.75, hat(True), 0.12)
    root = CHORDS[(i // 4) % 4][0] - 12
    at(L, beat, tone(note(root), BEAT * 0.9, harmonics=5, decay=0.25), 0.33)
    at(L, beat + BEAT * 0.75, tone(note(root), BEAT * 0.25, harmonics=5, decay=0.08), 0.18)
    if bar_pos == 0:
        chord = CHORDS[(i // 4) % 4][1]
        at(L, beat, pad([note(n) for n in chord], BEAT * 4), 0.2)
        for k, n in enumerate(chord + [chord[0] + 12]):
            at(L, beat + k * BEAT / 2, tone(note(n + 12), 0.4, harmonics=3, decay=0.18), 0.07)
    beat += BEAT
    i += 1
at(L, END, pad([note(n) for n in (57, 60, 64, 69)], 1.0), 0.3)

# ---------------------------------------------------------------- efeitos (sincronizados com o index.html)
def click(t, g=0.8):
    at(X, t, fft_filter(rng.standard_normal(int(0.035 * SR)), lo=1800, hi=9000) * env(int(0.035 * SR), d=0.007), g)
    at(X, t, tone(2100, 0.04, harmonics=1, decay=0.008), g * 0.3)

def chime(t, notes, g=0.32):
    for j, n in enumerate(notes):
        at(X, t + j * 0.11, tone(note(n), 0.5, harmonics=2, decay=0.22), g)

def pop(t, n=79, g=0.25):
    at(X, t, tone(note(n), 0.12, harmonics=2, decay=0.04), g)

def whoosh(t, dur=0.45, g=0.32):
    at(X, t - dur * 0.55, sweep_noise(dur, 4000, 400) * np.hanning(int(dur * SR)), g)

def boom(t, g=0.5):
    at(X, t, kick(1.0) * 0.8 + fft_filter(rng.standard_normal(int(0.45 * SR)), hi=800) * env(int(0.45 * SR), d=0.12) * 0.4, g)

CUTS = [3, 10.5, 14.5, 24, 29, 33.5, 39]
# Gancho: linhas batendo, tremidas, riser até o drop.
for j in range(3):
    pop(0.15 + j * 0.12 + 0.15, 57 + j * 3, 0.2)
for t in (0.45, 0.95):
    boom(t, 0.55)
at(X, 1.1, sweep_noise(1.85, 300, 7000) * np.linspace(0, 1, int(1.85 * SR)) ** 2, 0.35)
for c in CUTS:
    whoosh(c)
    boom(c, 0.6 if c in (3, 39) else 0.22)
# Vibrance: varredura subindo com o slider, ding ao passar de 100%, clique em Aplicar.
at(X, 3.8, sweep_noise(4.2, 400, 4000) * np.hanning(int(4.2 * SR)), 0.1)
pop(5.4, 84, 0.3)
pop(6.4, 88, 0.3)
click(9.0)
chime(9.05, [81, 88], 0.22)
# Perfil automático: aviso do Windows.
chime(12.3, [76, 83], 0.3)
# Replay: liga, F8, botão do mouse, salvo, vira vertical, etiquetas.
click(15.8)
click(17.7, 1.0)
click(18.2, 1.0)
chime(18.5, [81, 85, 88], 0.3)
whoosh(19.9 + 0.25, 0.6, 0.28)
pop(21.0, 81)
pop(21.4, 83)
# Raio-X: contador e cada item corrigido.
for j in range(20):
    at(X, 24.3 + j * 0.035, tone(2400, 0.02, harmonics=1, decay=0.005), 0.15)
for j, t in enumerate((25.2, 25.7, 26.2, 26.7)):
    pop(t, 76 + j * 2, 0.3)
chime(26.75, [84, 88, 91], 0.28)
# Treino: acertos (cada 6 quadros da sequência).
for f in range(5, 48, 6):
    t = 29 + 0.3 + f / 47 * 3.4
    pop(t, 79 + (f // 6) % 3 * 2, 0.28)
    at(X, t, fft_filter(rng.standard_normal(int(0.05 * SR)), lo=2500) * env(int(0.05 * SR), d=0.012), 0.22)
# E mais: um whoosh por cartão.
for j in range(5):
    whoosh(33.5 + 0.6 + j * 0.9 + 0.2, 0.35, 0.2)
# Final.
at(X, 39.8, sweep_noise(0.8, 1500, 8000) * np.hanning(int(0.8 * SR)), 0.18)
boom(40.5, 0.35)

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
fade[-int(0.6 * SR):] = np.linspace(1, 0, int(0.6 * SR))
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
