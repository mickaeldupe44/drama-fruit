// Les comptes : qui appelle, ce que sa formule autorise, les débits de crédits et les garde-fous contre les abus.
// Mode test (pas de Supabase) : un seul code d'accès, tout est gratuit et illimité.
import { send, authed } from './common.js';
import { paid, userFromToken, rpc, select, count } from './store.js';
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
  if (!user) { send(res, 401, { error: 'Connecte-toi pour continuer.', code: 'unauthorized' }); return null; }
  // Un compte dont l'e-mail n'est pas confirmé ne reçoit rien : c'est ce qui limite les comptes créés à la chaîne.
  if (!user.confirmed) { send(res, 403, { error: 'Confirme ton adresse e-mail (lien reçu à l\'inscription) pour continuer.', code: 'unconfirmed' }); return null; }
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

// Compteur d'usage : refuse au-delà de « max » pour une même clé. C'est ce qui empêche de faire tourner cent clips
// ou d'écrire mille scénarios avec un seul paiement.
export async function limit(user, p, key, max, message) {
  if (user.test || p.admin) return;
  const ok = await rpc('bump', { p_id: user.id, p_key: key, p_max: max });
  if (ok === false) throw fail(429, 'rate_limited', message);
}
const today = () => new Date().toISOString().slice(0, 10);
// Écrire, relire ou vérifier un scénario est gratuit, mais pas illimité : chaque appel coûte de l'argent au site.
export async function limitWriting(user) {
  if (user.test) return;
  await limit(user, await profile(user), `ia:${today()}`, 120, 'Tu as beaucoup sollicité l\'IA aujourd\'hui. Reviens demain.');
}

const cleanId = (x) => String(x || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);

// Un épisode se paie en entier, une seule fois, au premier appel de son tournage (image ou clip) : b.episode est son
// identifiant. Si un appel suivant demande plus que ce qui a été payé (plus de scènes, un modèle plus cher, la HD),
// la différence est débitée. Une scène refaite (b.redo) se paie à part.
// « use » vaut 'img' ou 'clip' : le nombre d'images et de clips par épisode est plafonné.
export async function chargeEpisode(user, b, use) {
  if (user.test) return { balance: null, price: 0 };
  const p = await profile(user);
  const pack = b.pack || {};
  const scenes = Array.isArray(pack.scenes) && pack.scenes.length ? pack.scenes.length : Math.round((Number(b.duration) || 0) / SCENE_SECONDS);
  const episode = cleanId(b.episode);
  if (!episode || !scenes) throw fail(400, 'bad_request', 'Recharge la page puis relance le tournage.');
  const what = { model: String(b.model || ''), scenes, hd: Boolean(b.hd) };
  const refusal = planRefusal(planOf(p), what);
  if (refusal) throw fail(403, 'plan_limit', refusal);
  const one = scenePrice(what);
  if (b.redo) return { balance: await spend(user, p, `refaire:${episode}:${cleanId(b.redo)}`, one, 'Scène refaite'), price: one };
  const price = episodePrice(what);
  let balance = null;
  if (!p.admin) {
    const rows = await select('ledger', { user_id: `eq.${user.id}`, ref: `like.ep:${episode}*`, select: 'delta' });
    const already = -rows.reduce((n, r) => n + (Number(r.delta) || 0), 0);
    if (!rows.length) {
      const max = planOf(p).dailyLimit;
      if (max) {
        const start = new Date(); start.setUTCHours(0, 0, 0, 0);
        const done = await count('ledger', { user_id: `eq.${user.id}`, created_at: `gte.${start.toISOString()}`, and: `(ref.like.ep:*,ref.not.like.*:plus:*)` });
        if (done >= max) throw fail(403, 'daily_limit', `Ta formule permet ${max} épisode${max > 1 ? 's' : ''} par jour. Reviens demain, ou passe à la formule supérieure.`);
      }
      balance = await spend(user, p, `ep:${episode}`, price, 'Épisode');
    } else if (price > already) {
      balance = await spend(user, p, `ep:${episode}:plus:${price}`, price - already, 'Épisode (complément)');
    }
  }
  if (use === 'img') await limit(user, p, `img:${episode}`, 20 + 3 * scenes, 'Trop d\'images demandées pour cet épisode. Lance un nouvel épisode.');
  if (use === 'clip') await limit(user, p, `clip:${episode}`, 2 * scenes + 2, 'Trop de scènes tournées pour cet épisode. Utilise « Refaire » ou lance un nouvel épisode.');
  return { balance, price: one };
}

// Pour les fonctions de tournage : débite et compte. Renvoie { ok: false } après avoir répondu au site en cas de refus.
export async function charged(res, user, b, use) {
  try { return { ok: true, ...(await chargeEpisode(user, b, use)) }; }
  catch (e) {
    if (!sendFailure(res, e)) { console.error('débit', e); send(res, 502, { error: 'Le service de comptes ne répond pas, réessaie dans un instant.' }); }
    return { ok: false };
  }
}

// Chaque clip accepté par Grok est noté avec le prix payé pour lui : c'est la seule base d'un remboursement.
export async function recordClip(user, requestId, price) {
  if (user.test || !requestId) return;
  try { await rpc('grant_once', { p_id: user.id, p_ref: `clip:${requestId}`, p_amount: 0, p_reason: String(price || 0) }); }
  catch (e) { console.error('note du clip', e); }
}
// Rembourse les clips que Grok n'a pas livrés : seulement ceux notés pour ce compte, au prix noté, une seule fois.
export async function refundClips(user, requestIds) {
  if (user.test || !requestIds.length) return;
  const ids = requestIds.map(cleanId).filter(Boolean);
  const rows = await select('ledger', { user_id: `eq.${user.id}`, ref: `in.(${ids.map((id) => `"clip:${id}"`).join(',')})`, select: 'ref,reason' });
  await Promise.all(rows.map((r) => {
    const amount = Math.max(0, Math.round(Number(r.reason) || 0));
    return amount ? rpc('grant_once', { p_id: user.id, p_ref: `rembourse:${r.ref.slice(5)}`, p_amount: amount, p_reason: 'Scène non livrée' }) : null;
  }));
}

// Crédite un compte une seule fois par référence (achats Stripe).
export async function grant(userId, ref, amount, reason) {
  if (!userId || amount <= 0) return null;
  return rpc('grant_once', { p_id: userId, p_ref: ref, p_amount: amount, p_reason: reason });
}
