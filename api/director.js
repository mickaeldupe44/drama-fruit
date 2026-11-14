import { env, send, body, requireAuth } from '../lib/common.js';

// Écrit l'histoire complète avec OpenAI (sinon Grok texte). Sans aucune clé, le site écrit lui-même un scénario de base.
const SYSTEM = `Tu es showrunner, scénariste et prompt engineer pour "Drama Fruit", une série TikTok virale en vidéo verticale 9:16.

STYLE VISUEL OBLIGATOIRE (la "bible" de la série, à respecter dans tous les prompts en anglais) :
- Les personnages sont des FRUITS ANTHROPOMORPHES À CORPS HUMAIN : une tête-fruit brillante et réaliste (texture du fruit, tige, feuilles) avec un visage cartoon très expressif (grands yeux brillants, sourcils marqués, larmes, colère, choc), des cheveux humains coiffés, et un corps humain normal habillé de vrais vêtements (costume, uniforme, tablier de serveuse, robe de soirée, etc.).
- Chaque personnage porte sur le front une PLAQUE LUMINEUSE DORÉE (badge LED) qui affiche sa valeur en euros (ex. "3,50 €" pour le pauvre, "2 000 €" pour le policier, "50 000 000 €" pour le milliardaire). Ce contraste riche/pauvre est le cœur du drama.
- Rendu 3D de film d'animation haut de gamme, très détaillé, couleurs saturées, lumière cinéma, décors luxueux ou très contrastés (palais doré, manoir, tribunal, prison, cuisine sale, rue sous la pluie...).
- Émotions exagérées façon feuilleton : humiliation, trahison, injustice, revanche.

STRUCTURE DE L'HISTOIRE :
- Accroche choc dans les 2 premières secondes (une injustice visible ou une phrase choc).
- Montée de la tension, une révélation ou un retournement.
- Fin en cliffhanger "PARTIE 1" qui donne envie de voir la suite.
- Répliques courtes, percutantes, faciles à lire en sous-titres (8 mots max par réplique), dans la langue demandée.

Tu reçois une idée. Écris l'HISTOIRE COMPLÈTE de l'épisode, puis tout ce qu'il faut pour générer les images et la vidéo.
Réponds UNIQUEMENT avec un objet JSON :
{"title": string (titre accrocheur, en français),
 "logline": string (une phrase),
 "story": string (l'histoire complète racontée en français, 6 à 12 phrases, du début à la fin, avec qui fait quoi et pourquoi),
 "cast": [{"name": string (nom français du fruit-personnage), "fruit": string (en anglais), "role": string (rôle en français, ex. "la serveuse accusée"), "price": string (valeur affichée sur la plaque du front, ex. "3,50 €"), "look": string (tenue et accessoires, en anglais),
   "imagePrompt": string (prompt anglais complet pour l'image DE FACE du personnage en pied : tête-fruit, visage, coiffure, corps humain, tenue, plaque lumineuse avec le prix exact, expression, 60 mots max),
   "backPrompt": string (prompt anglais pour le même personnage VU DE DOS : coiffure, tige, tenue de dos, 35 mots max)}],
 "sets": [{"id": "s1", "name": string (nom court en français), "prompt": string (prompt anglais complet du décor VIDE, sans personnage : lieu, architecture, lumière, couleurs, accessoires, ambiance, 60 mots max)}],
 "setting": string (décor principal, en anglais),
 "shots": [{"seconds": number, "set": string (id du décor), "characters": [string] (noms présents), "visual": string (ce qu'on voit, en anglais),
   "videoPrompt": string (prompt anglais détaillé pour Grok : cadrage, mouvement de caméra, actions, émotions, gestes, nomme les personnages, 70 mots max),
   "dialogue": [{"who": string, "tone": string (en anglais), "line": string}]}],
 "caption": string (légende TikTok en français avec emojis), "hashtags": [string]}
Règles : 2 à 4 personnages ; autant de décors que l'histoire en a besoin (1 à 4), en changer au moins une fois si l'épisode dure 10 s ou plus ; la somme des "seconds" doit être exactement égale à la durée demandée ; chaque plan dure au maximum 15 secondes.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST attendu.' });
  if (!requireAuth(req, res)) return;
  // OpenAI si une clé est fournie, sinon Grok (texte) avec la clé xAI.
  const llm = env('OPENAI_API_KEY')
    ? { url: 'https://api.openai.com/v1/chat/completions', key: env('OPENAI_API_KEY'), models: [env('OPENAI_MODEL'), 'gpt-5-mini', 'gpt-4.1', 'gpt-4o'].filter(Boolean), name: 'OpenAI' }
    : env('XAI_API_KEY') ? { url: 'https://api.x.ai/v1/chat/completions', key: env('XAI_API_KEY'), models: [env('XAI_TEXT_MODEL') || 'grok-4.20-0309-non-reasoning'], name: 'Grok' } : null;
  if (!llm) return send(res, 200, { fallback: true });
  const b = body(req);
  const duration = Math.max(4, Math.min(60, Number(b.duration) || 15));
  const shots = Math.max(2, Math.ceil(duration / 6));
  const lines = [
    `Idée : ${String(b.idea || '').slice(0, 1500)}`,
    `Langue des répliques : ${b.lang || 'fr'}`,
    `Durée totale : ${duration} secondes, au moins ${shots} plan(s).`,
    b.settingDesc ? `Décor imposé : ${b.settingDesc}` : '',
    b.outro ? `Dernière réplique, face caméra : "${b.outro.line || b.outro.text}" (dite par ${b.outro.speaker || 'le personnage principal'}).` : '',
  ];
  if (b.viral) {
    lines.push('MODE VIRAL : réécris pour maximiser la rétention TikTok. Accroche choc dans la première seconde, rythme plus rapide, retournement, cliffhanger final. Ajoute "changes": [string] listant en français ce que tu as amélioré.');
    if (b.previousPlan) lines.push(`Scénario actuel à améliorer : ${JSON.stringify(b.previousPlan).slice(0, 6000)}`);
    if (b.feedback) lines.push(`Remarques de l'utilisateur : ${String(b.feedback).slice(0, 1000)}`);
  } else if (b.feedback && b.previousPlan) {
    lines.push(`Corrige ce scénario selon ces remarques : ${String(b.feedback).slice(0, 1000)}\nScénario : ${JSON.stringify(b.previousPlan).slice(0, 6000)}`);
  }
  try {
    const askModel = async (model, json) => {
      const r = await fetch(llm.url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${llm.key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          ...(json ? { response_format: { type: 'json_object' } } : {}),
          messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: lines.filter(Boolean).join('\n') }],
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { const e = new Error((d.error && (d.error.message || d.error)) || d.message || `${llm.name} ${r.status}`); e.status = r.status; throw e; }
      return String(d.choices[0].message.content || '');
    };
    const ask = async (json) => {
      let last;
      for (const m of llm.models) {
        try { return await askModel(m, json); } catch (e) { last = e; if (!(e.status === 404 || /model/i.test(String(e.message)))) throw e; }
      }
      throw last;
    };
    let text;
    try { text = await ask(true); } catch (e) { if (e.status !== 400) throw e; text = await ask(false); }
    const a = text.indexOf('{'), z = text.lastIndexOf('}');
    const plan = JSON.parse(a >= 0 ? text.slice(a, z + 1) : text);
    if (!Array.isArray(plan.shots) || !plan.shots.length) throw new Error('scénario vide');
    plan.cast = (Array.isArray(plan.cast) ? plan.cast : []).filter((c) => c && c.name).slice(0, 4);
    plan.shots = plan.shots.map((x) => ({ ...x, seconds: Math.max(1, Math.min(15, Number(x.seconds) || 5)), visual: String(x.visual || x.videoPrompt || ''), dialogue: Array.isArray(x.dialogue) ? x.dialogue.filter((l) => l && l.line) : [] }));
    plan.hashtags = Array.isArray(plan.hashtags) ? plan.hashtags : [];
    plan.sets = (Array.isArray(plan.sets) ? plan.sets : []).filter((x) => x && x.id && x.prompt).slice(0, 4);
    if (b.viral) plan.viral = true;
    send(res, 200, { plan, balance: 9999 });
  } catch (e) {
    console.error('director', e);
    send(res, 200, { fallback: true, warning: String(e.message || e) });
  }
}
