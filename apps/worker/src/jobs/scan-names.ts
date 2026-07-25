/** Rapprochement des noms de scans (Drive) et du champ image_source (Firestore). */

/**
 * Clé de comparaison d'un nom de fichier : normalisation Unicode NFC (les
 * noms arabes peuvent arriver décomposés depuis Drive), extension retirée,
 * séparateurs unifiés, casse ignorée.
 */
export function cleNom(nom: string): string {
  return nom
    .normalize('NFC')
    .replace(/\.[^.]*$/, '')
    .replace(/[\s_\-–—]+/g, '')
    .toLowerCase();
}

/**
 * Clé de secours « livre + page » : beaucoup de scans sont nommés
 * `…_Page445.png` et le champ image_source peut différer sur le préfixe.
 * Retourne null si aucun numéro de page n'est identifiable.
 */
export function clePage(nom: string): string | null {
  const base = nom.normalize('NFC').replace(/\.[^.]*$/, '');
  const m = base.match(/page[\s_-]*(\d+)\s*$/i);
  if (!m?.[1]) return null;
  return `page${Number.parseInt(m[1], 10)}`;
}

/**
 * Nom de livre exploitable : les dossiers Drive portent des marqueurs d'état
 * héritée du pipeline Apps Script (« [TERMINÉ] … ») qui n'existent pas dans
 * le champ image_source.
 */
export function nomLivrePropre(nom: string): string {
  return nom
    .normalize('NFC')
    .replace(/\[[^\]]*\]/g, '')
    .trim();
}

/** Index de recherche construit sur les objets copiés dans le bucket. */
export interface IndexScans {
  parNom: Map<string, string>;
  /** clé « {livre}|page{n} » → chemin GCS */
  parLivreEtPage: Map<string, string>;
}

export function creerIndex(): IndexScans {
  return { parNom: new Map(), parLivreEtPage: new Map() };
}

export function indexer(index: IndexScans, livre: string, nomFichier: string, gcsPath: string): void {
  index.parNom.set(cleNom(nomFichier), gcsPath);
  const page = clePage(nomFichier);
  if (page) index.parLivreEtPage.set(`${cleNom(livre)}|${page}`, gcsPath);
}

/**
 * Retrouve le scan correspondant à un `image_source`. Essaie le nom exact
 * (après normalisation), puis le couple livre + numéro de page déduit du nom.
 */
export function resoudre(index: IndexScans, imageSource: string): string | undefined {
  const direct = index.parNom.get(cleNom(imageSource));
  if (direct) return direct;
  const page = clePage(imageSource);
  if (!page) return undefined;
  const cle = cleNom(imageSource);
  for (const [k, v] of index.parLivreEtPage) {
    const [livre] = k.split('|');
    if (livre && k.endsWith(`|${page}`) && cle.includes(livre)) return v;
  }
  return undefined;
}
