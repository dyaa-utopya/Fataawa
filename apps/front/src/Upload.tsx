import { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { ApiError, adminIngerer, demanderUploadUrls, listerLivres } from './api.js';
import { connexionGoogle, deconnexion } from './auth.js';
import type { DICT } from './i18n.js';
import type { FichierPret, LivreResume } from './types.js';

type EtatFichier = 'attente' | 'envoi' | 'ok' | 'refus' | 'erreur';

interface Ligne {
  fichier: File;
  etat: EtatFichier;
  detail?: string;
}

const CONCURRENCE = 4;

/**
 * Espace d'ajout de fatwas : les images partent directement du navigateur
 * vers le bucket via des URLs signées obtenues de l'API — rien ne transite
 * par le serveur. Une fois déposées, l'ingestion enchaîne OCR, structuration
 * et indexation.
 */
export default function Upload({
  t,
  utilisateur,
  onRetour,
}: {
  t: (typeof DICT)['fr'];
  utilisateur: User | null;
  onRetour: () => void;
}) {
  const [livres, setLivres] = useState<LivreResume[]>([]);
  const [livre, setLivre] = useState('');
  const [lignes, setLignes] = useState<Ligne[]>([]);
  const [envoiEnCours, setEnvoiEnCours] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    if (!utilisateur) return;
    listerLivres()
      .then((l) => setLivres(l))
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 403) setErreur(t.notAllowed);
      });
  }, [utilisateur, t.notAllowed]);

  if (!utilisateur) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center bg-stone-100 px-4">
        <div className="w-full max-w-sm rounded-2xl border border-stone-200 bg-white p-6 text-center shadow-sm">
          <h2 className="text-lg font-semibold text-stone-800">{t.uploadTitle}</h2>
          <p className="mt-2 text-sm text-stone-500">{t.signInHint}</p>
          <button
            onClick={() => void connexionGoogle().catch(() => setErreur(t.errorNetwork))}
            className="mt-4 w-full rounded-full bg-emerald-700 px-5 py-2.5 font-medium text-white hover:bg-emerald-800"
          >
            {t.signIn}
          </button>
          <button onClick={onRetour} className="mt-3 w-full text-sm text-stone-500 underline">
            {t.backToChat}
          </button>
          {erreur && <p className="mt-3 text-sm text-red-600">{erreur}</p>}
        </div>
      </div>
    );
  }

  async function envoyer() {
    const nomLivre = livre.trim();
    if (nomLivre === '' || lignes.length === 0 || envoiEnCours) return;
    setEnvoiEnCours(true);
    setErreur(null);
    setMessage(null);

    try {
      const prets = await demanderUploadUrls(
        nomLivre,
        lignes.map((l) => ({ nom: l.fichier.name, type: l.fichier.type })),
      );
      const parNom = new Map<string, FichierPret>(prets.map((p) => [p.nom, p]));

      setLignes((prev) =>
        prev.map((l) => {
          const p = parNom.get(l.fichier.name);
          return p?.refus ? { ...l, etat: 'refus', detail: p.refus } : { ...l, etat: 'attente' };
        }),
      );

      const aEnvoyer = lignes.filter((l) => parNom.get(l.fichier.name)?.url);
      let suivant = 0;
      await Promise.all(
        Array.from({ length: Math.min(CONCURRENCE, aEnvoyer.length) }, async () => {
          for (;;) {
            const ligne = aEnvoyer[suivant++];
            if (ligne === undefined) return;
            const pret = parNom.get(ligne.fichier.name);
            if (!pret?.url) return;
            const majEtat = (etat: EtatFichier, detail?: string) =>
              setLignes((prev) =>
                prev.map((l) => (l.fichier.name === ligne.fichier.name ? { ...l, etat, detail } : l)),
              );
            majEtat('envoi');
            try {
              const res = await fetch(pret.url, {
                method: 'PUT',
                headers: { 'content-type': ligne.fichier.type },
                body: ligne.fichier,
              });
              majEtat(res.ok ? 'ok' : 'erreur', res.ok ? undefined : `HTTP ${res.status}`);
            } catch {
              majEtat('erreur', t.errorNetwork);
            }
          }
        }),
      );

      await adminIngerer().catch(() => undefined);
      setMessage(t.uploadDone);
      listerLivres().then(setLivres).catch(() => undefined);
    } catch (err) {
      setErreur(
        err instanceof ApiError && err.status === 403
          ? t.notAllowed
          : err instanceof ApiError && err.status === 401
            ? t.sessionExpired
            : t.errorNetwork,
      );
    } finally {
      setEnvoiEnCours(false);
    }
  }

  const pastille: Record<EtatFichier, string> = {
    attente: 'text-stone-400',
    envoi: 'text-amber-600',
    ok: 'text-emerald-700',
    refus: 'text-red-600',
    erreur: 'text-red-600',
  };
  const icone: Record<EtatFichier, string> = {
    attente: '•',
    envoi: '↑',
    ok: '✓',
    refus: '✕',
    erreur: '!',
  };

  return (
    <div className="flex h-dvh flex-col bg-stone-100 text-stone-900">
      <header className="shrink-0 border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <div>
            <h1 className="text-lg font-bold text-emerald-800">{t.uploadTitle}</h1>
            <p className="text-xs text-stone-500">{utilisateur.email}</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={onRetour}
              className="rounded-md border border-stone-300 px-2.5 py-1.5 text-xs font-medium text-stone-600 hover:bg-stone-50"
            >
              {t.backToChat}
            </button>
            <button
              onClick={() => void deconnexion()}
              className="rounded-md border border-stone-300 px-2.5 py-1.5 text-xs font-medium text-stone-600 hover:bg-stone-50"
            >
              {t.signOut}
            </button>
          </div>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-4 px-4 py-6">
          <div className="rounded-xl border border-stone-200 bg-white p-4">
            <label className="block text-sm font-medium text-stone-700">{t.bookName}</label>
            <input
              list="livres-existants"
              value={livre}
              onChange={(e) => setLivre(e.target.value)}
              placeholder={t.bookPlaceholder}
              dir="auto"
              className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2 outline-none focus:border-emerald-500"
            />
            <datalist id="livres-existants">
              {livres.map((l) => (
                <option key={l.id} value={l.titre} />
              ))}
            </datalist>
            <p className="mt-2 text-xs text-stone-500">{t.fileNameHint}</p>

            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/tiff"
              multiple
              onChange={(e) =>
                setLignes(
                  Array.from(e.target.files ?? []).map((f) => ({ fichier: f, etat: 'attente' as const })),
                )
              }
              className="mt-3 block w-full text-sm file:mr-3 file:rounded-full file:border-0 file:bg-emerald-700 file:px-4 file:py-2 file:text-white"
            />

            <button
              onClick={() => void envoyer()}
              disabled={envoiEnCours || lignes.length === 0 || livre.trim() === ''}
              className="mt-4 w-full rounded-full bg-emerald-700 px-5 py-2.5 font-medium text-white hover:bg-emerald-800 disabled:opacity-40"
            >
              {envoiEnCours ? t.uploading : `${t.uploadStart} (${lignes.length})`}
            </button>

            {message && (
              <p className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                {message}
              </p>
            )}
            {erreur && (
              <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {erreur}
              </p>
            )}
          </div>

          {lignes.length > 0 && (
            <div className="rounded-xl border border-stone-200 bg-white p-4">
              <ul className="space-y-1 text-sm">
                {lignes.map((l) => (
                  <li key={l.fichier.name} className="flex items-baseline justify-between gap-3">
                    <span className="truncate" dir="auto">
                      {l.fichier.name}
                    </span>
                    <span className={`shrink-0 text-xs ${pastille[l.etat]}`}>
                      {icone[l.etat]} {l.detail ?? ''}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {livres.length > 0 && (
            <div className="rounded-xl border border-stone-200 bg-white p-4">
              <h3 className="mb-2 text-sm font-medium text-stone-700">{t.booksInProgress}</h3>
              <ul className="space-y-1 text-sm text-stone-600">
                {livres.map((l) => (
                  <li key={l.id} className="flex justify-between gap-3">
                    <span className="truncate" dir="auto">
                      {l.titre}
                    </span>
                    <span className="shrink-0 text-xs text-stone-400">
                      {l.nbPagesOcr}/{l.nbPages} {t.page} · {l.nbFatwas} {t.fatwa}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
