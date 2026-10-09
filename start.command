#!/bin/bash
# Двойной клик — запускает квиз на http://localhost:8765 и открывает браузер.
# Закрыть: Ctrl+C или просто закрыть окно терминала.
cd "$(dirname "$0")" || exit 1
PORT=8765
URL="http://localhost:$PORT"

if lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  open "$URL"
  exit 0
fi

(sleep 1 && open "$URL") &
echo "Квиз на диване: $URL"
echo "Чтобы остановить — Ctrl+C или закройте это окно."
exec python3 server.py "$PORT"
