import { env, send, body } from '../lib/common.js';
import { requireUser, profile, planOf, sendFailure } from '../lib/account.js';
import { select, insert, update, remove, count, uploadUrl, readUrl } from '../lib/store.js';
import { OFFER, episodePrice } from '../lib/offer.js';
import { stripe, stripeReady, checkoutParams } from '../lib/stripe.js';

// Tout ce qui touche au compte passe par cette seule fonction, car l'offre gratuite de Vercel en accepte 12 :
// /api/me et, grâce à la règle de vercel.json, /api/library, /api/characters, /api/checkout, /api/portal et /api/store.
const ROUTES = ['me', 'library', 'characters', 'checkout', 'portal', 'store'];
function routeOf(req) {
  const r = String((req.query && req.query.r) || '');
  if (ROUTES.includes(r)) return r;
  const m = /\/api\/([a-z]+)/.exec(String(req.url || ''));
  return m && ROUTES.includes(m[1]) ? m[1] : 'me';
}
const origin = (req) => (env('SITE_URL') || `https://${req.headers['x-forwarded-host'] || req.headers.host}`).replace(/\/$/, '');
const cleanId = (x) => String(x || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
const bad = (status, code, message) => Object.assign(new Error(message), { status, code });

// Compte de test : administrateur, crédits illimités, rien n'est facturé ni gardé sur le serveur.
function testAccount(route, res) {
  if (route === 'me') return send(res, 200, { email: 'testeur', admin: true, credits: 9999, plan: 'studio', planName: 'Studio (test)', subscription: false, test: true, items: [] });
  if (route === 'library' || route === 'characters') return send(res, 200, { items: [] });
  return send(res, 400, { error: 'Le paiement et la vidéothèque en ligne ne sont pas activés sur cette version de test.', code: 'test_mode' });
}

async function me(user, res) {
  const p = await profile(user); const plan = planOf(p);
  send(res, 200, { email: user.email, admin: p.admin, credits: p.credits, plan: plan.id, planName: plan.name, perks: plan, subscription: Boolean(p.stripe_subscription), items: [] });
}

async function library(req, res, user) {
  const mine = { user_id: `eq.${user.id}` };
  if (req.method === 'GET') {
    const rows = await select('episodes', { ...mine, order: 'created_at.desc', limit: 60 });
    const items = await Promise.all(rows.map(async (e, k) => {
      const segments = Array.isArray(e.segments) ? e.segments : [];
      let stored = null; if (e.stored_path && k < 24) { try { stored = await readUrl(e.stored_path); } catch { stored = null; } }
      return { id: e.job || e.id, episode: e.id, title: e.title, model: e.model, duration: e.duration, cost: e.cost, resolution: e.resolution, status: 'done', stored: Boolean(stored), outputUrl: stored || segments[0] || null, segments, plan: e.plan, check: e.verdict, createdAt: e.created_at };
    }));
    return send(res, 200, { items });
  }
  if (req.method === 'DELETE') { await remove('episodes', { ...mine, id: `eq.${cleanId(req.query.id)}` }); return send(res, 200, { ok: true }); }
  const b = body(req); const id = cleanId(b.episode);
  if (!id) throw bad(400, 'bad_request', 'Épisode sans identifiant.');
  const found = await select('episodes', { id: `eq.${id}`, select: 'id,user_id' });
  if (found[0] && found[0].user_id !== user.id) throw bad(403, 'forbidden', 'Cet épisode appartient à un autre compte.');
  if (JSON.stringify(b.plan || null).length > 300000 || JSON.stringify(b.check || null).length > 60000) throw bad(413, 'too_large', 'Épisode trop volumineux pour être gardé.');
  if (!found[0] && (await count('episodes', mine)) >= 500) throw bad(403, 'plan_limit', 'Ta vidéothèque est pleine : supprime d\'anciens épisodes.');
  const scenes = Array.isArray(b.segments) ? b.segments.length : 0;
  const row = {
    title: String(b.title || 'Épisode').slice(0, 200), job: String(b.job || '').slice(0, 4000) || null, model: String(b.model || '').slice(0, 60), duration: Number(b.duration) || scenes * 6,
    resolution: String(b.resolution || '').slice(0, 10) || null, segments: (b.segments || []).map(String).slice(0, 13), plan: b.plan || null, verdict: b.check || null,
    cost: scenes && OFFER.modelCredits[b.model] ? episodePrice({ model: b.model, scenes, hd: b.resolution === '1080p' }) : 0,
    // Vidéo montée gardée : le chemin est calculé ici, jamais reçu du navigateur.
    ...(b.stored ? { stored_path: `${user.id}/${id}.mp4` } : {}),
  };
  if (found[0]) await update('episodes', { id: `eq.${id}`, ...mine }, row); else await insert('episodes', { id, user_id: user.id, ...row }, 'return=minimal');
  send(res, 200, { ok: true });
}

async function characters(req, res, user) {
  const mine = { user_id: `eq.${user.id}` };
  if (req.method === 'GET') {
    const rows = await select('characters', { ...mine, order: 'created_at.desc', limit: 40 });
    return send(res, 200, { items: rows.map((c) => ({ id: c.id, name: c.name, image_data: c.image })) });
  }
  if (req.method === 'DELETE') { await remove('characters', { ...mine, id: `eq.${cleanId(req.query.id)}` }); return send(res, 200, { ok: true }); }
  const b = body(req); const name = String(b.name || '').trim().slice(0, 60); const image = String(b.imageDataUrl || '');
  if (!name || !/^data:image\//.test(image) || image.length > 900000) throw bad(400, 'bad_request', 'Il faut un nom et une image (moins de 600 Ko).');
  const max = planOf(await profile(user)).characters || 0;
  if ((await count('characters', mine)) >= max) throw bad(403, 'plan_limit', max ? `Ta formule garde ${max} personnage${max > 1 ? 's' : ''}. Retires-en un, ou change de formule.` : 'Les personnages enregistrés font partie des formules Pro et Studio.');
  await insert('characters', { user_id: user.id, name, image }, 'return=minimal');
  send(res, 200, { ok: true });
}

async function checkout(req, res, user) {
  if (!stripeReady()) throw bad(503, 'payment_off', 'Le paiement n\'est pas encore activé.');
  const b = body(req); const kind = b.kind === 'pack' ? 'pack' : 'plan';
  const item = kind === 'pack' ? OFFER.packs[b.id] : OFFER.plans[b.id];
  if (!item || !(item.price > 0)) throw bad(400, 'bad_request', 'Offre inconnue.');
  const p = await profile(user);
  // Déjà abonné : on change de formule dans le portail Stripe, pour ne jamais payer deux abonnements.
  if (kind === 'plan' && p.stripe_subscription && p.stripe_customer) return portal(req, res, user, p);
  const s = await stripe('checkout/sessions', checkoutParams({ kind, item, user, customer: p.stripe_customer, origin: origin(req) }));
  send(res, 200, { url: s.url });
}

async function portal(req, res, user, known) {
  if (!stripeReady()) throw bad(503, 'payment_off', 'Le paiement n\'est pas encore activé.');
  const p = known || await profile(user);
  if (!p.stripe_customer) throw bad(400, 'no_customer', 'Tu n\'as pas encore d\'abonnement à gérer.');
  const s = await stripe('billing_portal/sessions', { customer: p.stripe_customer, return_url: `${origin(req)}/#compte` });
  send(res, 200, { url: s.url });
}

// Adresse où le navigateur dépose la vidéo montée, pour la garder dans la vidéothèque.
async function store(req, res, user) {
  const id = cleanId(body(req).episode);
  if (!planOf(await profile(user)).library) throw bad(403, 'plan_limit', 'La vidéothèque permanente fait partie des formules payantes.');
  const found = await select('episodes', { id: `eq.${id}`, user_id: `eq.${user.id}`, select: 'id' });
  if (!id || !found[0]) throw bad(404, 'not_found', 'Épisode introuvable.');
  send(res, 200, { url: await uploadUrl(`${user.id}/${id}.mp4`) });
}

export default async function handler(req, res) {
  const user = await requireUser(req, res); if (!user) return;
  const route = routeOf(req);
  if (user.test) return testAccount(route, res);
  try {
    if (route === 'me') return await me(user, res);
    if (route === 'library') return await library(req, res, user);
    if (route === 'characters') return await characters(req, res, user);
    if (route !== 'me' && req.method !== 'POST') return send(res, 405, { error: 'POST attendu.' });
    if (route === 'checkout') return await checkout(req, res, user);
    if (route === 'portal') return await portal(req, res, user);
    return await store(req, res, user);
  } catch (e) {
    if (sendFailure(res, e)) return;
    console.error('compte', route, e);
    send(res, 502, { error: 'Le service de comptes ne répond pas, réessaie dans un instant.' });
  }
}
