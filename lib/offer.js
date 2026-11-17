// L'offre : formules, packs et prix en crédits. Le serveur fait foi : le site l'affiche via /api/config et tous les débits
// sont calculés ici. Fabriquée à partir de DEFAULT_OFFER dans index.html (qui ne sert plus que d'aperçu sans serveur).
export const SCENE_SECONDS = 6;
export const SCENE_CREDITS = 3;

export const OFFER = {
  "planOrder": [
    "free",
    "starter",
    "pro",
    "studio"
  ],
  "plans": {
    "free": {
      "id": "free",
      "name": "Découverte",
      "price": 0,
      "monthlyCredits": 0,
      "welcomeCredits": 35,
      "maxDuration": 15,
      "hd": false,
      "models": [
        "grok-imagine-video-1.5-lite"
      ],
      "imageStart": false,
      "maxShots": 2,
      "revisions": 1,
      "dailyLimit": 1,
      "characters": 0,
      "library": false,
      "perks": [
        "35 crédits offerts (ton premier épisode)",
        "1 épisode par jour, jusqu'à 12 s",
        "Grok Imagine Lite",
        "1 révision par épisode",
        "Lien vidéo valable 48 h"
      ]
    },
    "starter": {
      "id": "starter",
      "name": "Starter",
      "price": 9.99,
      "monthlyCredits": 120,
      "welcomeCredits": 0,
      "maxDuration": 30,
      "hd": false,
      "models": [
        "grok-imagine-video-1.5",
        "grok-imagine-video-1.5-lite"
      ],
      "imageStart": false,
      "maxShots": 4,
      "revisions": 2,
      "dailyLimit": 0,
      "characters": 0,
      "library": true,
      "perks": [
        "120 crédits par mois",
        "Épisodes jusqu'à 30 s, 4 plans montés",
        "Grok Imagine 1.5 et Lite",
        "2 révisions par épisode",
        "Vidéothèque permanente",
        "Crédits non utilisés reportés"
      ]
    },
    "pro": {
      "id": "pro",
      "name": "Pro",
      "price": 24.99,
      "monthlyCredits": 300,
      "welcomeCredits": 0,
      "maxDuration": 72,
      "hd": false,
      "models": [
        "grok-imagine-video-1.5",
        "grok-imagine-video-1.5-lite"
      ],
      "imageStart": true,
      "maxShots": 8,
      "revisions": 0,
      "dailyLimit": 0,
      "characters": 3,
      "library": true,
      "perks": [
        "300 crédits par mois",
        "Épisodes jusqu'à 72 s",
        "Grok Imagine 1.5 et Lite, vidéo en 720p",
        "Révisions illimitées",
        "Image de départ et 3 personnages enregistrés",
        "Vidéothèque permanente",
        "Crédits reportés"
      ]
    },
    "studio": {
      "id": "studio",
      "name": "Studio",
      "price": 69.99,
      "monthlyCredits": 900,
      "welcomeCredits": 0,
      "maxDuration": 72,
      "hd": false,
      "models": [
        "grok-imagine-video-1.5",
        "grok-imagine-video-1.5-lite"
      ],
      "imageStart": true,
      "maxShots": 12,
      "revisions": 0,
      "dailyLimit": 0,
      "characters": 20,
      "library": true,
      "perks": [
        "900 crédits par mois",
        "Épisodes jusqu'à 72 s, 12 scènes montées",
        "Grok Imagine 1.5 et Lite, vidéo en 720p",
        "Révisions illimitées",
        "20 personnages enregistrés",
        "Vidéothèque permanente",
        "Crédits reportés",
        "Support prioritaire"
      ]
    }
  },
  "packs": {
    "pack100": {
      "id": "pack100",
      "name": "100 crédits",
      "credits": 100,
      "price": 9.99
    },
    "pack500": {
      "id": "pack500",
      "name": "500 crédits",
      "credits": 500,
      "price": 44.99
    },
    "pack1500": {
      "id": "pack1500",
      "name": "1200 crédits",
      "credits": 1200,
      "price": 99
    }
  },
  "modelCredits": {
    "grok-imagine-video-1.5-lite": 1,
    "grok-imagine-video-1.5": 4
  },
  "hdMultiplier": 2,
  "assetCredits": 15,
  "improveCredits": 5
};

const rate = (model, hd) => (OFFER.modelCredits[model] || 0) * (hd ? OFFER.hdMultiplier : 1);

// Prix d'un épisode entier (casting et décors + chaque scène) et d'une scène seule (scène refaite ou remboursée).
export const episodePrice = ({ model, scenes, hd }) => Math.ceil(rate(model, hd) * scenes * SCENE_SECONDS) + (OFFER.assetCredits || 0) + SCENE_CREDITS * scenes;
export const scenePrice = ({ model, hd }) => Math.ceil(rate(model, hd) * SCENE_SECONDS) + SCENE_CREDITS;

// Ce que la formule autorise. Renvoie un message d'erreur, ou null si tout est permis.
export function planRefusal(plan, { model, scenes, hd }) {
  if (!(model in OFFER.modelCredits)) return "Ce modèle vidéo n'est pas disponible.";
  if (!plan.models.includes(model)) return "Ce modèle vidéo n'est pas inclus dans ta formule.";
  if (scenes * SCENE_SECONDS > plan.maxDuration) return `Ta formule va jusqu'à ${plan.maxDuration} s par épisode.`;
  if (hd && !plan.hd) return "La HD n'est pas incluse dans ta formule.";
  return null;
}
