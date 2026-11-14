// Appels xAI (Grok Imagine) pour les images.
import { env } from './common.js';

export const IMAGE_MODEL = () => env('XAI_IMAGE_MODEL') || 'grok-imagine-image-2.0';

function pickUrl(d) {
  const x = (d && Array.isArray(d.data) && d.data[0]) || d || {};
  if (x.url) return x.url;
  if (x.b64_json) return `data:image/png;base64,${x.b64_json}`;
  return null;
}

async function call(path, payload) {
  const r = await fetch(`https://api.x.ai/v1/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env('XAI_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((d.error && (d.error.message || d.error)) || d.message || `xAI ${r.status}`);
  const url = pickUrl(d);
  if (!url) throw new Error('xAI n\'a pas renvoyé d\'image');
  return url;
}

export const generateImage = (prompt, aspectRatio) =>
  call('images/generations', { model: IMAGE_MODEL(), prompt: prompt.slice(0, 3800), n: 1, aspect_ratio: aspectRatio });

export const editImages = (urls, prompt, aspectRatio) =>
  call('images/edits', { model: IMAGE_MODEL(), prompt: prompt.slice(0, 3800), images: urls.slice(0, 5).map((url) => ({ type: 'image_url', url })), aspect_ratio: aspectRatio });
