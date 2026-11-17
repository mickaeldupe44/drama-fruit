import { env } from './common.js';

// Le modèle de texte : OpenAI si la clé est là, sinon Grok texte.
export function textLlm() {
  if (env('OPENAI_API_KEY')) return { url: 'https://api.openai.com/v1/chat/completions', key: env('OPENAI_API_KEY'), models: [env('OPENAI_MODEL'), 'gpt-5', 'gpt-5-mini', 'gpt-4.1'].filter(Boolean), name: 'OpenAI' };
  if (env('XAI_API_KEY')) return { url: 'https://api.x.ai/v1/chat/completions', key: env('XAI_API_KEY'), models: [env('XAI_TEXT_MODEL') || 'grok-4.20-0309-non-reasoning'], name: 'Grok' };
  return null;
}

// Envoie system + user, renvoie l'objet JSON trouvé dans la réponse.
// « info », s'il est fourni, reçoit le modèle qui a répondu, la durée et le nombre de jetons : de quoi voir où part le temps.
export async function chatJson(llm, system, user, effort, info) {
  const t0 = Date.now();
  const askModel = async (model, json) => {
    const reasoning = /^(gpt-5|o\d)/.test(model) ? { reasoning_effort: effort || 'low' } : { temperature: 0.4 };
    const r = await fetch(llm.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${llm.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, ...reasoning, ...(json ? { response_format: { type: 'json_object' } } : {}), messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error((d.error && (d.error.message || d.error)) || d.message || `${llm.name} ${r.status}`); e.status = r.status; throw e; }
    if (info) { const u = d.usage || {}; Object.assign(info, { model: d.model || model, effort: reasoning.reasoning_effort || null, jetons_lus: u.prompt_tokens, jetons_ecrits: u.completion_tokens, dont_reflexion: (u.completion_tokens_details || {}).reasoning_tokens }); }
    return String(d.choices[0].message.content || '');
  };
  const ask = async (json) => {
    let last;
    for (const m of llm.models) {
      try { return await askModel(m, json); } catch (e) { last = e; if (!(e.status === 404 || /model/i.test(String(e.message)))) throw e; }
    }
    throw last;
  };
  let text;
  try { text = await ask(true); } catch (e) { if (e.status !== 400) throw e; text = await ask(false); }
  if (info) info.secondes = Math.round((Date.now() - t0) / 100) / 10;
  const a = text.indexOf('{'), z = text.lastIndexOf('}');
  return JSON.parse(a >= 0 ? text.slice(a, z + 1) : text);
}
