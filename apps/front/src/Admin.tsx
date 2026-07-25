import { useState } from 'react';
import type { User } from 'firebase/auth';
import { connexionGoogle, deconnexion } from './auth.js';
import type { DICT } from './i18n.js';
import Rapport from './Rapport.js';
import Themes from './Themes.js';
import Upload from './Upload.js';

type Section = 'ajout' | 'themes' | 'rapport';

/**
 * Espace d'administration, servi sur une adresse non publiée.
 *
 * L'adresse ne protège rien par elle-même : le vrai contrôle est la connexion
 * Google, et l'allowlist que le serveur vérifie à chaque appel. Sans compte
 * autorisé, tout ce qui suit répond 403 — l'écran ci-dessous n'est qu'une
 * porte.
 */
export default function Admin({
  t,
  utilisateur,
  onQuitter,
}: {
  t: (typeof DICT)['fr'];
  utilisateur: User | null;
  onQuitter: () => void;
}) {
  const [section, setSection] = useState<Section>('ajout');
  const [erreur, setErreur] = useState<string | null>(null);

  if (!utilisateur) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center bg-stone-100 px-4">
        <div className="w-full max-w-sm rounded-2xl border border-stone-200 bg-white p-6 text-center shadow-sm">
          <h2 className="text-lg font-semibold text-stone-800">{t.adminTitle}</h2>
          <p className="mt-2 text-sm text-stone-500">{t.signInHint}</p>
          <button
            onClick={() => void connexionGoogle().catch(() => setErreur(t.errorNetwork))}
            className="mt-4 w-full rounded-full bg-emerald-700 px-5 py-2.5 font-medium text-white hover:bg-emerald-800"
          >
            {t.signIn}
          </button>
          <button onClick={onQuitter} className="mt-3 w-full text-sm text-stone-500 underline">
            {t.backToChat}
          </button>
          {erreur !== null && <p className="mt-3 text-sm text-red-600">{erreur}</p>}
        </div>
      </div>
    );
  }

  const onglets: Array<[Section, string]> = [
    ['ajout', t.uploadTitle],
    ['themes', t.themesTab],
    ['rapport', t.reportTab],
  ];

  return (
    <div className="flex h-dvh flex-col bg-stone-100 text-stone-900">
      <header className="shrink-0 border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div>
            <h1 className="text-lg font-bold text-emerald-800">{t.adminTitle}</h1>
            <p className="text-xs text-stone-500">{utilisateur.email}</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={onQuitter}
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
        <div className="mx-auto max-w-3xl px-4 pb-2">
          <div className="inline-flex overflow-hidden rounded-lg border border-stone-300">
            {onglets.map(([code, label]) => (
              <button
                key={code}
                onClick={() => setSection(code)}
                className={`px-3 py-1.5 text-xs font-medium ${
                  section === code ? 'bg-emerald-700 text-white' : 'text-stone-600 hover:bg-stone-50'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">
        {section === 'ajout' && <Upload t={t} utilisateur={utilisateur} />}
        {section === 'themes' && <Themes t={t} />}
        {section === 'rapport' && <Rapport t={t} />}
      </main>
    </div>
  );
}
