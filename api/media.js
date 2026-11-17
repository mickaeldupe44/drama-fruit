import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { env, send, tokenFor } from '../lib/common.js';
import { paid, userFromToken } from '../lib/store.js';

// Relais des vidéos/images Grok sur notre propre domaine, pour que la couverture TikTok puisse lire l'image.
const okToken = (t) => { const code = env('ACCESS_CODE'); if (!code || typeof t !== 'string') return false; const g = tokenFor(code); return t.length === g.length && crypto.timingSafeEqual(Buffer.from(t), Buffer.from(g)); };
const privateHost = (h) => /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|\[)/i.test(h) || !h.includes('.');

export default async function handler(req, res) {
  const h = String(req.headers.authorization || '');
  const token = h.startsWith('Bearer ') ? h.slice(7) : req.query.t;
  // Mode payant : le jeton de connexion du site ; mode test : le jeton du code d'accès.
  const allowed = paid() ? Boolean(token && await userFromToken(String(token))) : okToken(token);
  if (!allowed) return send(res, 401, { error: 'Connecte-toi pour continuer.' });
  let u; try { u = new URL(String(req.query.u || '')); } catch { return send(res, 400, { error: 'Adresse invalide.' }); }
  if (u.protocol !== 'https:' || privateHost(u.hostname)) return send(res, 400, { error: 'Adresse refusée.' });
  try {
    const up = await fetch(u, { headers: req.headers.range ? { Range: req.headers.range } : {} });
    const type = up.headers.get('content-type') || '';
    if (!up.ok || !/^(video|image)\/|octet-stream/.test(type)) return send(res, 502, { error: `Média indisponible (${up.status}).` });
    res.statusCode = up.status;
    for (const k of ['content-type', 'content-length', 'content-range', 'accept-ranges']) { const v = up.headers.get(k); if (v) res.setHeader(k, v); }
    res.setHeader('Cache-Control', 'private, max-age=3600');
    Readable.fromWeb(up.body).pipe(res);
  } catch (e) {
    console.error('media', e);
    send(res, 502, { error: 'Média injoignable.' });
  }
}
