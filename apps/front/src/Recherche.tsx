import { useState } from 'react';
import { ApiError, rechercher } from './api.js';
import type { DICT } from './i18n.js';
import type { ResultatRecherche } from './types.js';

type T = (typeof DICT)['fr'];

/** Une fatwa dans la liste : aperçu replié, texte intégral au déploiement. */
function CarteResultat({
  r,
  t,
  onVoirPage,
}: {
  r: ResultatRecherche;
  t: T;
  onVoirPage: () => void;
}) {
  const [deploye, setDeploye] = useState(false);
  // le découpage question / réponse n'existe pas sur les fatwas les plus
  // anciennes : on retombe alors sur le texte d'un seul tenant
  const separe = r.question !== '' && r.reponse !== '';

  return (
    <article className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-stone-500">
        <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-medium text-emerald-800">
          {t.fatwa} {r.numero_fatwa || '—'}
        </span>
        {r.sous_question !== '' && (
          <span className="rounded bg-stone-100 px-1.5 py-0.5 font-medium text-stone-600">
            {t.subQuestion} {r.sous_question}
          </span>
        )}
        {r.livre_titre !== '' && (
          <span dir="auto" className="truncate">
            {r.livre_titre}
          </span>
        )}
        {r.sujet !== '' && (
          <span dir="auto" className="rounded-full border border-stone-200 px-2 py-0.5">
            {r.sujet}
            {r.sous_sujet !== '' && ` · ${r.sous_sujet}`}
          </span>
        )}
        {/* Deux chemins mènent ici, le mot exact et le sens : sans le dire, une
            liste qui mêle les deux paraît capricieuse. */}
        <span className="ms-auto shrink-0 text-stone-400">{t.origine[r.origine]}</span>
      </div>

      {deploye ? (
        separe ? (
          <div className="space-y-3">
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-stone-400">
                {t.questionLabel}
              </p>
              <p dir="rtl" className="texte-arabe whitespace-pre-wrap text-stone-800">
                {r.question}
              </p>
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-stone-400">
                {t.answerLabel}
              </p>
              <p dir="rtl" className="texte-arabe whitespace-pre-wrap text-stone-800">
                {r.reponse}
              </p>
            </div>
          </div>
        ) : (
          <p dir="rtl" className="texte-arabe whitespace-pre-wrap text-stone-800">
            {r.texte}
          </p>
        )
      ) : (
        <p dir="rtl" className="texte-arabe line-clamp-3 text-stone-700">
          {r.extrait}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs font-medium">
        <button
          onClick={() => setDeploye((v) => !v)}
          className="rounded-full border border-stone-300 px-3 py-1.5 text-stone-600 hover:bg-stone-50"
        >
          {deploye ? `▴ ${t.readLess}` : `▾ ${t.readMore}`}
        </button>
        {r.url_image !== null && (
          <button onClick={onVoirPage} className="text-emerald-700 underline hover:text-emerald-900">
            🖼 {t.viewPage}
          </button>
        )}
      </div>
    </article>
  );
}

/**
 * Recherche globale : on interroge le même index que le chat, mais on rend les
 * fatwas telles quelles. Rien n'est rédigé par le modèle ici — c'est le pendant
 * « consultation directe » de la question/réponse, pas son remplacement.
 */
export default function Recherche({
  t,
  onVoirPage,
}: {
  t: T;
  onVoirPage: (r: ResultatRecherche) => void;
}) {
  const [requete, setRequete] = useState('');
  const [resultats, setResultats] = useState<ResultatRecherche[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function lancer(e: React.FormEvent) {
    e.preventDefault();
    const clean = requete.trim();
    if (clean.length < 2 || loading) return;
    setLoading(true);
    setError(null);
    try {
      setResultats(await rechercher(clean));
    } catch (err) {
      setResultats(null);
      if (err instanceof ApiError && err.status === 429) setError(t.rateLimited);
      else setError(t.errorNetwork);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-5">
      <form onSubmit={(e) => void lancer(e)} className="flex items-center gap-2">
        <input
          value={requete}
          onChange={(e) => setRequete(e.target.value)}
          placeholder={t.searchPlaceholder}
          dir="auto"
          className="flex-1 rounded-full border border-stone-300 bg-white px-4 py-2.5 outline-none focus:border-emerald-500"
        />
        <button
          type="submit"
          disabled={loading || requete.trim().length < 2}
          className="rounded-full bg-emerald-700 px-5 py-2.5 font-medium text-white disabled:opacity-40"
        >
          {t.searchAction}
        </button>
      </form>

      {resultats === null && !loading && error === null && (
        <div className="mt-16 text-center">
          <h2 className="text-2xl font-semibold text-stone-700">{t.searchTitle}</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-stone-500">{t.searchBody}</p>
        </div>
      )}

      {loading && <p className="mt-8 animate-pulse text-center text-sm text-stone-500">{t.searching}</p>}

      {error !== null && (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {resultats !== null && !loading && (
        <div className="mt-5 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-stone-400">
            {resultats.length === 0 ? t.noResults : `${resultats.length} ${t.resultsCount}`}
          </p>
          {resultats.map((r) => (
            <CarteResultat key={r.id} r={r} t={t} onVoirPage={() => onVoirPage(r)} />
          ))}
        </div>
      )}
    </div>
  );
}
