#!/usr/bin/env bash
# Crée/actualise les déclencheurs Cloud Scheduler (remplacent les triggers GAS).
# À lancer après le premier deploy-worker.sh.
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-looker-studio-458310}"
REGION="${REGION:-us-central1}"
SERVICE="fataawa-worker"
SA_EMAIL="sa-fataawa-worker@${PROJECT_ID}.iam.gserviceaccount.com"

gcloud config set project "$PROJECT_ID" >/dev/null

URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')"
[ -n "$URL" ] || { echo "Service $SERVICE introuvable : déployer d'abord." >&2; exit 1; }

upsert_job() {
  local name="$1" schedule="$2" path="$3"
  if gcloud scheduler jobs describe "$name" --location="$REGION" >/dev/null 2>&1; then
    gcloud scheduler jobs update http "$name" --location="$REGION" \
      --schedule="$schedule" --uri="${URL}${path}" --http-method=POST \
      --oidc-service-account-email="$SA_EMAIL" --oidc-token-audience="$URL"
  else
    gcloud scheduler jobs create http "$name" --location="$REGION" \
      --schedule="$schedule" --uri="${URL}${path}" --http-method=POST \
      --oidc-service-account-email="$SA_EMAIL" --oidc-token-audience="$URL"
  fi
}

# Ingestion Drive → GCS toutes les 15 minutes
upsert_job fataawa-ingestion "*/15 * * * *" "/tasks/ingestion"
# Balayage de rattrapage horaire (pages bloquées EN_COURS / tâches perdues)
upsert_job fataawa-relance "17 * * * *" "/tasks/relance"

echo "Déclencheurs en place sur $URL"
