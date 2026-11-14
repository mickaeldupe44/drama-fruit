import { env, send, body, requireAuth, encodeJob, XAI_NATIVE_MAX, xaiModel } from '../lib/common.js';

// Étape 3 : Grok tourne la vidéo. Les images du casting et du décor servent de références,
// et la première image (tout le monde en place) sert de point de départ.
const STYLE = 'Vertical 9:16 video. High-end 3D animated soap-opera drama starring anthropomorphic fruit characters with expressive faces, eyes, mouths and small arms. Cinematic lighting, dramatic close-ups, lip-synced dialogue with natural voices.';

function segmentsOf(plan, duration) {
  const n = Math.max(1, Math.ceil(duration / XAI_NATIVE_MAX));
  const shots = Array.isArray(plan.shots) && plan.shots.length ? plan.shots : [{ seconds: duration, visual: plan.logline || '', dialogue: [] }];
  const groups = Array.from({ length: n }, () => []);
  shots.forEach((s, i) => groups[Math.min(n - 1, Math.floor((i * n) / shots.length))].push(s));
  const base = Math.floor(duration / n); let extra = duration - base * n;
  return groups.map((g, k) => ({ seconds: Math.min(XAI_NATIVE_MAX, base + (extra-- > 0 ? 1 : 0)), shots: g, index: k, total: n }));
}

const isImg = (u) => typeof u === 'string' && (/^https:\/\//.test(u) || u.startsWith('data:image/'));

function promptFor(plan, seg, lang, refMap) {
  const cast = (plan.cast || []).map((c) => `${c.name} (a ${c.fruit}${c.look ? ', ' + c.look : ''})`).join('; ');
  const parts = [STYLE];
  if (refMap.length) parts.push('References: ' + refMap.map((r) => `${r.label} is ${r.tag}`).join('; ') + '. Keep every character and the set exactly as in their reference images.');
  else if (cast) parts.push(`Characters: ${cast}.`);
  if (!refMap.some((r) => r.isSet) && plan.setting) parts.push(`Setting: ${plan.settingPrompt || plan.setting}.`);
  if (seg.total > 1) parts.push(`This is part ${seg.index + 1} of ${seg.total} of the same continuous episode.`);
  seg.shots.forEach((s, i) => {
    parts.push(`Shot ${i + 1}: ${s.videoPrompt || s.visual || ''}`);
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
  const assets = b.assets || {};
  const duration = Math.max(4, Math.min(60, Number(b.duration) || 15));
  const model = xaiModel(b.model);
  const full = model === 'grok-imagine-video-1.5'; // seul ce modèle accepte les images de référence
  const userImage = typeof b.imageDataUrl === 'string' && b.imageDataUrl.startsWith('data:image/') ? b.imageDataUrl : null;
  const firstFrame = userImage || (isImg(assets.keyframe) ? assets.keyframe : null);
  const refs = [];
  if (isImg(assets.decor)) refs.push({ url: assets.decor, label: 'the set', isSet: true });
  (assets.characters || []).forEach((c) => { if (isImg(c.url)) refs.push({ url: c.url, label: c.name }); });
  const segs = segmentsOf(plan, duration);
  try {
    const ids = [];
    for (const seg of segs) {
      const payload = { model, duration: seg.seconds, aspect_ratio: '9:16' };
      const pinned = seg.index === 0 ? firstFrame : (!full ? firstFrame : null);
      if (pinned) payload.image = { url: pinned };
      let refMap = [];
      if (full && refs.length) {
        const offset = pinned ? 1 : 0;
        const used = refs.slice(0, 14 - offset);
        payload.reference_images = used.map((r) => ({ url: r.url }));
        refMap = used.map((r, i) => ({ ...r, tag: `<IMAGE_${i + offset}>` }));
      }
      payload.prompt = promptFor(plan, seg, b.lang, refMap);
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
