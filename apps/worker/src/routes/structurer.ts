import { Router } from 'express';
import {
  FieldValue,
  type FatwaOuverteState,
  type FatwaStored,
  LEASE_STRUCT_MS,
  type LivreDoc,
  type PageDoc,
  type PageSourceRef,
  STATUT_OCR,
  Timestamp,
  type WorkerConfig,
  commenceDans,
  db,
  enqueueWorkerTask,
  estPageSommaire,
  fatwaIdFrom,
  fatwaRef,
  fromPipeline,
  geminiStructurePage,
  normaliseNumeroFatwa,
  normaliseSousQuestion,
  numerosFatwaCites,
  pagesCouvertes,
  porteEnTeteFatwa,
  livreRef,
  logger,
  pagesCol,
  structurerTaskPayloadSchema,
} from '@fataawa/core';
import { asyncHandler, errorMessage, tasksRuntime } from '../util.js';

const TIME_BUDGET_MS = 7 * 60_000;
/**
 * Délai d'attente devant un trou de numérotation. Assez long pour couvrir la
 * copie d'un recueil entier vers l'inbox (quelques minutes pour 500 scans),
 * assez court pour ne pas immobiliser un livre auquel il manque vraiment une
 * page. Au-delà, le trou est réputé définitif et signalé.
 */
const INGESTION_GRACE_MS = 15 * 60_000;

/** Un seul passage de structuration actif par livre (bail sur le doc livre). */
async function acquireLease(livreId: string): Promise<boolean> {
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(livreRef(livreId));
    if (!snap.exists) return false;
    const lease = (snap.data() as LivreDoc).structLease;
    if (lease && Date.now() - lease.toMillis() < LEASE_STRUCT_MS) return false;
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
      let etat: 'rattrape' | 'bloque' | 'attente_ocr' | 'budget' | 'reinitialise' = 'budget';
      // Génération du découpage, relevée au premier tour : si une remise à zéro
      // survient pendant ce passage, on l'abandonne au lieu de réécrire le
      // curseur qu'elle vient d'annuler.
      let generation: number | null = null;

      try {
        while (
          pagesStructurees < cfg.structPagesPerRun &&
          Date.now() - debut < TIME_BUDGET_MS
        ) {
          const livreSnap = await livreRef(livreId).get();
          const livre = livreSnap.data() as LivreDoc;
          const gen = livre.generationStruct ?? 0;
          if (generation === null) generation = gen;
          else if (gen !== generation) {
            log.warn({ generation, gen }, 'passage abandonné : le découpage a été réinitialisé');
            etat = 'reinitialise';
            break;
          }
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

          // Trou dans la numérotation : les pages manquantes n'ont pas encore
          // été créées par l'ingestion, qui ne suit pas l'ordre des numéros.
          // Le curseur ne revient jamais en arrière : avancer ici condamnerait
          // ces pages à n'être jamais découpées. C'est ce qui a fait perdre 91
          // pages au recueil 2 et 87 au recueil 10, le découpage ayant démarré
          // avant la fin de la copie. On patiente donc tant que des pages
          // arrivent encore ; passé ce délai, le trou est réel (scan absent)
          // et on le franchit en le signalant.
          if (page.numero > curseur + 1) {
            const derniere = livre.dernierePageAt?.toMillis() ?? 0;
            if (Date.now() - derniere < INGESTION_GRACE_MS) {
              log.info(
                { curseur, prochaine: page.numero },
                'découpage en attente : des pages manquent encore avant celle-ci',
              );
              etat = 'attente_ocr';
              break;
            }
            log.warn(
              { curseur, prochaine: page.numero, manquantes: page.numero - curseur - 1 },
              'trou franchi : ces pages ne sont jamais arrivées',
            );
          }

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
          // Page vide, page de sommaire, ou OCR emballé : rien à en tirer. Le
          // sommaire est écarté ici, avant l'appel au modèle — c'est
          // déterministe et cela épargne une vingtaine d'appels par recueil.
          // Le garde-fou de longueur, lui, vise les pages dont l'OCR part en
          // boucle : envoyer 131 000 caractères au modèle tronque sa réponse,
          // épuise les tentatives et met la page en quarantaine, ce qui arrête
          // le livre entier sur une page de sommaire.
          const sommaire = estPageSommaire(texte);
          const emballe = texte.length > cfg.structMaxPageChars;
          if (emballe) {
            log.warn(
              { pageId: pageDoc.id, caracteres: texte.length, plafond: cfg.structMaxPageChars },
              'page ignorée : OCR emballé, le texte ne peut pas être celui d’une page',
            );
            await pageDoc.ref.update({
              derniereErreur: `OCR emballé : ${texte.length} caractères`,
              majAt: FieldValue.serverTimestamp(),
            });
          }
          if (texte === '' || texte === '[PAGE_VIDE]' || sommaire || emballe) {
            if (sommaire && !emballe) log.info({ pageId: pageDoc.id }, 'page de sommaire ignorée');
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

          // L'en-tête d'une fatwa n'est imprimé qu'une fois : une page qui
          // reprend par « س ٣: » ne porte aucun numéro. Le rattachement est
          // fait ici, pas par le modèle — lui montrer un numéro venu d'ailleurs
          // le conduit à le plaquer sur des fatwas étrangères.
          // Une page peut à la fois achever une fatwa et en ouvrir une autre :
          // seul un en-tête EN TÊTE DE PAGE signifie qu'aucune continuation ne
          // la précède. Sinon la page s'ouvre sur une suite, qui hérite du
          // numéro en cours.
          const ouvreParEnTete = porteEnTeteFatwa(texte.slice(0, 200));
          const numeroHerite = ouvreParEnTete ? '' : (livre.dernierNumeroFatwa ?? '');
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
          let ecartees = 0;
          let dernierNumero = livre.dernierNumeroFatwa ?? '';
          // Le numéro court le long de la page, de fatwa en fatwa : une fatwa
          // muette reprend le dernier numéro vu, et dès qu'une fatwa déclare le
          // sien, c'est lui qui prend le relais pour les suivantes. Ne rattacher
          // que la première laissait orphelines les sous-questions d'après
          // (« س ٣: », « س ٧: ») sur les fatwas longues, à cheval sur 3-4 pages.
          let numeroCourant = numeroHerite;
          // Seul le texte de la page courante (plus le fragment hérité) autorise
          // une extraction : une fatwa vue uniquement dans les pages de contexte
          // appartient à une page suivante et sera prise quand le curseur y sera.
          const perimetre = `${texte}\n${fragment?.textePartiel ?? ''}`;
          for (const [i, fatwa] of resultat.fatwasCompletes.entries()) {
            if (!commenceDans(fatwa.texteComplet, perimetre)) {
              ecartees++;
              log.info(
                { pageId: pageDoc.id, numero: fatwa.numero, sousQuestion: fatwa.sousQuestion },
                'fatwa écartée : elle commence dans une page de contexte, pas ici',
              );
              continue;
            }
            // sentinelle : plusieurs numéros dans un même bloc valent un coup d'œil
            const cites = numerosFatwaCites(fatwa.texteComplet);
            if (cites.length > 1) {
              log.warn(
                { pageId: pageDoc.id, numero: fatwa.numero, numerosCites: cites },
                'plusieurs numéros de fatwa dans un même bloc — citation ou découpage à vérifier',
              );
            }
            const numeroDeclare = normaliseNumeroFatwa(fatwa.numero);
            if (numeroDeclare !== '') numeroCourant = numeroDeclare;
            const numero = numeroCourant;
            if (numero !== '') dernierNumero = numero;
            const id = fatwaIdFrom(livreId, numero, `p${pageDoc.id}-${i}`, fatwa.sousQuestion);

            // La même fatwa est parfois extraite deux fois : entière depuis la
            // page où elle commence, puis tronquée depuis la page suivante, où
            // le modèle prend sa fin pour un début. Les deux passent la
            // vérification (chacune débute bien dans sa page), d'où l'arbitrage
            // ici : le texte le plus complet l'emporte, jamais le plus récent.
            const existant = await fatwaRef(id).get();
            if (existant.exists) {
              const ancien = (existant.data() as FatwaStored).texte_arabe ?? '';
              if (ancien.length > fatwa.texteComplet.length) {
                ecartees++;
                log.info(
                  { pageId: pageDoc.id, numero, ancien: ancien.length, nouveau: fatwa.texteComplet.length },
                  'version plus courte ignorée : la fatwa enregistrée est plus complète',
                );
                continue;
              }
            } else {
              creations++;
            }
            // Pages réellement occupées, mesurées sur le texte rendu : une fatwa
            // déborde souvent sur la page suivante, et l'ignorer laissait le
            // lecteur devant un scan coupé en bas de page.
            const couvertes = pagesCouvertes(
              fatwa.texteComplet,
              [
                { ref: pageSource, texte, numero: page.numero },
                ...suivantesSnap.docs
                  .map((d) => {
                    const p = d.data() as PageDoc;
                    return {
                      ref: { numero: p.numero, pageId: d.id, gcsPath: p.gcsPath },
                      texte: (p.texteOcr ?? '').trim(),
                      numero: p.numero,
                    };
                  })
                  .filter((c) => c.texte !== ''),
              ],
              page.numero,
            );
            // la première fatwa complète porte en plus les pages du fragment recousu
            const pages =
              fragment && i === 0
                ? dedupPages([...fragmentPages, ...couvertes])
                : dedupPages(couvertes);
            batch.set(
              fatwaRef(id),
              {
                ...fromPipeline({
                  livreId,
                  // chiffres latins comme dans la collection historique
                  numero,
                  // rang normalisé : identifie la sous-question sans ambiguïté
                  sousQuestion: normaliseSousQuestion(fatwa.sousQuestion),
                  imageSource: page.gcsPath.slice(page.gcsPath.lastIndexOf('/') + 1),
                  themeN1: fatwa.themeN1,
                  themeN2: fatwa.themeN2,
                  themeN3: fatwa.themeN3,
                  themesComplets: fatwa.themesComplets,
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
                themeN1: resultat.fatwaOuverte.themeN1,
                themeN2: resultat.fatwaOuverte.themeN2,
                themeN3: resultat.fatwaOuverte.themeN3,
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
            dernierNumeroFatwa: dernierNumero,
            nbFatwas: FieldValue.increment(creations),
            majAt: FieldValue.serverTimestamp(),
          });
          await batch.commit();

          for (const fatwaId of aEmbedder) {
            await enqueueWorkerTask(tasksRuntime(cfg), cfg.embedQueue, '/tasks/embed', { fatwaId });
          }

          pagesStructurees++;
          fatwasEcrites += aEmbedder.length;
          log.info(
            { pageId: pageDoc.id, fatwas: aEmbedder.length, ecartees, ouverte: !!nouvelleOuverte },
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
