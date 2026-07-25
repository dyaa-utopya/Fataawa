#!/usr/bin/env bash
# Import one-shot du MASTER_SHEET historique vers la collection `fatwas`
# (Cloud Run Job, réutilise l'image du worker).
# Usage : MASTER_SHEET_ID=xxxx [DRY_RUN=1] [MASTER_MAPPING='id=A,...'] ./infra/run-backfill.sh
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-looker-studio-458310}"
REGION="${REGION:-us-central1}"
SA_EMAIL="sa-fataawa-worker@${PROJECT_ID}.iam.gserviceaccount.com"
JOB="fataawa-backfill"
MASTER_MAPPING="${MASTER_MAPPING:-id=A,sujet=B,sousSujet=C,numero=D,texte=E}"
MASTER_RANGE="${MASTER_RANGE:-A2:Z}"
MASTER_LIVRE_ID="${MASTER_LIVRE_ID:-import-master}"
DRY_RUN="${DRY_RUN:-}"

: "${MASTER_SHEET_ID:?MASTER_SHEET_ID est obligatoire (ID du Google Sheet master)}"

gcloud config set project "$PROJECT_ID" >/dev/null

WORKER_URL="$(gcloud run services describe fataawa-worker --region "$REGION" --format='value(status.url)')"
[ -n "$WORKER_URL" ] || { echo "Worker introuvable : déployer d'abord (deploy-worker.sh)." >&2; exit 1; }

TAG="$(git rev-parse --short HEAD 2>/dev/null || date +%s)"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/fataawa/worker:${TAG}"

echo "── Build de l'image ${IMAGE}…"
gcloud builds submit --config infra/cloudbuild-worker.yaml --substitutions="_IMAGE=${IMAGE}" .

echo "── Déploiement du job ${JOB}…"
gcloud run jobs deploy "$JOB" \
  --image "$IMAGE" \
  --region "$REGION" \
  --service-account "$SA_EMAIL" \
  --task-timeout=3600 \
  --max-retries=0 \
  --command=node \
  --args=apps/worker/dist/jobs/backfill-master.js \
  --set-env-vars "GOOGLE_CLOUD_PROJECT=${PROJECT_ID},REGION=${REGION},WORKER_URL=${WORKER_URL},TASKS_SA_EMAIL=${SA_EMAIL},MASTER_SHEET_ID=${MASTER_SHEET_ID},MASTER_RANGE=${MASTER_RANGE},MASTER_MAPPING=${MASTER_MAPPING},MASTER_LIVRE_ID=${MASTER_LIVRE_ID},DRY_RUN=${DRY_RUN}"

echo "── Exécution…"
gcloud run jobs execute "$JOB" --region "$REGION" --wait
echo "Backfill terminé — vérifier les logs du job et la collection fatwas."
