const DIGIT_MAPS: Array<[string, string]> = [
  ['٠١٢٣٤٥٦٧٨٩', '0123456789'], // chiffres arabes orientaux
  ['۰۱۲۳۴۵۶۷۸۹', '0123456789'], // variante persane
];

/** Convertit les chiffres arabes orientaux / persans en chiffres latins. */
export function normalizeDigits(input: string): string {
  let out = '';
  for (const ch of input) {
    let mapped = ch;
    for (const [from, to] of DIGIT_MAPS) {
      const i = [...from].indexOf(ch);
      if (i >= 0) {
        mapped = to[i] ?? ch;
        break;
      }
    }
    out += mapped;
  }
  return out;
}

/**
 * Extrait le numéro de page d'un nom de fichier de scan.
 * Convention : le DERNIER groupe de chiffres du nom (extension exclue) est le
 * numéro de page — « page_012.png » → 12, « livre2_p015.png » → 15,
 * « ٠١٢.png » → 12. Retourne null si aucun chiffre (ex. « couverture.png »).
 */
export function extractNumeroPage(filename: string): number | null {
  const stem = filename.replace(/\.[^.]*$/, '');
  const groups = normalizeDigits(stem).match(/\d+/g);
  if (!groups || groups.length === 0) return null;
  const last = groups[groups.length - 1];
  if (last === undefined) return null;
  const n = Number.parseInt(last, 10);
  return Number.isSafeInteger(n) ? n : null;
}

/** ID de document Firestore d'une page : numéro zéro-paddé (tri lexical = ordre de lecture). */
export function pageIdFromNumero(numero: number): string {
  return String(numero).padStart(4, '0');
}

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/tiff': 'tif',
};

export function extFromMime(mimeType: string): string {
  return EXT_BY_MIME[mimeType] ?? 'bin';
}

export function isSupportedImageMime(mimeType: string): boolean {
  return mimeType in EXT_BY_MIME;
}

/** Chemin GCS canonique d'un scan de page. */
export function gcsPathForPage(livreId: string, pageId: string, mimeType: string): string {
  return `livres/${livreId}/pages/${pageId}.${extFromMime(mimeType)}`;
}
