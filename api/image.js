import { env, send, body } from '../lib/common.js';
import { requireUser, charged } from '../lib/account.js';
import { openaiGenerate, openaiEdit, SCENE_SIZES, sceneQuality } from '../lib/openai.js';
import { generateImage, editImages } from '../lib/xai.js';
import { sheetPrompt, lieuPrompt, objetPrompt, scenePrompt } from '../lib/pack.js';

// Une image à la fois (personnage, décor ou 1re image), pour rester sous les limites de temps et de taille.
const LOOK = 'Ultra-detailed high-end 3D animated film render, glossy realistic fruit textures, cinematic lighting, rich saturated colors, sharp focus, viral TikTok fruit-drama style.';
const BIBLE = 'Anthropomorphic fruit character with a HUMAN BODY: a glossy realistic fruit as the head (stem, leaves, fruit skin texture) with a very expressive cartoon face (big shiny eyes, strong eyebrows, expressive mouth) and styled human hair, normal human body wearing real clothes, human hands.';

export const planSets = (p) => (Array.isArray(p.sets) && p.sets.length ? p.sets : [{ id: 's1', name: 'Décor', prompt: p.settingPrompt || p.setting || 'dramatic kitchen at night' }]).slice(0, 4);

const priceTag = (c) => (c.price ? ` A glowing golden LED price badge is attached on the forehead, clearly displaying "${c.price}".` : '');
function charPrompt(c) {
  return `${LOOK} ${BIBLE} Character reference sheet, FRONT VIEW, full body standing, of ONE character named ${c.name}: a ${c.fruit}. ${c.imagePrompt || c.look || ''}${priceTag(c)} Plain light grey studio background, centered, whole body visible from head to shoes, no other characters, no text except the price badge.`;
}
function backPrompt(c) {
  return `${LOOK} The exact same character as in the reference image (${c.name}, a ${c.fruit}), now seen FROM BEHIND (back view), full body standing, same hair, same stem, same clothes and colors. ${c.backPrompt || ''} Plain light grey studio background, whole body visible, no other characters, no text.`;
}
function setPrompt(s) {
  return `${LOOK} Empty movie set, no characters, vertical 9:16 composition: ${s.prompt || s.name}. Beautifully art-directed, detailed props, atmospheric light, depth, room for characters in the foreground, no text.`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST attendu.' });
  const user = await requireUser(req, res); if (!user) return;
  const b = body(req); const p = b.plan || {};
  // Mode payant : l'épisode se paie une seule fois, au premier appel de son tournage.
  if (!(await charged(res, user, b, 'img')).ok) return;
  const useOpenAI = Boolean(env('OPENAI_API_KEY'));
  if (!useOpenAI && !env('XAI_API_KEY')) return send(res, 500, { error: 'Aucune clé d\'image sur le serveur.' });
  const gen = (prompt, portrait) => (useOpenAI ? openaiGenerate(prompt, '1024x1536') : generateImage(prompt, portrait ? '2:3' : '9:16'));
  try {
    let url;
    const pack = b.pack;
    if (pack && b.kind === 'sheet') {
      const pp = (pack.persos || [])[Number(b.index) || 0]; if (!pp) return send(res, 400, { error: 'Personnage inconnu.' });
      url = useOpenAI ? await openaiGenerate(sheetPrompt(pp), '1536x1024') : await generateImage(sheetPrompt(pp), '3:2');
    } else if (pack && b.kind === 'lieu') {
      const l = (pack.lieux || [])[Number(b.index) || 0]; if (!l) return send(res, 400, { error: 'Lieu inconnu.' });
      url = await gen(lieuPrompt(l), false);
    } else if (pack && b.kind === 'objet') {
      const o = (pack.objets || [])[Number(b.index) || 0]; if (!o) return send(res, 400, { error: 'Objet inconnu.' });
      url = useOpenAI ? await openaiGenerate(objetPrompt(o), '1024x1024') : await generateImage(objetPrompt(o), '1:1');
    } else if (pack && b.kind === 'scene') {
      const i = Number(b.index) || 0; if (!pack.scenes || !pack.scenes[i]) return send(res, 400, { error: 'Scène inconnue.' });
      const refs = (Array.isArray(b.refs) ? b.refs : []).filter((r) => r && typeof r.url === 'string').slice(0, 6);
      const labels = refs.map((r, k) => `image ${k + 1} = ${r.label}`);
      // L'image que Grok va animer : en vraie 9:16 et en haute définition, c'est elle qui fixe la netteté du clip.
      const sp = scenePrompt(pack, i, labels);
      if (useOpenAI) url = refs.length ? await openaiEdit(refs.map((r) => r.url), sp, SCENE_SIZES, { quality: sceneQuality() }) : await openaiGenerate(sp, SCENE_SIZES, { quality: sceneQuality() });
      else url = refs.length ? await editImages(refs.map((r) => r.url), sp, '9:16') : await generateImage(sp, '9:16');
    } else if (b.kind === 'char') {
      const c = (p.cast || [])[Number(b.index) || 0]; if (!c) return send(res, 400, { error: 'Personnage inconnu.' });
      url = await gen(charPrompt(c), true);
    } else if (b.kind === 'back') {
      const c = (p.cast || [])[Number(b.index) || 0]; if (!c) return send(res, 400, { error: 'Personnage inconnu.' });
      const front = b.refs && b.refs[0] && b.refs[0].url;
      if (!front) return send(res, 400, { error: 'Image de face manquante.' });
      url = useOpenAI ? await openaiEdit([front], backPrompt(c), '1024x1536') : await editImages([front], backPrompt(c), '2:3');
    } else if (b.kind === 'set') {
      const s = planSets(p)[Number(b.index) || 0]; if (!s) return send(res, 400, { error: 'Décor inconnu.' });
      url = await gen(setPrompt(s), false);
    } else if (b.kind === 'key') {
      const refs = (Array.isArray(b.refs) ? b.refs : []).filter((r) => r && typeof r.url === 'string').slice(0, 5);
      if (!refs.length) return send(res, 400, { error: 'Aucune image de référence.' });
      const first = (p.shots && p.shots[0]) || {};
      const desc = refs.map((r, i) => `image ${i + 1} is ${r.label}`).join(', ');
      const prompt = `${LOOK} ${BIBLE} Opening frame of a vertical 9:16 soap-opera episode. Use the reference images: ${desc}. Place the characters inside the set, keeping each character's exact design, hair, clothes, colors and forehead price badge. Scene: ${first.videoPrompt || first.visual || p.logline || ''} Dramatic, beautiful cinematic composition, characters clearly visible and acting, no text.`;
      url = useOpenAI ? await openaiEdit(refs.map((r) => r.url), prompt, SCENE_SIZES, { quality: sceneQuality() }) : await editImages(refs.map((r) => r.url), prompt, '9:16');
    } else return send(res, 400, { error: 'Type d\'image inconnu.' });
    send(res, 200, { url, provider: useOpenAI ? 'openai' : 'xai' });
  } catch (e) {
    console.error('image', b.kind, e);
    const busy = /rate limit|too many|429/i.test(String(e.message));
    send(res, busy ? 429 : 502, { error: busy ? 'Trop d\'images demandées d\'un coup, nouvel essai…' : `Image non créée : ${e.message || e}`, code: busy ? 'rate_limited' : 'image_failed' });
  }
}
