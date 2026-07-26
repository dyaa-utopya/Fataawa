#!/usr/bin/env python3
"""Déploiement complet de Fataawa en pilotant les APIs REST Google Cloud.

Écrit pour les environnements sans gcloud (sandbox Claude Code) : équivalent de
deploy-all.sh, authentifié par un jeton d'accès OAuth court (1 h) fourni via
ACCESS_TOKEN — par exemple la sortie de `gcloud auth print-access-token`.

Usage :
  ACCESS_TOKEN=ya29... GEMINI_KEY=... DRIVE_ROOT_FOLDER_ID=... \
    python3 infra/deploy_via_api.py all

Étapes individuelles : apis, iam, bucket, queues, secret, indexes, build,
deploy_worker, scheduler, deploy_api, hosting. Tout est idempotent.
"""

from __future__ import annotations

import base64
import gzip
import hashlib
import io
import json
import os
import ssl
import subprocess
import sys
import tarfile
import time
import urllib.error
import urllib.request

PROJECT = os.environ.get("PROJECT_ID", "looker-studio-458310")
REGION = os.environ.get("REGION", "us-central1")
BUCKET = os.environ.get("BUCKET", f"{PROJECT}-fataawa-scans")
TOKEN = os.environ.get("ACCESS_TOKEN", "")
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-3.1-flash-lite")
EMBEDDING_MODEL = os.environ.get("EMBEDDING_MODEL", "gemini-embedding-001")
# Collections de fatwas, en un seul endroit. Le retraitement des recueils écrit
# dans une collection neuve pendant que l'API continue de servir l'ancienne ;
# les deux valeurs sont journalisées à chaque déploiement, parce qu'un worker
# redéployé sans cette variable écrivait jusqu'ici droit dans la production.
# Depuis la bascule du 26/07, les deux pointent sur la collection retraitée :
# l'ancienne (fatawas_db) reste en place, intacte, pour un retour arrière.
FATWAS_ECRITURE = os.environ.get("FATWAS_COLLECTION", "fatawas_v2")
FATWAS_LECTURE = os.environ.get("FATWAS_COLLECTION_API", "fatawas_v2")
SA_WORKER = f"sa-fataawa-worker@{PROJECT}.iam.gserviceaccount.com"
SA_API = f"sa-fataawa-api@{PROJECT}.iam.gserviceaccount.com"
CA_BUNDLE = "/root/.ccr/ca-bundle.crt"
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

_ctx = ssl.create_default_context(
    cafile=CA_BUNDLE if os.path.exists(CA_BUNDLE) else None
)


class ApiError(RuntimeError):
    def __init__(self, status: int, body: str, url: str):
        super().__init__(f"HTTP {status} sur {url} : {body[:800]}")
        self.status = status
        self.body = body


def req(
    method: str,
    url: str,
    body: object | None = None,
    raw: bytes | None = None,
    content_type: str = "application/json",
    ok_statuses: tuple[int, ...] = (200, 201, 204),
) -> dict:
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    r = urllib.request.Request(url, data=data, method=method)
    r.add_header("Authorization", f"Bearer {TOKEN}")
    r.add_header("x-goog-user-project", PROJECT)
    if data is not None:
        r.add_header("Content-Type", content_type)
    try:
        with urllib.request.urlopen(r, context=_ctx, timeout=120) as resp:
            payload = resp.read()
            if resp.status not in ok_statuses:
                raise ApiError(resp.status, payload.decode(errors="replace"), url)
            return json.loads(payload) if payload else {}
    except urllib.error.HTTPError as e:
        raise ApiError(e.code, e.read().decode(errors="replace"), url) from None


def exists(url: str) -> dict | None:
    try:
        return req("GET", url)
    except ApiError as e:
        if e.status in (403, 404):
            return None
        raise


def poll_lro(base: str, name: str, label: str, timeout_s: int = 600) -> dict:
    """Attend la fin d'une long-running operation ({base}/{name})."""
    start = time.time()
    while True:
        op = req("GET", f"{base}/{name}")
        if op.get("done"):
            if "error" in op:
                raise RuntimeError(f"{label} : {json.dumps(op['error'])[:500]}")
            return op.get("response", {})
        if time.time() - start > timeout_s:
            raise RuntimeError(f"{label} : délai dépassé ({timeout_s}s)")
        time.sleep(4)


def log(msg: str) -> None:
    print(f"── {msg}", flush=True)


def retry_propagation(fn, label: str, attempts: int = 8, wait: int = 10):
    """Rejoue une écriture IAM le temps qu'un service account fraîchement créé se propage."""
    for i in range(attempts):
        try:
            return fn()
        except ApiError as e:
            if i < attempts - 1 and e.status in (400, 404) and "does not exist" in e.body:
                log(f"{label} : propagation IAM en cours, nouvel essai dans {wait}s")
                time.sleep(wait)
                continue
            raise


# ─────────────────────────────── étapes ────────────────────────────────────


def step_apis() -> None:
    log("Activation des APIs")
    services = [
        "run.googleapis.com", "cloudtasks.googleapis.com",
        "cloudscheduler.googleapis.com", "firestore.googleapis.com",
        "storage.googleapis.com", "vision.googleapis.com",
        "drive.googleapis.com", "sheets.googleapis.com",
        "secretmanager.googleapis.com", "artifactregistry.googleapis.com",
        "cloudbuild.googleapis.com", "iamcredentials.googleapis.com",
        "firebasehosting.googleapis.com",
    ]
    op = req(
        "POST",
        f"https://serviceusage.googleapis.com/v1/projects/{PROJECT}/services:batchEnable",
        {"serviceIds": services},
    )
    if not op.get("done"):
        poll_lro("https://serviceusage.googleapis.com/v1", op["name"], "activation APIs")
    log("APIs actives")


def _merge_bindings(policy: dict, wanted: list[tuple[str, str]]) -> bool:
    changed = False
    bindings = policy.setdefault("bindings", [])
    for role, member in wanted:
        b = next((x for x in bindings if x.get("role") == role and "condition" not in x), None)
        if b is None:
            bindings.append({"role": role, "members": [member]})
            changed = True
        elif member not in b.get("members", []):
            b["members"].append(member)
            changed = True
    return changed


def step_iam() -> None:
    log("Service accounts")
    for account_id, display in [
        ("sa-fataawa-worker", "Fataawa worker"),
        ("sa-fataawa-api", "Fataawa API"),
    ]:
        email = f"{account_id}@{PROJECT}.iam.gserviceaccount.com"
        if exists(f"https://iam.googleapis.com/v1/projects/{PROJECT}/serviceAccounts/{email}") is None:
            req(
                "POST",
                f"https://iam.googleapis.com/v1/projects/{PROJECT}/serviceAccounts",
                {"accountId": account_id, "serviceAccount": {"displayName": display}},
            )
            log(f"créé : {email}")

    log("Rôles projet")
    project_info = req("GET", f"https://cloudresourcemanager.googleapis.com/v1/projects/{PROJECT}")
    num = project_info["projectNumber"]
    policy = req(
        "POST",
        f"https://cloudresourcemanager.googleapis.com/v1/projects/{PROJECT}:getIamPolicy",
        {},
    )
    wanted = [
        ("roles/datastore.user", f"serviceAccount:{SA_WORKER}"),
        ("roles/cloudtasks.enqueuer", f"serviceAccount:{SA_WORKER}"),
        ("roles/datastore.user", f"serviceAccount:{SA_API}"),
        # pousser les images depuis Cloud Build (selon l'ancienneté du projet,
        # le build tourne avec l'un ou l'autre de ces comptes)
        ("roles/artifactregistry.writer", f"serviceAccount:{num}@cloudbuild.gserviceaccount.com"),
        ("roles/artifactregistry.writer", f"serviceAccount:{num}-compute@developer.gserviceaccount.com"),
        ("roles/logging.logWriter", f"serviceAccount:{num}-compute@developer.gserviceaccount.com"),
        ("roles/storage.objectViewer", f"serviceAccount:{num}-compute@developer.gserviceaccount.com"),
    ]
    if _merge_bindings(policy, wanted):
        retry_propagation(
            lambda: req(
                "POST",
                f"https://cloudresourcemanager.googleapis.com/v1/projects/{PROJECT}:setIamPolicy",
                {"policy": policy},
            ),
            "rôles projet",
        )

    log("Auto-permissions des service accounts (OIDC / signBlob)")
    for email, role in [
        (SA_WORKER, "roles/iam.serviceAccountUser"),
        (SA_API, "roles/iam.serviceAccountTokenCreator"),
    ]:
        base = f"https://iam.googleapis.com/v1/projects/{PROJECT}/serviceAccounts/{email}"

        def _bind(base: str = base, email: str = email, role: str = role) -> None:
            pol = req("POST", f"{base}:getIamPolicy", {})
            if _merge_bindings(pol, [(role, f"serviceAccount:{email}")]):
                req("POST", f"{base}:setIamPolicy", {"policy": pol})

        retry_propagation(_bind, f"auto-permission {email}")


def step_bucket() -> None:
    log(f"Bucket gs://{BUCKET}")
    if exists(f"https://storage.googleapis.com/storage/v1/b/{BUCKET}") is None:
        req(
            "POST",
            f"https://storage.googleapis.com/storage/v1/b?project={PROJECT}",
            {
                "name": BUCKET,
                "location": REGION,
                "iamConfiguration": {"uniformBucketLevelAccess": {"enabled": True}},
            },
        )
    iam_url = f"https://storage.googleapis.com/storage/v1/b/{BUCKET}/iam"

    def _bucket_iam() -> None:
        policy = req("GET", iam_url)
        if _merge_bindings(
            policy,
            [
                ("roles/storage.objectAdmin", f"serviceAccount:{SA_WORKER}"),
                ("roles/storage.objectViewer", f"serviceAccount:{SA_API}"),
            ],
        ):
            req("PUT", iam_url, policy)

    retry_propagation(_bucket_iam, "IAM bucket")


def step_queues() -> None:
    log("Queues Cloud Tasks")
    parent = f"projects/{PROJECT}/locations/{REGION}"
    queues = {
        "ocr": ({"maxDispatchesPerSecond": 2, "maxConcurrentDispatches": 5},
                {"maxAttempts": 10, "minBackoff": "10s", "maxBackoff": "300s"}),
        "structuration": ({"maxDispatchesPerSecond": 2, "maxConcurrentDispatches": 5},
                          {"maxAttempts": 8, "minBackoff": "30s", "maxBackoff": "600s"}),
        "embedding": ({"maxDispatchesPerSecond": 5, "maxConcurrentDispatches": 10},
                      {"maxAttempts": 8, "minBackoff": "10s", "maxBackoff": "300s"}),
    }
    for name, (rate, retry) in queues.items():
        qname = f"{parent}/queues/{name}"
        body = {"name": qname, "rateLimits": rate, "retryConfig": retry}
        if exists(f"https://cloudtasks.googleapis.com/v2/{qname}") is None:
            req("POST", f"https://cloudtasks.googleapis.com/v2/{parent}/queues", body)
        else:
            req(
                "PATCH",
                f"https://cloudtasks.googleapis.com/v2/{qname}?updateMask=rateLimits,retryConfig",
                body,
            )


def step_secret() -> None:
    log("Secret gemini-api-key")
    base = f"https://secretmanager.googleapis.com/v1/projects/{PROJECT}/secrets/gemini-api-key"
    if exists(base) is None:
        req(
            "POST",
            f"https://secretmanager.googleapis.com/v1/projects/{PROJECT}/secrets?secretId=gemini-api-key",
            {"replication": {"automatic": {}}},
        )
    pol = req("GET", f"{base}:getIamPolicy")
    if _merge_bindings(
        pol,
        [
            ("roles/secretmanager.secretAccessor", f"serviceAccount:{SA_WORKER}"),
            ("roles/secretmanager.secretAccessor", f"serviceAccount:{SA_API}"),
        ],
    ):
        req("POST", f"{base}:setIamPolicy", {"policy": pol})

    versions = req("GET", f"{base}/versions").get("versions", [])
    if not any(v.get("state") == "ENABLED" for v in versions):
        key = os.environ.get("GEMINI_KEY", "")
        if not key:
            raise SystemExit("Secret vide et GEMINI_KEY absent : fournir GEMINI_KEY=...")
        req(
            "POST",
            f"{base}:addVersion",
            {"payload": {"data": base64.b64encode(key.encode()).decode()}},
        )
        log("clé Gemini enregistrée dans Secret Manager")


def step_indexes() -> None:
    log("Index Firestore (relance + vectoriel)")
    base = f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/collectionGroups"
    for cg, body in [
        (
            "pages",
            {
                "queryScope": "COLLECTION_GROUP",
                "fields": [
                    {"fieldPath": "statutOcr", "order": "ASCENDING"},
                    {"fieldPath": "majAt", "order": "ASCENDING"},
                ],
            },
        ),
        # index vectoriel du RAG sur la collection historique `fatawas_db`.
        # Champ embedding_v2 : le champ `embedding` d'origine vient d'un modèle
        # retiré de l'API Gemini, ses vecteurs sont inexploitables ici.
        (
            "fatawas_db",
            {
                "queryScope": "COLLECTION",
                "fields": [
                    {
                        "fieldPath": "embedding_v2",
                        "vectorConfig": {"dimension": 768, "flat": {}},
                    }
                ],
            },
        ),
        # (pas d'index composite pour `statut` : l'index simple automatique suffit)
    ]:
        try:
            req("POST", f"{base}/{cg}/indexes", body)
            log(f"index {cg} : création lancée (construction en arrière-plan)")
        except ApiError as e:
            if e.status == 409:
                log(f"index {cg} : déjà présent")
            else:
                raise


def _make_source_tarball() -> bytes:
    excluded_dirs = {"node_modules", ".git", "dist", "coverage"}
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for root, dirs, files in os.walk(REPO_ROOT):
            dirs[:] = [d for d in dirs if d not in excluded_dirs]
            for f in files:
                if f.endswith(".tsbuildinfo") or f == ".env" or f.startswith(".env."):
                    continue
                full = os.path.join(root, f)
                tar.add(full, arcname=os.path.relpath(full, REPO_ROOT))
    return buf.getvalue()


def _run_build(image: str, dockerfile: str, source_obj: str, label: str) -> str:
    build = req(
        "POST",
        f"https://cloudbuild.googleapis.com/v1/projects/{PROJECT}/builds",
        {
            "source": {"storageSource": {"bucket": f"{PROJECT}_cloudbuild", "object": source_obj}},
            "steps": [
                {
                    "name": "gcr.io/cloud-builders/docker",
                    "args": ["build", "-f", dockerfile, "-t", image, "."],
                }
            ],
            "images": [image],
            "timeout": "1500s",
            "options": {"logging": "CLOUD_LOGGING_ONLY"},
        },
    )
    return build["metadata"]["build"]["id"]


def _wait_build(build_id: str, label: str) -> None:
    start = time.time()
    while True:
        b = req("GET", f"https://cloudbuild.googleapis.com/v1/projects/{PROJECT}/builds/{build_id}")
        status = b.get("status")
        if status == "SUCCESS":
            log(f"build {label} : SUCCESS")
            return
        if status in ("FAILURE", "INTERNAL_ERROR", "TIMEOUT", "CANCELLED", "EXPIRED"):
            raise RuntimeError(f"build {label} : {status} — logs : {b.get('logUrl', '?')}")
        if time.time() - start > 1500:
            raise RuntimeError(f"build {label} : délai dépassé — {b.get('logUrl', '?')}")
        time.sleep(10)


def step_build() -> dict[str, str]:
    log("Build des images (Cloud Build)")
    staging = f"{PROJECT}_cloudbuild"
    if exists(f"https://storage.googleapis.com/storage/v1/b/{staging}") is None:
        req(
            "POST",
            f"https://storage.googleapis.com/storage/v1/b?project={PROJECT}",
            {"name": staging, "location": "US"},
        )
    if exists(
        f"https://artifactregistry.googleapis.com/v1/projects/{PROJECT}/locations/{REGION}/repositories/fataawa"
    ) is None:
        op = req(
            "POST",
            f"https://artifactregistry.googleapis.com/v1/projects/{PROJECT}/locations/{REGION}/repositories?repositoryId=fataawa",
            {"format": "DOCKER"},
        )
        poll_lro("https://artifactregistry.googleapis.com/v1", op["name"], "dépôt AR")

    tag = os.environ.get("IMAGE_TAG") or subprocess.run(
        ["git", "rev-parse", "--short", "HEAD"], capture_output=True, text=True, cwd=REPO_ROOT
    ).stdout.strip() or str(int(time.time()))
    source_obj = f"source/fataawa-{tag}.tgz"
    log("upload du code source vers GCS")
    req(
        "POST",
        f"https://storage.googleapis.com/upload/storage/v1/b/{staging}/o?uploadType=media&name={source_obj}",
        raw=_make_source_tarball(),
        content_type="application/gzip",
    )

    images = {
        "worker": f"{REGION}-docker.pkg.dev/{PROJECT}/fataawa/worker:{tag}",
        "api": f"{REGION}-docker.pkg.dev/{PROJECT}/fataawa/api:{tag}",
    }
    ids = {
        "worker": _run_build(images["worker"], "apps/worker/Dockerfile", source_obj, "worker"),
        "api": _run_build(images["api"], "apps/api/Dockerfile", source_obj, "api"),
    }
    log(f"builds lancés (worker {ids['worker'][:8]}…, api {ids['api'][:8]}…) — patience")
    for label, bid in ids.items():
        _wait_build(bid, label)
    return images


def _env_vars(pairs: dict[str, str]) -> list[dict]:
    out: list[dict] = [{"name": k, "value": v} for k, v in pairs.items()]
    out.append(
        {
            "name": "GEMINI_API_KEY",
            "valueSource": {"secretKeyRef": {"secret": "gemini-api-key", "version": "latest"}},
        }
    )
    return out


def _deploy_service(service_id: str, service: dict, label: str) -> str:
    base = f"https://run.googleapis.com/v2/projects/{PROJECT}/locations/{REGION}/services"
    current = exists(f"{base}/{service_id}")
    for attempt in range(4):
        try:
            if current is None:
                op = req("POST", f"{base}?serviceId={service_id}", service)
            else:
                op = req("PATCH", f"{base}/{service_id}", service)
            break
        except ApiError as e:
            if e.status == 409:  # créé entre-temps → bascule en mise à jour
                current = {}
                continue
            # la propagation IAM d'un service account tout juste créé peut prendre ~30 s
            if attempt < 3 and ("does not exist" in e.body or e.status == 400):
                log(f"{label} : retry ({e.body[:120]}…)")
                time.sleep(15)
                continue
            raise
    poll_lro("https://run.googleapis.com/v2", op["name"], f"déploiement {label}")
    return req("GET", f"{base}/{service_id}")["uri"]


def step_deploy_worker(images: dict[str, str]) -> str:
    log("Déploiement du worker (fataawa-worker)")
    # Connecteur Drive optionnel : vide = ingestion depuis le bucket seulement.
    drive_root = os.environ.get("DRIVE_ROOT_FOLDER_ID", "")

    def worker_body(worker_url: str) -> dict:
        return {
            "template": {
                "serviceAccount": SA_WORKER,
                "timeout": "900s",
                "maxInstanceRequestConcurrency": 10,
                "scaling": {"maxInstanceCount": 5},
                "containers": [
                    {
                        "image": images["worker"],
                        "resources": {"limits": {"memory": "1Gi", "cpu": "1"}},
                        "env": _env_vars(
                            {
                                "GOOGLE_CLOUD_PROJECT": PROJECT,
                                "REGION": REGION,
                                "GCS_BUCKET": BUCKET,
                                "DRIVE_ROOT_FOLDER_ID": drive_root,
                                "TASKS_SA_EMAIL": SA_WORKER,
                                "GEMINI_MODEL": GEMINI_MODEL,
                                "EMBEDDING_MODEL": EMBEDDING_MODEL,
                                "WORKER_URL": worker_url,
                                "FATWAS_COLLECTION": FATWAS_ECRITURE,
                                "INGEST_BATCH": os.environ.get("INGEST_BATCH", "100"),
                            }
                        ),
                    }
                ],
            }
        }

    url = _deploy_service("fataawa-worker", worker_body("https://pending.invalid"), "worker")
    url2 = _deploy_service("fataawa-worker", worker_body(url), "worker (WORKER_URL)")

    base = f"https://run.googleapis.com/v2/projects/{PROJECT}/locations/{REGION}/services/fataawa-worker"
    pol = req("GET", f"{base}:getIamPolicy")
    if _merge_bindings(pol, [("roles/run.invoker", f"serviceAccount:{SA_WORKER}")]):
        req("POST", f"{base}:setIamPolicy", {"policy": pol})
    log(f"worker : {url2}")
    log(f"worker : écrit les fatwas dans « {FATWAS_ECRITURE} »")
    return url2


def step_scheduler(worker_url: str) -> None:
    log("Déclencheurs Cloud Scheduler")
    parent = f"projects/{PROJECT}/locations/{REGION}"
    jobs = [
        ("fataawa-ingestion", "*/15 * * * *", "/tasks/ingestion"),
        ("fataawa-relance", "17 * * * *", "/tasks/relance"),
    ]
    for name, schedule, path in jobs:
        body = {
            "name": f"{parent}/jobs/{name}",
            "schedule": schedule,
            "timeZone": "Etc/UTC",
            "httpTarget": {
                "uri": f"{worker_url}{path}",
                "httpMethod": "POST",
                "oidcToken": {"serviceAccountEmail": SA_WORKER, "audience": worker_url},
            },
        }
        url = f"https://cloudscheduler.googleapis.com/v1/{parent}/jobs/{name}"
        if exists(url) is None:
            req("POST", f"https://cloudscheduler.googleapis.com/v1/{parent}/jobs", body)
        else:
            req("PATCH", f"{url}?updateMask=schedule,timeZone,httpTarget", body)


def step_deploy_api(images: dict[str, str]) -> str:
    log("Déploiement de l'API sur chercherf (remplace la révision actuelle)")
    # URL du worker : nécessaire pour déclencher l'ingestion depuis l'espace d'ajout
    worker = exists(
        f"https://run.googleapis.com/v2/projects/{PROJECT}/locations/{REGION}/services/fataawa-worker"
    )
    worker_url = (worker or {}).get("uri", "")
    body = {
        "template": {
            "serviceAccount": SA_API,
            "timeout": "120s",
            "maxInstanceRequestConcurrency": 40,
            "scaling": {"maxInstanceCount": 3},
            "containers": [
                {
                    "image": images["api"],
                    "resources": {"limits": {"memory": "512Mi", "cpu": "1"}},
                    "env": _env_vars(
                        {
                            "GOOGLE_CLOUD_PROJECT": PROJECT,
                            "GCS_BUCKET": BUCKET,
                            "GEMINI_MODEL": GEMINI_MODEL,
                            "EMBEDDING_MODEL": EMBEDDING_MODEL,
                            # allowlist de l'espace d'ajout de fatwas (la
                            # consultation, elle, reste publique)
                            "ALLOWED_EMAILS": os.environ.get("ALLOWED_EMAILS", "dyaa@utopya.fr"),
                            # collection servie au public, distincte de celle où
                            # le retraitement écrit tant qu'il n'est pas validé
                            "FATWAS_COLLECTION": FATWAS_LECTURE,
                            # le rapport d'administration peut aussi analyser la
                            # collection où le retraitement écrit
                            "FATWAS_COLLECTION_PIPELINE": FATWAS_ECRITURE,
                            "REGION": REGION,
                            "WORKER_URL": worker_url,
                            "TASKS_SA_EMAIL": SA_WORKER,
                        }
                    ),
                }
            ],
        }
    }
    url = _deploy_service(os.environ.get("API_SERVICE", "chercherf"), body, "api")
    base = f"https://run.googleapis.com/v2/projects/{PROJECT}/locations/{REGION}/services/{os.environ.get('API_SERVICE', 'chercherf')}"
    pol = req("GET", f"{base}:getIamPolicy")
    if _merge_bindings(pol, [("roles/run.invoker", "allUsers")]):
        req("POST", f"{base}:setIamPolicy", {"policy": pol})
    log(f"api : {url}")
    log(f"api : lit les fatwas dans « {FATWAS_LECTURE} »")
    return url


def _run_job(job_id: str, images: dict[str, str], script: str, env: dict[str, str], label: str) -> None:
    """Crée/actualise un Cloud Run Job sur l'image du worker et l'exécute."""
    base = f"https://run.googleapis.com/v2/projects/{PROJECT}/locations/{REGION}/jobs"
    body = {
        "template": {
            "taskCount": 1,
            "template": {
                "serviceAccount": SA_WORKER,
                "timeout": "3600s",
                "maxRetries": 0,
                "containers": [
                    {
                        "image": images["worker"],
                        "command": ["node"],
                        "args": [script],
                        "resources": {"limits": {"memory": "2Gi", "cpu": "2"}},
                        "env": _env_vars(env),
                    }
                ],
            },
        }
    }
    op = req("POST", f"{base}?jobId={job_id}", body) if exists(f"{base}/{job_id}") is None else req(
        "PATCH", f"{base}/{job_id}", body
    )
    poll_lro("https://run.googleapis.com/v2", op["name"], f"job {label}")

    op = req("POST", f"{base}/{job_id}:run", {})
    exec_name = op["metadata"]["name"] if "metadata" in op else op["name"]
    log(f"{label} : exécution lancée ({exec_name.split('/')[-1]})")
    start = time.time()
    while time.time() - start < 3600:
        ex = req("GET", f"https://run.googleapis.com/v2/{exec_name}")
        if ex.get("succeededCount"):
            log(f"{label} : terminé")
            return
        if ex.get("failedCount"):
            raise RuntimeError(f"{label} : échec — voir Cloud Logging ({job_id})")
        time.sleep(20)
    raise RuntimeError(f"{label} : délai dépassé")


def step_replay(images: dict[str, str]) -> None:
    """Rejoue des livres depuis legacy/ dans le pipeline actuel."""
    _run_job(
        "fataawa-replay",
        images,
        "apps/worker/dist/jobs/replay.js",
        {
            "GOOGLE_CLOUD_PROJECT": PROJECT,
            "REGION": REGION,
            "GCS_BUCKET": BUCKET,
            "WORKER_URL": (
                exists(
                    f"https://run.googleapis.com/v2/projects/{PROJECT}/locations/{REGION}/services/fataawa-worker"
                )
                or {}
            ).get("uri", ""),
            "TASKS_SA_EMAIL": SA_WORKER,
            # collection cible : neuve par défaut, la production reste intacte
            "FATWAS_COLLECTION": FATWAS_ECRITURE,
            "LIVRES": os.environ.get("LIVRES", ""),
            "INGESTIONS": os.environ.get("INGESTIONS", "30"),
            "RESET": os.environ.get("RESET", ""),
            # rejeu du seul découpage : l'OCR déjà fait est conservé
            "RESET_STRUCT": os.environ.get("RESET_STRUCT", ""),
        },
        "rejeu des livres",
    )


def step_import_scans(images: dict[str, str]) -> None:
    """Copie les scans historiques Drive → bucket et raccorde les fatwas."""
    drive_root = os.environ.get("DRIVE_SCANS_FOLDER_ID") or os.environ.get("DRIVE_ROOT_FOLDER_ID", "")
    if not drive_root:
        raise SystemExit("DRIVE_SCANS_FOLDER_ID requis (dossier Drive racine des scans)")
    _run_job(
        "fataawa-import-scans",
        images,
        "apps/worker/dist/jobs/import-scans.js",
        {
            "GOOGLE_CLOUD_PROJECT": PROJECT,
            "GCS_BUCKET": BUCKET,
            "DRIVE_ROOT_FOLDER_ID": drive_root,
            "CONCURRENCY": os.environ.get("CONCURRENCY", "8"),
            "DRY_RUN": os.environ.get("DRY_RUN", ""),
        },
        "import des scans",
    )


def step_reembed(images: dict[str, str]) -> None:
    """Cloud Run Job de ré-embedding de la collection historique (idempotent)."""
    log("Ré-embedding de fatawas_db (Cloud Run Job)")
    base = f"https://run.googleapis.com/v2/projects/{PROJECT}/locations/{REGION}/jobs"
    body = {
        "template": {
            "taskCount": 1,
            "template": {
                "serviceAccount": SA_WORKER,
                "timeout": "3600s",
                "maxRetries": 0,
                "containers": [
                    {
                        "image": images["worker"],
                        "command": ["node"],
                        "args": ["apps/worker/dist/jobs/reembed.js"],
                        "resources": {"limits": {"memory": "1Gi", "cpu": "1"}},
                        "env": _env_vars(
                            {
                                "GOOGLE_CLOUD_PROJECT": PROJECT,
                                "EMBEDDING_MODEL": EMBEDDING_MODEL,
                                "CONCURRENCY": os.environ.get("CONCURRENCY", "6"),
                                "LIMIT": os.environ.get("LIMIT", "0"),
                                "FORCE": os.environ.get("FORCE", ""),
                            }
                        ),
                    }
                ],
            },
        }
    }
    if exists(f"{base}/fataawa-reembed") is None:
        op = req("POST", f"{base}?jobId=fataawa-reembed", body)
    else:
        op = req("PATCH", f"{base}/fataawa-reembed", body)
    poll_lro("https://run.googleapis.com/v2", op["name"], "job de ré-embedding")

    op = req("POST", f"{base}/fataawa-reembed:run", {})
    log("exécution lancée — suivi dans Cloud Logging (fataawa-reembed)")
    exec_name = op["metadata"]["name"] if "metadata" in op else op["name"]
    start = time.time()
    while time.time() - start < 3600:
        ex = req("GET", f"https://run.googleapis.com/v2/{exec_name}")
        if ex.get("succeededCount"):
            log(f"ré-embedding terminé ({ex.get('succeededCount')} tâche(s) OK)")
            return
        if ex.get("failedCount"):
            raise RuntimeError("le job de ré-embedding a échoué — voir Cloud Logging")
        time.sleep(20)
    raise RuntimeError("ré-embedding : délai dépassé")


def step_hosting() -> None:
    log("Front → Firebase Hosting")
    with open(os.path.join(REPO_ROOT, "firebase.json")) as f:
        hosting = json.load(f)["hosting"]
    site = hosting["site"]

    subprocess.run(
        ["npm", "run", "-w", "@fataawa/front", "build"], cwd=REPO_ROOT, check=True
    )

    base = "https://firebasehosting.googleapis.com/v1beta1"
    if exists(f"{base}/projects/{PROJECT}/sites/{site}") is None:
        try:
            req("POST", f"{base}/projects/{PROJECT}/sites?siteId={site}", {})
            log(f"site créé : {site}.web.app")
        except ApiError as e:
            if e.status == 409:
                raise SystemExit(
                    f"Le nom de site « {site} » est pris globalement sur Firebase : "
                    "changer hosting.site dans firebase.json puis relancer l'étape hosting."
                )
            raise

    rewrites = []
    for rw in hosting.get("rewrites", []):
        entry: dict = {"glob": rw["source"]}
        if "run" in rw:
            entry["run"] = {"serviceId": rw["run"]["serviceId"], "region": rw["run"]["region"]}
        elif "destination" in rw:
            entry["path"] = rw["destination"]
        rewrites.append(entry)
    version = req(
        "POST", f"{base}/projects/{PROJECT}/sites/{site}/versions", {"config": {"rewrites": rewrites}}
    )
    vname = version["name"]

    dist = os.path.join(REPO_ROOT, "apps/front/dist")
    files: dict[str, tuple[str, bytes]] = {}
    for root, _dirs, names in os.walk(dist):
        for n in names:
            full = os.path.join(root, n)
            rel = "/" + os.path.relpath(full, dist).replace(os.sep, "/")
            with open(full, "rb") as fh:
                gz = gzip.compress(fh.read(), 9)
            files[rel] = (hashlib.sha256(gz).hexdigest(), gz)

    populate = req(
        "POST",
        f"{base}/{vname}:populateFiles",
        {"files": {path: digest for path, (digest, _gz) in files.items()}},
    )
    upload_url = populate.get("uploadUrl", "")
    needed = set(populate.get("uploadRequiredHashes", []))
    for _path, (digest, gz) in files.items():
        if digest in needed:
            req(
                "POST",
                f"{upload_url}/{digest}",
                raw=gz,
                content_type="application/octet-stream",
            )
            needed.discard(digest)
    req("PATCH", f"{base}/{vname}?updateMask=status", {"status": "FINALIZED"})
    req("POST", f"{base}/projects/{PROJECT}/sites/{site}/releases?versionName={vname}", {})
    log(f"front en ligne : https://{site}.web.app")


def main() -> None:
    if not TOKEN:
        raise SystemExit("ACCESS_TOKEN manquant (gcloud auth print-access-token)")
    step = sys.argv[1] if len(sys.argv) > 1 else "all"
    if step == "all":
        step_apis()
        step_iam()
        step_bucket()
        step_queues()
        step_secret()
        step_indexes()
        images = step_build()
        worker_url = step_deploy_worker(images)
        step_scheduler(worker_url)
        step_deploy_api(images)
        step_hosting()
        print(
            "\nDéploiement terminé.\n"
            f" - Front  : https://{json.load(open(os.path.join(REPO_ROOT, 'firebase.json')))['hosting']['site']}.web.app\n"
            f" - Rappel : partager le dossier Drive racine (Éditeur) et le MASTER_SHEET (Lecteur)\n"
            f"            avec {SA_WORKER}"
        )
    elif step in {"apis", "iam", "bucket", "queues", "secret", "indexes", "hosting"}:
        globals()[f"step_{step}"]()
    elif step == "build":
        print(json.dumps(step_build(), indent=2))
    elif step in {
        "deploy_worker",
        "scheduler",
        "deploy_api",
        "reembed",
        "import_scans",
        "replay",
    }:
        tag = os.environ.get("IMAGE_TAG", "")
        if not tag and step != "scheduler":
            raise SystemExit("IMAGE_TAG requis (tag des images déjà construites)")
        images = {
            "worker": f"{REGION}-docker.pkg.dev/{PROJECT}/fataawa/worker:{tag}",
            "api": f"{REGION}-docker.pkg.dev/{PROJECT}/fataawa/api:{tag}",
        }
        if step == "deploy_worker":
            step_deploy_worker(images)
        elif step == "deploy_api":
            step_deploy_api(images)
        elif step == "reembed":
            step_reembed(images)
        elif step == "import_scans":
            step_import_scans(images)
        elif step == "replay":
            step_replay(images)
        else:
            worker = req(
                "GET",
                f"https://run.googleapis.com/v2/projects/{PROJECT}/locations/{REGION}/services/fataawa-worker",
            )
            step_scheduler(worker["uri"])
    else:
        raise SystemExit(f"étape inconnue : {step}")


if __name__ == "__main__":
    main()
