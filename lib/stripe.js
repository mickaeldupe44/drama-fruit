// Stripe, appelé en HTTP (pas de bibliothèque) : page de paiement, portail client et vérification des notifications.
import crypto from 'node:crypto';
import { env } from './common.js';

export const stripeReady = () => Boolean(env('STRIPE_SECRET_KEY'));

// Stripe attend des formulaires : { a: { b: [1] } } devient a[b][0]=1.
function form(obj, prefix, out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') form(v, key, out); else out.append(key, String(v));
  }
  return out;
}

export async function stripe(path, params, method = 'POST') {
  const r = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: { Authorization: `Bearer ${env('STRIPE_SECRET_KEY')}`, ...(params ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    body: params ? form(params).toString() : undefined,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error((d.error && d.error.message) || `Stripe ${r.status}`); e.status = r.status; e.upstream = true; throw e; }
  return d;
}

const cents = (euros) => Math.round(Number(euros) * 100);

// La page de paiement Stripe pour une formule (abonnement mensuel) ou un pack de crédits (paiement unique).
// Les prix viennent de l'offre du site : rien à créer à la main dans Stripe.
export function checkoutParams({ kind, item, user, customer, origin }) {
  const meta = { uid: user.id, kind, id: item.id };
  const product = { name: kind === 'plan' ? `Drama Fruit ${item.name}` : `Drama Fruit · ${item.name}` };
  const price = { currency: 'eur', unit_amount: cents(item.price), product_data: product, ...(kind === 'plan' ? { recurring: { interval: 'month' } } : {}) };
  return {
    mode: kind === 'plan' ? 'subscription' : 'payment',
    line_items: [{ quantity: 1, price_data: price }],
    client_reference_id: user.id,
    ...(customer ? { customer } : { customer_email: user.email || undefined }),
    metadata: meta,
    ...(kind === 'plan' ? { subscription_data: { metadata: meta } } : { payment_intent_data: { metadata: meta } }),
    allow_promotion_codes: true,
    success_url: `${origin}/?paiement=ok#compte`,
    cancel_url: `${origin}/#tarifs`,
  };
}

// Vérifie qu'une notification vient bien de Stripe (signature HMAC du corps brut, valable 5 minutes).
export function verifyWebhook(raw, header, secret, now = Date.now()) {
  const parts = Object.fromEntries(String(header || '').split(',').map((kv) => kv.trim().split('=')).filter((x) => x.length === 2).map(([k, v]) => [k, v]));
  const sigs = String(header || '').split(',').map((kv) => kv.trim()).filter((kv) => kv.startsWith('v1=')).map((kv) => kv.slice(3));
  if (!parts.t || !sigs.length || !secret) return false;
  if (Math.abs(now / 1000 - Number(parts.t)) > 300) return false;
  const good = crypto.createHmac('sha256', secret).update(`${parts.t}.${raw}`).digest('hex');
  return sigs.some((s) => s.length === good.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(good)));
}
