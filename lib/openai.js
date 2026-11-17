// Images OpenAI (GPT Image). Renvoie des images JPEG en data URI (pas de stockage nécessaire).
import { env } from './common.js';

const MODELS = () => [env('OPENAI_IMAGE_MODEL'), 'gpt-image-2', 'gpt-image-1.5'].filter(Boolean);
const QUALITY = () => env('OPENAI_IMAGE_QUALITY') || 'medium';
// Compression JPEG des images rendues par OpenAI (100 = la moins compressée). À 75, l'image de départ arrivait déjà abîmée chez Grok.
const COMPRESSION = () => { const n = Number(env('OPENAI_IMAGE_COMPRESSION')); return n >= 50 && n <= 100 ? Math.round(n) : 90; };
// Image de départ des scènes : une vraie image verticale 9:16 en haute définition (gpt-image-2 accepte les tailles sur mesure),
// sinon le portrait classique 2:3. La qualité de ces images-là se règle à part avec OPENAI_SCENE_QUALITY (low, medium, high).
export const SCENE_SIZES = ['1152x2048', '1024x1536'];
export const sceneQuality = () => env('OPENAI_SCENE_QUALITY') || QUALITY();

function toDataUrl(d) {
  const x = d && Array.isArray(d.data) && d.data[0];
  if (x && x.b64_json) return `data:image/jpeg;base64,${x.b64_json}`;
  if (x && x.url) return x.url;
  throw new Error('OpenAI n\'a pas renvoyé d\'image');
}

async function withModels(fn) {
  let last;
  for (const model of Array.from(new Set(MODELS()))) {
    try { return await fn(model); } catch (e) { last = e; if (!/model|not found|does not exist|unsupported/i.test(String(e.message))) throw e; }
  }
  throw last;
}

async function check(r) {
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error((d.error && (d.error.message || d.error)) || `OpenAI ${r.status}`); e.status = r.status; e.param = d.error && d.error.param; throw e; }
  return toDataUrl(d);
}

// « size » peut être une liste de tailles par ordre de préférence : si OpenAI refuse la première (modèle qui ne fait que les
// tailles classiques), on essaie la suivante au lieu de rater l'image.
async function withSizes(size, fn) {
  const sizes = [].concat(size); let last;
  for (const s of sizes) {
    try { return await fn(s); }
    catch (e) { last = e; if (!(e.param === 'size' || /size|dimension|pixel|\d{3,4}x\d{3,4}/i.test(String(e.message)))) throw e; }
  }
  throw last;
}

export const openaiGenerate = (prompt, size, opts = {}) => withSizes(size, (sz) => withModels(async (model) => check(await fetch('https://api.openai.com/v1/images/generations', {
  method: 'POST',
  headers: { Authorization: `Bearer ${env('OPENAI_API_KEY')}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ model, prompt: prompt.slice(0, 3900), n: 1, size: sz, quality: opts.quality || QUALITY(), output_format: 'jpeg', output_compression: COMPRESSION() }),
}))));

function dataUrlToBlob(u) {
  const m = /^data:([^;]+);base64,(.*)$/.exec(u || '');
  if (!m) return null;
  return new Blob([Buffer.from(m[2], 'base64')], { type: m[1] });
}

export const openaiEdit = (dataUrls, prompt, size, opts = {}) => withSizes(size, (sz) => withModels(async (model) => {
  const fd = new FormData();
  fd.append('model', model); fd.append('prompt', prompt.slice(0, 3900)); fd.append('size', sz);
  fd.append('quality', opts.quality || QUALITY()); fd.append('output_format', 'jpeg'); fd.append('output_compression', String(COMPRESSION()));
  dataUrls.slice(0, 8).forEach((u, i) => { const b = dataUrlToBlob(u); if (b) fd.append('image[]', b, `ref${i}.jpg`); });
  return check(await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${env('OPENAI_API_KEY')}` }, body: fd }));
}));
