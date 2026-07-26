import { type App, applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getAppCheck } from 'firebase-admin/app-check';
import { getAuth } from 'firebase-admin/auth';
import type { NextFunction, Request, Response } from 'express';
import { logger } from '@fataawa/core';

/**
 * Accès réservé : le front exige une connexion Google, et l'API vérifie
 * elle-même le jeton — sans quoi la protection ne serait que cosmétique
 * (l'URL Cloud Run reste publiquement joignable).
 *
 * ALLOWED_EMAILS : liste d'adresses autorisées, séparées par des virgules.
 * Vide = personne n'est autorisé (fermé par défaut, jamais ouvert par erreur).
 */
export interface AuthConfig {
  allowedEmails: Set<string>;
}

/**
 * App Check : le front joint une attestation prouvant que l'appel vient bien de
 * lui. Sans compte utilisateur, c'est la seule barrière qu'on ne franchit pas en
 * changeant d'adresse IP.
 *
 * Deux modes, et l'ordre compte. En observation (défaut), les appels sans
 * attestation valable passent mais sont comptés : c'est ce qui permet de voir
 * arriver de vrais jetons avant de fermer la porte. En application, ils sont
 * refusés. Fermer d'emblée, c'est risquer de couper le site sur une erreur de
 * configuration qu'on ne verrait qu'après coup.
 */
export interface AppCheckConfig {
  enforce: boolean;
}

export function parseAppCheckConfig(env: NodeJS.ProcessEnv): AppCheckConfig {
  return { enforce: env.APP_CHECK_ENFORCE === '1' || env.APP_CHECK_ENFORCE === 'true' };
}

export function parseAuthConfig(env: NodeJS.ProcessEnv): AuthConfig {
  const emails = (env.ALLOWED_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e !== '');
  return { allowedEmails: new Set(emails) };
}

let app: App | undefined;

function adminApp(): App {
  if (!app) {
    app = getApps()[0] ?? initializeApp({ credential: applicationDefault() });
  }
  return app;
}

export interface Utilisateur {
  email: string;
  uid: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    utilisateur?: Utilisateur;
  }
}

function bearer(req: Request): string | null {
  const header = req.header('authorization') ?? '';
  const [type, token] = header.split(' ');
  return type?.toLowerCase() === 'bearer' && token ? token : null;
}

/** Middleware : jeton Firebase valide + adresse dans l'allowlist. */
export function requireUser(cfg: AuthConfig) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const token = bearer(req);
    if (!token) {
      res.status(401).json({ erreur: 'connexion requise' });
      return;
    }
    try {
      const decoded = await getAuth(adminApp()).verifyIdToken(token);
      const email = (decoded.email ?? '').toLowerCase();
      if (email === '' || decoded.email_verified !== true) {
        res.status(403).json({ erreur: 'adresse e-mail non vérifiée' });
        return;
      }
      if (!cfg.allowedEmails.has(email)) {
        logger.warn({ email }, 'accès refusé : adresse hors allowlist');
        res.status(403).json({ erreur: 'compte non autorisé' });
        return;
      }
      req.utilisateur = { email, uid: decoded.uid };
      next();
    } catch (err) {
      logger.warn({ err }, 'jeton invalide');
      res.status(401).json({ erreur: 'session expirée, reconnectez-vous' });
    }
  };
}

/**
 * Middleware d'attestation. Placé sur les routes publiques : elles n'ont aucune
 * autre protection que le débit par IP.
 */
export function requireAppCheck(cfg: AppCheckConfig) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const token = req.header('x-firebase-appcheck');
    const mode = cfg.enforce ? 'application' : 'observation';
    // Diagnostic envoyé par le client quand il n'a pas pu attester. Purement
    // informatif : il n'autorise rien, il explique seulement l'absence de jeton.
    const diag = (req.header('x-appcheck-diag') ?? '').slice(0, 120);

    /** Une ligne par requête publique : c'est la trace qui rend le flux auditable. */
    const tracer = (verdict: string, raison?: string) =>
      logger.info(
        {
          fluxPublic: true,
          route: req.path,
          verdict,
          mode,
          ...(raison === undefined ? {} : { raison }),
          ...(diag === '' ? {} : { diagClient: diag }),
        },
        `flux public : ${req.path} → ${verdict}`,
      );

    if (token === undefined || token === '') {
      tracer('SANS_ATTESTATION');
      if (cfg.enforce) {
        res.status(401).json({ erreur: 'attestation requise' });
        return;
      }
      next();
      return;
    }
    try {
      await getAppCheck(adminApp()).verifyToken(token);
      tracer('ATTESTEE');
      next();
    } catch (err) {
      tracer('ATTESTATION_INVALIDE', err instanceof Error ? err.message.slice(0, 160) : String(err));
      if (cfg.enforce) {
        res.status(401).json({ erreur: 'attestation invalide' });
        return;
      }
      next();
    }
  };
}
