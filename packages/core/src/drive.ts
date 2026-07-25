import { drive as createDrive, type drive_v3 } from '@googleapis/drive';
import { GoogleAuth } from 'google-auth-library';

let client: drive_v3.Drive | undefined;

function drive(): drive_v3.Drive {
  client ??= createDrive({
    version: 'v3',
    auth: new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/drive'] }),
  });
  return client;
}

const FOLDER_MIME = 'application/vnd.google-apps.folder';

function escapeQuery(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export interface DriveFolder {
  id: string;
  name: string;
}

export interface DriveImage {
  id: string;
  name: string;
  mimeType: string;
}

/** Sous-dossiers du dossier racine : un par livre. */
export async function listBookFolders(rootFolderId: string): Promise<DriveFolder[]> {
  const res = await drive().files.list({
    q: `'${escapeQuery(rootFolderId)}' in parents and mimeType='${FOLDER_MIME}' and trashed=false`,
    fields: 'files(id,name)',
    pageSize: 500,
  });
  return (res.data.files ?? []).flatMap((f) => (f.id && f.name ? [{ id: f.id, name: f.name }] : []));
}

export async function findSubfolder(parentId: string, name: string): Promise<string | null> {
  const res = await drive().files.list({
    q: `'${escapeQuery(parentId)}' in parents and mimeType='${FOLDER_MIME}' and name='${escapeQuery(name)}' and trashed=false`,
    fields: 'files(id)',
    pageSize: 1,
  });
  return res.data.files?.[0]?.id ?? null;
}

export async function ensureSubfolder(parentId: string, name: string): Promise<string> {
  const existing = await findSubfolder(parentId, name);
  if (existing) return existing;
  const res = await drive().files.create({
    requestBody: { name, mimeType: FOLDER_MIME, parents: [parentId] },
    fields: 'id',
  });
  if (!res.data.id) throw new Error(`création du dossier Drive « ${name} » échouée`);
  return res.data.id;
}

/** Images d'un dossier, triées par nom (ordre de lecture attendu). */
export async function listImages(folderId: string, max: number): Promise<DriveImage[]> {
  const res = await drive().files.list({
    q: `'${escapeQuery(folderId)}' in parents and trashed=false and mimeType contains 'image/'`,
    fields: 'files(id,name,mimeType)',
    orderBy: 'name',
    pageSize: Math.min(max, 1000),
  });
  return (res.data.files ?? []).flatMap((f) =>
    f.id && f.name && f.mimeType ? [{ id: f.id, name: f.name, mimeType: f.mimeType }] : [],
  );
}

export async function downloadFile(fileId: string): Promise<Buffer> {
  const res = await drive().files.get({ fileId, alt: 'media' }, { responseType: 'arraybuffer' });
  return Buffer.from(res.data as ArrayBuffer);
}

export async function moveFile(fileId: string, fromFolderId: string, toFolderId: string): Promise<void> {
  await drive().files.update({
    fileId,
    addParents: toFolderId,
    removeParents: fromFolderId,
    fields: 'id',
  });
}
