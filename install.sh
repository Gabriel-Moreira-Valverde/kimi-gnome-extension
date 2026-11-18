#!/usr/bin/env bash
# Instala o Kimi para o usuário atual (não precisa de sudo).
set -euo pipefail

UUID="kimi@local"
ORIGEM="$(cd "$(dirname "$0")" && pwd)"
DESTINO="$HOME/.local/share/gnome-shell/extensions/$UUID"

mkdir -p "$DESTINO/icons"
cp "$ORIGEM"/{extension.js,lib.js,dados.js,stylesheet.css,metadata.json} "$DESTINO/"
cp "$ORIGEM"/icons/*.svg "$DESTINO/icons/"

# ativa a extensão (passa a valer no próximo login)
atuais="$(gsettings get org.gnome.shell enabled-extensions)"
if [[ "$atuais" != *"$UUID"* ]]; then
    if [[ "$atuais" == "@as []" || "$atuais" == "[]" ]]; then
        gsettings set org.gnome.shell enabled-extensions "['$UUID']"
    else
        gsettings set org.gnome.shell enabled-extensions "${atuais%]}, '$UUID']"
    fi
fi

echo "Kimi instalado em $DESTINO"
echo "Saia da sessão e entre de novo para ele aparecer na barra superior."
