import { env, send } from '../lib/common.js';
import { paid, select, update } from '../lib/store.js';
import { refund as grant } from '../lib/account.js';
import { OFFER } from '../lib/offer.js';
import { stripe, verifyWebhook } from '../lib/stripe.js';

// Les notifications de Stripe : c'est ici, et seulement ici, que les crédits achetés arrivent sur un compte.
// À déclarer dans Stripe (Développeurs → Webhooks) : https://TON-SITE/api/stripe, avec les événements
// checkout.session.completed, invoice.paid, customer.subscription.updated et customer.subscription.deleted.
export const config = { api: { bodyParser: false } };

// Le corps exact reçu de Stripe (la signature porte dessus, à l'octet près).
async function rawBody(req) {
  const chunks = [];
  try { for await (const c of req) chunks.push(typeof c === 'string' ? Buffer.from(c) : c); } catch { /* flux déjà lu */ }
  if (chunks.length) return Buffer.concat(chunks).toString('utf8');
  const b = req.body;
  if (typeof b === 'string') return b;
  if (Buffer.isBuffer(b)) return b.toString('utf8');
  return b ? JSON.stringify(b) : '';
}

const setPlan = (uid, patch) => update('profiles', { id: `eq.${uid}` }, patch);

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST attendu.' });
  if (!paid() || !env('STRIPE_WEBHOOK_SECRET')) return send(res, 503, { error: 'Paiement non configuré.' });
  const raw = await rawBody(req);
  if (!verifyWebhook(raw, req.headers['stripe-signature'], env('STRIPE_WEBHOOK_SECRET'))) return send(res, 400, { error: 'Signature invalide.' });
  let ev; try { ev = JSON.parse(raw); } catch { return send(res, 400, { error: 'Corps illisible.' }); }
  const o = (ev.data && ev.data.object) || {};
  try {
    if (ev.type === 'checkout.session.completed') {
      const m = o.metadata || {}; const uid = m.uid || o.client_reference_id;
      if (uid && o.customer) await setPlan(uid, { stripe_customer: o.customer });
      if (uid && o.mode === 'payment' && o.payment_status === 'paid') {
        const pack = OFFER.packs[m.id];
        if (pack) await grant(uid, `stripe:${o.id}`, pack.credits, `Pack ${pack.name}`);
      }
      if (uid && o.mode === 'subscription' && OFFER.plans[m.id]) await setPlan(uid, { plan: m.id, stripe_subscription: o.subscription || null });
    } else if (ev.type === 'invoice.paid') {
      // Premier paiement et chaque renouvellement : les crédits du mois. La formule est notée sur l'abonnement.
      const subId = o.subscription || (o.parent && o.parent.subscription_details && o.parent.subscription_details.subscription);
      if (subId) {
        const sub = await stripe(`subscriptions/${encodeURIComponent(subId)}`, null, 'GET');
        const m = sub.metadata || {}; const plan = OFFER.plans[m.id];
        if (m.uid && plan) {
          await setPlan(m.uid, { plan: plan.id, stripe_subscription: sub.id, stripe_customer: sub.customer });
          await grant(m.uid, `stripe:${o.id}`, plan.monthlyCredits, `Formule ${plan.name}`);
        }
      }
    } else if (ev.type === 'customer.subscription.deleted' || ev.type === 'customer.subscription.updated') {
      const m = o.metadata || {};
      const ended = ev.type === 'customer.subscription.deleted' || ['canceled', 'unpaid', 'incomplete_expired'].includes(o.status);
      if (m.uid && ended) {
        const rows = await select('profiles', { id: `eq.${m.uid}`, select: 'stripe_subscription' });
        if (!rows[0] || !rows[0].stripe_subscription || rows[0].stripe_subscription === o.id) await setPlan(m.uid, { plan: 'free', stripe_subscription: null });
      }
    }
    send(res, 200, { received: true });
  } catch (e) {
    console.error('stripe', ev.type, e);
    send(res, 500, { error: 'Traitement impossible, Stripe réessaiera.' });
  }
}
