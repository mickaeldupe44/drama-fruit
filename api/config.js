import { env, send } from '../lib/common.js';
import { paid } from '../lib/store.js';
import { OFFER } from '../lib/offer.js';
import { stripeReady } from '../lib/stripe.js';

const r = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

// Ce que le site doit savoir au chargement : mode test ou mode payant, services branchés, offre et modèles.
export default function handler(req, res) {
  const xai = Boolean(env('XAI_API_KEY'));
  const real = paid();
  send(res, 200, {
    ok: true,
    // Mode test tant que Supabase n'est pas réglé : un code d'accès, rien n'est facturé.
    testMode: !real,
    ...(real ? { supabaseUrl: env('SUPABASE_URL'), supabaseAnonKey: env('SUPABASE_ANON_KEY') } : {}),
    ready: { db: real || Boolean(env('ACCESS_CODE')), stripe: real && stripeReady(), xai, images: xai || Boolean(env('OPENAI_API_KEY')), imageProvider: env('OPENAI_API_KEY') ? 'openai' : 'xai', runway: false, llm: env('OPENAI_API_KEY') ? 'openai' : (xai ? 'xai' : 'none') },
    offer: OFFER,
    // Seuls les modèles Grok (xAI) sont branchés.
    models: {
      'grok-imagine-video-1.5': { provider: 'xai', durations: r(4, 15), nativeShots: false, inPromptShots: 4, image: 'first' },
      'grok-imagine-video-1.5-lite': { provider: 'xai', durations: r(4, 15), nativeShots: false, inPromptShots: 3, image: 'first' },
    },
    supportEmail: env('SUPPORT_EMAIL') || '',
  });
}
