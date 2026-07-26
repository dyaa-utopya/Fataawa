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
 * Aucun appel au modèle ici, et c'est le point : tout est déjà en base. Les
 * pages du recueil, mises bout à bout, forment un texte continu ; on y situe
 * le début de la fatwa puis sa fin, et les pages traversées sont les siennes.
 *
 * Seul le champ `pages` est réécrit. Le texte des fatwas n'est jamais touché.
 */
const configSchema = z.object({
  GOOGLE_CLOUD_PROJECT: z.string().min(1),
  /**
   * Pages examinées après celle de départ. Mesuré sur le corpus : 27 fatwas
   * occupent cinq pages, quatre en occupent six, une en occupe sept. Neuf
   * laisse donc de la marge, et n'coûte que la lecture de textes déjà chargés.
   */
  FENETRE: z.coerce.number().int().min(1).max(15).default(9),
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

      // On regarde la page de départ, les deux d'avant (le découpage a pu
      // enregistrer une page trop tard) et les suivantes.
      const candidats = [];
      for (let n = depart - 2; n <= depart + cfg.FENETRE; n++) {
        const p = parNumero.get(n);
        if (p !== undefined && p.texte !== '') candidats.push({ ...p, numero: n });
      }
      if (!parNumero.has(depart)) continue;

      const trouvees = pagesCouvertes(texte, candidats, depart).sort(
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
