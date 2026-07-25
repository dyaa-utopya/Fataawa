# Fataawa — pipeline Cloud Run

Pipeline complet : scans de livres arabes → OCR → structuration en fatwas → embeddings
→ recherche RAG conversationnelle, en Node.js/TypeScript sur Cloud Run, projet GCP
**`looker-studio-458310`** (`us-central1`). L'architecture et les décisions sont dans
**[ARCHITECTURE.md](./ARCHITECTURE.md)**.

**Déployé et en ligne** — Apps Script est arrêté, ce dépôt porte tout le pipeline :

| Composant | Où |
|---|---|
| Front (SPA trilingue) | **https://fataawa.web.app** (Firebase Hosting) |
| API publique | service Cloud Run **`chercherf`** (URL historique conservée) |
| Worker (privé, IAM) | service Cloud Run `fataawa-worker` |
| Données | Firestore, collection **`fatawas_db`** (7 149 fatwas) |
| Scans | bucket `looker-studio-458310-fataawa-scans` |

## Arborescence

```
packages/core     domaine partagé : config (zod), Firestore, Drive, GCS, Gemini
                  (REST + retry), embeddings, structuration, Vision, Cloud Tasks
                  fatwas.ts → mapping avec la collection historique fatawas_db
apps/worker       service Cloud Run privé « fataawa-worker » :
                  POST /tasks/ingestion   bucket (+ Drive optionnel) → pages (15 min)
                  POST /tasks/ocr-page    OCR Gemini, fallback Vision (queue ocr)
                  POST /tasks/structurer  fatwas ordonnées par livre (queue structuration)
                  POST /tasks/embed       embedding → EN_LIGNE (queue embedding)
                  POST /tasks/reembed     (ré)indexation par lots de la collection
                  POST /tasks/relance     filet de sécurité horaire
                  jobs/reembed            même travail en Cloud Run Job
                  jobs/backfill-master    import Sheet → Firestore (optionnel, inutilisé)
apps/api          API publique (service chercherf) :
                  POST /v1/ask            triage → RAG groundé → sources signées
                  GET  /v1/images/:livreId/:pageId
apps/front        SPA React trilingue FR/EN/AR (RTL), chat + clarification + sources
infra/            deploy_via_api.py (déploiement par API REST, sans gcloud)
                  *.sh (équivalents gcloud), firebase.json
```

## Données : la collection `fatawas_db`

La base de production contenait déjà **7 149 fatwas** avec ses propres noms de champs.
**Aucune migration n'a été faite** : le code lit et écrit cette collection telle quelle,
via la couche de mapping unique `packages/core/src/fatwas.ts`.

| Champ | Rôle |
|---|---|
| `texte_arabe`, `sujet_principal`, `sous_sujet`, `numero_fatwa`, `numero_page` | contenu (historique) |
| `image_source` | nom de fichier du scan (fatwas historiques) |
| `embedding` | **vecteur historique, conservé intact, plus utilisé** |
| `embedding_v2` + `embedding_model` | vecteur courant (`gemini-embedding-001`, 768d) |
| `livre_id`, `gcs_path`, `pages`, `statut` | ajoutés par le pipeline |

**Pourquoi `embedding_v2`** : mesure faite au déploiement — les vecteurs historiques ne
proviennent pas de `gemini-embedding-001` (similarité cosinus **0,04** entre le vecteur
stocké et un ré-embedding du même texte) et leur modèle d'origine a été retiré de l'API
Gemini. Ils sont donc inutilisables pour interroger la base. Le nouveau vecteur vit dans
un champ distinct, avec son propre index : le champ d'origine reste intact et un retour
arrière reste possible.

Le pipeline écrit aussi `livres/{livreId}` et `livres/{livreId}/pages/{0007}`
(`statutOcr : A_TRAITER → EN_COURS → TRAITE | QUARANTAINE`, `texteOcr`, `moteur`…).
Une page en `QUARANTAINE` **bloque la structuration de son livre** (choix assumé).

## Ajouter des scans

Déposer les images dans le bucket sous **`inbox/{nom-du-livre}/`** — le nom de fichier
doit contenir le numéro de page (`page_012.png`, `٠١٢.png`… : le **dernier nombre** du
nom fait foi). Rien n'est déplacé : l'état vit dans Firestore, un fichier déjà ingéré est
ignoré au passage suivant. L'ingestion tourne toutes les 15 minutes, ou à la demande :

```bash
gcloud scheduler jobs run fataawa-ingestion --location=us-central1
```

Le connecteur **Drive est optionnel** : renseigner `DRIVE_ROOT_FOLDER_ID` (et partager le
dossier avec `sa-fataawa-worker@looker-studio-458310.iam.gserviceaccount.com`) pour que
« A TRAITER » soit copié vers le bucket automatiquement.

### Scans des fatwas historiques

Les 4 870 scans des 10 recueils vivaient dans Drive, rangés dans les sous-dossiers du
pipeline Apps Script (`TRAITES`…). Le job `import-scans` les copie vers
`legacy/{livre}/` **et raccorde chaque fatwa à sa page** en écrivant `gcs_path` — aucun
chemin n'est deviné à la lecture. Le rapprochement se fait sur le nom de fichier
(normalisation NFC de l'arabe, séparateurs et casse ignorés, repli sur livre + numéro de
page) ; le test à blanc a raccordé 7 149 / 7 149 fatwas.

```bash
export DRIVE_SCANS_FOLDER_ID=<id_dossier_racine_des_scans>
DRY_RUN=1 python3 infra/deploy_via_api.py import_scans   # rapport sans écriture
python3 infra/deploy_via_api.py import_scans             # copie + raccordement
```

Prérequis : le dossier partagé (Lecteur) avec
`sa-fataawa-worker@looker-studio-458310.iam.gserviceaccount.com`. Le job est idempotent :
il ne recopie pas un objet déjà présent et complète les raccordements manquants.

## Développement local

```bash
npm ci
npm run typecheck && npm run lint && npm test
npm run -w @fataawa/front build     # build du front
npm run -w @fataawa/front dev       # front en dev (proxy /api → VITE_API_TARGET)
```

## Déploiement

Deux voies équivalentes. Depuis une machine **sans gcloud** (ou pour tout piloter par
API), avec un jeton `gcloud auth print-access-token` :

```bash
export ACCESS_TOKEN=ya29...        # jeton admin (1 h)
python3 infra/deploy_via_api.py all          # infra + build + worker + API + front
python3 infra/deploy_via_api.py build        # étapes individuelles, toutes idempotentes
IMAGE_TAG=<tag> python3 infra/deploy_via_api.py deploy_api
python3 infra/deploy_via_api.py hosting
IMAGE_TAG=<tag> python3 infra/deploy_via_api.py reembed   # ré-indexation complète
```

Depuis **Cloud Shell** (gcloud déjà authentifié) :

```bash
GEMINI_KEY='...' DRIVE_ROOT_FOLDER_ID=<id> ./infra/deploy-all.sh
```

La clé Gemini est un secret Secret Manager (`gemini-api-key`), restreinte à
`generativelanguage.googleapis.com`. Rotation = nouvelle version du secret +
redéploiement ; le code ne la voit que par variable d'environnement.

## Comportement de la recherche

1. **Triage** : le modèle lit la question, la reformule en question autonome (les
   références à l'historique sont résolues) et la classe claire / ambiguë.
2. **Question claire** → recherche vectorielle Firestore (`findNearest` sur
   `embedding_v2`, cosine, top 6) → réponse groundée avec citations et sources.
3. **Question ambiguë** → réponse `type: "clarification"` : « Votre question est-elle
   bien celle-ci ? » + interprétations alternatives, **sans recherche**. La recherche
   part quand l'utilisateur confirme (`questionConfirmee: true`).
4. Les sources citées sont **vérifiées contre le lot réellement récupéré** : le modèle
   ne peut pas inventer de référence.

## Sécurité

- Worker : **IAM uniquement** (Cloud Tasks / Scheduler avec jeton OIDC), jamais public.
- API : publique sans login (décision actée) — rate limiting par IP + `max-instances=3`.
- Un seul secret dans tout le système : la clé Gemini. Firestore, GCS, Drive, Vision :
  service accounts sans clé.
- **Reste à faire (côté console)** : révoquer les anciennes clés Gemini/Vision et la
  private key Firebase qui étaient en clair dans le `CONFIG.gs` d'Apps Script.

## Limites connues

- Scans > ~15 Mo : dépassent la limite d'appel inline Gemini → `QUARANTAINE` après
  3 tentatives.
- Une fatwa encore ouverte en fin de livre reste dans `livre.fatwaOuverte` tant que de
  nouvelles pages n'arrivent pas.
- Alerte e-mail sur quarantaine : à poser dans Cloud Monitoring (métrique log-based sur
  `severity=ERROR`) — non scriptée ici.
- Rate limiting par instance (en mémoire) : suffisant avec `max-instances` bas.
