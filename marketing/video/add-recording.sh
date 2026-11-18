#!/usr/bin/env bash
# Coloca uma gravação de tela num espaço do vídeo e atualiza slots.json.
#
# Uso: ./add-recording.sh <espaço> <arquivo.mp4> [início_em_segundos] [legenda]
#   espaços: jogo (fundo da abertura), clip (celular vertical), treino (janela da mira)
# Exemplo: ./add-recording.sh clip ~/Downloads/ace.mp4 12 "ACE no Ascent"
set -euo pipefail
cd "$(dirname "$0")"
SLOT="$1"; SRC="$2"; START="${3:-0}"; LABEL="${4:-}"
case "$SLOT" in
  clip) SIZE="436:716" ;;              # celular vertical
  jogo) SIZE="1080:1920" ;;            # tela inteira
  treino) SIZE="2560:1600" ;;          # janela do app (16:10)
  *) echo "espaço desconhecido: $SLOT (use jogo, clip ou treino)"; exit 1 ;;
esac
DIR="assets/slots/$SLOT"
rm -rf "$DIR"; mkdir -p "$DIR"
# 6 s a 30 fps, cortado para preencher o espaço sem distorcer.
ffmpeg -hide_banner -loglevel error -ss "$START" -i "$SRC" -t 6 \
  -vf "fps=30,scale=${SIZE}:force_original_aspect_ratio=increase,crop=${SIZE}" -q:v 3 "$DIR/%05d.jpg"
N=$(ls "$DIR" | wc -l)
python3 - "$SLOT" "$DIR" "$N" "$LABEL" <<'PY'
import json, sys
slot, d, n, label = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4]
try:
    data = json.load(open("slots.json"))
except Exception:
    data = {}
entry = {"dir": d, "frames": n, "fps": 30}
if label:
    entry["label"] = label
data[slot] = entry
json.dump(data, open("slots.json", "w"), indent=2, ensure_ascii=False)
print(f"{slot}: {n} quadros")
PY
