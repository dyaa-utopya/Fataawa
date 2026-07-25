import { useEffect, useState } from 'react';
import { listerThemes } from './api.js';
import type { DICT } from './i18n.js';
import type { Taxonomie } from './types.js';

/**
 * La taxonomie appliquée à la structuration, telle que le serveur la sert.
 * Affichée en lecture : c'est la règle que le modèle doit suivre, et elle doit
 * pouvoir être relue sans ouvrir le code.
 */
export default function Themes({ t }: { t: (typeof DICT)['fr'] }) {
  const [taxonomie, setTaxonomie] = useState<Taxonomie | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    listerThemes()
      .then(setTaxonomie)
      .catch(() => setErreur(t.errorNetwork));
  }, [t.errorNetwork]);

  if (erreur !== null) return <p className="p-6 text-sm text-red-600">{erreur}</p>;
  if (taxonomie === null) return <p className="p-6 text-sm text-stone-500">{t.loading}</p>;

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-6">
      <div className="rounded-xl border border-stone-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-stone-800">{t.themesTitle}</h2>
        <p className="mt-1 text-sm text-stone-500">{t.themesHint}</p>
        <p className="mt-2 text-xs text-stone-400">
          {taxonomie.chapitres.length} {t.themesChapters} ·{' '}
          {taxonomie.chapitres.reduce((n, c) => n + c.sections.length, 0)} {t.themesSections}
        </p>
      </div>

      {taxonomie.chapitres.map((c) => (
        <div key={c.nom} className="rounded-xl border border-stone-200 bg-white p-4">
          <h3 dir="rtl" className="texte-arabe text-base font-semibold text-emerald-800">
            {c.nom}
          </h3>
          <div dir="rtl" className="mt-2 flex flex-wrap gap-1.5">
            {c.sections.map((s) => (
              <span
                key={s}
                className="rounded-full border border-stone-200 bg-stone-50 px-2.5 py-1 text-sm text-stone-700"
              >
                {s}
              </span>
            ))}
            <span className="rounded-full border border-dashed border-stone-300 px-2.5 py-1 text-sm text-stone-400">
              {taxonomie.sectionAutre}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
