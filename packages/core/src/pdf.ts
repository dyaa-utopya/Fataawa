import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * Découpage des PDF via poppler (installé dans l'image du worker).
 *
 * Les scans sont rendus en PNG sans perte : la compression avec perte dégrade
 * la lisibilité du texte arabe pour l'OCR — c'est vérifié à l'usage, on ne
 * cherche donc pas à alléger les images produites.
 */

/** Nombre de pages d'un PDF (pdfinfo). */
export async function pdfNombrePages(chemin: string): Promise<number> {
  const { stdout } = await run('pdfinfo', [chemin], { maxBuffer: 1 << 20 });
  const m = stdout.match(/^Pages:\s+(\d+)/m);
  const n = m?.[1] ? Number.parseInt(m[1], 10) : 0;
  if (!Number.isSafeInteger(n) || n <= 0) throw new Error('nombre de pages illisible');
  return n;
}

/**
 * Texte déjà présent dans le PDF sur une page donnée. Un PDF de scan n'en a
 * aucun ; s'il en a, l'OCR pourrait être évité (piste d'optimisation).
 */
export async function pdfTextePage(chemin: string, page: number): Promise<string> {
  try {
    const { stdout } = await run(
      'pdftotext',
      ['-f', String(page), '-l', String(page), chemin, '-'],
      { maxBuffer: 8 << 20 },
    );
    return stdout.trim();
  } catch {
    return '';
  }
}

export interface RenduPages {
  /** Fichiers produits, dans l'ordre des pages. */
  fichiers: Array<{ page: number; chemin: string }>;
}

/**
 * Rend une plage de pages en PNG dans `dossierSortie`, nommées
 * `page_0001.png`… (le numéro vient du PDF : plus de dépendance au nommage
 * des fichiers, donc plus de risque de numéros en doublon).
 */
export async function pdfRendrePages(
  chemin: string,
  dossierSortie: string,
  premiere: number,
  derniere: number,
  dpi: number,
): Promise<RenduPages> {
  await run(
    'pdftoppm',
    [
      '-png',
      '-r',
      String(dpi),
      '-f',
      String(premiere),
      '-l',
      String(derniere),
      chemin,
      `${dossierSortie}/page`,
    ],
    { maxBuffer: 1 << 20 },
  );
  const { readdir } = await import('node:fs/promises');
  const noms = (await readdir(dossierSortie)).filter((n) => n.endsWith('.png'));
  const fichiers = noms
    .map((nom) => {
      const m = nom.match(/(\d+)\.png$/);
      return { page: m?.[1] ? Number.parseInt(m[1], 10) : 0, chemin: `${dossierSortie}/${nom}` };
    })
    .filter((f) => f.page > 0)
    .sort((a, b) => a.page - b.page);
  return { fichiers };
}

/**
 * Nom d'objet d'une page rendue : `{livre}_Page0445.png`.
 * Le nom du livre y figure — le fichier reste identifiable hors de son dossier,
 * comme les scans historiques — et le numéro est zéro-paddé pour que l'ordre
 * alphabétique soit l'ordre de lecture.
 */
export function nomPageRendue(livreId: string, page: number): string {
  return `${livreId}_Page${String(page).padStart(4, '0')}.png`;
}
