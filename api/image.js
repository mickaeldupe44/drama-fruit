import { env, send, body, requireAuth } from '../lib/common.js';
import { openaiGenerate, openaiEdit } from '../lib/openai.js';
import { generateImage, editImages } from '../lib/xai.js';

// Une image à la fois (personnage, décor ou 1re image), pour rester sous les limites de temps et de taille.
const LOOK = 'Gorgeous high-end 3D animated feature film style (Pixar / DreamWorks quality), appealing and beautiful character design, soft cinematic lighting, rich saturated colors, glossy detailed textures, shallow depth of field.';

export const planSets = (p) => (Array.isArray(p.sets) && p.sets.length ? p.sets : [{ id: 's1', name: 'Décor', prompt: p.settingPrompt || p.setting || 'dramatic kitchen at night' }]).slice(0, 3);

function charPrompt(c) {
  return `${LOOK} Character portrait of ONE charming anthropomorphic fruit character named ${c.name}: a ${c.fruit} with a beautiful expressive cartoon face (large sparkling eyes, long lashes or bold brows, expressive mouth), elegant small arms and legs. ${c.imagePrompt || c.look || ''} Full body, three-quarter view, confident pose, clean soft gradient studio background, no text, no watermark.`;
}
function setPrompt(s) {
  return `${LOOK} Empty movie set, no characters, vertical 9:16 composition: ${s.prompt || s.name}. Beautifully art-directed, detailed props, atmospheric light, depth, room for characters in the foreground, no text.`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST attendu.' });
  if (!requireAuth(req, res)) return;
  const b = body(req); const p = b.plan || {};
  const useOpenAI = Boolean(env('OPENAI_API_KEY'));
  if (!useOpenAI && !env('XAI_API_KEY')) return send(res, 500, { error: 'Aucune clé d\'image sur le serveur.' });
  const gen = (prompt, portrait) => (useOpenAI ? openaiGenerate(prompt, '1024x1536') : generateImage(prompt, portrait ? '2:3' : '9:16'));
  try {
    let url;
    if (b.kind === 'char') {
      const c = (p.cast || [])[Number(b.index) || 0]; if (!c) return send(res, 400, { error: 'Personnage inconnu.' });
      url = await gen(charPrompt(c), true);
    } else if (b.kind === 'set') {
      const s = planSets(p)[Number(b.index) || 0]; if (!s) return send(res, 400, { error: 'Décor inconnu.' });
      url = await gen(setPrompt(s), false);
    } else if (b.kind === 'key') {
      const refs = (Array.isArray(b.refs) ? b.refs : []).filter((r) => r && typeof r.url === 'string').slice(0, 5);
      if (!refs.length) return send(res, 400, { error: 'Aucune image de référence.' });
      const first = (p.shots && p.shots[0]) || {};
      const desc = refs.map((r, i) => `image ${i + 1} is ${r.label}`).join(', ');
      const prompt = `${LOOK} Opening frame of a vertical 9:16 soap-opera episode. Use the reference images: ${desc}. Place the characters inside the set, keeping each character's exact design, colors and accessories. Scene: ${first.videoPrompt || first.visual || p.logline || ''} Dramatic, beautiful cinematic composition, characters clearly visible and acting, no text.`;
      url = useOpenAI ? await openaiEdit(refs.map((r) => r.url), prompt, '1024x1536') : await editImages(refs.map((r) => r.url), prompt, '9:16');
    } else return send(res, 400, { error: 'Type d\'image inconnu.' });
    send(res, 200, { url, provider: useOpenAI ? 'openai' : 'xai' });
  } catch (e) {
    console.error('image', b.kind, e);
    send(res, 502, { error: `Image non créée : ${e.message || e}` });
  }
}
