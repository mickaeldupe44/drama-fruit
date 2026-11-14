import { send, requireAuth } from '../lib/common.js';

// Pas de base de données pendant le test : la bibliothèque reste vide.
export default function handler(req, res) {
  if (!requireAuth(req, res)) return;
  send(res, 200, { items: [] });
}
