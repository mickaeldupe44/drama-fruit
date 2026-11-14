// Outils partagés par les fonctions /api (mode test : un seul code d'accès, pas de base de données).
import crypto from 'node:crypto';

export const env = (k) => (process.env[k] || '').trim();

export function send(res, status, data) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).send(JSON.stringify(data));
}

export function tokenFor(code) {
  return crypto.createHmac('sha256', code).update('drama-fruit-test').digest('hex');
}

// Vérifie le jeton envoyé par le site (Authorization: Bearer ...). Renvoie true si OK.
export function authed(req) {
  const code = env('ACCESS_CODE');
  if (!code) return false;
  const h = String(req.headers.authorization || '');
  const t = h.startsWith('Bearer ') ? h.slice(7) : '';
  const good = tokenFor(code);
  return t.length === good.length && crypto.timingSafeEqual(Buffer.from(t), Buffer.from(good));
}

export function requireAuth(req, res) {
  if (authed(req)) return true;
  send(res, 401, { error: 'Connecte-toi pour continuer.', code: 'unauthorized' });
  return false;
}

export function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch { return {}; }
}

// Identifiant de tâche sans base de données : on encode les identifiants xAI dans l'id.
export const encodeJob = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
export function decodeJob(id) {
  try { return JSON.parse(Buffer.from(String(id || ''), 'base64url').toString('utf8')); } catch { return null; }
}

export const XAI_NATIVE_MAX = 15;
export const xaiModel = (m) => (m === 'grok-imagine-video-1.5-lite' ? 'grok-imagine-video-1.5-lite' : 'grok-imagine-video-1.5');
