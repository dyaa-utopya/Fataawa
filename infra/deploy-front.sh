#!/usr/bin/env bash
# Build du front React + déploiement Firebase Hosting sur le site nommé
# défini dans firebase.json (fataawa → https://fataawa.web.app), avec
# rewrite /api/** → service Cloud Run chercherf.
# Auth : automatique dans Cloud Shell ; sinon `npx firebase-tools login` une fois.
set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT_ID="${PROJECT_ID:-looker-studio-458310}"
SITE="$(node -e "console.log(require('./firebase.json').hosting.site)")"

npm run -w @fataawa/front build

# créer le site Hosting nommé s'il n'existe pas encore dans le projet
if ! npx --yes firebase-tools hosting:sites:list --project "$PROJECT_ID" 2>/dev/null | grep -q "${SITE}\.web\.app"; then
  if ! npx --yes firebase-tools hosting:sites:create "$SITE" --project "$PROJECT_ID"; then
    echo ""
    echo "⚠ Impossible de créer le site « ${SITE} » : le nom est probablement déjà pris"
    echo "  globalement sur Firebase. Choisir un autre nom (ex. fataawa-app) :"
    echo "  1. le changer dans firebase.json (champ \"site\")"
    echo "  2. relancer ce script"
    exit 1
  fi
fi

npx --yes firebase-tools deploy --only hosting --project "$PROJECT_ID"
echo ""
echo "Front en ligne : https://${SITE}.web.app"
