import {
  GoogleAuthProvider,
  type User,
  browserLocalPersistence,
  getAuth,
  getRedirectResult,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup,
  signInWithRedirect,
  signOut,
} from 'firebase/auth';
import { app } from './firebase.js';

const auth = getAuth(app);
void setPersistence(auth, browserLocalPersistence);

export function observerUtilisateur(cb: (user: User | null) => void): () => void {
  return onAuthStateChanged(auth, cb);
}

/**
 * Code d'erreur exploitable, à afficher tel quel.
 *
 * Un écran qui répond « erreur de connexion » à tout, du réseau coupé à la clé
 * API invalide, ne laisse aucune prise : la panne devient indiscernable de la
 * suivante. On garde donc le code de Firebase à côté du message lisible.
 */
export function codeErreur(err: unknown): string {
  const code = (err as { code?: string }).code ?? '';
  const message = err instanceof Error ? err.message : String(err);
  return (code || message).slice(0, 160);
}

/**
 * Échecs qui viennent de la fenêtre surgissante, non de la connexion.
 *
 * Les navigateurs de téléphone la refusent souvent d'office, et un onglet ouvert
 * puis reperdu compte comme « fermée par l'utilisateur ». Dans ces cas-là on
 * repasse par une redirection plein écran, qui n'a pas ce défaut.
 */
const ECHECS_FENETRE = new Set([
  'auth/popup-blocked',
  'auth/popup-closed-by-user',
  'auth/cancelled-popup-request',
  'auth/operation-not-supported-in-this-environment',
  'auth/web-storage-unsupported',
]);

function fournisseur(): GoogleAuthProvider {
  const p = new GoogleAuthProvider();
  p.setCustomParameters({ prompt: 'select_account' });
  return p;
}

export async function connexionGoogle(): Promise<void> {
  try {
    await signInWithPopup(auth, fournisseur());
  } catch (err) {
    if (!ECHECS_FENETRE.has(codeErreur(err))) throw err;
    // La page quitte l'écran ici : la suite se joue au retour, dans
    // retourRedirection().
    await signInWithRedirect(auth, fournisseur());
  }
}

/**
 * Reprend la connexion après une redirection. À appeler une fois au chargement :
 * sans cet appel, un retour en échec laisse l'écran de connexion muet.
 *
 * Renvoie le code d'erreur, ou une chaîne vide s'il n'y avait rien à reprendre
 * ou si la reprise a réussi.
 */
export async function retourRedirection(): Promise<string> {
  try {
    await getRedirectResult(auth);
    return '';
  } catch (err) {
    return codeErreur(err);
  }
}

export async function deconnexion(): Promise<void> {
  await signOut(auth);
}

/** Jeton d'identité courant (rafraîchi automatiquement par le SDK). */
export async function jeton(): Promise<string | null> {
  return (await auth.currentUser?.getIdToken()) ?? null;
}
