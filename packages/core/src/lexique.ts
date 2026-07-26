/**
 * Recherche par mots-clés, à placer À CÔTÉ de la recherche sémantique.
 *
 * La recherche vectorielle cherche le sens : elle excelle quand le lecteur
 * décrit son problème avec ses mots, et échoue quand il connaît le mot exact.
 * Demander « ٢٦٧٧ » ou « الاستغاثة » à un index de vecteurs rend des voisins de
 * sens, jamais la ligne précise — parce que le sens d'un numéro n'existe pas.
 *
 * Firestore n'a pas de recherche plein texte. On indexe donc les mots de chaque
 * fatwa dans un tableau (`mots`) interrogeable par `array-contains`, ce qui
 * suffit ici : le corpus est clos, les requêtes courtes.
 *
 * Ce chemin ne sert QUE la recherche globale. Le questions/réponses reste
 * purement sémantique : une question posée librement ne rencontre presque
 * jamais les mots du livre, et y ajouter la correspondance lexicale
 * n'apporterait que du bruit.
 *
 * Limite connue, assumée : les préfixes arabes (و، ب، ل، ك) ne sont pas
 * détachés, si bien que « البحوث », « للبحوث » et « والبحوث » restent trois
 * jetons distincts. Les séparer sans analyseur morphologique casse plus de mots
 * qu'il n'en rapproche — « ولد » n'est pas « و + لد ». C'est le chemin
 * sémantique qui absorbe ces variantes.
 */

/**
 * Mots qui ne distinguent aucune fatwa d'une autre — toutes formes déjà
 * normalisées, puisque c'est sous cette forme qu'elles sont comparées.
 *
 * Le tri s'est fait par NATURE, la fréquence ne servant que de preuve. Mesuré
 * sur les 3 981 fatwas du corpus, « الصلاة » apparaît dans 43 % d'entre elles —
 * plus que « اللجنة » (44 %) ou « رئيس » (43 %). Un simple seuil de fréquence
 * aurait donc supprimé le mot le plus utile du recueil. On n'écarte que ce qui
 * est structurel ou relève de la signature ; aucun mot de contenu, quelle que
 * soit sa fréquence.
 */
const MOTS_VIDES = new Set([
  // particules et pronoms
  'من',
  'في',
  'الي',
  'علي',
  'عن',
  'مع',
  'هذا',
  'هذه',
  'ذلك',
  'التي',
  'الذي',
  'الذين',
  'ما',
  'لا',
  'ولا',
  'الا',
  'ان',
  'انه',
  'او',
  'ام',
  'ثم',
  'قد',
  'كان',
  'كانت',
  'يكون',
  'هل',
  'كل',
  'بين',
  'عند',
  'بعد',
  'قبل',
  'حتي',
  'لم',
  'لن',
  'كما',
  'به',
  'له',
  'لها',
  'هو',
  'هي',
  'وهو',
  'اذا',
  'وقد',
  'عليه',
  'فيه',
  'فيها',
  'لان',
  'الله',
  'تعالي',
  // en-tête imprimé sur presque chaque fatwa : « الفتوى رقم » / « السؤال »
  // (74 %, 74 %, 57 %)
  'فتوي',
  'الفتوي',
  'رقم',
  'سوال',
  'السوال',
  'جواب',
  'الجواب',
  // formule de clôture « وبالله التوفيق وصلى الله على نبينا محمد وآله وصحبه
  // وسلم » (71 à 74 %). C'est le même décor qui avait faussé la mesure de
  // l'étendue des fatwas : présent partout, il ne dit rien de nulle part.
  'وبالله',
  'توفيق',
  'التوفيق',
  'وصلي',
  'نبينا',
  'محمد',
  'واله',
  'وصحبه',
  'وسلم',
  // bloc de signature du comité (37 à 51 %)
  'لجنه',
  'اللجنه',
  'دايمه',
  'الدايمه',
  'بحوث',
  'للبحوث',
  'البحوث',
  'علميه',
  'العلميه',
  'افتاء',
  'الافتاء',
  'والافتاء',
  'رييس',
  'الرييس',
  'نايب',
  'عضو',
  // noms des signataires, présents sur presque toutes les fatwas : les
  // chercher rendrait le corpus entier (24 à 51 %)
  'بن',
  'باز',
  'عفيفي',
  'غديان',
  'قعود',
  'عبد',
  'عبدالله',
  'عبدالعزيز',
  'عبدالرزاق',
]);

/**
 * En deçà de deux caractères, un mot arabe normalisé ne porte plus rien
 * (particules ب، ل، و collées).
 */
const LONGUEUR_MIN = 2;
/**
 * Retirer l'article défini n'est sûr que si le reste tient encore debout :
 * « الله » réduit à « له » serait un contresens, d'où le plancher.
 */
const RESTE_MIN_SANS_ARTICLE = 3;
/** Mots indexés par fatwa. Les plus longues sont tronquées ; elles restent
 *  atteignables par la recherche sémantique, qui lit tout le texte. */
export const PLAFOND_JETONS_TEXTE = 400;
/** Mots retenus d'une requête : au-delà, ce n'est plus une recherche par mots. */
export const PLAFOND_JETONS_REQUETE = 6;

const DIACRITIQUES = /[ً-ْٰـ]/g;
const CHIFFRES_ARABES = /[٠-٩]/g;

/**
 * Forme comparable d'un mot arabe : diacritiques et tatweel retirés, variantes
 * de hamza ramenées à ا, tāʾ marbūṭa à ه, yāʾ final à ي, chiffres arabes
 * convertis. L'OCR et le lecteur n'écrivent pas ces caractères de la même
 * façon ; sans cette réduction, « الصلاة » et « الصلاه » ne se rencontrent pas.
 */
export function normaliserMot(mot: string): string {
  return mot
    .normalize('NFC')
    .replace(DIACRITIQUES, '')
    .replace(CHIFFRES_ARABES, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/[ىئ]/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .toLowerCase();
}

/**
 * Formes sous lesquelles un mot est indexé : lui-même, et sa forme sans article
 * défini. Le lecteur qui tape « زكاة » doit trouver « الزكاة », et l'inverse.
 */
function formes(mot: string): string[] {
  const m = normaliserMot(mot);
  if (m.length < LONGUEUR_MIN) return [];
  const nu = m.startsWith('ال') && m.length - 2 >= RESTE_MIN_SANS_ARTICLE ? m.slice(2) : '';
  return nu === '' ? [m] : [m, nu];
}

function decouper(texte: string): string[] {
  return texte.split(/[^\p{L}\p{N}]+/u).filter((m) => m !== '');
}

/**
 * Mots à stocker sur une fatwa. Dédoublonnés, plafonnés, mots vides retirés :
 * ce tableau est indexé par Firestore, chaque entrée y coûte.
 */
export function jetonsTexte(texte: string, plafond = PLAFOND_JETONS_TEXTE): string[] {
  const vus = new Set<string>();
  for (const mot of decouper(texte)) {
    for (const f of formes(mot)) {
      if (MOTS_VIDES.has(f)) continue;
      vus.add(f);
      if (vus.size >= plafond) return [...vus];
    }
  }
  return [...vus];
}

/**
 * Mots d'une requête, dans l'ordre où le lecteur les a écrits.
 *
 * Les mots vides sont retirés ici aussi : « ما حكم الصلاة » se ramène à
 * « حكم » et « صلاة », sans quoi « ما » ramènerait la moitié du corpus.
 */
export function jetonsRequete(requete: string, plafond = PLAFOND_JETONS_REQUETE): string[] {
  const jetons: string[] = [];
  const vus = new Set<string>();
  for (const mot of decouper(requete)) {
    for (const f of formes(mot)) {
      if (MOTS_VIDES.has(f) || vus.has(f)) continue;
      vus.add(f);
      jetons.push(f);
      if (jetons.length >= plafond) return jetons;
    }
  }
  return jetons;
}

/**
 * Numéro de fatwa demandé, ou chaîne vide.
 *
 * Reconnaît « 2677 », « ٢٦٧٧ », « رقم ٢٦٧٧ », « الفتوى رقم 2677 » — mais rien
 * qui contienne d'autres mots : « زكاة 1000 » est une recherche de texte où le
 * nombre est un montant, pas un numéro de fatwa. La confusion coûterait cher,
 * puisqu'un numéro exact passe devant tout le reste.
 */
export function numeroDemande(requete: string): string {
  const mots = decouper(requete).map(normaliserMot).filter((m) => m !== '');
  const chiffres = mots.filter((m) => /^\d+$/.test(m));
  const autres = mots.filter((m) => !/^\d+$/.test(m));
  if (chiffres.length !== 1) return '';
  const seul = chiffres[0] ?? '';
  const habilles = autres.every((m) => m === 'رقم' || m === 'الفتوي' || m === 'فتوي');
  return habilles && seul.length >= 2 ? seul : '';
}

/**
 * Rang lexical d'un candidat : nombre de mots distincts de la requête qu'il
 * porte. À égalité, la fatwa la plus courte passe devant — la même
 * correspondance y pèse plus lourd.
 */
export function scoreLexical(jetonsDoc: readonly string[], motsCherches: readonly string[]): number {
  const presents = new Set(jetonsDoc);
  let n = 0;
  for (const j of motsCherches) if (presents.has(j)) n++;
  return n;
}

/**
 * Fusion de rangs réciproques : additionne 1/(K + rang) sur chaque liste.
 *
 * Choisie parce qu'elle ne compare aucun score entre eux — une distance cosinus
 * et un compte de mots communs ne sont pas commensurables, et toute tentative
 * de les mettre à la même échelle demande un réglage qui vieillit mal. Seul
 * l'ordre compte ici.
 */
export const K_RRF = 60;

export function fusionnerRangs<T>(listes: ReadonlyArray<readonly T[]>, cle: (x: T) => string): T[] {
  const scores = new Map<string, number>();
  const objets = new Map<string, T>();
  for (const liste of listes) {
    liste.forEach((x, i) => {
      const k = cle(x);
      scores.set(k, (scores.get(k) ?? 0) + 1 / (K_RRF + i + 1));
      if (!objets.has(k)) objets.set(k, x);
    });
  }
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => objets.get(k))
    .filter((x): x is T => x !== undefined);
}
