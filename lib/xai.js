// Appels xAI (Grok Imagine) : images, et envoi des vidéos.
import { env, VIDEO_RESOLUTIONS } from './common.js';

export const IMAGE_MODEL = () => env('XAI_IMAGE_MODEL') || 'grok-imagine-image-2.0';
// Netteté des images Grok. Sans ces deux réglages, xAI rend en 1K et en qualité « low » pour une image créée de zéro.
// XAI_IMAGE_RESOLUTION = 1k, 1.5k ou 2k (2k par défaut) ; XAI_IMAGE_QUALITY = low, medium ou auto (medium par défaut).
const pick = (name, allowed, fallback) => { const v = env(name).toLowerCase(); return allowed.includes(v) ? v : fallback; };
export const imageExtras = () => ({ resolution: pick('XAI_IMAGE_RESOLUTION', ['1k', '1.5k', '2k'], '2k'), quality: pick('XAI_IMAGE_QUALITY', ['low', 'medium', 'auto'], 'medium') });
const errorText = (d, status) => String((d && d.error && (d.error.message || d.error)) || (d && d.message) || `xAI ${status}`);

function pickUrl(d) {
  const x = (d && Array.isArray(d.data) && d.data[0]) || d || {};
  if (x.url) return x.url;
  if (x.b64_json) return `data:image/png;base64,${x.b64_json}`;
  return null;
}

async function post(path, payload) {
  const r = await fetch(`https://api.x.ai/v1/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env('XAI_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(errorText(d, r.status)); e.status = r.status; throw e; }
  const url = pickUrl(d);
  if (!url) throw new Error('xAI n\'a pas renvoyé d\'image');
  return url;
}

// On demande la meilleure netteté ; si xAI refuse justement ces réglages (modèle qui ne les connaît pas), on redemande sans eux
// plutôt que de rater l'image.
async function call(path, payload) {
  try { return await post(path, { ...payload, ...imageExtras() }); }
  catch (e) {
    if (e.status !== 400 || !/resolution|quality/i.test(String(e.message))) throw e;
    return post(path, payload);
  }
}

// Envoi d'une vidéo à Grok. Si xAI refuse la résolution demandée (ce mode ou ce compte ne la propose pas), on descend d'un cran
// au lieu d'échouer : 1080p → 720p → 480p. Renvoie l'identifiant de la demande et la résolution réellement acceptée.
export async function submitVideo(payload) {
  let p = { ...payload };
  for (;;) {
    const r = await fetch('https://api.x.ai/v1/videos/generations', {
      method: 'POST', headers: { Authorization: `Bearer ${env('XAI_API_KEY')}`, 'Content-Type': 'application/json' }, body: JSON.stringify(p),
    });
    const d = await r.json().catch(() => ({}));
    if (r.ok && d.request_id) return { requestId: d.request_id, resolution: p.resolution || '480p' };
    const message = errorText(d, r.status);
    const lower = VIDEO_RESOLUTIONS[VIDEO_RESOLUTIONS.indexOf(p.resolution) + 1];
    if (r.status === 400 && p.resolution && lower && /resolution|1080p|720p/i.test(message)) { p = { ...p, resolution: lower }; continue; }
    const e = new Error(message); e.status = r.status; throw e;
  }
}

export const generateImage = (prompt, aspectRatio) =>
  call('images/generations', { model: IMAGE_MODEL(), prompt: prompt.slice(0, 3800), n: 1, aspect_ratio: aspectRatio });

export const editImages = (urls, prompt, aspectRatio) =>
  call('images/edits', { model: IMAGE_MODEL(), prompt: prompt.slice(0, 3800), images: urls.slice(0, 5).map((url) => ({ type: 'image_url', url })), aspect_ratio: aspectRatio });
