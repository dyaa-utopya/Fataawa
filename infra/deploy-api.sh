#!/usr/bin/env bash
# Build + déploiement de l'API publique sur le service Cloud Run EXISTANT
# `chercherf` (URL conservée). L'ancien backend (route {question}/UPLOAD des
# robots Apps Script, désormais arrêtés) est remplacé par cette version.
# Usage : ./infra/deploy-api.sh
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-looker-studio-458310}"
REGION="${REGION:-us-central1}"
BUCKET="${BUCKET:-${PROJECT_ID}-fataawa-scans}"
SERVICE="${API_SERVICE:-chercherf}"
SA_EMAIL="sa-fataawa-api@${PROJECT_ID}.iam.gserviceaccount.com"
GEMINI_MODEL="${GEMINI_MODEL:-gemini-3.1-flash-lite}"
EMBEDDING_MODEL="${EMBEDDING_MODEL:-gemini-embedding-001}"

gcloud config set project "$PROJECT_ID" >/dev/null

TAG="$(git rev-parse --short HEAD 2>/dev/null || date +%s)"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/fataawa/api:${TAG}"

echo "── Build de l'image ${IMAGE}…"
gcloud builds submit --config infra/cloudbuild-api.yaml --substitutions="_IMAGE=${IMAGE}" .

echo "── Déploiement Cloud Run (${SERVICE}) — remplace la révision actuelle…"
gcloud run deploy "$SERVICE" \
  --image "$IMAGE" \
  --region "$REGION" \
  --service-account "$SA_EMAIL" \
  --allow-unauthenticated \
  --memory=512Mi \
  --cpu=1 \
  --timeout=120 \
  --concurrency=40 \
  --max-instances=3 \
  --set-env-vars "GOOGLE_CLOUD_PROJECT=${PROJECT_ID},GCS_BUCKET=${BUCKET},GEMINI_MODEL=${GEMINI_MODEL},EMBEDDING_MODEL=${EMBEDDING_MODEL}" \
  --set-secrets "GEMINI_API_KEY=gemini-api-key:latest"

URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')"
echo "API déployée : $URL"
echo "Test : curl -s -X POST $URL/v1/ask -H 'content-type: application/json' -d '{\"question\":\"...\"}'"
