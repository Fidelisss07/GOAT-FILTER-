# Vídeo do TikTok

Vídeo vertical (1080×1920, 30 fps, 45 s) com cenas 3D, efeitos e trilha sintetizada
(`audio.py`, sem samples de terceiros). Tudo é gerado por código: `index.html` desenha
cada cena em função do tempo e `render.cjs` captura quadro a quadro.

```sh
# 1. capturas reais do app (modo demonstração), uma vez:
(cd ../.. && npx vite build && npx vite preview --port 4173 &) ; node capture-ui.cjs
# 2. revisão automática: nada fora da área segura do TikTok
node render.cjs --check
# 3. vídeo final
./build.sh                 # gera out/goat-filter-tiktok.mp4
node render.cjs --preview 4,12.5   # só alguns quadros em out/preview/
```

## Colocar gravações de tela

```sh
./add-recording.sh jogo   jogada.mp4 5    # fundo da abertura (fica sem cor)
./add-recording.sh clip   ace.mp4 12      # celular vertical da cena de clipes
./add-recording.sh treino treino.mp4      # janela da cena de treino
./build.sh
```

Cada gravação usa 6 s a partir do segundo informado. Para voltar ao modelo, deixe
`slots.json` como `{}`.

Linha do tempo (s): gancho 0–3 · vibrance 3–10,5 · perfil automático 10,5–14,5 ·
replay e clipes 14,5–24 · Raio-X 24–29 · treino 29–33,5 · e mais 33,5–39 · final 39–45.
