import { useState } from 'react';
import { ApiError, vocaliser } from './api.js';
import type { DICT } from './i18n.js';
import { LIMITE_VOCALISATION } from './config.js';

type T = (typeof DICT)['fr'];

interface Resultat {
  texte: string;
  vocalises: number;
  refuses: number;
  mots: number;
}

/**
 * Vocaliseur — produit distinct des fatwas.
 *
 * On colle jusqu'à trois pages de texte arabe nu, on récupère le même texte
 * voyellé. Rien n'est cherché, rien n'est conservé : le texte soumis n'est
 * enregistré nulle part.
 *
 * Ce que l'écran doit rendre visible, c'est la FIDÉLITÉ. Le serveur garantit que
 * le texte rendu est celui reçu aux signes près, et refuse les mots que le
 * modèle a voulu corriger — il faut le dire, sinon l'utilisateur ne sait pas ce
 * qu'il tient.
 */
export default function Voyelles({ t }: { t: T }) {
  const [entree, setEntree] = useState('');
  const [resultat, setResultat] = useState<Resultat | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [copie, setCopie] = useState(false);

  const trop = entree.length > LIMITE_VOCALISATION;
  const pret = entree.trim().length >= 2 && !trop && !enCours;

  async function lancer() {
    if (!pret) return;
    setEnCours(true);
    setErreur(null);
    setResultat(null);
    setCopie(false);
    try {
      setResultat(await vocaliser(entree));
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) setErreur(t.rateLimited);
      else setErreur(t.errorNetwork);
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-6">
      <div className="rounded-xl border border-stone-200 bg-white p-4">
        <h2 className="text-lg font-semibold text-stone-800">{t.vowelsTitle}</h2>
        <p className="mt-1 text-sm text-stone-500">{t.vowelsHint}</p>

        <textarea
          value={entree}
          onChange={(e) => setEntree(e.target.value)}
          placeholder={t.vowelsPlaceholder}
          dir="rtl"
          rows={10}
          className="texte-arabe mt-3 w-full resize-y rounded-md border border-stone-300 px-3 py-2 leading-loose outline-none focus:border-emerald-500"
        />
        <div className="mt-1 flex items-baseline justify-between text-xs">
          <span className={trop ? 'font-medium text-red-600' : 'text-stone-400'}>
            {entree.length} / {LIMITE_VOCALISATION} {t.vowelsChars}
          </span>
          {trop && <span className="text-red-600">{t.vowelsTooLong}</span>}
        </div>

        <button
          onClick={() => void lancer()}
          disabled={!pret}
          className="mt-3 w-full rounded-full bg-emerald-700 px-5 py-2.5 font-medium text-white hover:bg-emerald-800 disabled:opacity-40"
        >
          {enCours ? t.vowelsWorking : t.vowelsStart}
        </button>

        {erreur !== null && (
          <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {erreur}
          </p>
        )}
      </div>

      {resultat !== null && (
        <div className="rounded-xl border border-stone-200 bg-white p-4">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-xs text-stone-500">
              {resultat.vocalises} / {resultat.mots} {t.vowelsDone}
            </p>
            <button
              onClick={() => {
                void navigator.clipboard.writeText(resultat.texte).then(() => setCopie(true));
              }}
              className="rounded-md border border-stone-300 px-2.5 py-1 text-xs font-medium text-stone-600 hover:bg-stone-50"
            >
              {copie ? t.copied : t.copy}
            </button>
          </div>

          {/* La fidélité est le cœur du service : on la déclare, dans les deux
              sens. Un mot refusé reparaît nu — mieux vaut une voyelle manquante
              qu'un mot inventé. */}
          {resultat.refuses > 0 ? (
            <p className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {resultat.refuses} {t.vowelsRefused}
            </p>
          ) : (
            <p className="mb-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
              {t.vowelsFaithful}
            </p>
          )}

          <p dir="rtl" className="texte-arabe whitespace-pre-wrap leading-loose text-stone-800">
            {resultat.texte}
          </p>
        </div>
      )}
    </div>
  );
}
