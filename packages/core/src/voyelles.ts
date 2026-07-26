/**
 * Vocalisation de l'arabe — produit distinct.
 *
 * Ne partage rien avec l'agent des fatwas : ni prompt, ni corpus, ni recherche.
 * On reçoit un texte arabe nu, on le rend voyellé, et c'est tout. Le service
 * n'a pas de mémoire et ne consulte aucune base.
 *
 * Le danger, ici, n'est pas que le modèle vocalise mal : c'est qu'il RÉÉCRIVE.
 * Un modèle à qui l'on soumet un texte religieux ancien est constamment tenté
 * de corriger une graphie, de compléter une formule, de remplacer un mot par
 * son équivalent moderne. Sur ce texte-là, une correction non demandée est une
 * falsification.
 *
 * D'où la garantie posée ici, qui ne dépend pas de la consigne : après l'appel,
 * on recolle mot à mot en comparant les SQUELETTES CONSONANTIQUES. Un mot dont
 * le squelette a changé est refusé et l'original reparaît, nu. Les espaces, les
 * retours à la ligne et la ponctuation sont ceux de l'entrée, jamais ceux de la
 * sortie. Le texte rendu est donc, par construction, le texte reçu — aux signes
 * de vocalisation près.
 */

/**
 * Trois pages du format le plus courant. Mesuré sur les 1 439 pages de vrai
 * texte du corpus : 1 014 caractères en médiane, 1 187 au 90ᵉ centile. Quatre
 * mille laisse donc de la marge sur trois pages pleines.
 */
export const LIMITE_VOCALISATION = 4000;

/**
 * Signes à retirer pour obtenir le squelette : toutes les marques non
 * espaçantes (c'est la catégorie Unicode de l'intégralité du tashkīl arabe,
 * voyelles brèves, sukūn, shadda, tanwīn et annotations coraniques) plus le
 * tatweel, qui n'est qu'un allongement graphique.
 */
const MARQUES = /[\p{Mn}ـ]/gu;
/** Même classe, sans le drapeau global : `test` sur une regex /g garde un curseur. */
const MARQUES_TEST = /\p{Mn}/u;
/** Un mot inclut ses marques : sans cela, une voyelle couperait le mot en deux. */
const SEPARATEURS = /([^\p{L}\p{N}\p{M}]+)/u;

/**
 * Squelette consonantique : ce qui doit rester identique de bout en bout.
 *
 * Volontairement sans autre normalisation. Si le modèle remplace « أ » par
 * « ا » ou « ة » par « ه », c'est une modification du texte, et elle doit être
 * refusée — contrairement à la recherche, où ces variantes se valent.
 */
export function squelette(texte: string): string {
  return texte.normalize('NFC').replace(MARQUES, '');
}

/** Découpe en alternance mots / séparateurs, sans rien perdre. */
function unites(texte: string): string[] {
  return texte.split(SEPARATEURS);
}

/** Indices des mots dans le tableau d'unités (les rangs pairs, hors vides). */
function motsSeuls(u: string[]): number[] {
  const idx: number[] = [];
  for (let i = 0; i < u.length; i += 2) {
    const m = u[i];
    if (m !== undefined && m !== '') idx.push(i);
  }
  return idx;
}

/**
 * Plus longue sous-suite commune, rendue comme paires d'indices alignés.
 *
 * Un simple appariement par position ne suffirait pas : il suffit que le modèle
 * ajoute un mot d'introduction ou en oublie un pour que tout décale, et chaque
 * mot suivant serait alors refusé à tort.
 */
function alignement(a: readonly string[], b: readonly string[]): Map<number, number> {
  const n = a.length;
  const m = b.length;
  const t: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const ligne = t[i];
      const suivante = t[i + 1];
      if (ligne === undefined || suivante === undefined) continue;
      ligne[j] =
        a[i] === b[j]
          ? (suivante[j + 1] ?? 0) + 1
          : Math.max(suivante[j] ?? 0, ligne[j + 1] ?? 0);
    }
  }
  const paires = new Map<number, number>();
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      paires.set(i, j);
      i++;
      j++;
    } else if ((t[i + 1]?.[j] ?? 0) >= (t[i]?.[j + 1] ?? 0)) {
      i++;
    } else {
      j++;
    }
  }
  return paires;
}

export interface Recollage {
  /** Texte voyellé, dont le squelette est celui de l'entrée. */
  texte: string;
  /** Mots effectivement voyellés par le modèle. */
  vocalises: number;
  /** Mots rendus nus parce que le modèle les avait altérés ou perdus. */
  refuses: number;
  /**
   * Positions, dans `texte`, des mots restés sans aucun signe — bornes de
   * caractères, pas indices de mots.
   *
   * Calculé ici, où l'on tient à la fois le texte et le résultat de
   * l'alignement, et rendu en bornes de caractères pour que l'affichage n'ait
   * qu'à découper : refaire le découpage en mots à l'écran serait une seconde
   * déduction, qui pourrait ne pas s'accorder avec le compte annoncé.
   *
   * Chiffres et mots latins en sont exclus : ils n'ont aucun signe à recevoir,
   * et les signaler noierait ce qu'il faut voir.
   */
  nus: Array<[debut: number, fin: number]>;
}

/** Lettres arabes, hors chiffres (٠-٩) et hors signes, plages voisines. */
const LETTRE_ARABE = /[ء-يٱ-ۓ]/u;

/**
 * Recolle la sortie du modèle sur l'entrée, mot par mot.
 *
 * On garde les séparateurs de l'ENTRÉE — pas ceux de la sortie. C'est ce qui
 * préserve exactement les retours à la ligne et les paragraphes, que le modèle
 * remanie volontiers.
 */
export function recollerFidele(entree: string, sortie: string): Recollage {
  const u = unites(entree);
  const idxEntree = motsSeuls(u);
  const motsSortie = unites(sortie).filter((_, i) => i % 2 === 0).filter((m) => m !== '');

  const squelettesEntree = idxEntree.map((i) => squelette(u[i] ?? ''));
  const squelettesSortie = motsSortie.map((m) => squelette(m));
  const paires = alignement(squelettesEntree, squelettesSortie);

  let vocalises = 0;
  let refuses = 0;
  idxEntree.forEach((iUnite, rang) => {
    const cible = paires.get(rang);
    const propose = cible === undefined ? undefined : motsSortie[cible];
    if (propose === undefined) {
      refuses++;
      return;
    }
    u[iUnite] = propose;
    // un mot rendu à l'identique n'a pas été voyellé ; le compter serait mentir
    if (propose !== squelettesEntree[rang]) vocalises++;
  });

  // Bornes des mots restés nus, relevées sur le texte définitif. Un seul
  // parcours, après assemblage : les positions sont donc exactes par
  // construction, y compris pour les mots que le modèle a laissés intacts.
  const nus: Array<[number, number]> = [];
  let position = 0;
  for (const unite of u) {
    if (unite === undefined) continue;
    const debut = position;
    position += unite.length;
    if (LETTRE_ARABE.test(unite) && !MARQUES_TEST.test(unite)) nus.push([debut, position]);
  }

  return { texte: u.join(''), vocalises, refuses, nus };
}

/** Taille maximale d'une page téléversée. Trois pages scannées tiennent
 *  largement dessous ; au-delà, c'est un livre, et l'appel coûterait cher. */
export const LIMITE_OCTETS_PAGE = 8 * 1024 * 1024;

/** Types acceptés au téléversement. Le modèle lit le PDF sans conversion. */
export const TYPES_PAGE = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/tiff',
  'application/pdf',
]);

/**
 * OCR du vocaliseur — prompt PROPRE À CE PRODUIT.
 *
 * Distinct de celui du pipeline, qui se présente comme « spécialisé dans les
 * textes islamiques arabes » : ici on ne sait pas ce qu'on lit, et l'annoncer
 * orienterait la lecture. On demande une transcription nue, sans les signes de
 * vocalisation même s'ils figurent sur la page — c'est l'étape suivante qui les
 * pose, et les garder ferait comparer des squelettes déjà voyellés.
 */
export const OCR_VOCALISATION_PROMPT = `Transcris tout le texte arabe visible sur cette page, tel qu'il est écrit.

RÈGLES :
1. Rends le texte seul. Aucune introduction, aucun commentaire, aucune balise.
2. Respecte les retours à la ligne et les paragraphes de la page.
3. N'ajoute aucun signe de vocalisation (تشكيل). Si la page en porte, transcris les lettres sans eux.
4. Ne corrige rien, ne complète rien, ne résume rien : ce qui est écrit, rien d'autre.
5. Ignore les numéros de page, les en-têtes et les pieds de page courants.
6. Si la page ne contient aucun texte arabe lisible, ne rends rien.`;

/**
 * Consigne du vocaliseur. Prompt propre à ce produit : il ne mentionne aucune
 * fatwa, aucun corpus, et ne doit jamais être fondu avec ceux du pipeline.
 *
 * Formulé en interdits plutôt qu'en objectifs, parce que c'est le débordement
 * — corriger, compléter, expliquer — qui est le risque, non l'insuffisance.
 */
export const VOCALISATION_SYSTEM = `Tu es un vocaliseur de textes arabes. Ta seule tâche est d'ajouter les signes de vocalisation (تشكيل) à un texte arabe existant.

RÈGLES ABSOLUES :
1. Restitue le texte reçu MOT POUR MOT, dans le même ordre, sans exception.
2. N'ajoute, ne supprime, ne remplace, ne déplace AUCUN mot et AUCUNE lettre. Même si le texte te paraît fautif, incomplet ou mal orthographié : tu n'y touches pas.
3. N'ajoute que les signes de vocalisation : fatḥa, ḍamma, kasra, sukūn, shadda, tanwīn, alif suscrit.
4. Conserve à l'identique la ponctuation, les parenthèses, les guillemets, les retours à la ligne et les paragraphes.
5. Vocalise INTÉGRALEMENT : chaque mot arabe reçoit ses signes, y compris la désinence casuelle (إعراب), qui doit être grammaticalement juste — c'est la raison d'être de ce travail.
6. Laisse tels quels les chiffres, les mots latins et tout ce qui n'est pas arabe.
7. Ne réponds RIEN d'autre que le texte vocalisé : aucune introduction, aucun commentaire, aucune explication, aucune balise.

Si un passage est ambigu, choisis la lecture grammaticalement correcte la plus courante — mais ne modifie jamais le texte pour lever l'ambiguïté.`;
