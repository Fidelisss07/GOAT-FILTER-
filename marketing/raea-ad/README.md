# Anúncio no raea (teste)

Anúncio de 20 s (1080x1920, 30 fps) feito com o [raea](https://github.com/shinyobjectz/raea) 0.1.6:
cenas em React/TSX (`edit.tsx`), música em Tone.js no próprio arquivo, render na GPU.

```sh
raea render edit.tsx -o out/goat-filter-raea.mp4 --manifest out/render.json --quality high
raea check out/goat-filter-raea.mp4 --manifest out/render.json --shape 9:16 --platform tiktok
raea render edit.tsx --at 85,290 -o stills/     # só alguns quadros
```

Cenas (compassos de 120 bpm, 60 quadros): gancho 0–60 · cor 60–180 · clipe 180–300 · extras 300–420 ·
final 420–600. Sem placa de vídeo, funciona com o Vulkan por software (Mesa llvmpipe).
