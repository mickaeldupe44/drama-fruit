import { env, send, decodeJob } from '../lib/common.js';
import { requireUser, refund } from '../lib/account.js';

import { OFFER, SCENE_SECONDS, scenePrice, episodePrice } from '../lib/offer.js';

const FINAL_FAIL = new Set(['failed', 'expired']);

export default async function handler(req, res) {
  const user = await requireUser(req, res); if (!user) return;
  const job = decodeJob(req.query.id);
  if (!job || !Array.isArray(job.r) || !job.r.length) return send(res, 404, { error: 'Tâche inconnue.' });
  const key = env('XAI_API_KEY');
  try {
    const all = await Promise.all(job.r.map(async (id) => {
      const r = await fetch(`https://api.x.ai/v1/videos/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${key}` } });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return { status: 'pending', error: (d.error && (d.error.message || d.error)) || `xAI ${r.status}` };
      return d;
    }));
    const base = { id: req.query.id, model: job.m, duration: job.d, title: job.t, cost: user.test ? 0 : episodePrice({ model: job.m, scenes: Math.max(1, Math.round(job.d / SCENE_SECONDS)), hd: job.q === '1080p' }), hd: job.q === '1080p', resolution: job.q || null, stored: false, createdAt: new Date(job.c || Date.now()).toISOString() };
    if (!user.test) {
      const hd = job.q === '1080p'; const perClip = job.r.length && job.d / job.r.length === SCENE_SECONDS ? scenePrice({ model: job.m, hd }) : Math.ceil((OFFER.modelCredits[job.m] || 0) * (hd ? OFFER.hdMultiplier : 1) * (job.d / job.r.length));
      await Promise.all(all.map((d, k) => (FINAL_FAIL.has(d.status) ? refund(user.id, `rembourse:${job.r[k]}`, perClip, 'Scène non livrée').catch((e) => console.error('remboursement', e)) : null)));
    }
    const failed = all.find((d) => FINAL_FAIL.has(d.status));
    if (failed) return send(res, 200, { ...base, status: 'failed', failureCode: String(failed.error || failed.status || '').toUpperCase(), refunded: true });
    const done = all.filter((d) => d.status === 'done' && d.video && d.video.url);
    if (done.length === all.length) {
      const segments = all.map((d) => d.video.url);
      return send(res, 200, { ...base, status: 'done', outputUrl: segments[0], segments });
    }
    send(res, 200, { ...base, status: done.length ? 'running' : 'queued', progress: done.length ? done.length / all.length : null });
  } catch (e) {
    console.error('job', e);
    send(res, 502, { error: 'Impossible de joindre le studio vidéo, nouvel essai…' });
  }
}
