import { env, send, body, requireAuth, encodeJob, XAI_NATIVE_MAX, xaiModel } from '../lib/common.js';

// Étape 3 : Grok tourne la vidéo. Les images du casting et du décor servent de références,
// et la première image (tout le monde en place) sert de point de départ.
const STYLE = 'Vertical 9:16 video. Ultra-detailed 3D animated soap-opera drama. The characters are anthropomorphic fruits with human bodies: glossy realistic fruit heads with very expressive cartoon faces and human hair, human bodies in real clothes, a glowing golden price badge on the forehead. Cinematic lighting, dramatic camera moves and close-ups, exaggerated emotions, lip-synced dialogue with natural expressive voices.';

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
  if (refMap.length) parts.push('References: ' + refMap.map((r) => `${r.label} is ${r.tag}`).join('; ') + '. Keep every character (face, hair, clothes, price badge) and every set exactly as in their reference images.');
  else if (cast) parts.push(`Characters: ${cast}.`);
  if (!refMap.some((r) => r.isSet) && plan.setting) parts.push(`Setting: ${plan.settingPrompt || plan.setting}.`);
  if (seg.total > 1) parts.push(`This is part ${seg.index + 1} of ${seg.total} of the same continuous episode.`);
  seg.shots.forEach((s, i) => {
    const st = s.set && refMap.find((r) => r.isSet && r.setId === s.set);
    parts.push(`Shot ${i + 1}${st ? ` (in ${st.tag})` : ''}: ${s.videoPrompt || s.visual || ''}`);
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
  const sets = (Array.isArray(assets.sets) && assets.sets.length ? assets.sets : (isImg(assets.decor) ? [{ id: 's1', name: 'main', url: assets.decor }] : [])).filter((x) => isImg(x.url));
  const charRefs = (assets.characters || []).filter((c) => isImg(c.url)).flatMap((c) => [{ url: c.url, label: `${c.name} (front view)` }].concat(isImg(c.back) ? [{ url: c.back, label: `${c.name} (back view)` }] : []));
  const refsFor = (seg) => {
    const ids = new Set(seg.shots.map((x) => x.set).filter(Boolean));
    const names = new Set(seg.shots.flatMap((x) => (Array.isArray(x.characters) ? x.characters : []).concat((x.dialogue || []).map((l) => l.who))));
    const used = sets.filter((x) => ids.has(x.id));
    const chars = names.size ? charRefs.filter((r) => names.has(r.label.replace(/ \((front|back) view\)$/, ''))) : charRefs;
    return [...(used.length ? used : sets).map((x) => ({ url: x.url, label: `the "${x.name}" set`, isSet: true, setId: x.id })), ...(chars.length ? chars : charRefs)];
  };
  const segs = segmentsOf(plan, duration);
  try {
    const ids = [];
    for (const seg of segs) {
      const payload = { model, duration: seg.seconds, aspect_ratio: '9:16' };
      const pinned = seg.index === 0 ? firstFrame : (!full ? firstFrame : null);
      if (pinned) payload.image = { url: pinned };
      let refMap = [];
      const refs = refsFor(seg);
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
