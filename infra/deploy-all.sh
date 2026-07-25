#!/usr/bin/env bash
# Déploiement complet en UNE commande, depuis une machine authentifiée sur le
# projet GCP — le plus simple : Cloud Shell (https://shell.cloud.google.com),
# déjà authentifié, gcloud et firebase-tools disponibles.
#
# Usage :
#   DRIVE_ROOT_FOLDER_ID=<id_dossier_drive_racine> ./infra/deploy-all.sh
#
# Optionnel :
#   GEMINI_KEY='...'   pour alimenter le secret s'il est encore vide
#   PROJECT_ID, REGION pour surcharger les défauts
#
# Ce script est idempotent : relançable après un échec, il reprend où il en était.
set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT_ID="${PROJECT_ID:-looker-studio-458310}"
export PROJECT_ID
: "${DRIVE_ROOT_FOLDER_ID:?DRIVE_ROOT_FOLDER_ID est obligatoire (ID du dossier Drive racine des livres)}"

command -v gcloud >/dev/null || { echo "gcloud introuvable — lancer depuis Cloud Shell."; exit 1; }
command -v node >/dev/null || { echo "node introuvable — Cloud Shell : nvm install 22 && nvm use 22"; exit 1; }
NODE_MAJOR="$(node -v | sed 's/^v//;s/\..*//')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "Node >= 20 requis pour le build du front (trouvé : $(node -v))."
  echo "Cloud Shell : nvm install 22 && nvm use 22"
  exit 1
fi

gcloud config set project "$PROJECT_ID" >/dev/null

echo "═══ 1/6 — Infra (APIs, bucket, service accounts, queues, secret, index)"
./infra/setup.sh

echo "═══ 2/6 — Clé Gemini dans Secret Manager"
if ! gcloud secrets versions list gemini-api-key --filter="state=ENABLED" \
  --format="value(name)" 2>/dev/null | grep -q .; then
  if [ -n "${GEMINI_KEY:-}" ]; then
    printf '%s' "$GEMINI_KEY" | gcloud secrets versions add gemini-api-key --data-file=-
    echo "Clé enregistrée."
  else
    echo "Le secret gemini-api-key est vide. Relancer avec GEMINI_KEY='LA_CLE' devant la"
    echo "commande, ou l'alimenter d'abord :"
    echo "  printf '%s' 'LA_CLE' | gcloud secrets versions add gemini-api-key --data-file=-"
    exit 1
  fi
else
  echo "Secret déjà alimenté."
fi

echo "═══ 3/6 — Worker (fataawa-worker)"
DRIVE_ROOT_FOLDER_ID="$DRIVE_ROOT_FOLDER_ID" ./infra/deploy-worker.sh

echo "═══ 4/6 — Déclencheurs Cloud Scheduler"
./infra/setup-scheduler.sh

echo "═══ 5/6 — API publique (chercherf)"
./infra/deploy-api.sh

echo "═══ 6/6 — Front (Firebase Hosting)"
[ -d node_modules ] || npm ci
./infra/deploy-front.sh

SA_WORKER="sa-fataawa-worker@${PROJECT_ID}.iam.gserviceaccount.com"
cat <<EOF

════════════════════════════════════════════════════════════════════
Déploiement terminé.

À faire à la main (une fois) :
 1. Partager le dossier Drive racine des livres avec :
      ${SA_WORKER}   (rôle Éditeur)
    et le MASTER_SHEET en lecture avec ce même compte.
 2. Backfill de l'historique (vérifier le mapping en DRY_RUN d'abord) :
      MASTER_SHEET_ID=<id> DRY_RUN=1 ./infra/run-backfill.sh
      MASTER_SHEET_ID=<id>           ./infra/run-backfill.sh
 3. Test de bout en bout : déposer des scans dans « livre / A TRAITER » puis
      gcloud scheduler jobs run fataawa-ingestion --location=us-central1
════════════════════════════════════════════════════════════════════
EOF
