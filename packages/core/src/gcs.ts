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
