import { useState } from 'react';
import { ApiError, lirePage, vocaliser } from './api.js';
import type { DICT } from './i18n.js';
import { LIMITE_VOCALISATION, PAGES_MAX } from './config.js';

type T = (typeof DICT)['fr'];

interface Resultat {
  texte: string;
  vocalises: number;
  /** Bornes des mots restés sans signes, telles que le serveur les a relevées. */
  nus: Array<[number, number]>;
  mots: number;
}

/**
 * Découpe le texte pour l'affichage, en isolant les mots restés sans signes.
 *
 * Les bornes viennent du SERVEUR, qui les a relevées sur le texte qu'il a
 * assemblé. Les recalculer ici serait une seconde déduction, et le surlignage
 * finirait par ne plus s'accorder avec le compte annoncé.
 */
function tronconner(texte: string, nus: ReadonlyArray<[number, number]>) {
  const morceaux: Array<{ texte: string; nu: boolean }> = [];
  let curseur = 0;
  for (const [debut, fin] of nus) {
    if (debut > curseur) morceaux.push({ texte: texte.slice(curseur, debut), nu: false });
    morceaux.push({ texte: texte.slice(debut, fin), nu: true });
    curseur = fin;
  }
  if (curseur < texte.length) morceaux.push({ texte: texte.slice(curseur), nu: false });
  return morceaux;
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

  const [lecture, setLecture] = useState('');

  const trop = entree.length > LIMITE_VOCALISATION;
  const pret = entree.trim().length >= 2 && !trop && !enCours && lecture === '';

  /**
   * Téléverser remplit le champ, il ne vocalise pas directement : l'OCR se
   * trompe parfois, et l'enchaîner sans relecture enfermerait l'erreur dans le
   * résultat. Le texte extrait revient donc là où il peut être corrigé.
   */
  async function lireFichiers(files: FileList | null) {
    const liste = Array.from(files ?? []).slice(0, PAGES_MAX);
    if (liste.length === 0) return;
    setErreur(null);
    setResultat(null);
    const morceaux: string[] = [];
    try {
      for (const [i, f] of liste.entries()) {
        setLecture(`${i + 1}/${liste.length}`);
        morceaux.push(await lirePage(f));
      }
      setEntree((prev) => [prev.trim(), ...morceaux].filter((s) => s !== '').join('\n\n'));
    } catch (err) {
      const s = err instanceof ApiError ? err.status : 0;
      if (s === 415) setErreur(t.vowelsBadType);
      else if (s === 413) setErreur(t.vowelsTooLong);
      else if (s === 422) setErreur(t.vowelsNoText);
      else if (s === 429) setErreur(t.rateLimited);
      else setErreur(t.errorNetwork);
    } finally {
      setLecture('');
    }
  }

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

        {/* Deux entrées pour la même chose : téléverser la page, ou coller le
            texte. Le téléversement remplit simplement le champ ci-dessous. */}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp,image/tiff,application/pdf"
          multiple
          disabled={lecture !== ''}
          onChange={(e) => {
            void lireFichiers(e.target.files);
            e.target.value = '';
          }}
          className="mt-3 block w-full text-sm file:mr-3 file:rounded-full file:border-0 file:bg-emerald-700 file:px-4 file:py-2 file:text-white disabled:opacity-40"
        />
        <p className="mt-1 text-xs text-stone-400">{t.vowelsUploadHint}</p>
        {lecture !== '' && (
          <p className="mt-2 text-sm text-stone-500">
            {t.vowelsReading} {lecture}
          </p>
        )}

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
              sens. Un mot laissé nu reparaît sans signes — mieux vaut une
              voyelle manquante qu'un mot inventé. */}
          {resultat.nus.length > 0 ? (
            <p className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {resultat.nus.length} {t.vowelsRefused}
            </p>
          ) : (
            <p className="mb-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
              {t.vowelsFaithful}
            </p>
          )}

          <p dir="rtl" className="texte-arabe whitespace-pre-wrap leading-loose text-stone-800">
            {tronconner(resultat.texte, resultat.nus).map((m, i) =>
              m.nu ? (
                // surligné, non coloré : le mot reste noir et lisible, c'est le
                // fond qui le désigne
                <mark key={i} className="rounded bg-amber-200 px-0.5 text-stone-900">
                  {m.texte}
                </mark>
              ) : (
                <span key={i}>{m.texte}</span>
              ),
            )}
          </p>
        </div>
      )}
    </div>
  );
}
