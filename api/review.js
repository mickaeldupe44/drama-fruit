import { env, send, body } from '../lib/common.js';
import { requireUser } from '../lib/account.js';
import { METHOD, reviewMission } from '../lib/method.js';
import { cleanPack, packToPlan, auditPack, mergeReview } from '../lib/pack.js';
import { textLlm, chatJson } from '../lib/llm.js';

// 2e passe : l'IA relit le PACK et corrige ce qui ne respecte pas la méthode.
export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST attendu.' });
  const user = await requireUser(req, res); if (!user) return;
  const llm = textLlm(); if (!llm) return send(res, 200, { skipped: true });
  const b = body(req); const pack = b.pack;
  if (!pack || !Array.isArray(pack.scenes)) return send(res, 400, { error: 'PACK manquant.' });
  const duration = Math.max(12, Math.min(78, Number(b.duration) || 72));
  const scenes = Math.max(2, Math.min(13, Math.round(duration / 6)));
  const cta = (b.outro && b.outro.line) || 'Commente PARTIE 2 et abonne-toi !';
  let idea = String(b.idea || '').slice(0, 2000); if (b.settingDesc) idea += ` (Décor souhaité : ${b.settingDesc})`;
  const before = auditPack(pack, { scenes, cta });
  try {
    // La relecture ne renvoie que ses corrections, qu'on applique au PACK : c'est ce qui la rend rapide.
    const info = {};
    const corrections = await chatJson(llm, METHOD, reviewMission({ idea, scenes, cta, lang: b.lang, pack, issues: before }), env('REVIEW_EFFORT') || 'low', info);
    const fixed = cleanPack(mergeReview(pack, corrections));
    const after = auditPack(fixed, { scenes, cta });
    const plan = packToPlan(fixed);
    plan.review = { by: llm.name, fixes: Array.isArray(fixed.relecture) ? fixed.relecture.map(String).slice(0, 20) : [], ok: fixed.conforme !== false && !after.length, remaining: after };
    if (Array.isArray(b.changes)) plan.changes = b.changes;
    if (b.viral) plan.viral = true;
    send(res, 200, { plan, meta: info });
  } catch (e) {
    console.error('review', e);
    send(res, 200, { failed: true, warning: String(e.message || e), remaining: before });
  }
}
