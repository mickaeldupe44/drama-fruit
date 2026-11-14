import { env, send, body, requireAuth } from '../lib/common.js';
import { generateImage, editImages } from '../lib/xai.js';

// Étape 2 : Grok dessine chaque fruit du casting, le décor vide, puis la première image avec tout le monde en place.
const LOOK = 'High-end 3D animated movie style (Pixar quality), soap-opera drama lighting, rich colors, sharp details.';

export function charPrompt(c) {
  return `${LOOK} Character design sheet of ONE anthropomorphic fruit character named ${c.name}: a ${c.fruit} with an expressive cartoon face (big eyes, eyebrows, mouth), small arms and legs. ${c.imagePrompt || c.look || ''} Full body, front view, standing, plain soft grey studio background, no text.`;
}
export function decorPrompt(plan) {
  return `${LOOK} Empty film set with no characters, vertical 9:16 framing: ${plan.settingPrompt || plan.setting || 'dramatic kitchen at night'}. Cinematic depth, room for characters in the foreground, no text.`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST attendu.' });
  if (!requireAuth(req, res)) return;
  if (!env('XAI_API_KEY')) return send(res, 500, { error: 'Clé XAI_API_KEY manquante sur le serveur.' });
  const plan = body(req).plan || {};
  const cast = (Array.isArray(plan.cast) ? plan.cast : []).slice(0, 4);
  try {
    const [decor, ...chars] = await Promise.all([
      generateImage(decorPrompt(plan), '9:16'),
      ...cast.map((c) => generateImage(charPrompt(c), '2:3').catch(() => null)),
    ]);
    const characters = cast.map((c, i) => ({ name: c.name, fruit: c.fruit, url: chars[i] })).filter((c) => c.url);
    let keyframe = null;
    try {
      const first = (plan.shots && plan.shots[0]) || {};
      const who = characters.map((c, i) => `${c.name} (the ${c.fruit} from image ${i + 2})`).join(', ');
      keyframe = await editImages([decor, ...characters.map((c) => c.url)],
        `${LOOK} Opening frame of a vertical 9:16 soap-opera episode. Place ${who} inside the set from image 1. Keep every character's design, colors and accessories exactly as in their image. Scene: ${first.videoPrompt || first.visual || plan.logline || ''} Dramatic composition, characters clearly visible, no text.`, '9:16');
    } catch (e) { console.error('keyframe', e); }
    send(res, 200, { decor, characters, keyframe });
  } catch (e) {
    console.error('assets', e);
    send(res, 502, { error: `Grok n'a pas pu créer les images : ${e.message || e}` });
  }
}
