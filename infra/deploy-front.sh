#!/usr/bin/env bash
# Build du front React + déploiement Firebase Hosting (rewrite /api/** → chercherf).
# Prérequis : `npx firebase-tools login` fait une fois sur le poste.
# Usage : ./infra/deploy-front.sh
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-looker-studio-458310}"

npm run -w @fataawa/front build
npx --yes firebase-tools deploy --only hosting --project "$PROJECT_ID"
