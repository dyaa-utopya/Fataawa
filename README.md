# Fataawa — pipeline Cloud Run

Migration du pipeline Apps Script (OCR de scans de livres arabes → base de fatwas
interrogeable en RAG) vers Node.js/TypeScript sur Cloud Run, projet GCP
**`looker-studio-458310`** (`us-central1`). L'architecture complète et le plan de
migration sont dans **[ARCHITECTURE.md](./ARCHITECTURE.md)**.

**État : phase 1** — socle + ingestion Drive→GCS + OCR (Gemini, fallback Cloud
Vision), état en Firestore. La structuration en fatwas (phase 2) et l'API/front
(phase 3) suivent.

## Arborescence

```
packages/core     domaine partagé : config (zod), Firestore, Drive, GCS,
                  Gemini (REST + retry), Vision, Cloud Tasks, logger
apps/worker       service Cloud Run privé « fataawa-worker » :
                  POST /tasks/ingestion   (Cloud Scheduler, toutes les 15 min)
                  POST /tasks/ocr-page    (Cloud Tasks, queue « ocr »)
                  POST /tasks/relance     (Cloud Scheduler, horaire)
apps/api          squelette de la future API publique (bascule de `chercherf`
                  en phase 3 — ne pas déployer avant)
infra/            scripts gcloud : setup, build+deploy worker, schedulers
```

## Modèle de données (Firestore)

- `livres/{livreId}` — livreId = ID du dossier Drive du livre ; compteurs,
  curseur de structuration (phase 2).
- `livres/{livreId}/pages/{0007}` — un document par scan : `gcsPath`, `sha256`,
  `statutOcr` (`A_TRAITER → EN_COURS → TRAITE | QUARANTAINE`), `texteOcr`,
  `moteur` (`GEMINI`/`VISION`), `tentatives`, `derniereErreur`.

Convention de nommage des scans : le **dernier nombre du nom de fichier est le
numéro de page** (`page_012.png`, `٠١٢.png`…). Un fichier sans nombre est
ignoré et signalé en erreur dans les logs.

## Développement local

```bash
npm ci
npm run typecheck
npm test
npm run lint
```

Lancement local du worker (avec un compte ayant les accès GCP) :
`cp .env.example .env`, remplir, puis
`npm run build && node --env-file=.env apps/worker/dist/server.js`.

## Déploiement (ordre)

```bash
# 1. Infra (APIs, bucket, SA, queue, secret, index) — idempotent
./infra/setup.sh

# 2. Clé Gemini dans Secret Manager (la clé actuelle convient ; pour la
#    rotation ultérieure : ajouter une version puis redéployer)
printf '%s' 'LA_CLE_GEMINI' | gcloud secrets versions add gemini-api-key --data-file=-

# 3. Partager le dossier Drive racine des livres avec le service account
#    sa-fataawa-worker@looker-studio-458310.iam.gserviceaccount.com (rôle Éditeur)

# 4. Déployer le worker
DRIVE_ROOT_FOLDER_ID=<id_dossier_drive_racine> ./infra/deploy-worker.sh

# 5. Mettre en place les déclencheurs
./infra/setup-scheduler.sh
```

### Validation avant bascule

1. **Tester d'abord sur un dossier Drive de test** (une copie d'un livre) en
   pointant `DRIVE_ROOT_FOLDER_ID` dessus : vérifier dans la console Firestore
   que les pages passent `A_TRAITER → TRAITE` avec un `texteOcr` correct, et
   dans GCS que les scans sont copiés.
   Déclenchement manuel : `gcloud scheduler jobs run fataawa-ingestion --location=us-central1`.
2. **Bascule** : couper le trigger GAS `processGeminiProduction50()` (OCR),
   puis pointer `DRIVE_ROOT_FOLDER_ID` sur le vrai dossier racine et redéployer.
   ⚠️ Ne jamais faire tourner les deux OCR en même temps sur les mêmes
   dossiers : les deux systèmes déplacent les fichiers de « A TRAITER » vers
   « TRAITES ».
3. Les autres robots GAS (structuration, master, export) continuent de tourner
   jusqu'à la phase 2 — ils travaillent sur les Docs/Sheets existants et ne
   sont pas impactés.

## Limites connues (phase 1)

- La structuration en fatwas n'existe pas encore côté Cloud Run : les pages
  s'accumulent en `TRAITE` dans Firestore, prêtes pour la phase 2.
- Les scans très lourds (>15 Mo) peuvent dépasser la limite d'appel inline
  Gemini : ils finiront en `QUARANTAINE` après 3 tentatives.
- L'alerte e-mail sur mise en quarantaine (Cloud Monitoring, métrique sur les
  logs `severity=ERROR`) sera posée avec le dashboard en fin de phase 2.
