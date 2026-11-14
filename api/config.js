import { env, send } from '../lib/common.js';

const r = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

export default function handler(req, res) {
  const xai = Boolean(env('XAI_API_KEY'));
  send(res, 200, {
    ok: true,
    testMode: true,
    ready: { db: Boolean(env('ACCESS_CODE')), xai, images: xai || Boolean(env('OPENAI_API_KEY')), imageProvider: env('OPENAI_API_KEY') ? 'openai' : 'xai', runway: false, llm: env('OPENAI_API_KEY') ? 'openai' : (xai ? 'xai' : 'none') },
    // Pour le test, seuls les modèles Grok (xAI) sont branchés.
    models: {
      'grok-imagine-video-1.5': { provider: 'xai', durations: r(4, 15), nativeShots: false, inPromptShots: 4, image: 'first' },
      'grok-imagine-video-1.5-lite': { provider: 'xai', durations: r(4, 15), nativeShots: false, inPromptShots: 3, image: 'first' },
    },
    supportEmail: env('SUPPORT_EMAIL') || '',
  });
}
