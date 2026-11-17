import { env, send, requireAuth, decodeJob } from '../lib/common.js';

const FINAL_FAIL = new Set(['failed', 'expired']);

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;
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
    const base = { id: req.query.id, model: job.m, duration: job.d, title: job.t, cost: 0, hd: job.q === '1080p', resolution: job.q || null, stored: false, createdAt: new Date(job.c || Date.now()).toISOString() };
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
