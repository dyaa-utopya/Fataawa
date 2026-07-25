import {
  CollectionGroup,
  CollectionReference,
  DocumentReference,
  FieldValue,
  Firestore,
  Timestamp,
} from '@google-cloud/firestore';

let instance: Firestore | undefined;

export function db(): Firestore {
  instance ??= new Firestore({ ignoreUndefinedProperties: true });
  return instance;
}

export const COL_LIVRES = 'livres';
export const SUB_PAGES = 'pages';

/**
 * Collection des fatwas. Par défaut la collection historique de production
 * (cf. packages/core/src/fatwas.ts). FATWAS_COLLECTION permet d'en viser une
 * autre : c'est ce qui rend un retraitement complet des livres possible sans
 * toucher aux données en service — le worker écrit dans la nouvelle, l'API
 * continue de lire l'ancienne, et la bascule se fait quand le résultat est
 * validé (retour arrière : remettre la variable).
 */
export const COL_FATWAS = process.env.FATWAS_COLLECTION ?? 'fatawas_db';
export const COL_CONVERSATIONS = 'conversations';
export const SUB_MESSAGES = 'messages';

export function livresCol(): CollectionReference {
  return db().collection(COL_LIVRES);
}

export function livreRef(livreId: string): DocumentReference {
  return livresCol().doc(livreId);
}

export function pagesCol(livreId: string): CollectionReference {
  return livreRef(livreId).collection(SUB_PAGES);
}

export function pageRef(livreId: string, pageId: string): DocumentReference {
  return pagesCol(livreId).doc(pageId);
}

export function pagesGroup(): CollectionGroup {
  return db().collectionGroup(SUB_PAGES);
}

export function fatwasCol(): CollectionReference {
  return db().collection(COL_FATWAS);
}

export function fatwaRef(fatwaId: string): DocumentReference {
  return fatwasCol().doc(fatwaId);
}

export function conversationRef(conversationId: string): DocumentReference {
  return db().collection(COL_CONVERSATIONS).doc(conversationId);
}

export function messagesCol(conversationId: string): CollectionReference {
  return conversationRef(conversationId).collection(SUB_MESSAGES);
}

export { FieldValue, Timestamp };
