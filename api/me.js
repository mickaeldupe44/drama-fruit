import { send, requireAuth } from '../lib/common.js';

// Compte de test : administrateur, crédits illimités (rien n'est facturé pendant le test).
export default function handler(req, res) {
  if (!requireAuth(req, res)) return;
  send(res, 200, { email: 'testeur', admin: true, credits: 9999, plan: 'studio', planName: 'Studio (test)', subscription: false, test: true });
}
