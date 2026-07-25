import { Storage } from '@google-cloud/storage';

let storage: Storage | undefined;

function client(): Storage {
  storage ??= new Storage();
  return storage;
}

export async function gcsUpload(
  bucket: string,
  path: string,
  content: Buffer,
  contentType: string,
): Promise<void> {
  await client().bucket(bucket).file(path).save(content, {
    contentType,
    resumable: false,
  });
}

export async function gcsDownload(bucket: string, path: string): Promise<Buffer> {
  const [buf] = await client().bucket(bucket).file(path).download();
  return buf;
}

export async function gcsExists(bucket: string, path: string): Promise<boolean> {
  const [ok] = await client().bucket(bucket).file(path).exists();
  return ok;
}

export interface GcsObject {
  path: string;
  contentType: string;
}

/**
 * Tous les objets sous un préfixe (auto-pagination ; les « dossiers »
 * eux-mêmes sont ignorés). L'état d'avancement vit dans Firestore, pas dans
 * l'arborescence : rien n'est déplacé après ingestion.
 */
export async function gcsList(bucket: string, prefix: string): Promise<GcsObject[]> {
  const [files] = await client().bucket(bucket).getFiles({ prefix });
  return files
    .filter((f) => !f.name.endsWith('/'))
    .map((f) => ({
      path: f.name,
      contentType: f.metadata.contentType ?? 'application/octet-stream',
    }));
}

/**
 * URL signée V4 en lecture. Sur Cloud Run (ADC sans clé privée), la signature
 * passe par l'API IAM signBlob : le service account doit avoir
 * roles/iam.serviceAccountTokenCreator sur lui-même (posé par infra/setup.sh).
 */
export async function gcsSignedReadUrl(
  bucket: string,
  path: string,
  ttlMinutes: number,
): Promise<string> {
  const [url] = await client()
    .bucket(bucket)
    .file(path)
    .getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + ttlMinutes * 60_000,
    });
  return url;
}
