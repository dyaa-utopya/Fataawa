import { z } from 'zod';
import {
  COL_FATWAS,
  type FatwaStored,
  FieldValue,
  type PageDoc,
  type PageSourceRef,
  db,
  livresCol,
  logger,
  pagesCol,
  pagesCouvertes,
} from '@fataawa/core';

/**
 * Corrige le champ `pages` des fatwas déjà en base.
 *
 * Le découpage n'y inscrivait que la page où la fatwa commence, alors qu'une
 * fatwa sur deux déborde sur la suivante. Conséquence visible : la visionneuse
 * s'ouvrait sur une réponse coupée en bas de feuille, sans indiquer qu'il y
 * avait une suite.
 *
 * Aucun appel au modèle ici, et c'est le point : tout est déjà en base. Le
 * texte de la fatwa d'un côté, le texte OCR de chaque page de l'autre, et une
 * comparaison — la part des tranches d'une page qui se retrouvent dans la
 * fatwa. Au-delà de 15 %, la page en fait partie. Mesuré sur un cas réel :
 * 33 % et 18 % sur les deux pages occupées, 0 % sur les quatre voisines.
 *
 * Seul le champ `pages` est réécrit. Le texte des fatwas n'est jamais touché.
 */
const configSchema = z.object({
  GOOGLE_CLOUD_PROJECT: z.string().min(1),
  /** Pages examinées après celle de départ ; une fatwa n'en déborde jamais plus. */
  FENETRE: z.coerce.number().int().min(1).max(10).default(4),
  /** Écriture réelle ; sinon on se contente de compter ce qui changerait. */
  APPLIQUER: z.string().optional(),
});

async function main(): Promise<void> {
  const cfg = configSchema.parse(process.env);
  const appliquer = cfg.APPLIQUER === '1' || cfg.APPLIQUER === 'true';
  logger.info({ collection: COL_FATWAS, appliquer }, 'rattrapage des pages démarré');

  const livres = (await livresCol().select().get()).docs.map((d) => d.id);
  let examinees = 0;
  let corrigees = 0;
  let etendues = 0;

  for (const livreId of livres) {
    const log = logger.child({ livre: livreId });

    // toutes les pages du livre, avec leur texte : un recueil tient largement
    // en mémoire (500 pages de 1 à 4 Ko)
    const parNumero = new Map<number, { ref: PageSourceRef; texte: string }>();
    for (const doc of (await pagesCol(livreId).get()).docs) {
      const p = doc.data() as PageDoc;
      parNumero.set(p.numero, {
        ref: { numero: p.numero, pageId: doc.id, gcsPath: p.gcsPath },
        texte: (p.texteOcr ?? '').trim(),
      });
    }

    const snap = await db()
      .collection(COL_FATWAS)
      .where('livre_id', '==', livreId)
      .get();
    let batch = db().batch();
    let enAttente = 0;

    for (const doc of snap.docs) {
      const data = doc.data() as FatwaStored;
      const texte = data.texte_arabe ?? '';
      const actuelles = (data.pages ?? []).map((p) => p.numero).sort((a, b) => a - b);
      const depart = actuelles[0];
      if (texte === '' || depart === undefined) continue;
      examinees++;

      // on regarde la page de départ, celle d'avant (une fatwa recousue peut
      // commencer plus tôt) et les suivantes
      const candidats = [];
      for (let n = depart - 1; n <= depart + cfg.FENETRE; n++) {
        const p = parNumero.get(n);
        if (p !== undefined && p.texte !== '') candidats.push(p);
      }
      const depuis = parNumero.get(depart);
      if (depuis === undefined) continue;

      const trouvees = pagesCouvertes(texte, candidats, depuis.ref).sort(
        (a, b) => a.numero - b.numero,
      );
      const numeros = trouvees.map((p) => p.numero);
      if (numeros.length === actuelles.length && numeros.every((n, i) => n === actuelles[i])) {
        continue;
      }
      corrigees++;
      if (numeros.length > actuelles.length) etendues++;
      if (appliquer) {
        batch.update(doc.ref, { pages: trouvees, majAt: FieldValue.serverTimestamp() });
        if (++enAttente >= 400) {
          await batch.commit();
          batch = db().batch();
          enAttente = 0;
        }
      }
    }
    if (appliquer && enAttente > 0) await batch.commit();
    log.info({ fatwas: snap.size }, 'recueil traité');
  }

  logger.info(
    { examinees, corrigees, etendues, appliquer },
    appliquer ? 'rattrapage terminé' : 'simulation terminée — rien n’a été écrit',
  );
}

main().catch((err: unknown) => {
  logger.error({ err }, 'rattrapage des pages en échec');
  process.exitCode = 1;
});
