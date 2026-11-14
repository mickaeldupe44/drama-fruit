import { env, send, body, requireAuth, encodeJob, XAI_NATIVE_MAX, xaiModel } from '../lib/common.js';

const STYLE = 'Vertical 9:16 video. High-end 3D animated soap-opera drama starring anthropomorphic fruit characters with expressive faces, eyes, mouths and small arms. Cinematic lighting, shallow depth of field, dramatic close-ups, lip-synced dialogue with natural voices.';

// Découpe le scénario en séquences de 15 s maximum (limite d'une vidéo Grok).
function segmentsOf(plan, duration) {
  const n = Math.max(1, Math.ceil(duration / XAI_NATIVE_MAX));
  const shots = Array.isArray(plan.shots) && plan.shots.length ? plan.shots : [{ seconds: duration, visual: plan.logline || '', dialogue: [] }];
  const groups = Array.from({ length: n }, () => []);
  shots.forEach((s, i) => groups[Math.min(n - 1, Math.floor((i * n) / shots.length))].push(s));
  const base = Math.floor(duration / n); let extra = duration - base * n;
  return groups.map((g, k) => ({ seconds: Math.min(XAI_NATIVE_MAX, base + (extra-- > 0 ? 1 : 0)), shots: g, index: k, total: n }));
}

function promptFor(plan, seg, lang) {
  const cast = (plan.cast || []).map((c) => `${c.name} (a ${c.fruit}${c.look ? ', ' + c.look : ''})`).join('; ');
  const parts = [STYLE, cast ? `Characters: ${cast}.` : '', plan.setting ? `Setting: ${plan.setting}.` : ''];
  if (seg.total > 1) parts.push(`This is part ${seg.index + 1} of ${seg.total} of the same continuous episode; keep the exact same characters, outfits and setting.`);
  seg.shots.forEach((s, i) => {
    parts.push(`Shot ${i + 1}: ${s.visual || ''}`);
    (s.dialogue || []).forEach((l) => parts.push(`${l.who} (${l.tone || 'dramatic'}) says in ${lang === 'en' ? 'English' : 'French'}: "${l.line}"`));
  });
  return parts.filter(Boolean).join('\n').slice(0, 4000);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST attendu.' });
  if (!requireAuth(req, res)) return;
  const key = env('XAI_API_KEY');
  if (!key) return send(res, 500, { error: 'Clé XAI_API_KEY manquante sur le serveur.' });
  const b = body(req);
  const plan = b.plan || {};
  const duration = Math.max(4, Math.min(60, Number(b.duration) || 15));
  const model = xaiModel(b.model);
  const segs = segmentsOf(plan, duration);
  try {
    const ids = [];
    for (const seg of segs) {
      const payload = { model, prompt: promptFor(plan, seg, b.lang), duration: seg.seconds, aspect_ratio: '9:16' };
      if (seg.index === 0 && typeof b.imageDataUrl === 'string' && b.imageDataUrl.startsWith('data:image/')) payload.image = { url: b.imageDataUrl };
      const r = await fetch('https://api.x.ai/v1/videos/generations', {
        method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.request_id) throw new Error((d.error && (d.error.message || d.error)) || d.message || `xAI ${r.status}`);
      ids.push(d.request_id);
    }
    const jobId = encodeJob({ r: ids, m: b.model || model, d: duration, t: String(plan.title || 'Épisode').slice(0, 80), c: Date.now() });
    send(res, 200, { jobId, cost: 0, balance: 9999 });
  } catch (e) {
    console.error('generate', e);
    send(res, 502, { error: `Le studio vidéo (xAI) a refusé la demande : ${e.message || e}` });
  }
}
