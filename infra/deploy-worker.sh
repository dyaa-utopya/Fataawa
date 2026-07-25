#!/usr/bin/env bash
# Build (Cloud Build) + déploiement du worker sur Cloud Run.
# Usage : DRIVE_ROOT_FOLDER_ID=xxxx ./infra/deploy-worker.sh
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-looker-studio-458310}"
REGION="${REGION:-us-central1}"
BUCKET="${BUCKET:-${PROJECT_ID}-fataawa-scans}"
SERVICE="fataawa-worker"
SA_EMAIL="sa-fataawa-worker@${PROJECT_ID}.iam.gserviceaccount.com"
GEMINI_MODEL="${GEMINI_MODEL:-gemini-3.1-flash-lite}"

: "${DRIVE_ROOT_FOLDER_ID:?DRIVE_ROOT_FOLDER_ID est obligatoire (ID du dossier Drive racine des livres)}"

gcloud config set project "$PROJECT_ID" >/dev/null

TAG="$(git rev-parse --short HEAD 2>/dev/null || date +%s)"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/fataawa/worker:${TAG}"

echo "── Build de l'image ${IMAGE}…"
gcloud builds submit --config infra/cloudbuild-worker.yaml --substitutions="_IMAGE=${IMAGE}" .

# WORKER_URL sert d'audience OIDC : connue seulement après le premier déploiement.
EXISTING_URL="$(gcloud run services describe "$SERVICE" --region "$REGION" \
  --format='value(status.url)' 2>/dev/null || true)"
WORKER_URL="${EXISTING_URL:-https://pending.invalid}"

echo "── Déploiement Cloud Run (${SERVICE})…"
gcloud run deploy "$SERVICE" \
  --image "$IMAGE" \
  --region "$REGION" \
  --service-account "$SA_EMAIL" \
  --no-allow-unauthenticated \
  --memory=1Gi \
  --cpu=1 \
  --timeout=900 \
  --concurrency=10 \
  --max-instances=5 \
  --set-env-vars "GOOGLE_CLOUD_PROJECT=${PROJECT_ID},REGION=${REGION},GCS_BUCKET=${BUCKET},DRIVE_ROOT_FOLDER_ID=${DRIVE_ROOT_FOLDER_ID},TASKS_SA_EMAIL=${SA_EMAIL},GEMINI_MODEL=${GEMINI_MODEL},WORKER_URL=${WORKER_URL}" \
  --set-secrets "GEMINI_API_KEY=gemini-api-key:latest"

URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')"
if [ "$URL" != "$WORKER_URL" ]; then
  echo "── Premier déploiement : enregistrement de WORKER_URL=${URL}…"
  gcloud run services update "$SERVICE" --region "$REGION" --update-env-vars "WORKER_URL=${URL}"
fi

# Cloud Tasks / Scheduler invoquent le worker avec l'OIDC de ce service account.
gcloud run services add-iam-policy-binding "$SERVICE" --region "$REGION" \
  --member="serviceAccount:$SA_EMAIL" --role=roles/run.invoker >/dev/null

echo "Worker déployé : $URL"
