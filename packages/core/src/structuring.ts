import { z } from 'zod';
import {
  type GeminiCallOptions,
  geminiGenerateText,
  stripJsonFences,
} from './gemini.js';
import { normalizeDigits } from './pages.js';
import { SECTION_AUTRE, blocTaxonomie, verifieThemes } from './themes.js';
import type { FatwaOuverteState } from './types.js';

/** Sortie attendue de la structuration d'une page. */
export interface FatwaExtraite {
  numero: string;
  /** Repère de sous-question dans une même fatwa : « 1 », « 2 », « أ »… vide si unique. */
  sousQuestion: string;
  /** Chapitre, section et sujet précis, ramenés sur la taxonomie. */
  themeN1: string;
  themeN2: string;
  themeN3: string;
  /** Les trois niveaux sont renseignés et conformes à la taxonomie. */
  themesComplets: boolean;
  question: string;
  reponse: string;
  texteComplet: string;
}

export interface FragmentOuvert {
  numero: string;
  sousQuestion: string;
  themeN1: string;
  themeN2: string;
  themeN3: string;
  textePartiel: string;
}

export interface StructurationResult {
  fatwasCompletes: FatwaExtraite[];
  fatwaOuverte: FragmentOuvert | null;
}

const fatwaExtraiteSchema = z.object({
  numero_fatwa: z.string().default(''),
  sous_question: z.string().default(''),
  theme_n1: z.string().default(''),
  theme_n2: z.string().default(''),
  theme_n3: z.string().default(''),
  question: z.string().default(''),
  reponse: z.string().default(''),
  texte_complet: z.string().min(1),
});

const structurationSchema = z.object({
  fatwas_completes: z.array(fatwaExtraiteSchema).default([]),
  fatwa_ouverte: z
    .object({
      numero_fatwa: z.string().default(''),
      sous_question: z.string().default(''),
      theme_n1: z.string().default(''),
      theme_n2: z.string().default(''),
      theme_n3: z.string().default(''),
      texte_partiel: z.string().min(1),
    })
    .nullable()
    .default(null),
});

/** Schéma de réponse au format Gemini (responseSchema). */
export const STRUCTURATION_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    fatwas_completes: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          numero_fatwa: { type: 'STRING' },
          sous_question: { type: 'STRING' },
          theme_n1: { type: 'STRING' },
          theme_n2: { type: 'STRING' },
          theme_n3: { type: 'STRING' },
          question: { type: 'STRING' },
          reponse: { type: 'STRING' },
          texte_complet: { type: 'STRING' },
        },
        // question et réponse sont exigées : sans elles, impossible de savoir
        // où s'arrête l'exposé et où commence la réponse du comité.
        // Les trois niveaux de thème le sont aussi : une fatwa sans thème
        // n'est pas navigable, et le rapport d'anomalies la signalera.
        required: ['question', 'reponse', 'texte_complet', 'theme_n1', 'theme_n2', 'theme_n3'],
      },
    },
    fatwa_ouverte: {
      type: 'OBJECT',
      nullable: true,
      properties: {
        numero_fatwa: { type: 'STRING' },
        sous_question: { type: 'STRING' },
        theme_n1: { type: 'STRING' },
        theme_n2: { type: 'STRING' },
        theme_n3: { type: 'STRING' },
        texte_partiel: { type: 'STRING' },
      },
      required: ['texte_partiel'],
    },
  },
  required: ['fatwas_completes'],
} as const;

export const STRUCTURATION_SYSTEM = `Tu structures des recueils de fatwas arabes en parcourant le livre dans l'ordre.

Tu reçois une FENÊTRE DE LECTURE de plusieurs pages consécutives :
- la PAGE COURANTE, seule page dont tu extrais les fatwas ;
- des PAGES SUIVANTES fournies uniquement comme CONTEXTE, pour que tu puisses voir où
  se termine une fatwa qui déborde de la page courante ;
- éventuellement un FRAGMENT EN ATTENTE : une fatwa commencée avant la page courante,
  dont le début de la page courante est la suite.

Règles strictes :
1. N'extrais QUE les fatwas qui commencent dans la PAGE COURANTE, ou qui prolongent le
   FRAGMENT EN ATTENTE. Une fatwa qui commence dans une page de contexte ne doit PAS
   être extraite : elle le sera à son tour. C'est ce qui évite les doublons.
2. Une fatwa peut se poursuivre dans les pages de contexte : dans ce cas recopie son
   texte ENTIER (page courante + suite) et place-la dans fatwas_completes. Ne coupe
   jamais une fatwa au bord d'une page.
3. Si une fatwa commencée dans la page courante n'est toujours pas terminée à la fin de
   la fenêtre, mets-la dans fatwa_ouverte (texte_partiel cumulé) et non dans
   fatwas_completes.
4. Recopie le texte arabe FIDÈLEMENT : ni résumé, ni traduction, ni correction.
5. numero_fatwa : le numéro de la fatwa, en CHIFFRES LATINS (« 1881 », jamais « ١٨٨١ »).
   Il figure dans un en-tête du type « السؤال الأول من الفتوى رقم (١٨٨١) » : le nombre
   entre parenthèses est le numéro. N'inscris QUE le numéro effectivement lisible dans la
   page courante ou dans le fragment ; s'il n'y en a aucun, laisse le champ VIDE. Ne
   devine jamais un numéro, ne réutilise pas celui d'une autre fatwa : le rattachement des
   fatwas sans numéro est fait ensuite, hors de ton travail.
6. SOUS-QUESSTIONS : une même fatwa contient parfois plusieurs questions
   (« السؤال الأول », « السؤال الثاني », ou des repères أ / ب / ج, ou 1 / 2 / 3), chacune
   avec sa propre réponse. Produis alors UNE ENTRÉE PAR QUESTION, toutes avec le MÊME
   numero_fatwa, et renseigne sous_question avec le repère tel qu'imprimé (« الأول »,
   « أ », « 2 »…). Si la fatwa ne contient qu'une question, laisse sous_question vide.
7. question / reponse : OBLIGATOIRES et jamais vides. Dans ces recueils, la séparation est
   marquée par deux abréviations imprimées : « س: » (سؤال) ouvre l'exposé du demandeur, et
   « ج: » (جواب) ouvre la réponse du comité. Avec plusieurs questions, elles sont numérotées :
   « س ٢: » … « ج ٢: ». La réponse commence EXACTEMENT à « ج: » (ou « ج ٢: »), pas avant.
   Attentions :
   - ne confonds pas ce marqueur avec un mot commençant par la lettre ج (جديد، جلسة…) : le
     marqueur est une lettre isolée suivie de deux points, éventuellement d'un numéro ;
   - « وبعد » et « الحمد لله » appartiennent souvent à la lettre du demandeur : ce ne sont
     PAS des marqueurs de réponse ;
   - l'exposé est fréquemment beaucoup plus long que la réponse ; c'est normal, ne coupe
     pas l'exposé pour équilibrer les deux.
   Si aucun marqueur « ج » n'apparaît, mets tout l'énoncé dans question et laisse reponse vide.
   texte_complet : les deux réunis, dans l'ordre de lecture, sans rien retirer.
8. THÈMES — theme_n1, theme_n2, theme_n3 : OBLIGATOIRES tous les trois, jamais vides,
   déduits de la fatwa ENTIÈRE (jamais du seul début ni de la seule fin).
   - theme_n1 : le chapitre. Recopie-le EXACTEMENT tel qu'il figure dans la TAXONOMIE
     ci-dessous. N'en invente aucun autre.
   - theme_n2 : la section, prise EXACTEMENT dans la liste du chapitre que tu as choisi.
     Si aucune ne convient, écris « ${SECTION_AUTRE} ».
   - theme_n3 : le sujet précis, libre, en arabe, deux à cinq mots (« زكاة الحلي المستعمل »,
     « حكم الصلاة خلف المبتدع »). Ni phrase, ni recopie de la question.
   Deux questions d'une même fatwa peuvent relever de thèmes différents : classe chacune
   pour elle-même.

TAXONOMIE (chapitre : sections admises)
${blocTaxonomie()}

9. Ignore les titres de chapitres, en-têtes courants, numéros de page isolés et notes de
   bas de page : ce ne sont ni des fatwas ni des fragments.
10. Une page de SOMMAIRE (فهرس / المحتويات : suite de titres suivis de points de conduite
    et d'un numéro de page) ne contient AUCUNE fatwa. Rends fatwas_completes vide.
Réponds STRICTEMENT au schéma JSON demandé.`;

export interface PageFenetre {
  numero: number;
  texte: string;
}

export interface StructurationInput {
  titreLivre: string;
  numeroPage: number;
  textePage: string;
  /** Pages suivantes fournies comme contexte de fin de fatwa. */
  pagesSuivantes?: PageFenetre[];
  fragment: FatwaOuverteState | null;
}

export function buildStructurationPrompt(input: StructurationInput): string {
  const fragmentBloc = input.fragment
    ? `FRAGMENT EN ATTENTE — fatwa ${input.fragment.numero || 'sans numéro'}${
        input.fragment.sousQuestion ? `, question ${input.fragment.sousQuestion}` : ''
      } commencée avant la page courante ; le début de la page courante en est la suite :
${input.fragment.textePartiel}

`
    : '';
  const contexte = (input.pagesSuivantes ?? [])
    .map(
      (p) => `--- PAGE ${p.numero} (CONTEXTE, ne pas extraire ce qui y commence) ---
${p.texte}`,
    )
    .join('\n\n');
  return `${fragmentBloc}=== PAGE COURANTE ${input.numeroPage} — LIVRE « ${input.titreLivre} » ===
${input.textePage}${contexte === '' ? '' : `\n\n${contexte}`}`;
}

/** JSON.parse + validation zod, en snake_case Gemini → camelCase domaine. */
export function parseStructurationJson(raw: string): StructurationResult {
  const parsed = structurationSchema.parse(JSON.parse(stripJsonFences(raw)));
  return {
    fatwasCompletes: parsed.fatwas_completes.map((f) => {
      // les libellés hors taxonomie sont effacés, jamais rapprochés de force :
      // la fatwa ressort incomplète et le rapport la signale
      const th = verifieThemes(f.theme_n1, f.theme_n2, f.theme_n3);
      return {
        numero: f.numero_fatwa.trim(),
        sousQuestion: f.sous_question.trim(),
        themeN1: th.niveau1,
        themeN2: th.niveau2,
        themeN3: th.niveau3,
        themesComplets: th.complet,
        question: f.question.trim(),
        reponse: f.reponse.trim(),
        texteComplet: f.texte_complet.trim(),
      };
    }),
    fatwaOuverte: parsed.fatwa_ouverte
      ? (() => {
          const th = verifieThemes(
            parsed.fatwa_ouverte.theme_n1,
            parsed.fatwa_ouverte.theme_n2,
            parsed.fatwa_ouverte.theme_n3,
          );
          return {
            numero: parsed.fatwa_ouverte.numero_fatwa.trim(),
            sousQuestion: parsed.fatwa_ouverte.sous_question.trim(),
            themeN1: th.niveau1,
            themeN2: th.niveau2,
            themeN3: th.niveau3,
            textePartiel: parsed.fatwa_ouverte.texte_partiel.trim(),
          };
        })()
      : null,
  };
}

export interface StructurationOptions extends GeminiCallOptions {
  model: string;
}

/** Structure une page ; un retry avec feedback si le JSON rendu est invalide. */
export async function geminiStructurePage(
  input: StructurationInput,
  opts: StructurationOptions,
): Promise<StructurationResult> {
  const prompt = buildStructurationPrompt(input);
  let derniereErreur = '';
  for (let essai = 0; essai < 2; essai++) {
    const texte =
      essai === 0
        ? prompt
        : `${prompt}

Ta réponse précédente était invalide (${derniereErreur}). Réponds STRICTEMENT au schéma JSON demandé.`;
    const raw = await geminiGenerateText(
      {
        model: opts.model,
        systemInstruction: STRUCTURATION_SYSTEM,
        contents: [{ role: 'user', parts: [{ text: texte }] }],
        responseSchema: STRUCTURATION_RESPONSE_SCHEMA,
      },
      opts,
    );
    try {
      return parseStructurationJson(raw);
    } catch (err) {
      derniereErreur = err instanceof Error ? err.message.slice(0, 200) : String(err);
    }
  }
  throw new Error(`structuration invalide après 2 essais : ${derniereErreur}`);
}

/**
 * Page de sommaire (فهرس) ? Ces pages, en fin de recueil, alignent des titres
 * suivis de points de conduite et d'un numéro de page. Le modèle n'en tire
 * généralement rien, mais rien ne le lui garantit : on les écarte avant même
 * de l'appeler — c'est déterministe, et cela évite une vingtaine d'appels par
 * livre.
 *
 * Signature mesurée sur le recueil 1 : les pages 478 à 496 ont 78 à 88 % de
 * leurs lignes terminées par un nombre ou pourvues de points de conduite ;
 * les pages de fatwas, elles, tombent à 0 %.
 */
const LIGNE_SOMMAIRE = /(\.{4,}|…{2,}|[.·]\s*[.·]\s*[.·])|[٠-٩0-9]{1,4}\s*$/u;
/**
 * Deuxième signal, global celui-là : les points de conduite saturent la page.
 * Il est indispensable parce que sur ces pages l'OCR s'emballe et rend tout
 * d'une traite — une seule ligne de 131 000 caractères, où le comptage par
 * lignes ne voit rien. Sur les dix recueils, une page de fatwas ne dépasse pas
 * 3 % de points ; ces pages-là sont à 49 %.
 */
const PROPORTION_POINTS = 0.15;

export function estPageSommaire(texte: string): boolean {
  const t = texte.trim();
  if (t === '') return false;
  let points = 0;
  for (const c of t) if (c === '.' || c === '·' || c === '…') points++;
  if (points / t.length >= PROPORTION_POINTS) return true;

  const lignes = t
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '');
  if (lignes.length < 6) return false;
  const reperes = lignes.filter((l) => LIGNE_SOMMAIRE.test(l)).length;
  return reperes >= 6 && reperes / lignes.length >= 0.5;
}

/**
 * Forme comparable d'un texte arabe : diacritiques, tatweel, ponctuation et
 * espaces retirés. Sert à confronter ce que le modèle a restitué au texte OCR,
 * qui diffèrent toujours un peu dans la ponctuation et les voyelles.
 */
export function normaliserPourComparaison(texte: string): string {
  return texte
    .normalize('NFC')
    .replace(/[ً-ْٰـ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .toLowerCase();
}

/**
 * La fatwa commence-t-elle réellement dans le texte fourni ?
 *
 * Le prompt demande au modèle de n'extraire que ce qui débute dans la page
 * courante, mais il ne s'y tient pas toujours : il lui arrive d'extraire une
 * fatwa vue dans les pages de contexte, qui sera ensuite ré-extraite à son
 * tour — d'où des doublons. Cette vérification est le garde-fou déterministe
 * qui ne dépend plus de la consigne.
 */
export function commenceDans(texteFatwa: string, texteAutorise: string, longueur = 40): boolean {
  const debut = normaliserPourComparaison(texteFatwa).slice(0, longueur);
  // début trop court pour décider : on laisse passer plutôt que de perdre la fatwa
  if (debut.length < 12) return true;
  return normaliserPourComparaison(texteAutorise).includes(debut);
}

/** Normalise un numéro de fatwa (chiffres arabes → latins, trim). */
export function normaliseNumeroFatwa(numero: string): string {
  return normalizeDigits(numero).trim();
}

/** Une page qui porte un en-tête « … من الفتوى رقم (X) » ouvre une nouvelle fatwa. */
export function porteEnTeteFatwa(textePage: string): boolean {
  return /الفتوى\s+رقم\s*\(/.test(textePage);
}

/**
 * Numéros de fatwa cités dans un texte. Un bloc qui en contient plusieurs peut
 * signaler deux fatwas soudées — mais c'est le plus souvent une citation
 * légitime (le demandeur renvoie à une fatwa parue ailleurs), d'où une simple
 * trace dans les journaux plutôt qu'un rejet.
 */
export function numerosFatwaCites(texte: string): string[] {
  const trouves = new Set<string>();
  for (const m of texte.matchAll(/الفتوى\s+رقم\s*\(?\s*([٠-٩0-9]+)\s*\)?/g)) {
    const brut = m[1];
    if (brut === undefined) continue;
    const n = normalizeDigits(brut).replace(/^0+(?=\d)/, '');
    if (n !== '') trouves.add(n);
  }
  return [...trouves];
}

/**
 * Repères de sous-question tels qu'imprimés dans les recueils, ramenés à un
 * rang numérique. Sans cette normalisation, la même question extraite deux
 * fois avec deux écritures différentes (« الثاني » puis « 2 ») produirait deux
 * documents au lieu d'un. Le repère d'origine reste lisible dans le texte de
 * la fatwa.
 */
const RANGS_ARABES: Record<string, number> = {
  // ordinaux masculins
  الأول: 1, الاول: 1, الثاني: 2, الثانى: 2, الثالث: 3, الرابع: 4, الخامس: 5,
  السادس: 6, السابع: 7, الثامن: 8, التاسع: 9, العاشر: 10,
  // ordinaux féminins — présents dans les recueils (« السؤال الأولى »)
  الأولى: 1, الاولى: 1, الثانية: 2, الثالثة: 3, الرابعة: 4, الخامسة: 5,
  السادسة: 6, السابعة: 7, الثامنة: 8, التاسعة: 9, العاشرة: 10,
  // lettres de l'abjad utilisées comme puces
  أ: 1, ا: 1, ب: 2, ج: 3, د: 4, ه: 5, و: 6, ز: 7, ح: 8, ط: 9, ي: 10,
};

export function normaliseSousQuestion(brut: string): string {
  const nettoye = normalizeDigits(brut)
    .replace(/[()[\].:،,-]/g, ' ')
    .trim();
  if (nettoye === '') return '';
  const chiffres = nettoye.match(/\d+/);
  if (chiffres?.[0]) return String(Number.parseInt(chiffres[0], 10));
  for (const mot of nettoye.split(/\s+/)) {
    const rang = RANGS_ARABES[mot];
    if (rang !== undefined) return String(rang);
  }
  // repère non reconnu : conservé tel quel plutôt que perdu
  return sanitizeIdPart(nettoye);
}

/** Partie d'ID de document Firestore sûre (pas de /, espaces, etc.). */
export function sanitizeIdPart(value: string): string {
  return value
    .replace(/[/\s#?[\]]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 300);
}

/**
 * ID de document d'une fatwa : `{livreId}_{numéro}` — plus `_{sous-question}`
 * quand la fatwa porte plusieurs questions. L'ID EST la déduplication :
 * réécrire la même fatwa (page rejouée, structuration relancée) écrase le même
 * document au lieu d'en créer un second.
 * Sans numéro exploitable, un suffixe déterministe (page + index) est utilisé.
 */
export function fatwaIdFrom(
  livreId: string,
  numeroBrut: string,
  fallbackSuffix: string,
  sousQuestion = '',
): string {
  const numero = sanitizeIdPart(normaliseNumeroFatwa(numeroBrut));
  const part = numero !== '' ? numero : sanitizeIdPart(fallbackSuffix);
  const sous = normaliseSousQuestion(sousQuestion);
  return `${sanitizeIdPart(livreId)}_${part !== '' ? part : 'x'}${sous !== '' ? `_${sous}` : ''}`;
}
