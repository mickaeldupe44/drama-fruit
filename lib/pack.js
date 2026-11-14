// PACK.json (méthode Moteur V4) → plan du site, prompts d'images (OpenAI) et de clips (Grok).

const arr = (x) => (Array.isArray(x) ? x : []);
const COLORS = { doré: 'gold', rouge: 'red', vert: 'green', bleu: 'blue', orange: 'orange', violet: 'purple', blanc: 'white', rose: 'pink' };

export function cleanPack(pack) {
  pack.persos = arr(pack.persos).filter((p) => p && p.id).slice(0, 5);
  pack.lieux = arr(pack.lieux).filter((l) => l && l.id).slice(0, 4);
  pack.objets = arr(pack.objets).filter((o) => o && o.id).slice(0, 3);
  pack.scenes = arr(pack.scenes).filter((s) => s && arr(s.repliques).length).slice(0, 13).map((s, i) => ({ ...s, n: i + 1, presents: arr(s.presents), repliques: arr(s.repliques).filter((r) => r && r.texte) }));
  if (!pack.scenes.length) throw new Error('PACK sans scène');
  return pack;
}

// Plan affiché sur le site (le PACK complet est gardé dans plan.pack).
export function packToPlan(pack) {
  const name = (id) => (pack.persos.find((p) => p.id === id) || {}).prenom || id;
  const lieuName = (id) => (pack.lieux.find((l) => l.id === id) || {}).nom || '';
  return {
    method: 'v4',
    pack,
    title: pack.titre || 'Épisode',
    logline: pack.couverture || '',
    couverture: pack.couverture || '',
    story: pack.histoire || '',
    cast: pack.persos.map((p) => ({ id: p.id, name: p.prenom, fruit: p.court_en || p.fruit, role: p.role, price: p.compteur, look: p.tenue_courte || p.tenue })),
    sets: pack.lieux.map((l) => ({ id: l.id, name: l.nom, prompt: l.description })),
    shots: pack.scenes.map((s) => ({
      seconds: 6,
      set: s.lieu || '',
      setLabel: s.lieu ? lieuName(s.lieu) : (s.titre || ''),
      characters: s.presents.map(name),
      visual: `${s.titre ? s.titre + ' — ' : ''}${s.decor || ''}`,
      dialogue: s.repliques.map((r) => ({ who: name(r.qui), tone: r.mood || '', line: r.texte })),
    })),
    outro: null,
    caption: `${pack.couverture || pack.titre || ''}`.trim(),
    hashtags: ['#fruitdrama', '#dramafruits', '#fruits', '#pourtoi'],
  };
}

// Recopie dans le PACK les répliques corrigées sur le site.
export function syncPack(plan) {
  const pack = plan.pack; if (!pack) return null;
  plan.shots.forEach((sh, i) => { const sc = pack.scenes[i]; if (!sc) return; sh.dialogue.forEach((d, j) => { if (sc.repliques[j]) sc.repliques[j].texte = d.line; }); });
  return pack;
}

const STYLE_IMG = "Image de film d'animation 3D haut de gamme, ultra détaillée, lumière cinéma, couleurs riches, format vertical 9:16. Personnages fruits anthropomorphes : la tête ET le corps sont le fruit (corps 100 % fruit, fruit intact, jamais coupé ni croqué), visage cartoon très expressif, cheveux, bras et jambes, vrais vêtements. Aucun texte, aucun logo, aucune marque, aucune vraie personne.";

function counterText(value, color) {
  return value ? ` Sur la peau du front, un petit affichage lumineux ${color ? `de couleur ${color}` : 'doré'} montre « ${value} » (uniquement sur le front, nulle part ailleurs).` : '';
}

export function sheetPrompt(p) {
  return `${STYLE_IMG} FEUILLE DE PERSONNAGE sur fond gris clair uni : le MÊME personnage montré deux fois côte à côte, en pied, à gauche VU DE FACE, à droite VU DE DOS. Personnage : ${p.fruit} (${p.genre || ''}, ${p.age ? p.age + ' ans' : 'adulte'}), ${p.role || ''}. Carrure : ${p.carrure || ''}. Tête : ${p.tete || ''}. Visage : ${p.visage || ''}. Cheveux : ${p.cheveux || ''}. Tenue : ${p.tenue || ''}. Marqueur toujours visible : ${p.marqueur || ''}.${counterText(p.compteur)} Pas de nom écrit, pas d'autre texte.`;
}
export function lieuPrompt(l) {
  return `${STYLE_IMG} DÉCOR VIDE de référence, sans aucun personnage, vertical 9:16 : ${l.nom || ''}. ${l.description || ''} Profondeur, lumière d'ambiance, place pour des personnages au premier plan.`;
}
export function objetPrompt(o) {
  return `${STYLE_IMG} FEUILLE D'OBJET : ${o.nom || ''}, seul, centré sur fond gris clair uni, bien éclairé. ${o.description || ''}`;
}

// Couleur de compteur en vigueur à la scène i (la couleur reste jusqu'au prochain changement).
function counterColorAt(pack, i, id) {
  let c = '';
  for (let k = 0; k <= i; k++) { const cc = pack.scenes[k].compteurs_couleur; if (cc && cc[id]) c = cc[id]; }
  return c;
}
function counterAt(pack, i, id) {
  for (let k = i; k >= 0; k--) { const cc = pack.scenes[k].compteurs; if (cc && cc[id]) return cc[id]; }
  return (pack.persos.find((p) => p.id === id) || {}).compteur || '';
}

// Image de départ d'une scène : refs = feuilles des présents (sauf entrée), lieu, objets.
export function sceneRefs(pack, i) {
  const s = pack.scenes[i];
  const entering = s.entree && s.entree.qui;
  const persos = s.presents.filter((id) => id !== entering).map((id) => pack.persos.find((p) => p.id === id)).filter(Boolean).slice(0, 3);
  return {
    persos: persos.map((p) => p.id),
    lieu: s.lieu && pack.lieux.find((l) => l.id === s.lieu) ? s.lieu : null,
    objets: arr(s.objets).filter((o) => pack.objets.find((x) => x.id === o)).slice(0, 2),
  };
}
export function scenePrompt(pack, i, refLabels) {
  const s = pack.scenes[i];
  const entering = s.entree && s.entree.qui;
  const who = s.presents.filter((id) => id !== entering).map((id) => {
    const p = pack.persos.find((x) => x.id === id); if (!p) return '';
    const v = counterAt(pack, i, id); const col = counterColorAt(pack, i, id);
    return `${p.fruit_court || p.fruit} (${p.tenue_courte || p.tenue || ''}, ${p.marqueur || ''}) : ${(s.poses || {})[id] || ''}${arr(s.larmes).includes(id) ? ', avec déjà des larmes sur les joues' : ''}.${v ? ` Compteur du front : « ${v} »${col ? ` en ${col}` : ''}.` : ''}`;
  }).filter(Boolean).join(' ');
  return `${STYLE_IMG} Images jointes : ${refLabels.join(' ; ')}. Garde EXACTEMENT les personnages (tête, visage, cheveux, tenue, marqueur) et le décor des images jointes. IMAGE DE DÉPART d'une scène de série, l'instant où le geste démarre, émotion à fond. Décor : ${s.decor || ''}. Détails visibles : ${arr(s.details).join(' ; ')}. Cadrage : ${s.cadrage || 'plan taille'}. ${who} Les personnages qui parlent sont au premier plan, grands et nets, visages tournés vers l'objectif, personne de dos. Aucun texte à l'image.`;
}

// Prompt du clip Grok de 6 s.
const CAM = {
  push_in: (c) => `The camera starts at waist level and pushes in to ${c.cible}'s face on the key line.`,
  whip_pan: (c) => `The camera holds on ${c.cible}, then whip-pans to ${c.autre} when they speak.`,
  snap_zoom: (c) => `A lightning-fast snap zoom onto ${c.objet} on the word "${c.mot}", then back to the faces.`,
  slow_push: (c) => `A slow continuous push-in toward ${c.cible}, never stopping, building tension.`,
  pull_back: (c) => `The camera starts in close-up on ${c.cible} and pulls back to reveal ${c.objet}.`,
  low_high: (c) => `Low angle on ${c.cible} who dominates, high angle on ${c.autre}.`,
  tracking: (c) => `The camera tracks ${c.cible} at shoulder height.`,
  tilt_up: (c) => `The camera tilts up from ${c.objet} to ${c.cible}'s face.`,
  cta: (c) => `On the last line ${c.cible} turns to look straight into the lens and speaks to the viewer.`,
};
export function clipPrompt(pack, i, refTags) {
  const s = pack.scenes[i];
  const P = (id) => pack.persos.find((p) => p.id === id);
  const short = (id) => { const p = P(id); return p ? `the ${p.court_en || p.fruit}` : (id || 'the character'); };
  const speakers = new Set(s.repliques.map((r) => r.qui));
  const lines = [
    'Vertical 9:16, one continuous 6-second shot, no cuts. High-end 3D animated fruit drama: fruit characters with expressive cartoon faces, hair and real clothes.',
    '<IMAGE_0> is the first frame: keep the set, the characters and their positions exactly.',
  ];
  if (refTags.length) lines.push(`Reference sheets: ${refTags.join('; ')}. Keep each character identical to their sheet.`);
  lines.push(`Set: ${s.decor_en || ''}.`);
  s.presents.forEach((id) => { const p = P(id); if (p) lines.push(`${short(id)}: ${p.look_en || ''}. Voice: ${p.voix || ''}.${speakers.has(id) ? '' : ' Does not speak in this shot (silent, reacts only).'}`); });
  if (s.entree && s.entree.qui) lines.push(`At ${s.entree.a || 1.5} s, ${short(s.entree.qui)} enters the frame from ${s.entree.ou_en || 'off-screen'}.`);
  s.repliques.forEach((r) => lines.push(`${short(r.qui)} ${r.action_en || ''}, then says in French, ${r.mood || ''}${r.larmes ? ', crying' : ''}: "${r.texte}"`));
  if (s.objet_entree && s.objet_entree.nom_en) lines.push(`At ${s.objet_entree.a || 2} s, ${s.objet_entree.nom_en} appears: ${s.objet_entree.comment_en || ''}.`);
  if (s.sortie && s.sortie.qui) lines.push(`At ${s.sortie.a || 4} s, ${short(s.sortie.qui)} turns away and leaves through ${s.sortie.ou_en || 'the back'}.`);
  if (s.compteurs_couleur) Object.entries(s.compteurs_couleur).forEach(([id, c]) => lines.push(`During the shot, the glowing counter on ${short(id)}'s forehead turns ${COLORS[c] || c}.`));
  if (s.effet) lines.push(`Effect: ${s.effet}`);
  const cam = s.camera || {}; const f = CAM[cam.mouvement];
  if (f) lines.push(f({ cible: P(cam.cible) ? short(cam.cible) : (cam.cible || 'the main character'), autre: P(cam.autre) ? short(cam.autre) : (cam.autre || 'the other character'), objet: cam.objet || 'the key object', mot: cam.mot || '' }));
  if (arr(s.bruits_en).length) lines.push(`Sound effects: ${s.bruits_en.join('; ')}.`);
  lines.push('Only these lines are spoken, in French, lip-synced to the right character. No music over the voices. No subtitles, no text on screen.');
  return lines.join('\n').slice(0, 4000);
}
