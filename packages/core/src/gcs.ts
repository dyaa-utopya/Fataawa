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
