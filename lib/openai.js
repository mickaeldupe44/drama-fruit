// Images OpenAI (GPT Image). Renvoie des images JPEG en data URI (pas de stockage nécessaire).
import { env } from './common.js';

const MODELS = () => [env('OPENAI_IMAGE_MODEL'), 'gpt-image-2', 'gpt-image-1.5'].filter(Boolean);
const QUALITY = () => env('OPENAI_IMAGE_QUALITY') || 'medium';

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
  if (!r.ok) throw new Error((d.error && (d.error.message || d.error)) || `OpenAI ${r.status}`);
  return toDataUrl(d);
}

export const openaiGenerate = (prompt, size) => withModels(async (model) => check(await fetch('https://api.openai.com/v1/images/generations', {
  method: 'POST',
  headers: { Authorization: `Bearer ${env('OPENAI_API_KEY')}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ model, prompt: prompt.slice(0, 3900), n: 1, size, quality: QUALITY(), output_format: 'jpeg', output_compression: 75 }),
})));

function dataUrlToBlob(u) {
  const m = /^data:([^;]+);base64,(.*)$/.exec(u || '');
  if (!m) return null;
  return new Blob([Buffer.from(m[2], 'base64')], { type: m[1] });
}

export const openaiEdit = (dataUrls, prompt, size) => withModels(async (model) => {
  const fd = new FormData();
  fd.append('model', model); fd.append('prompt', prompt.slice(0, 3900)); fd.append('size', size);
  fd.append('quality', QUALITY()); fd.append('output_format', 'jpeg'); fd.append('output_compression', '75');
  dataUrls.slice(0, 8).forEach((u, i) => { const b = dataUrlToBlob(u); if (b) fd.append('image[]', b, `ref${i}.jpg`); });
  return check(await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${env('OPENAI_API_KEY')}` }, body: fd }));
});
