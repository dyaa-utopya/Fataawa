import {
  GoogleAuthProvider,
  type User,
  browserLocalPersistence,
  getAuth,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import { app } from './firebase.js';

const auth = getAuth(app);
void setPersistence(auth, browserLocalPersistence);

export function observerUtilisateur(cb: (user: User | null) => void): () => void {
  return onAuthStateChanged(auth, cb);
}

export async function connexionGoogle(): Promise<void> {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  await signInWithPopup(auth, provider);
}

export async function deconnexion(): Promise<void> {
  await signOut(auth);
}

/** Jeton d'identité courant (rafraîchi automatiquement par le SDK). */
export async function jeton(): Promise<string | null> {
  return (await auth.currentUser?.getIdToken()) ?? null;
}
