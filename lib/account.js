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
// Écrire, relire et vérifier un scénario fait travailler l'IA, donc coûte de l'argent au site à chaque appel
// (relevé le 17 novembre 2026 : environ 0,13 $ pour écrire 72 s, 0,07 $ pour relire, quelques centimes pour vérifier un épisode filmé).
// Chaque formule en offre un nombre par mois, compté à part pour chaque usage, sinon tout le quota pourrait partir
// dans l'usage le plus cher. Au-delà, l'appel coûte quelques crédits, plus que son prix de revient.
// Sans abonnement, ce nombre est offert une seule fois et non chaque mois : un compte gratuit ne peut donc pas coûter
// plus que son cadeau de bienvenue. Renvoie le solde si des crédits ont été débités, sinon null.
export const AI_USES = {
  ecrire: { extra: 3, quota: (credits) => Math.max(4, Math.floor(credits / 25)), label: 'écrire un scénario' },
  relire: { extra: 2, quota: (credits) => Math.max(4, Math.floor(credits / 25)), label: 'relire un scénario' },
  verifier: { extra: 2, quota: (credits) => Math.max(6, Math.floor(credits / 12)), label: 'vérifier un épisode' },
};
export async function limitWriting(user, kind, known) {
  if (user.test) return null;
  const p = known || await profile(user);
  if (p.admin) return null;
  const use = AI_USES[kind];
  if (!use) throw new Error('usage IA inconnu : ' + kind);
  const credits = planOf(p).monthlyCredits || 0;
  const period = credits > 0 ? new Date().toISOString().slice(0, 7) : 'offert';
  const free = await rpc('bump', { p_id: user.id, p_key: `ia:${kind}:${period}`, p_max: use.quota(credits) });
  if (free !== false) return null;
  const ref = `ia:${kind}:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const balance = await rpc('spend_once', { p_id: user.id, p_ref: ref, p_amount: use.extra, p_reason: `Au-delà du nombre offert : ${use.label}` });
  if (balance === -1) throw fail(402, 'insufficient_credits', `${credits > 0 ? 'Le nombre offert ce mois-ci est atteint' : 'Tes essais offerts sont utilisés'} : ${use.label} coûte maintenant ${use.extra} crédits.`);
  return balance;
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
  if (b.redo) {
    // Une scène refaite se paie une fois et donne droit à un clip. Le même clic rejoué n'est pas débité une 2e fois,
    // et on tolère un second appel (nouvel essai après un refus de Grok), jamais plus : sinon un seul paiement
    // suffirait à tourner des clips sans fin.
    const id = cleanId(b.redo);
    const balance = await spend(user, p, `refaire:${episode}:${id}`, one, 'Scène refaite');
    await limit(user, p, `refaire:${use === 'img' ? 'img' : 'clip'}:${episode}:${id}`, 2, 'Cette scène vient d\'être refaite. Clique de nouveau sur « Refaire » pour un nouvel essai.');
    return { balance, price: one };
  }
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
  if (use === 'img') await limit(user, p, `img:${episode}`, 14 + 2 * scenes, 'Trop d\'images demandées pour cet épisode. Lance un nouvel épisode.');
  // Les images de scène sont les plus grandes, donc les plus chères : une par scène, plus quelques nouveaux essais.
  if (use === 'img' && (b.kind === 'scene' || b.kind === 'key')) await limit(user, p, `grande:${episode}`, scenes + Math.max(2, Math.round(scenes / 2)), 'Trop d\'images de scène demandées pour cet épisode. Lance un nouvel épisode.');
  // L'ancien tournage en un seul appel lance tous les clips de l'épisode d'un coup : un appel, plus un nouvel essai.
  if (use === 'gen') await limit(user, p, `gen:${episode}`, 2, 'Cet épisode a déjà été tourné. Lance un nouvel épisode.');
  // Un clip par scène, plus une petite marge pour les nouveaux essais : chaque clip en trop coûterait plus que l'épisode ne rapporte.
  if (use === 'clip') await limit(user, p, `clip:${episode}`, scenes + Math.max(1, Math.round(scenes / 4)), 'Trop de scènes tournées pour cet épisode. Utilise « Refaire » ou lance un nouvel épisode.');
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
// Seuls les clips payés sont remboursables : un par scène de l'épisode, un seul par scène refaite, un seul tournage
// pour l'ancien mode en un appel. Les clips en plus (nouveaux essais) ne le sont pas, sinon des échecs provoqués
// rapporteraient plus de crédits que l'épisode n'en a coûté. À appeler une fois le clip accepté par Grok.
export async function refundable(user, b, use) {
  if (user.test) return false;
  const pack = b.pack || {};
  const scenes = Array.isArray(pack.scenes) && pack.scenes.length ? pack.scenes.length : Math.round((Number(b.duration) || 0) / SCENE_SECONDS);
  const episode = cleanId(b.episode);
  const [key, max] = use === 'gen' ? [`paye:gen:${episode}`, 1] : (b.redo ? [`paye:${episode}:${cleanId(b.redo)}`, 1] : [`paye:${episode}`, scenes]);
  try { return (await rpc('bump', { p_id: user.id, p_key: key, p_max: max })) !== false; }
  catch (e) { console.error('compteur des remboursements', e); return false; }
}
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
