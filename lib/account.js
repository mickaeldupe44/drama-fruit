// Les comptes : qui appelle, ce que sa formule autorise, et les débits de crédits.
// Mode test (pas de Supabase) : un seul code d'accès, tout est gratuit et illimité.
import { send, authed } from './common.js';
import { paid, userFromToken, rpc, count } from './store.js';
import { OFFER, SCENE_SECONDS, episodePrice, scenePrice, planRefusal } from './offer.js';

export { paid };

const fail = (status, code, message) => Object.assign(new Error(message), { status, code });
// Renvoie au site une erreur « prévue » (crédits, formule…) ; les autres remontent telles quelles.
export function sendFailure(res, e) {
  if (!e || !e.code) return false;
  send(res, e.status || 400, { error: e.message, code: e.code });
  return true;
}

// Qui appelle ? Répond 401 et renvoie null si personne n'est connecté.
export async function requireUser(req, res) {
  if (!paid()) {
    if (authed(req)) return { id: 'test', email: '', test: true };
    send(res, 401, { error: 'Connecte-toi pour continuer.', code: 'unauthorized' });
    return null;
  }
  const h = String(req.headers.authorization || '');
  const user = h.startsWith('Bearer ') ? await userFromToken(h.slice(7)) : null;
  if (!user) send(res, 401, { error: 'Connecte-toi pour continuer.', code: 'unauthorized' });
  return user;
}

// Le profil (formule, crédits). Il est créé à la première visite, avec les crédits de bienvenue.
export async function profile(user) {
  if (user.test) return { plan: 'studio', credits: 9999, admin: true };
  const d = await rpc('ensure_profile', { p_id: user.id, p_email: user.email, p_welcome: OFFER.plans.free.welcomeCredits || 0 });
  const p = Array.isArray(d) ? d[0] : d;
  if (!p || !p.id) throw new Error('Profil introuvable.');
  return p;
}
export const planOf = (p) => OFFER.plans[p.plan] || OFFER.plans.free;

// Débite « amount » crédits, une seule fois pour une même référence. Renvoie le solde (null en mode test ou pour un admin).
export async function spend(user, p, ref, amount, reason) {
  if (user.test || p.admin || amount <= 0) return null;
  const balance = await rpc('spend_once', { p_id: user.id, p_ref: ref, p_amount: amount, p_reason: reason });
  if (balance === -1) throw fail(402, 'insufficient_credits', `Il te manque des crédits : il en faut ${amount} et il t'en reste ${p.credits}.`);
  return balance;
}
export async function refund(userId, ref, amount, reason) {
  if (!userId || userId === 'test' || amount <= 0) return null;
  return rpc('grant_once', { p_id: userId, p_ref: ref, p_amount: amount, p_reason: reason });
}

const cleanId = (x) => String(x || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);

// Un épisode se paie en entier, une seule fois, au premier appel du tournage (image ou clip) : b.episode est son identifiant.
// Une scène refaite (b.redo) se paie à part. Renvoie le solde après débit, ou null si rien n'est facturé.
export async function chargeEpisode(user, b) {
  if (user.test) return null;
  const p = await profile(user);
  const pack = b.pack || {};
  const scenes = Array.isArray(pack.scenes) && pack.scenes.length ? pack.scenes.length : Math.round((Number(b.duration) || 0) / SCENE_SECONDS);
  const episode = cleanId(b.episode);
  if (!episode || !scenes) throw fail(400, 'bad_request', 'Recharge la page puis relance le tournage.');
  const what = { model: String(b.model || ''), scenes, hd: Boolean(b.hd) };
  const refusal = planRefusal(planOf(p), what);
  if (refusal) throw fail(403, 'plan_limit', refusal);
  if (b.redo) return spend(user, p, `refaire:${episode}:${cleanId(b.redo)}`, scenePrice(what), 'Scène refaite');
  const limit = planOf(p).dailyLimit;
  if (limit && !p.admin) {
    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    const already = await count('ledger', { user_id: `eq.${user.id}`, created_at: `gte.${today.toISOString()}`, and: `(ref.like.ep:*,ref.neq.ep:${episode})` });
    if (already >= limit) throw fail(403, 'daily_limit', `Ta formule permet ${limit} épisode${limit > 1 ? 's' : ''} par jour. Reviens demain, ou passe à la formule supérieure.`);
  }
  return spend(user, p, `ep:${episode}`, episodePrice(what), 'Épisode');
}

// Pour les fonctions de tournage : débite si besoin. Renvoie { ok: false } après avoir répondu au site en cas de refus.
export async function charged(res, user, b) {
  try { return { ok: true, balance: await chargeEpisode(user, b) }; }
  catch (e) {
    if (!sendFailure(res, e)) { console.error('débit', e); send(res, 502, { error: 'Le service de comptes ne répond pas, réessaie dans un instant.' }); }
    return { ok: false };
  }
}
