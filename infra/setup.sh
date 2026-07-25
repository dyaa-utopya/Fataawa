#!/usr/bin/env bash
# Mise en place unique de l'infra GCP (idempotent, rejouable).
# Usage : PROJECT_ID=looker-studio-458310 ./infra/setup.sh
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-looker-studio-458310}"
REGION="${REGION:-us-central1}"
BUCKET="${BUCKET:-${PROJECT_ID}-fataawa-scans}"
SA_NAME="sa-fataawa-worker"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
SA_API_NAME="sa-fataawa-api"
SA_API_EMAIL="${SA_API_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

gcloud config set project "$PROJECT_ID" >/dev/null

echo "── Activation des APIs…"
gcloud services enable \
  run.googleapis.com \
  cloudtasks.googleapis.com \
  cloudscheduler.googleapis.com \
  firestore.googleapis.com \
  storage.googleapis.com \
  vision.googleapis.com \
  drive.googleapis.com \
  sheets.googleapis.com \
  secretmanager.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  iamcredentials.googleapis.com \
  firebasehosting.googleapis.com

echo "── Dépôt Artifact Registry…"
gcloud artifacts repositories describe fataawa --location="$REGION" >/dev/null 2>&1 ||
  gcloud artifacts repositories create fataawa --repository-format=docker --location="$REGION"

echo "── Bucket GCS des scans…"
gcloud storage buckets describe "gs://$BUCKET" >/dev/null 2>&1 ||
  gcloud storage buckets create "gs://$BUCKET" --location="$REGION" --uniform-bucket-level-access

echo "── Service account du worker…"
gcloud iam service-accounts describe "$SA_EMAIL" >/dev/null 2>&1 ||
  gcloud iam service-accounts create "$SA_NAME" --display-name="Fataawa worker"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$SA_EMAIL" --role=roles/datastore.user --condition=None >/dev/null
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$SA_EMAIL" --role=roles/cloudtasks.enqueuer --condition=None >/dev/null
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" \
  --member="serviceAccount:$SA_EMAIL" --role=roles/storage.objectAdmin >/dev/null
# nécessaire pour émettre des jetons OIDC en son propre nom (tâches Cloud Tasks)
gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" \
  --member="serviceAccount:$SA_EMAIL" --role=roles/iam.serviceAccountUser >/dev/null

echo "── Service account de l'API publique…"
gcloud iam service-accounts describe "$SA_API_EMAIL" >/dev/null 2>&1 ||
  gcloud iam service-accounts create "$SA_API_NAME" --display-name="Fataawa API"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$SA_API_EMAIL" --role=roles/datastore.user --condition=None >/dev/null
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" \
  --member="serviceAccount:$SA_API_EMAIL" --role=roles/storage.objectViewer >/dev/null
# signature d'URLs V4 sans clé privée (IAM signBlob sur lui-même)
gcloud iam service-accounts add-iam-policy-binding "$SA_API_EMAIL" \
  --member="serviceAccount:$SA_API_EMAIL" --role=roles/iam.serviceAccountTokenCreator >/dev/null

echo "── Queues Cloud Tasks…"
create_or_update_queue() {
  local name="$1"; shift
  gcloud tasks queues describe "$name" --location="$REGION" >/dev/null 2>&1 ||
    gcloud tasks queues create "$name" --location="$REGION"
  gcloud tasks queues update "$name" --location="$REGION" "$@" >/dev/null
}
# ocr : débit calé sur le quota Gemini (remplace le « barillet » de clés)
create_or_update_queue ocr \
  --max-dispatches-per-second=2 --max-concurrent-dispatches=5 \
  --max-attempts=10 --min-backoff=10s --max-backoff=300s
# structuration : séquentiel par livre (bail applicatif), parallèle entre livres
create_or_update_queue structuration \
  --max-dispatches-per-second=2 --max-concurrent-dispatches=5 \
  --max-attempts=8 --min-backoff=30s --max-backoff=600s
# embedding : appels courts et bon marché
create_or_update_queue embedding \
  --max-dispatches-per-second=5 --max-concurrent-dispatches=10 \
  --max-attempts=8 --min-backoff=10s --max-backoff=300s

echo "── Secret gemini-api-key…"
gcloud secrets describe gemini-api-key >/dev/null 2>&1 ||
  gcloud secrets create gemini-api-key --replication-policy=automatic
gcloud secrets add-iam-policy-binding gemini-api-key \
  --member="serviceAccount:$SA_EMAIL" --role=roles/secretmanager.secretAccessor >/dev/null
gcloud secrets add-iam-policy-binding gemini-api-key \
  --member="serviceAccount:$SA_API_EMAIL" --role=roles/secretmanager.secretAccessor >/dev/null

echo "── Index Firestore…"
# balayage de relance (collection group pages)
gcloud firestore indexes composite create \
  --collection-group=pages \
  --query-scope=COLLECTION_GROUP \
  --field-config=field-path=statutOcr,order=ascending \
  --field-config=field-path=majAt,order=ascending 2>/dev/null || true
# index vectoriel du RAG (fatwas.embedding, 768 dimensions, cosine via findNearest)
gcloud firestore indexes composite create \
  --collection-group=fatwas \
  --query-scope=COLLECTION \
  --field-config='field-path=embedding,vector-config={"dimension":"768","flat":"{}"}' 2>/dev/null || true

cat <<EOF

Infra prête. Étapes manuelles restantes :
 1. Mettre la clé Gemini dans le secret (la clé actuelle convient, rotation plus tard) :
      printf '%s' 'LA_CLE' | gcloud secrets versions add gemini-api-key --data-file=-
 2. Partager le dossier Drive racine des livres avec :  $SA_EMAIL  (rôle Éditeur)
    (et le MASTER_SHEET en lecture avec ce même compte, pour le backfill)
 3. Worker :     DRIVE_ROOT_FOLDER_ID=... ./infra/deploy-worker.sh
 4. Planifier :  ./infra/setup-scheduler.sh
 5. Backfill :   MASTER_SHEET_ID=... DRY_RUN=1 ./infra/run-backfill.sh   (puis sans DRY_RUN)
 6. API :        ./infra/deploy-api.sh        (remplace le service chercherf)
 7. Front :      ./infra/deploy-front.sh      (Firebase Hosting)
EOF
