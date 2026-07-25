import { initializeApp } from 'firebase/app';
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

/**
 * Configuration web Firebase : publique par nature (elle identifie le projet,
 * elle n'autorise rien par elle-même). L'accès réel est verrouillé par les
 * domaines autorisés côté Firebase Auth et par l'allowlist d'adresses
 * vérifiée par l'API à chaque requête.
 */
const firebaseConfig = {
  apiKey: 'AIzaSyBTckAyYjcJ0FDLg3AeC0dJnrIcQrGCX5Y',
  authDomain: 'looker-studio-458310.firebaseapp.com',
  projectId: 'looker-studio-458310',
  appId: '1:1043287255633:web:881d8cda8fa5e3da8aa670',
};

const auth = getAuth(initializeApp(firebaseConfig));
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
