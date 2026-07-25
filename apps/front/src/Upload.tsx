import { useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  ApiError,
  adminIngerer,
  demanderPdfUrl,
  demanderUploadUrls,
  lancerDecoupage,
  listerLivres,
  verifierLot,
} from './api.js';
import { connexionGoogle, deconnexion } from './auth.js';
import type { DICT } from './i18n.js';
import type { FichierPret, LivreResume, Verification } from './types.js';

type EtatFichier = 'attente' | 'envoi' | 'ok' | 'refus' | 'erreur';

interface Ligne {
  fichier: File;
  etat: EtatFichier;
  detail?: string;
}

/** Envois simultanés vers GCS : au-delà, le navigateur sérialise de lui-même. */
const CONCURRENCE = 4;
/** Les URLs signées sont demandées par tranches, pas 500 d'un coup. */
const TAILLE_TRANCHE = 100;

function formatTaille(octets: number): string {
  const mo = octets / (1024 * 1024);
  return mo >= 1024 ? `${(mo / 1024).toFixed(1)} Go` : `${mo.toFixed(0)} Mo`;
}

/**
 * Espace d'ajout de fatwas : les images partent directement du navigateur vers
 * le bucket via des URLs signées — rien ne transite par le serveur, la taille
 * du lot n'a donc pas de limite pratique. Un livre entier (plusieurs centaines
 * de pages) est vérifié avant envoi, puis transféré par tranches.
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
  /** Deux voies au choix : le PDF entier, ou les images page par page. */
  const [mode, setMode] = useState<'pdf' | 'images'>('pdf');
  const [pdf, setPdf] = useState<File | null>(null);
  const [lignes, setLignes] = useState<Ligne[]>([]);
  const [verif, setVerif] = useState<Verification | null>(null);
  const [verifEnCours, setVerifEnCours] = useState(false);
  const [envoiEnCours, setEnvoiEnCours] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  // Le traitement tourne en arrière-plan : l'avancement se rafraîchit seul,
  // inutile d'attendre ou de recharger la page.
  useEffect(() => {
    if (!utilisateur) return;
    let vivant = true;
    const charger = () =>
      listerLivres()
        .then((l) => {
          if (vivant) setLivres(l);
        })
        .catch((err: unknown) => {
          if (vivant && err instanceof ApiError && err.status === 403) setErreur(t.notAllowed);
        });
    void charger();
    const minuteur = setInterval(() => void charger(), 15_000);
    return () => {
      vivant = false;
      clearInterval(minuteur);
    };
  }, [utilisateur, t.notAllowed]);

  const poidsTotal = useMemo(() => lignes.reduce((s, l) => s + l.fichier.size, 0), [lignes]);
  const envoyees = lignes.filter((l) => l.etat === 'ok').length;

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

  function erreurLisible(err: unknown): string {
    if (err instanceof ApiError && err.status === 403) return t.notAllowed;
    if (err instanceof ApiError && err.status === 401) return t.sessionExpired;
    return t.errorNetwork;
  }

  function choisirFichiers(files: FileList | null) {
    const liste = Array.from(files ?? []).map((f) => ({ fichier: f, etat: 'attente' as const }));
    setLignes(liste);
    setVerif(null);
    setMessage(null);
    setErreur(null);
    if (liste.length === 0 || livre.trim() === '') return;
    setVerifEnCours(true);
    verifierLot(
      livre.trim(),
      liste.map((l) => ({ nom: l.fichier.name, type: l.fichier.type })),
    )
      .then(setVerif)
      .catch((err: unknown) => setErreur(erreurLisible(err)))
      .finally(() => setVerifEnCours(false));
  }

  /** Voie PDF : un seul transfert, le serveur produit ensuite les pages. */
  async function envoyerPdf() {
    const nomLivre = livre.trim();
    if (nomLivre === '' || pdf === null || envoiEnCours) return;
    setEnvoiEnCours(true);
    setErreur(null);
    setMessage(null);
    try {
      const { chemin, url } = await demanderPdfUrl(nomLivre, pdf.name);
      const res = await fetch(url, {
        method: 'PUT',
        headers: { 'content-type': 'application/pdf' },
        body: pdf,
      });
      if (!res.ok) throw new ApiError(res.status);
      await lancerDecoupage(nomLivre, chemin);
      setMessage(t.pdfDone);
      listerLivres().then(setLivres).catch(() => undefined);
    } catch (err) {
      setErreur(erreurLisible(err));
    } finally {
      setEnvoiEnCours(false);
    }
  }

  async function envoyer() {
    const nomLivre = livre.trim();
    if (nomLivre === '' || lignes.length === 0 || envoiEnCours) return;
    setEnvoiEnCours(true);
    setErreur(null);
    setMessage(null);

    const majEtat = (nom: string, etat: EtatFichier, detail?: string) =>
      setLignes((prev) => prev.map((l) => (l.fichier.name === nom ? { ...l, etat, detail } : l)));

    try {
      // tranches : les URLs sont demandées juste avant d'être utilisées
      for (let debut = 0; debut < lignes.length; debut += TAILLE_TRANCHE) {
        const tranche = lignes.slice(debut, debut + TAILLE_TRANCHE);
        const prets = await demanderUploadUrls(
          nomLivre,
          tranche.map((l) => ({ nom: l.fichier.name, type: l.fichier.type })),
        );
        const parNom = new Map<string, FichierPret>(prets.map((p) => [p.nom, p]));
        for (const l of tranche) {
          const refus = parNom.get(l.fichier.name)?.refus;
          if (refus) majEtat(l.fichier.name, 'refus', refus);
        }

        const aEnvoyer = tranche.filter((l) => parNom.get(l.fichier.name)?.url);
        let suivant = 0;
        await Promise.all(
          Array.from({ length: Math.min(CONCURRENCE, aEnvoyer.length) }, async () => {
            for (;;) {
              const ligne = aEnvoyer[suivant++];
              if (ligne === undefined) return;
              const url = parNom.get(ligne.fichier.name)?.url;
              if (!url) continue;
              majEtat(ligne.fichier.name, 'envoi');
              try {
                const res = await fetch(url, {
                  method: 'PUT',
                  headers: { 'content-type': ligne.fichier.type },
                  body: ligne.fichier,
                });
                majEtat(
                  ligne.fichier.name,
                  res.ok ? 'ok' : 'erreur',
                  res.ok ? undefined : `HTTP ${res.status}`,
                );
              } catch {
                majEtat(ligne.fichier.name, 'erreur', t.errorNetwork);
              }
            }
          }),
        );
      }

      await adminIngerer().catch(() => undefined);
      setMessage(t.uploadDone);
      listerLivres().then(setLivres).catch(() => undefined);
    } catch (err) {
      setErreur(erreurLisible(err));
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
  const bloquant = (verif?.doublons.length ?? 0) > 0;

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
            {/* choix de la voie d'envoi */}
            <div className="mt-4 flex overflow-hidden rounded-lg border border-stone-300">
              {(['pdf', 'images'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => {
                    setMode(m);
                    setMessage(null);
                    setErreur(null);
                  }}
                  className={`flex-1 px-3 py-2 text-sm font-medium ${
                    mode === m ? 'bg-emerald-700 text-white' : 'text-stone-600 hover:bg-stone-50'
                  }`}
                >
                  {m === 'pdf' ? t.modePdf : t.modeImages}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-stone-500">
              {mode === 'pdf' ? t.pdfHint : t.fileNameHint}
            </p>

            {mode === 'pdf' ? (
              <>
                <input
                  type="file"
                  accept="application/pdf"
                  onChange={(e) => {
                    setPdf(e.target.files?.[0] ?? null);
                    setMessage(null);
                    setErreur(null);
                  }}
                  className="mt-3 block w-full text-sm file:mr-3 file:rounded-full file:border-0 file:bg-emerald-700 file:px-4 file:py-2 file:text-white"
                />
                {pdf && (
                  <p className="mt-2 text-xs text-stone-500">
                    {pdf.name} · {formatTaille(pdf.size)}
                  </p>
                )}
                <button
                  onClick={() => void envoyerPdf()}
                  disabled={envoiEnCours || pdf === null || livre.trim() === ''}
                  className="mt-4 w-full rounded-full bg-emerald-700 px-5 py-2.5 font-medium text-white hover:bg-emerald-800 disabled:opacity-40"
                >
                  {envoiEnCours ? t.uploading : t.pdfStart}
                </button>
              </>
            ) : (
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/tiff"
                multiple
                onChange={(e) => choisirFichiers(e.target.files)}
                className="mt-3 block w-full text-sm file:mr-3 file:rounded-full file:border-0 file:bg-emerald-700 file:px-4 file:py-2 file:text-white"
              />
            )}

            {mode === 'images' && lignes.length > 0 && (
              <p className="mt-2 text-xs text-stone-500">
                {lignes.length} {t.filesSelected} · {formatTaille(poidsTotal)}
              </p>
            )}

            {mode === 'images' && verifEnCours && (
              <p className="mt-3 text-sm text-stone-500">{t.checking}</p>
            )}

            {mode === 'images' && verif && (
              <div className="mt-3 space-y-2 rounded-lg border border-stone-200 bg-stone-50 p-3 text-sm">
                <p className="text-stone-700">
                  {t.pagesDetected}{' '}
                  <strong>
                    {verif.plage ? `${verif.plage.premier} – ${verif.plage.dernier}` : '—'}
                  </strong>{' '}
                  ({verif.acceptes}/{verif.total})
                  {verif.dejaPresentes > 0 && (
                    <>
                      {' · '}
                      {verif.dejaPresentes} {t.alreadyPresent}
                    </>
                  )}
                </p>
                {verif.doublons.length > 0 && (
                  <p className="rounded border border-red-300 bg-red-50 px-2 py-1.5 text-red-800">
                    <strong>{t.duplicateWarning}</strong>{' '}
                    {verif.doublons
                      .slice(0, 5)
                      .map((d) => `${d.numeroPage} (${d.noms.length})`)
                      .join(', ')}
                    {verif.doublons.length > 5 && ' …'}
                  </p>
                )}
                {verif.refuses.length > 0 && (
                  <p className="text-amber-700">
                    {verif.refuses.length} {t.rejectedFiles} : {verif.refuses[0]?.nom}
                    {verif.refuses.length > 1 && ' …'}
                  </p>
                )}
                {verif.manquants.length > 0 && (
                  <p className="text-stone-500">
                    {t.missingPages} {verif.manquants.slice(0, 10).join(', ')}
                    {verif.manquants.length > 10 && ' …'}
                  </p>
                )}
              </div>
            )}

            {mode === 'images' && (
              <>
                <button
                  onClick={() => void envoyer()}
                  disabled={envoiEnCours || lignes.length === 0 || livre.trim() === '' || bloquant}
                  className="mt-4 w-full rounded-full bg-emerald-700 px-5 py-2.5 font-medium text-white hover:bg-emerald-800 disabled:opacity-40"
                >
                  {envoiEnCours
                    ? `${t.uploading} ${envoyees}/${lignes.length}`
                    : `${t.uploadStart} (${lignes.length})`}
                </button>
                {bloquant && (
                  <p className="mt-2 text-center text-xs text-red-700">{t.fixDuplicates}</p>
                )}
              </>
            )}

            {mode === 'images' && envoiEnCours && (
              <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-stone-200">
                <div
                  className="h-full bg-emerald-600 transition-all"
                  style={{ width: `${Math.round((envoyees / Math.max(1, lignes.length)) * 100)}%` }}
                />
              </div>
            )}

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

          {mode === 'images' && lignes.length > 0 && lignes.length <= 600 && (
            <div className="max-h-72 overflow-y-auto rounded-xl border border-stone-200 bg-white p-4">
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
              <h3 className="mb-2 flex items-baseline justify-between text-sm font-medium text-stone-700">
                {t.booksInProgress}
                <span className="text-xs font-normal text-stone-400">{t.autoRefresh}</span>
              </h3>
              <ul className="space-y-2 text-sm text-stone-600">
                {livres.map((l) => {
                  const pct = l.nbPages === 0 ? 0 : Math.round((l.nbPagesOcr / l.nbPages) * 100);
                  return (
                    <li key={l.id}>
                      <div className="flex justify-between gap-3">
                        <span className="truncate" dir="auto">
                          {l.titre}
                        </span>
                        <span className="shrink-0 text-xs text-stone-400">
                          {l.nbPagesOcr}/{l.nbPages} {t.page} · {l.nbFatwas} {t.fatwa}
                        </span>
                      </div>
                      <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-stone-200">
                        <div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
