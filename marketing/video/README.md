# Vídeo do TikTok

Vídeo vertical (1080×1920, 30 fps, ~27 s) com cenas 3D, efeitos e trilha sintetizada
(`audio.py`, sem samples de terceiros). Tudo é gerado por código: `index.html` desenha
cada cena em função do tempo e `render.cjs` captura quadro a quadro.

```sh
./build.sh                 # gera out/goat-filter-tiktok.mp4
node render.cjs --preview 4,12.5   # só alguns quadros em out/preview/
```

## Colocar gravações de tela

```sh
./add-recording.sh clip  jogada.mp4 12 "ACE no Ascent"   # celular da cena "Aperta e clipa"
./add-recording.sh app   app.mp4                          # cartão da cena "Um clique"
./add-recording.sh treino treino.mp4                      # cena da mira
./add-recording.sh site  site.mp4                         # cena do site
./build.sh
```

Cada gravação usa 6 s a partir do segundo informado. Para voltar ao modelo, deixe
`slots.json` como `{}`.

Linha do tempo (s): gancho 0–2,5 · antes/depois 2,5–6 · app 6–10 · clipes 10–14,5 ·
Raio-X 14,5–18 · treino 18–21 · site 21–23,5 · final 23,5–27.
