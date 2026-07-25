import { Router } from 'express';
import {
  FieldValue,
  type FatwaOuverteState,
  type LivreDoc,
  type PageDoc,
  type PageSourceRef,
  STATUT_OCR,
  Timestamp,
  type WorkerConfig,
  db,
  enqueueWorkerTask,
  fatwaIdFrom,
  fatwaRef,
  fromPipeline,
  geminiStructurePage,
  livreRef,
  logger,
  pagesCol,
  structurerTaskPayloadSchema,
} from '@fataawa/core';
import { asyncHandler, errorMessage, tasksRuntime } from '../util.js';

const LEASE_MS = 8 * 60_000;
const TIME_BUDGET_MS = 7 * 60_000;

/** Un seul passage de structuration actif par livre (bail sur le doc livre). */
async function acquireLease(livreId: string): Promise<boolean> {
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(livreRef(livreId));
    if (!snap.exists) return false;
    const lease = (snap.data() as LivreDoc).structLease;
    if (lease && Date.now() - lease.toMillis() < LEASE_MS) return false;
    tx.update(livreRef(livreId), { structLease: Timestamp.now() });
    return true;
  });
}

async function releaseLease(livreId: string): Promise<void> {
  await livreRef(livreId).update({ structLease: FieldValue.delete() });
}

function dedupPages(pages: PageSourceRef[]): PageSourceRef[] {
  const byId = new Map(pages.map((p) => [p.pageId, p]));
  return [...byId.values()].sort((a, b) => a.numero - b.numero);
}

/**
 * POST /tasks/structurer — déclenché après chaque OCR réussi (et par le
 * balayage de relance). Avance le curseur du livre page par page, STRICTEMENT
 * dans l'ordre : c'est ce qui permet de recoudre les fatwas coupées entre
 * pages (« SUITE ») via livre.fatwaOuverte. Idempotent : les fatwas sont
 * upsertées par ID déterministe, rejouer une page réécrit les mêmes documents.
 */
export function structurerRouter(cfg: WorkerConfig): Router {
  const router = Router();

  router.post(
    '/structurer',
    asyncHandler(async (req, res) => {
      const parsed = structurerTaskPayloadSchema.safeParse(req.body);
      if (!parsed.success) {
        logger.error({ body: req.body }, 'payload structurer invalide, tâche abandonnée');
        res.status(200).json({ ignoree: 'payload invalide' });
        return;
      }
      const { livreId } = parsed.data;
      const log = logger.child({ livreId });

      if (!(await acquireLease(livreId))) {
        res.status(200).json({ ignoree: 'structuration déjà en cours ou livre absent' });
        return;
      }

      const debut = Date.now();
      let pagesStructurees = 0;
      let fatwasEcrites = 0;
      let etat: 'rattrape' | 'bloque' | 'attente_ocr' | 'budget' = 'budget';

      try {
        while (
          pagesStructurees < cfg.structPagesPerRun &&
          Date.now() - debut < TIME_BUDGET_MS
        ) {
          const livreSnap = await livreRef(livreId).get();
          const livre = livreSnap.data() as LivreDoc;
          const curseur = livre.curseurStructuration ?? 0;

          const nextSnap = await pagesCol(livreId)
            .where('numero', '>', curseur)
            .orderBy('numero', 'asc')
            .limit(1)
            .get();
          if (nextSnap.empty) {
            etat = 'rattrape';
            break;
          }
          const pageDoc = nextSnap.docs[0];
          if (!pageDoc) {
            etat = 'rattrape';
            break;
          }
          const page = pageDoc.data() as PageDoc;

          if (page.statutOcr === STATUT_OCR.QUARANTAINE) {
            // choix assumé : une page en quarantaine bloque le livre plutôt
            // que de recoudre une fatwa de travers
            log.error({ pageId: pageDoc.id }, 'structuration bloquée par une page en QUARANTAINE');
            etat = 'bloque';
            break;
          }
          if (page.statutOcr !== STATUT_OCR.TRAITE) {
            etat = 'attente_ocr'; // l'OCR de cette page relancera la structuration
            break;
          }

          const texte = (page.texteOcr ?? '').trim();
          if (texte === '' || texte === '[PAGE_VIDE]') {
            await livreRef(livreId).update({
              curseurStructuration: page.numero,
              majAt: FieldValue.serverTimestamp(),
            });
            pagesStructurees++;
            continue;
          }

          // Fenêtre de lecture : les pages suivantes servent de contexte pour
          // voir où se termine une fatwa qui déborde de la page courante. On
          // attend qu'elles soient OCRisées si elles existent déjà (l'OCR
          // relancera la structuration), sinon on avance avec ce qu'on a et
          // c'est fatwaOuverte qui sert de filet.
          const suivantesSnap = await pagesCol(livreId)
            .where('numero', '>', page.numero)
            .orderBy('numero', 'asc')
            .limit(cfg.structWindowPages - 1)
            .get();
          const contexte: Array<{ numero: number; texte: string }> = [];
          let attendContexte = false;
          for (const doc of suivantesSnap.docs) {
            const p = doc.data() as PageDoc;
            if (p.statutOcr === STATUT_OCR.TRAITE) {
              const t = (p.texteOcr ?? '').trim();
              if (t !== '' && t !== '[PAGE_VIDE]') contexte.push({ numero: p.numero, texte: t });
            } else if (p.statutOcr !== STATUT_OCR.QUARANTAINE) {
              attendContexte = true;
              break;
            }
          }
          if (attendContexte && contexte.length === 0) {
            etat = 'attente_ocr';
            break;
          }

          // Un fragment qui n'aboutit pas doit être abandonné : sans cela il
          // survit aux pages vides (couverture, sommaire) et finit recousu à
          // une fatwa sans rapport, des dizaines de pages plus loin.
          const fragmentBrut = livre.fatwaOuverte ?? null;
          const ecart = page.numero - (fragmentBrut?.depuisPage ?? page.numero);
          const fragmentPerime = fragmentBrut !== null && ecart > cfg.structWindowPages + 2;
          if (fragmentPerime) {
            log.warn(
              { pageId: pageDoc.id, ouvertePage: fragmentBrut?.depuisPage, ecart },
              'fragment de fatwa abandonné : non abouti après plusieurs pages',
            );
          }
          const fragment = fragmentPerime ? null : fragmentBrut;
          let resultat;
          try {
            resultat = await geminiStructurePage(
              {
                titreLivre: livre.titre,
                numeroPage: page.numero,
                textePage: texte,
                pagesSuivantes: contexte,
                fragment,
              },
              { apiKey: cfg.geminiApiKey, model: cfg.geminiModel },
            );
          } catch (err) {
            const message = errorMessage(err);
            const tentatives = (page.structTentatives ?? 0) + 1;
            if (tentatives >= cfg.structMaxAttempts) {
              await pageDoc.ref.update({
                statutOcr: STATUT_OCR.QUARANTAINE,
                structTentatives: tentatives,
                derniereErreur: `structuration : ${message}`,
                majAt: FieldValue.serverTimestamp(),
              });
              log.error(
                { pageId: pageDoc.id, tentatives },
                `page en QUARANTAINE (structuration) après ${tentatives} tentatives : ${message}`,
              );
              etat = 'bloque';
              break;
            }
            await pageDoc.ref.update({
              structTentatives: tentatives,
              derniereErreur: `structuration : ${message}`,
              majAt: FieldValue.serverTimestamp(),
            });
            throw err; // → 503, Cloud Tasks rejouera depuis le curseur (idempotent)
          }

          const pageSource: PageSourceRef = {
            numero: page.numero,
            pageId: pageDoc.id,
            gcsPath: page.gcsPath,
          };
          const fragmentPages = fragment?.pages ?? [];

          // pages couvertes par la fenêtre : une fatwa peut s'étendre sur le contexte
          const pagesFenetre: PageSourceRef[] = [
            pageSource,
            ...suivantesSnap.docs
              .filter((d) => contexte.some((c) => c.numero === (d.data() as PageDoc).numero))
              .map((d) => {
                const p = d.data() as PageDoc;
                return { numero: p.numero, pageId: d.id, gcsPath: p.gcsPath };
              }),
          ];

          const batch = db().batch();
          const aEmbedder: string[] = [];
          // La même fatwa peut être extraite deux fois (chevauchement de
          // fenêtres) : l'ID déterministe la dédoublonne, mais le compteur du
          // livre ne doit pas pour autant compter deux fois — d'où la
          // vérification d'existence avant écriture.
          let creations = 0;
          for (const [i, fatwa] of resultat.fatwasCompletes.entries()) {
            const id = fatwaIdFrom(livreId, fatwa.numero, `p${pageDoc.id}-${i}`, fatwa.sousQuestion);
            if (!(await fatwaRef(id).get()).exists) creations++;
            // la première fatwa complète porte les pages du fragment recousu
            const pages =
              fragment && i === 0
                ? dedupPages([...fragmentPages, ...pagesFenetre])
                : [pageSource];
            batch.set(
              fatwaRef(id),
              {
                ...fromPipeline({
                  livreId,
                  numero: fatwa.numero,
                  sousQuestion: fatwa.sousQuestion,
                  sujetPrincipal: fatwa.sujetPrincipal,
                  sousSujet: fatwa.sousSujet,
                  texte: fatwa.texteComplet,
                  question: fatwa.question,
                  reponse: fatwa.reponse,
                  pages,
                }),
                majAt: FieldValue.serverTimestamp(),
              },
              { merge: true },
            );
            aEmbedder.push(id);
          }

          const nouvelleOuverte: FatwaOuverteState | null = resultat.fatwaOuverte
            ? {
                numero: resultat.fatwaOuverte.numero,
                sousQuestion: resultat.fatwaOuverte.sousQuestion,
                sujetPrincipal: resultat.fatwaOuverte.sujetPrincipal,
                sousSujet: resultat.fatwaOuverte.sousSujet,
                textePartiel: resultat.fatwaOuverte.textePartiel,
                // conserve la page d'ouverture d'origine tant que le fragment vit
                depuisPage: fragment?.depuisPage ?? page.numero,
                // une page entièrement en continuation cumule les pages du fragment
                pages:
                  fragment && resultat.fatwasCompletes.length === 0
                    ? dedupPages([...fragmentPages, pageSource])
                    : [pageSource],
              }
            : null;

          batch.update(livreRef(livreId), {
            curseurStructuration: page.numero,
            fatwaOuverte: nouvelleOuverte,
            nbFatwas: FieldValue.increment(creations),
            majAt: FieldValue.serverTimestamp(),
          });
          await batch.commit();

          for (const fatwaId of aEmbedder) {
            await enqueueWorkerTask(tasksRuntime(cfg), cfg.embedQueue, '/tasks/embed', { fatwaId });
          }

          pagesStructurees++;
          fatwasEcrites += resultat.fatwasCompletes.length;
          log.info(
            { pageId: pageDoc.id, fatwas: resultat.fatwasCompletes.length, ouverte: !!nouvelleOuverte },
            'page structurée',
          );
        }
      } catch (err) {
        await releaseLease(livreId).catch(() => undefined);
        log.warn({ err }, `structuration en échec : ${errorMessage(err)}, retry via Cloud Tasks`);
        res.status(503).json({ retry: true });
        return;
      }

      await releaseLease(livreId).catch(() => undefined);

      // budget épuisé mais du travail reste : on se ré-enfile
      if (etat === 'budget') {
        await enqueueWorkerTask(tasksRuntime(cfg), cfg.structQueue, '/tasks/structurer', { livreId });
      }

      log.info({ pagesStructurees, fatwasEcrites, etat }, 'passage de structuration terminé');
      res.status(200).json({ pages: pagesStructurees, fatwas: fatwasEcrites, etat });
    }),
  );

  return router;
}
