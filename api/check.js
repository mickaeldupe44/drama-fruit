import { send, body, env } from '../lib/common.js';
import { requireUser, limitWriting, sendFailure } from '../lib/account.js';
import { textLlm, chatJson } from '../lib/llm.js';

// Vérification de cohérence : l'IA regarde 2 images de chaque scène tournée et les compare au PACK.
const isImg = (u) => typeof u === 'string' && u.startsWith('data:image/') && u.length < 400000;

function sceneSpec(pack, sc) {
  const who = (id) => (pack.persos || []).find((p) => p.id === id) || {};
  const lieu = (pack.lieux || []).find((l) => l.id === sc.lieu);
  const persos = (sc.presents || []).map((id) => { const p = who(id); return `${p.prenom || id} = ${p.fruit || ''}${p.tenue_courte || p.tenue ? `, en ${p.tenue_courte || p.tenue}` : ''}${p.compteur ? `, compteur « ${p.compteur} » sur le front` : ''}`; });
  const poses = sc.poses ? Object.entries(sc.poses).map(([k, v]) => `${who(k).prenom || k} : ${v}`).join(' ; ') : '';
  return [
    `Titre : ${sc.titre || ''}`,
    `Lieu : ${lieu ? `${lieu.nom} (${lieu.description || ''})` : (sc.decor || '')}`,
    `Personnages présents : ${persos.join(' | ') || 'aucun'}`,
    sc.entree && sc.entree.qui ? `Entrée en cours de scène : ${who(sc.entree.qui).prenom || sc.entree.qui}` : '',
    `Cadrage : ${sc.cadrage || ''}`,
    poses ? `Actions : ${poses}` : '',
    `Répliques : ${(sc.repliques || []).map((r) => `${who(r.qui).prenom || r.qui} : « ${r.texte} »`).join(' ')}`,
  ].filter(Boolean).join('\n');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST attendu.' });
  const user = await requireUser(req, res); if (!user) return;
  try { await limitWriting(user, 'verifier'); } catch (e) { if (sendFailure(res, e)) return; console.error('compteur', e); return send(res, 502, { error: 'Le service de comptes ne répond pas, réessaie dans un instant.' }); }
  const llm = textLlm(); if (!llm) return send(res, 500, { error: 'Aucune IA disponible pour la vérification.' });
  if (llm.name === 'Grok' && env('XAI_VISION_MODEL')) llm.models = [env('XAI_VISION_MODEL')];
  const b = body(req); const pack = b.pack || {}; const frames = Array.isArray(b.frames) ? b.frames : [];
  if (!Array.isArray(pack.scenes) || !frames.length) return send(res, 400, { error: 'Rien à vérifier.' });
  const content = [{ type: 'text', text: `Voici l'épisode « ${pack.titre || ''} » découpé en ${pack.scenes.length} scènes de 6 secondes, dans l'ordre. Pour chaque scène tu as ce que le scénario demande, puis 2 images extraites de la vidéo tournée (vers le début et vers la fin de la scène).` }];
  frames.slice(0, 13).forEach((f) => {
    const i = Number(f.index) || 0; const sc = pack.scenes[i]; if (!sc) return;
    content.push({ type: 'text', text: `\n=== SCÈNE ${i + 1} — CE QUE LE SCÉNARIO DEMANDE ===\n${sceneSpec(pack, sc)}\n=== SCÈNE ${i + 1} — IMAGES DE LA VIDÉO ===` });
    (f.images || []).filter(isImg).slice(0, 2).forEach((u) => content.push({ type: 'image_url', image_url: { url: u, detail: 'low' } }));
  });
  content.push({ type: 'text', text: `\nVérifie chaque scène comme un monteur exigeant :
1. Les bons personnages sont là (bon fruit, bonne tenue, bon compteur), sans personnage en trop ni manquant (sauf une entrée prévue en cours de scène).
2. Le bon lieu.
3. L'action correspond à ce qui est écrit.
4. La scène est à la bonne place dans l'histoire (elle ne ressemble pas à une autre scène et suit logiquement la précédente).
5. Pas de défaut grave : visage déformé, fruit qui change, texte ou sous-titres incrustés dans l'image, personnage coupé.
Sois juste : une petite différence de cadrage n'est pas une erreur. Mets "ok": false seulement si la scène pose un vrai problème pour comprendre l'histoire ou pour la qualité.
Réponds UNIQUEMENT en JSON : {"scenes":[{"n":1,"ok":true,"note":8,"probleme":"phrase courte en français, vide si ok"}],"ordre_ok":true,"resume":"1 ou 2 phrases en français"}` });
  try {
    const d = await chatJson(llm, 'Tu es le chef monteur de DramaFruits, des mini-séries TikTok de fruits humanoïdes. Tu contrôles que chaque scène tournée correspond au scénario.', content, 'low');
    const scenes = (Array.isArray(d.scenes) ? d.scenes : []).map((x) => ({ n: Number(x.n) || 0, ok: x.ok !== false, note: Number(x.note) || null, probleme: String(x.probleme || '').slice(0, 300) })).filter((x) => x.n >= 1);
    send(res, 200, { by: llm.name, scenes, ordre_ok: d.ordre_ok !== false, resume: String(d.resume || '').slice(0, 500) });
  } catch (e) {
    console.error('check', e);
    send(res, 502, { error: `Vérification impossible : ${e.message || e}` });
  }
}
