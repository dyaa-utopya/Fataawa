/** Utilitaires purs du backfill MASTER_SHEET (testés unitairement). */

/** 'A' → 0, 'B' → 1, …, 'AA' → 26. */
export function colIndex(letter: string): number {
  const clean = letter.trim().toUpperCase();
  if (!/^[A-Z]+$/.test(clean)) throw new Error(`colonne invalide : « ${letter} »`);
  let n = 0;
  for (const ch of clean) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export interface MasterMapping {
  id?: number;
  livre?: number;
  sujet?: number;
  sousSujet?: number;
  numero?: number;
  texte: number;
}

const CHAMPS_VALIDES = new Set(['id', 'livre', 'sujet', 'sousSujet', 'numero', 'texte']);

/** Parse « id=A,sujet=B,sousSujet=C,numero=D,texte=E » (texte obligatoire). */
export function parseMapping(spec: string): MasterMapping {
  const mapping: Partial<Record<string, number>> = {};
  for (const pair of spec.split(',')) {
    const [champ, col] = pair.split('=').map((s) => s.trim());
    if (!champ || !col) throw new Error(`mapping invalide : « ${pair} »`);
    if (!CHAMPS_VALIDES.has(champ)) throw new Error(`champ de mapping inconnu : « ${champ} »`);
    mapping[champ] = colIndex(col);
  }
  if (mapping.texte === undefined) throw new Error('le mapping doit définir « texte »');
  return mapping as unknown as MasterMapping;
}

export interface LigneMaster {
  id: string;
  livre: string;
  sujet: string;
  sousSujet: string;
  numero: string;
  texte: string;
}

function cell(row: unknown[], index: number | undefined): string {
  if (index === undefined) return '';
  const value = row[index];
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}

/** Ligne du sheet → champs fatwa ; null si la ligne n'a pas de texte. */
export function rowToLigne(row: unknown[], mapping: MasterMapping): LigneMaster | null {
  const texte = cell(row, mapping.texte);
  if (texte === '') return null;
  return {
    id: cell(row, mapping.id),
    livre: cell(row, mapping.livre),
    sujet: cell(row, mapping.sujet),
    sousSujet: cell(row, mapping.sousSujet),
    numero: cell(row, mapping.numero),
    texte,
  };
}
