import { env, send, body, requireAuth } from '../lib/common.js';
import { METHOD, mission } from '../lib/method.js';
import { cleanPack, packToPlan } from '../lib/pack.js';

// Étape 1 : la méthode Moteur V4 de Micka + l'idée choisie → PACK.json complet (OpenAI, sinon Grok texte).
export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST attendu.' });
  if (!requireAuth(req, res)) return;
  const llm = env('OPENAI_API_KEY')
    ? { url: 'https://api.openai.com/v1/chat/completions', key: env('OPENAI_API_KEY'), models: [env('OPENAI_MODEL'), 'gpt-5', 'gpt-5-mini', 'gpt-4.1'].filter(Boolean), name: 'OpenAI' }
    : env('XAI_API_KEY') ? { url: 'https://api.x.ai/v1/chat/completions', key: env('XAI_API_KEY'), models: [env('XAI_TEXT_MODEL') || 'grok-4.20-0309-non-reasoning'], name: 'Grok' } : null;
  if (!llm) return send(res, 200, { fallback: true });
  const b = body(req);
  const duration = Math.max(12, Math.min(78, Number(b.duration) || 72));
  const scenes = Math.max(2, Math.min(13, Math.round(duration / 6)));
  const cta = (b.outro && b.outro.line) || 'Commente PARTIE 2 et abonne-toi !';
  let idea = String(b.idea || '').slice(0, 2000);
  if (b.settingDesc) idea += ` (Décor souhaité : ${b.settingDesc})`;
  let user = mission({ idea, scenes, cta, lang: b.lang });
  if (b.previousPlan && b.previousPlan.pack) {
    user += `\n\n=== VERSION ACTUELLE À AMÉLIORER ===\n${JSON.stringify(b.previousPlan.pack).slice(0, 30000)}\n\n${b.viral ? 'Réécris ce PACK pour le rendre encore plus viral (accroche plus forte, relances plus nettes, punchline plus citable), en suivant la méthode.' : 'Corrige ce PACK.'}${b.feedback ? ` Remarques de l'utilisateur à appliquer : ${String(b.feedback).slice(0, 1500)}` : ''} Ajoute "changes": [string] à la racine, la liste en français de ce que tu as changé.`;
  }
  const info = {}; const t0 = Date.now();
  const askModel = async (model, json) => {
    const reasoning = /^(gpt-5|o\d)/.test(model) ? { reasoning_effort: env('DIRECTOR_EFFORT') || 'low' } : { temperature: 0.9 };
    const r = await fetch(llm.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${llm.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, ...reasoning, ...(json ? { response_format: { type: 'json_object' } } : {}), messages: [{ role: 'system', content: METHOD }, { role: 'user', content: user }] }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error((d.error && (d.error.message || d.error)) || d.message || `${llm.name} ${r.status}`); e.status = r.status; throw e; }
    const u = d.usage || {};
    Object.assign(info, { model: d.model || model, effort: reasoning.reasoning_effort || null, jetons_lus: u.prompt_tokens, jetons_ecrits: u.completion_tokens, dont_reflexion: (u.completion_tokens_details || {}).reasoning_tokens });
    return String(d.choices[0].message.content || '');
  };
  const ask = async (json) => {
    let last;
    for (const m of llm.models) {
      try { return await askModel(m, json); } catch (e) { last = e; if (!(e.status === 404 || /model/i.test(String(e.message)))) throw e; }
    }
    throw last;
  };
  try {
    let text;
    try { text = await ask(true); } catch (e) { if (e.status !== 400) throw e; text = await ask(false); }
    const a = text.indexOf('{'), z = text.lastIndexOf('}');
    const pack = cleanPack(JSON.parse(a >= 0 ? text.slice(a, z + 1) : text));
    const plan = packToPlan(pack);
    if (Array.isArray(pack.changes)) plan.changes = pack.changes;
    if (b.viral) plan.viral = true;
    info.secondes = Math.round((Date.now() - t0) / 100) / 10;
    send(res, 200, { plan, balance: 9999, meta: info });
  } catch (e) {
    console.error('director', e);
    send(res, 200, { fallback: true, warning: String(e.message || e) });
  }
}
