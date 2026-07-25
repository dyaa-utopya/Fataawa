import { useEffect, useState } from 'react';
import { chargerRapport } from './api.js';
import type { DICT } from './i18n.js';
import type { Rapport as RapportData } from './types.js';

type T = (typeof DICT)['fr'];

function Cellule({ n, total }: { n: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((n * 100) / total);
  return (
    <td className={`px-2 py-1.5 text-end tabular-nums ${n === 0 ? 'text-stone-300' : 'text-stone-700'}`}>
      {n}
      {n > 0 && <span className="ms-1 text-xs text-stone-400">{pct}%</span>}
    </td>
  );
}

/**
 * Ce que le pipeline n'a pas su renseigner, livre par livre. Sans ce relevé,
 * une fatwa sans thème ou sans réponse se perd dans la masse : elle reste
 * cherchable mais inclassable, et rien ne le signale.
 */
export default function Rapport({ t }: { t: T }) {
  const [data, setData] = useState<RapportData | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [chargement, setChargement] = useState(true);
  /** Collection analysée : celle servie au public, ou celle du retraitement. */
  const [collection, setCollection] = useState<string | undefined>(undefined);

  function recharger() {
    setChargement(true);
    setErreur(null);
    chargerRapport(collection)
      .then(setData)
      .catch(() => setErreur(t.errorNetwork))
      .finally(() => setChargement(false));
  }
  useEffect(recharger, [t.errorNetwork, collection]);

  if (chargement && data === null)
    return <p className="p-6 text-sm text-stone-500">{t.reportLoading}</p>;
  if (erreur !== null) return <p className="p-6 text-sm text-red-600">{erreur}</p>;
  if (data === null) return null;

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-6">
      <div className="rounded-xl border border-stone-200 bg-white p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-stone-800">{t.reportTitle}</h2>
            <p className="mt-1 text-sm text-stone-500">
              {data.total} {t.fatwa} · {t.reportCollection} <code>{data.collection}</code>
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {data.collectionsDisponibles.length > 1 && (
              <div className="flex overflow-hidden rounded-md border border-stone-300">
                {data.collectionsDisponibles.map((c) => (
                  <button
                    key={c}
                    onClick={() => setCollection(c)}
                    className={`px-2.5 py-1.5 text-xs font-medium ${
                      data.collection === c ? 'bg-emerald-700 text-white' : 'text-stone-600 hover:bg-stone-50'
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            )}
            <button
              onClick={recharger}
              disabled={chargement}
              className="rounded-md border border-stone-300 px-2.5 py-1.5 text-xs font-medium text-stone-600 hover:bg-stone-50 disabled:opacity-40"
            >
              {chargement ? t.loading : t.reportRefresh}
            </button>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="border-b border-stone-200 bg-stone-50 text-xs uppercase tracking-wide text-stone-400">
            <tr>
              <th className="px-2 py-2 text-start font-semibold">{t.reportBook}</th>
              <th className="px-2 py-2 text-end font-semibold">{t.fatwa}</th>
              <th className="px-2 py-2 text-end font-semibold">{t.reportNoNumber}</th>
              <th className="px-2 py-2 text-end font-semibold">{t.reportNoTheme1}</th>
              <th className="px-2 py-2 text-end font-semibold">{t.reportNoTheme2}</th>
              <th className="px-2 py-2 text-end font-semibold">{t.reportNoTheme3}</th>
              <th className="px-2 py-2 text-end font-semibold">{t.reportNoQuestion}</th>
              <th className="px-2 py-2 text-end font-semibold">{t.reportNoAnswer}</th>
            </tr>
          </thead>
          <tbody>
            {data.livres.map((l) => (
              <tr key={l.livreId} className="border-b border-stone-100 last:border-0">
                <td dir="auto" className="max-w-[220px] truncate px-2 py-1.5 text-stone-700">
                  {l.titre}
                </td>
                <td className="px-2 py-1.5 text-end tabular-nums text-stone-500">{l.total}</td>
                <Cellule n={l.sansNumero} total={l.total} />
                <Cellule n={l.sansThemeN1} total={l.total} />
                <Cellule n={l.sansThemeN2} total={l.total} />
                <Cellule n={l.sansThemeN3} total={l.total} />
                <Cellule n={l.sansQuestion} total={l.total} />
                <Cellule n={l.sansReponse} total={l.total} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data.exemples.length > 0 && (
        <div className="rounded-xl border border-stone-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-stone-800">{t.reportSamples}</h3>
          <ul className="mt-3 space-y-3">
            {data.exemples.map((e) => (
              <li key={e.id} className="border-b border-stone-100 pb-3 last:border-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-medium text-emerald-800">
                    {t.fatwa} {e.numero_fatwa || '—'}
                    {e.sous_question !== '' && ` · ${e.sous_question}`}
                  </span>
                  {e.manques.map((m) => (
                    <span key={m} className="rounded bg-red-50 px-1.5 py-0.5 text-red-700">
                      {m}
                    </span>
                  ))}
                </div>
                <p dir="rtl" className="texte-arabe mt-1 line-clamp-2 text-sm text-stone-600">
                  {e.extrait}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
