#!/bin/zsh
cd "${0:A:h}"
if curl --silent --fail http://127.0.0.1:4173/ >/dev/null; then
  open http://127.0.0.1:4173/
else
  npm run dev -- --open
fi
