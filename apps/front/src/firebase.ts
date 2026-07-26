import { type FirebaseApp, initializeApp } from 'firebase/app';
import { ReCaptchaEnterpriseProvider, getToken, initializeAppCheck } from 'firebase/app-check';

/**
 * Configuration web Firebase : publique par nature (elle identifie le projet,
 * elle n'autorise rien par elle-même). L'accès réel est verrouillé par les
 * domaines autorisés côté Firebase Auth et par l'allowlist d'adresses
 * vérifiée par l'API à chaque requête.
 *
 * Ces quatre valeurs ne se devinent pas : elles viennent de
 * `firebase.googleapis.com/v1beta1/projects/…/webApps/…/config`. Une clé
 * plausible mais fausse ne provoque aucune erreur au build — elle fait
 * seulement échouer chaque appel à Google avec « API key not valid », ce qui
 * ressemble à une panne réseau. Le déploiement les compare donc à la réponse de
 * Firebase et refuse de publier un bundle qui ne les porte pas (`step_hosting`).
 */
const firebaseConfig = {
  apiKey: 'AIzaSyBTckAyYjhFWglZRkytX1saufGjewn0F2Y',
  authDomain: 'looker-studio-458310.firebaseapp.com',
  projectId: 'looker-studio-458310',
  appId: '1:1043287255633:web:881d8cda8fa5e3da8aa670',
};

export const app: FirebaseApp = initializeApp(firebaseConfig);

/**
 * App Check : atteste que l'appel vient bien de ce site, et pas d'un script qui
 * taperait sur l'API depuis ailleurs. C'est la seule protection qui change la
 * nature du problème sur un front sans login — un compteur par IP se contourne
 * en changeant d'adresse.
 *
 * La clé du site est publique, comme la configuration ci-dessus : elle ne vaut
 * que couplée au domaine déclaré (fataawa.web.app) et au score reCAPTCHA, tous
 * deux vérifiés côté Google. reCAPTCHA tourne en mode « score » : aucune case à
 * cocher, rien à faire pour le lecteur.
 */
const SITE_KEY = '6LcP2WUtAAAAADV8FfaB5YIHJ789Q5N5bmAWKYED';

// L'initialisation elle-même peut échouer (script reCAPTCHA bloqué, domaine non
// déclaré) : on ne laisse pas cette exception emporter le chargement du site.
const appCheck = (() => {
  try {
    return initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(SITE_KEY),
      isTokenAutoRefreshEnabled: true,
    });
  } catch {
    return null;
  }
})();

/**
 * Jeton d'attestation à joindre aux appels API. Ne fait jamais échouer la
 * requête : si l'attestation échoue (réseau, extension qui bloque reCAPTCHA),
 * l'appel part sans jeton et c'est le serveur qui décide s'il l'accepte. Rendre
 * le site inutilisable parce que reCAPTCHA n'a pas répondu serait pire que le
 * risque qu'App Check couvre.
 *
 * En cas d'échec, la RAISON est renvoyée pour être joignée à l'appel et
 * journalisée côté serveur. Sans elle, un site qui n'atteste plus est
 * indiscernable d'un site qui n'a jamais essayé — c'est ce qui rend une panne
 * d'attestation impossible à diagnostiquer.
 */
export interface Attestation {
  jeton: string | null;
  /** Vide si tout va bien ; sinon le code d'erreur, à des fins de diagnostic. */
  echec: string;
}

export async function jetonAppCheck(): Promise<Attestation> {
  if (appCheck === null) return { jeton: null, echec: 'initialisation' };
  try {
    return { jeton: (await getToken(appCheck, false)).token, echec: '' };
  } catch (err) {
    const code = (err as { code?: string }).code ?? '';
    const message = err instanceof Error ? err.message : String(err);
    return { jeton: null, echec: (code || message).slice(0, 120) };
  }
}
