import { env, send, body, xaiModel, videoResolution } from '../lib/common.js';
import { requireUser, charged, recordClip } from '../lib/account.js';
import { clipPrompt } from '../lib/pack.js';
import { submitVideo } from '../lib/xai.js';

// Étape 3 : un clip Grok de 6 s pour UNE scène du PACK, à partir de son image de départ.
const isImg = (u) => typeof u === 'string' && (/^https:\/\//.test(u) || u.startsWith('data:image/'));

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST attendu.' });
  const user = await requireUser(req, res); if (!user) return;
  const key = env('XAI_API_KEY');
  if (!key) return send(res, 500, { error: 'Clé XAI_API_KEY manquante sur le serveur.' });
  const b = body(req); const pack = b.pack || {}; const i = Number(b.index) || 0;
  // Mode payant : l'épisode se paie une seule fois, au premier appel de son tournage.
  const bill = await charged(res, user, b, b.redo ? null : 'clip'); if (!bill.ok) return;
  if (!pack.scenes || !pack.scenes[i]) return send(res, 400, { error: 'Scène inconnue.' });
  const model = xaiModel(b.model);
  const full = model === 'grok-imagine-video-1.5';
  const payload = { model, duration: Math.max(4, Math.min(15, Number(pack.scenes[i].duree) || 6)), aspect_ratio: '9:16' };
  if (isImg(b.image)) payload.image = { url: b.image };
  const refs = full ? (Array.isArray(b.refs) ? b.refs : []).filter((r) => r && isImg(r.url)).slice(0, 6) : [];
  const offset = payload.image ? 1 : 0;
  if (refs.length) payload.reference_images = refs.map((r) => ({ url: r.url }));
  // La netteté : sans « resolution », Grok tourne en 480p. Avec les feuilles de personnages, 720p est le maximum de xAI.
  // On décide d'après le modèle et non d'après cette scène : toutes les scènes d'un épisode doivent avoir la même taille
  // pour le montage, même celle qui n'a aucune feuille à joindre.
  payload.resolution = videoResolution({ refs: full, hd: Boolean(b.hd) });
  payload.prompt = clipPrompt(pack, i, refs.map((r, k) => `<IMAGE_${k + offset}> is ${r.label}`));
  try {
    const d = await submitVideo(payload);
    await recordClip(user, d.requestId, bill.price);
    send(res, 200, { requestId: d.requestId, resolution: d.resolution });
  } catch (e) {
    if (e.status) return send(res, e.status === 429 ? 429 : 502, { error: `Grok a refusé la scène ${i + 1} : ${e.message}`, code: e.status === 429 ? 'rate_limited' : 'clip_failed' });
    console.error('clip', e);
    send(res, 502, { error: `Grok injoignable pour la scène ${i + 1}.` });
  }
}
