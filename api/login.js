import crypto from 'node:crypto';
import { env, send, body, tokenFor } from '../lib/common.js';

// Connexion de test : n'importe quel e-mail + le code d'accès (variable ACCESS_CODE sur Vercel).
export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST attendu.' });
  const code = env('ACCESS_CODE');
  const { email, password } = body(req);
  if (!code) return send(res, 500, { error: 'ACCESS_CODE manquant sur le serveur.' });
  // Comparaison à temps constant, et une seconde d'attente après un mauvais code : deviner le code à la chaîne devient très lent.
  const given = crypto.createHash('sha256').update(String(password || '')).digest(); const good = crypto.createHash('sha256').update(code).digest();
  if (!crypto.timingSafeEqual(given, good)) { await new Promise((ok) => setTimeout(ok, 1000)); return send(res, 400, { error: 'Code d\'accès incorrect.' }); }
  send(res, 200, { access_token: tokenFor(code), refresh_token: 'test', expires_in: 30 * 24 * 3600, user: { email: String(email || 'testeur') } });
}
