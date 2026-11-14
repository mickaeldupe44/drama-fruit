import { env, send, body, requireAuth, xaiModel } from '../lib/common.js';
import { clipPrompt } from '../lib/pack.js';

// Étape 3 : un clip Grok de 6 s pour UNE scène du PACK, à partir de son image de départ.
const isImg = (u) => typeof u === 'string' && (/^https:\/\//.test(u) || u.startsWith('data:image/'));

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST attendu.' });
  if (!requireAuth(req, res)) return;
  const key = env('XAI_API_KEY');
  if (!key) return send(res, 500, { error: 'Clé XAI_API_KEY manquante sur le serveur.' });
  const b = body(req); const pack = b.pack || {}; const i = Number(b.index) || 0;
  if (!pack.scenes || !pack.scenes[i]) return send(res, 400, { error: 'Scène inconnue.' });
  const model = xaiModel(b.model);
  const full = model === 'grok-imagine-video-1.5';
  const payload = { model, duration: Math.max(4, Math.min(15, Number(pack.scenes[i].duree) || 6)), aspect_ratio: '9:16' };
  if (isImg(b.image)) payload.image = { url: b.image };
  const refs = full ? (Array.isArray(b.refs) ? b.refs : []).filter((r) => r && isImg(r.url)).slice(0, 6) : [];
  const offset = payload.image ? 1 : 0;
  if (refs.length) payload.reference_images = refs.map((r) => ({ url: r.url }));
  payload.prompt = clipPrompt(pack, i, refs.map((r, k) => `<IMAGE_${k + offset}> is ${r.label}`));
  try {
    const r = await fetch('https://api.x.ai/v1/videos/generations', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.request_id) {
      const msg = (d.error && (d.error.message || d.error)) || d.message || `xAI ${r.status}`;
      return send(res, r.status === 429 ? 429 : 502, { error: `Grok a refusé la scène ${i + 1} : ${msg}`, code: r.status === 429 ? 'rate_limited' : 'clip_failed' });
    }
    send(res, 200, { requestId: d.request_id });
  } catch (e) {
    console.error('clip', e);
    send(res, 502, { error: `Grok injoignable pour la scène ${i + 1}.` });
  }
}
