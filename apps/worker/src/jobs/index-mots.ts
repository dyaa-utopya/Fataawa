import { z } from 'zod';
import {
  COL_FATWAS,
  type FatwaStored,
  FieldValue,
  db,
  logger,
  motsIndexables,
  toFatwa,
} from '@fataawa/core';

/**
 * Remplit le champ `mots` des fatwas déjà en base.
 *
 * La recherche par mots-clés interroge ce tableau : sans lui, seules les fatwas
 * écrites après le déploiement seraient trouvables par mot exact, et le corpus
 * paraîtrait à moitié muet. Aucun appel au modèle — tout se calcule à partir du
 * texte déjà stocké.
 *
 * Seul `mots` est écrit ; le texte des fatwas n'est jamais touché.
 */
const configSchema = z.object({
  GOOGLE_CLOUD_PROJECT: z.string().min(1),
  /** Écriture réelle ; sinon on se contente de compter ce qui changerait. */
  APPLIQUER: z.string().optional(),
  /** Réécrit même les fatwas qui portent déjà des mots (changement de règles). */
  FORCER: z.string().optional(),
});

/** Firestore accepte 500 opérations par lot ; on garde une marge. */
const TAILLE_LOT = 400;
/** Pagination : un curseur sur l'ID, pour ne pas tenir 4 000 documents en mémoire. */
const TAILLE_PAGE = 500;

async function main(): Promise<void> {
  const cfg = configSchema.parse(process.env);
  const appliquer = cfg.APPLIQUER === '1' || cfg.APPLIQUER === 'true';
  const forcer = cfg.FORCER === '1' || cfg.FORCER === 'true';
  logger.info({ collection: COL_FATWAS, appliquer, forcer }, 'indexation lexicale démarrée');

  let dernier = '';
  let examinees = 0;
  let ecrites = 0;
  let vides = 0;
  let total = 0;

  for (;;) {
    let q = db().collection(COL_FATWAS).orderBy('__name__').limit(TAILLE_PAGE);
    if (dernier !== '') q = q.startAfter(dernier);
    const snap = await q.get();
    if (snap.empty) break;
    dernier = snap.docs[snap.docs.length - 1]?.id ?? '';

    let batch = db().batch();
    let enAttente = 0;
    for (const doc of snap.docs) {
      examinees++;
      const data = doc.data() as FatwaStored;
      if (!forcer && (data.mots?.length ?? 0) > 0) continue;

      const f = toFatwa(doc.id, data);
      const mots = motsIndexables(f.sujetPrincipal, f.sousSujet, f.themeN3, f.numero, f.texte);
      total += mots.length;
      if (mots.length === 0) {
        // fatwa sans texte exploitable : rien à indexer, et l'écriture d'un
        // tableau vide coûterait un document de plus à parcourir au prochain
        // passage sans rien y gagner
        vides++;
        continue;
      }
      ecrites++;
      if (appliquer) {
        batch.update(doc.ref, { mots, majAt: FieldValue.serverTimestamp() });
        if (++enAttente >= TAILLE_LOT) {
          await batch.commit();
          batch = db().batch();
          enAttente = 0;
        }
      }
    }
    if (appliquer && enAttente > 0) await batch.commit();
    logger.info({ examinees, ecrites }, 'page indexée');
  }

  logger.info(
    {
      examinees,
      ecrites,
      vides,
      motsMoyens: ecrites === 0 ? 0 : Math.round(total / ecrites),
      appliquer,
    },
    appliquer ? 'indexation lexicale terminée' : 'simulation terminée — rien n’a été écrit',
  );
}

main().catch((err: unknown) => {
  logger.error({ err }, 'indexation lexicale en échec');
  process.exitCode = 1;
});
