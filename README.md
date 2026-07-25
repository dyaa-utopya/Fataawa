# Fataawa — pipeline Cloud Run

Pipeline complet : scans de livres arabes (Drive) → OCR → structuration en fatwas →
embeddings → recherche RAG conversationnelle, en Node.js/TypeScript sur Cloud Run,
projet GCP **`looker-studio-458310`** (`us-central1`). L'architecture et le plan de
migration sont dans **[ARCHITECTURE.md](./ARCHITECTURE.md)**.

**État : phases 1 à 3 livrées** (les robots Apps Script sont arrêtés, ce dépôt porte
tout le pipeline). Reste côté GCP : dérouler le déploiement ci-dessous, et la
révocation des anciennes clés exposées dans `CONFIG.gs` (phase 0, toujours d'actualité).

## Arborescence

```
packages/core     domaine partagé : config (zod), Firestore, Drive, GCS, Gemini
                  (REST + retry), embeddings, structuration, Vision, Cloud Tasks
apps/worker       service Cloud Run privé « fataawa-worker » :
                  POST /tasks/ingestion   Drive « A TRAITER » → GCS + Firestore (15 min)
                  POST /tasks/ocr-page    OCR Gemini, fallback Vision (queue ocr)
                  POST /tasks/structurer  fatwas ordonnées par livre (queue structuration)
                  POST /tasks/embed       embeddings → EN_LIGNE (queue embedding)
                  POST /tasks/relance     filet de sécurité horaire
                  jobs/backfill-master    import one-shot du MASTER_SHEET historique
apps/api          API publique (déployée sur le service EXISTANT « chercherf ») :
                  POST /v1/ask            RAG conversationnel groundé + sources signées
                  GET  /v1/images/:livreId/:pageId   URL signée fraîche d'un scan
apps/front        SPA React trilingue FR/EN/AR (RTL), chat + suggestions + sources,
                  servie par Firebase Hosting (rewrite /api/** → chercherf)
infra/            scripts gcloud : setup, deploys, schedulers, backfill
```

## Modèle de données (Firestore)

- `livres/{livreId}` — livreId = ID du dossier Drive ; compteurs, `curseurStructuration`
  (dernière page structurée), `fatwaOuverte` (fatwa coupée en fin de page, la « SUITE »),
  `structLease` (une seule structuration active par livre).
- `livres/{livreId}/pages/{0007}` — un document par scan : `gcsPath`, `statutOcr`
  (`A_TRAITER → EN_COURS → TRAITE | QUARANTAINE`), `texteOcr`, `moteur`, tentatives.
  Une page en `QUARANTAINE` **bloque la structuration de son livre** (choix assumé).
- `fatwas/{livreId_numero}` — l'ID est la déduplication ; texte, sujet, pages sources,
  `embedding` (vecteur 768, index Firestore), `statut STRUCTUREE → EN_LIGNE`.
- `conversations/{id}/messages` — historique du chat public (ID anonyme côté client).

Convention de nommage des scans : le **dernier nombre du nom de fichier est le numéro
de page** (`page_012.png`, `٠١٢.png`…). Un fichier sans nombre est ignoré et signalé.

## Développement local

```bash
npm ci
npm run typecheck && npm run lint && npm test
npm run -w @fataawa/front build        # build du front
npm run -w @fataawa/front dev          # front en dev (proxy /api → VITE_API_TARGET)
```

Worker ou API en local (avec un compte ayant les accès GCP) : `cp .env.example .env`,
remplir, puis `npm run build && node --env-file=.env apps/worker/dist/server.js`
(ou `apps/api/dist/server.js`).

## Déploiement (ordre complet)

```bash
# 1. Infra : APIs, bucket, 2 service accounts, 3 queues, secret, index (dont vectoriel)
./infra/setup.sh

# 2. Clé Gemini dans Secret Manager (la clé actuelle convient ; rotation plus tard =
#    nouvelle version du secret + redéploiement)
printf '%s' 'LA_CLE_GEMINI' | gcloud secrets versions add gemini-api-key --data-file=-

# 3. Partages : le dossier Drive racine des livres ET le MASTER_SHEET avec
#    sa-fataawa-worker@looker-studio-458310.iam.gserviceaccount.com (Éditeur / Lecteur)

# 4. Worker + déclencheurs
DRIVE_ROOT_FOLDER_ID=<id_dossier_racine> ./infra/deploy-worker.sh
./infra/setup-scheduler.sh

# 5. Backfill du MASTER_SHEET historique → collection fatwas
#    D'abord en DRY_RUN pour vérifier le mapping des colonnes (voir logs du job),
#    ajuster MASTER_MAPPING si besoin (défaut : id=A,sujet=B,sousSujet=C,numero=D,texte=E)
MASTER_SHEET_ID=<id_sheet> DRY_RUN=1 ./infra/run-backfill.sh
MASTER_SHEET_ID=<id_sheet> ./infra/run-backfill.sh

# 6. API publique — REMPLACE la révision actuelle du service chercherf (URL conservée)
./infra/deploy-api.sh

# 7. Front sur Firebase Hosting (une fois : npx firebase-tools login)
./infra/deploy-front.sh
```

### Validation

1. **OCR** : déposer quelques scans dans `livre/A TRAITER`, lancer
   `gcloud scheduler jobs run fataawa-ingestion --location=us-central1`, vérifier dans
   Firestore que les pages passent en `TRAITE` puis que des documents `fatwas/` avec
   `statut: EN_LIGNE` apparaissent.
2. **API** : `curl -s -X POST <url_chercherf>/v1/ask -H 'content-type: application/json'
   -d '{"question":"…","langue":"fr"}'` → réponse groundée + sources avec `url_image`.
3. **Front** : l'URL Firebase Hosting sert le chat ; `/api/v1/ask` doit répondre à
   travers le rewrite (même origine).

## Sécurité (rappel)

- Worker : IAM uniquement (Cloud Tasks/Scheduler avec OIDC), jamais public.
- API : publique sans login (décision actée) — rate limiting par IP + `max-instances=3`.
  Durcissement possible ensuite : App Check.
- Unique secret : la clé API Gemini dans Secret Manager. Vision, Firestore, GCS, Drive,
  Sheets : service accounts sans clé.
- **Phase 0 restante** : révoquer les anciennes clés Gemini/Vision et la private key
  Firebase présentes en clair dans le `CONFIG.gs` de l'ancien projet Apps Script.

## Limites connues

- Scans > ~15 Mo : dépassent la limite d'appel inline Gemini → `QUARANTAINE` après
  3 tentatives.
- Une fatwa encore ouverte en toute fin de livre reste dans `livre.fatwaOuverte`
  (visible en admin) tant que de nouvelles pages n'arrivent pas.
- Alerte e-mail sur quarantaine : à poser dans Cloud Monitoring (métrique log-based
  sur `severity=ERROR`, message « QUARANTAINE ») — non scriptée ici.
- Rate limiting par instance (en mémoire) : suffisant avec `max-instances` bas.
