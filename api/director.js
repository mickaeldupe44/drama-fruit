import { env, send, body, requireAuth } from '../lib/common.js';

// Écrit le scénario avec OpenAI (optionnel). Sans clé, le site écrit lui-même un scénario de base.
const SYSTEM = `Tu es le réalisateur et le prompt engineer de "Drama Fruit" : des mini-séries verticales (9:16) où des fruits anthropomorphes (visages expressifs, bras, petites jambes, accessoires) vivent des drames de feuilleton.
Ton scénario sert ensuite à générer des images (personnages, décor) puis une vidéo avec Grok Imagine. Écris donc des prompts visuels précis, en anglais.
Réponds UNIQUEMENT avec un objet JSON :
{"title": string, "logline": string,
 "cast": [{"name": string, "fruit": string (en anglais), "look": string (accessoire distinctif, en anglais), "imagePrompt": string (description visuelle complète du personnage en anglais : couleurs, texture du fruit, expression, vêtements/accessoires, 40 mots max)}],
 "setting": string (décor court, en anglais), "settingPrompt": string (description visuelle complète du décor vide en anglais : lieu, lumière, couleurs, ambiance, 50 mots max),
 "shots": [{"seconds": number, "visual": string (ce qu'on voit, en anglais), "videoPrompt": string (prompt vidéo en anglais pour Grok : action, mouvements de caméra, cadrage, émotions, nomme les personnages par leur nom, 60 mots max), "dialogue": [{"who": string, "tone": string (en anglais), "line": string (dans la langue demandée)}]}],
 "caption": string, "hashtags": [string]}
Règles : 2 à 4 personnages, répliques courtes et percutantes, accroche dans la première seconde, une révélation, et une fin qui donne envie de voir la suite.
La somme des "seconds" doit être exactement égale à la durée demandée. Chaque plan dure au maximum 15 secondes.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST attendu.' });
  if (!requireAuth(req, res)) return;
  const key = env('OPENAI_API_KEY');
  if (!key) return send(res, 200, { fallback: true });
  const b = body(req);
  const duration = Math.max(4, Math.min(60, Number(b.duration) || 15));
  const shots = Math.max(1, Math.ceil(duration / 15));
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
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: env('OPENAI_MODEL') || 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        temperature: 0.9,
        messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: lines.filter(Boolean).join('\n') }],
      }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error((d.error && d.error.message) || `OpenAI ${r.status}`);
    const plan = JSON.parse(d.choices[0].message.content);
    if (!Array.isArray(plan.shots) || !plan.shots.length) throw new Error('scénario vide');
    plan.cast = (Array.isArray(plan.cast) ? plan.cast : []).filter((c) => c && c.name).slice(0, 4);
    plan.shots = plan.shots.map((x) => ({ ...x, seconds: Math.max(1, Math.min(15, Number(x.seconds) || 5)), visual: String(x.visual || x.videoPrompt || ''), dialogue: Array.isArray(x.dialogue) ? x.dialogue.filter((l) => l && l.line) : [] }));
    plan.hashtags = Array.isArray(plan.hashtags) ? plan.hashtags : [];
    if (b.viral) plan.viral = true;
    send(res, 200, { plan, balance: 9999 });
  } catch (e) {
    console.error('director', e);
    send(res, 200, { fallback: true, warning: String(e.message || e) });
  }
}
