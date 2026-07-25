import { Router } from 'express';
import {
  FieldValue,
  GeminiUnusableError,
  type MoteurOcr,
  type PageDoc,
  STATUT_OCR,
  type WorkerConfig,
  gcsDownload,
  geminiOcrImage,
  livreRef,
  logger,
  ocrTaskPayloadSchema,
  pageIdFromNumero,
  pageRef,
  visionOcrImage,
} from '@fataawa/core';
import { asyncHandler, errorMessage } from '../util.js';

/**
 * POST /tasks/ocr-page — déclenché par Cloud Tasks (queue « ocr »).
 * Idempotent : une page déjà TRAITE (ou en QUARANTAINE) est ignorée.
 * Échec : réponse 503 → Cloud Tasks rejoue avec backoff ; à partir de
 * MAX_OCR_ATTEMPTS tentatives, la page passe en QUARANTAINE et la tâche est
 * acquittée (200) pour stopper les retries.
 */
export function ocrRouter(cfg: WorkerConfig): Router {
  const router = Router();

  router.post(
    '/ocr-page',
    asyncHandler(async (req, res) => {
      const parsed = ocrTaskPayloadSchema.safeParse(req.body);
      if (!parsed.success) {
        logger.error({ body: req.body }, 'payload de tâche OCR invalide, tâche abandonnée');
        res.status(200).json({ ignoree: 'payload invalide' });
        return;
      }
      const { livreId, numeroPage } = parsed.data;
      const pageId = pageIdFromNumero(numeroPage);
      const log = logger.child({ livreId, pageId });

      const ref = pageRef(livreId, pageId);
      const snap = await ref.get();
      if (!snap.exists) {
        log.warn('page absente de Firestore, tâche abandonnée');
        res.status(200).json({ ignoree: 'page absente' });
        return;
      }
      const page = snap.data() as PageDoc;
      if (page.statutOcr === STATUT_OCR.TRAITE || page.statutOcr === STATUT_OCR.QUARANTAINE) {
        res.status(200).json({ ignoree: `statut ${page.statutOcr}` });
        return;
      }

      const tentatives = (page.tentatives ?? 0) + 1;
      await ref.update({
        statutOcr: STATUT_OCR.EN_COURS,
        tentatives,
        majAt: FieldValue.serverTimestamp(),
      });

      try {
        const image = await gcsDownload(cfg.gcsBucket, page.gcsPath);

        let texteOcr: string;
        let moteur: MoteurOcr;
        try {
          texteOcr = await geminiOcrImage(image, page.mimeType, {
            apiKey: cfg.geminiApiKey,
            model: cfg.geminiModel,
          });
          moteur = 'GEMINI';
        } catch (err) {
          if (!(err instanceof GeminiUnusableError)) throw err;
          log.warn({ raison: err.reason }, 'fallback Cloud Vision');
          texteOcr = await visionOcrImage(image);
          moteur = 'VISION';
        }

        await ref.update({
          statutOcr: STATUT_OCR.TRAITE,
          texteOcr,
          moteur,
          ocrAt: FieldValue.serverTimestamp(),
          majAt: FieldValue.serverTimestamp(),
          derniereErreur: FieldValue.delete(),
        });
        await livreRef(livreId).update({
          nbPagesOcr: FieldValue.increment(1),
          majAt: FieldValue.serverTimestamp(),
        });
        log.info({ moteur, longueur: texteOcr.length, tentatives }, 'page OCRisée');
        res.status(200).json({ ok: true, moteur });
      } catch (err) {
        const message = errorMessage(err);
        if (tentatives >= cfg.maxOcrAttempts) {
          await ref.update({
            statutOcr: STATUT_OCR.QUARANTAINE,
            derniereErreur: message,
            majAt: FieldValue.serverTimestamp(),
          });
          // niveau ERROR : sert de signal à l'alerte Cloud Monitoring (quarantaine)
          log.error({ err, tentatives }, `page en QUARANTAINE après ${tentatives} tentatives : ${message}`);
          res.status(200).json({ quarantaine: true });
          return;
        }
        await ref.update({
          statutOcr: STATUT_OCR.A_TRAITER,
          derniereErreur: message,
          majAt: FieldValue.serverTimestamp(),
        });
        log.warn({ err, tentatives }, `OCR en échec (tentative ${tentatives}), retry via Cloud Tasks`);
        res.status(503).json({ retry: true });
      }
    }),
  );

  return router;
}
