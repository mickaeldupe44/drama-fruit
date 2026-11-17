# Drama Fruit : version de test

Ce dossier contient le site complet et un petit serveur qui fabrique de vraies vidéos avec Grok (xAI).

## Ce que fait ce test
- Connexion avec ton e-mail et un **code d'accès** que tu choisis (pas encore de vrais comptes clients).
- Le scénario est écrit par ChatGPT si tu ajoutes une clé OpenAI, sinon par le site lui-même.
- La vidéo est tournée par Grok Imagine. Au-delà de 15 s, l'épisode est tourné en plusieurs séquences qui s'enchaînent dans le lecteur (le montage en un seul fichier viendra plus tard).
- Rien n'est facturé aux visiteurs : pas encore de paiement Stripe ni de crédits réels. Seul ton compte xAI est débité.

## Les réglages à mettre sur Vercel (Settings → Environment Variables)
| Nom | Valeur |
|---|---|
| `XAI_API_KEY` | ta clé xAI (console.x.ai → API Keys) |
| `ACCESS_CODE` | un mot de passe de ton choix, 8 caractères minimum |
| `OPENAI_API_KEY` | facultatif : ta clé OpenAI pour de meilleurs scénarios |

Ne colle jamais ces clés dans le chat ni dans un fichier : seulement dans Vercel.

## La netteté des vidéos (réglages facultatifs)
Le site demande maintenant une résolution à Grok pour chaque clip. Avant, il n'en demandait pas et xAI tournait tout en 480p, son réglage par défaut.

| Nom | Valeurs | Si tu ne mets rien |
|---|---|---|
| `XAI_VIDEO_RESOLUTION` | `480p`, `720p` ou `1080p` | `720p` |
| `XAI_IMAGE_RESOLUTION` | `1k`, `1.5k` ou `2k` (images faites par Grok) | `2k` |
| `XAI_IMAGE_QUALITY` | `low`, `medium` ou `auto` (images faites par Grok) | `medium` |
| `OPENAI_IMAGE_QUALITY` | `low`, `medium` ou `high` (feuilles, lieux, objets) | `medium` |
| `OPENAI_SCENE_QUALITY` | `low`, `medium` ou `high` (image de départ de chaque scène) | comme `OPENAI_IMAGE_QUALITY` |
| `OPENAI_IMAGE_COMPRESSION` | de 50 à 100 (100 = image la moins compressée) | `90` |

À savoir :
- Avec les feuilles de personnages en référence (Grok Imagine 1.5), xAI plafonne à **720p**. Le 1080p n'est possible que sans images de référence ; le site redescend tout seul à 720p quand il le faut.
- La case « HD 1080p » du studio demande du 1080p quand le mode le permet.
- Prix xAI par seconde de vidéo, relevés sur docs.x.ai en novembre 2026 : Grok Imagine 1.5 = 0,087 $ en 480p, 0,14 $ en 720p, 0,25 $ en 1080p ; version Lite = 0,027 $, 0,03 $ et 0,14 $ (son 1080p est un 720p agrandi).
- Pour revenir à l'ancien coût : `XAI_VIDEO_RESOLUTION=480p`.

## La vitesse du scénario (réglages facultatifs)

Le scénario est écrit par l'IA, puis relu une 2e fois. La relecture ne renvoie que ses corrections (elle ne réécrit plus tout le scénario), et l'histoire s'affiche sur le site dès qu'elle est écrite, pendant la relecture.

- `DIRECTOR_EFFORT` : effort de réflexion pour l'écriture (`minimal`, `low`, `medium`, `high`). Par défaut `low`.
- `REVIEW_EFFORT` : effort de réflexion pour la relecture. Par défaut `low`.

Le modèle utilisé, la durée et le nombre de jetons de chaque étape s'affichent dans la console du navigateur (lignes « [Drama Fruit] scénario écrit » et « scénario relu »).

Le serveur retire aussi du scénario les personnages, lieux et objets qu'aucune scène n'utilise : chacun coûtait une image pour rien.

## Fichiers
- `index.html` et `media/` : le site.
- `api/` : le serveur, une fonction par fichier (config, login, me, library, director, review, image, clip, generate, job, check, media).
- `lib/` : le code partagé (`common.js` : outils, dont le choix de la résolution vidéo).

**Attention : 12 fichiers au maximum dans `api/`.** C'est la limite de l'offre gratuite de Vercel (Hobby). Avec un 13ᵉ fichier, Vercel refuse la mise en ligne et le site reste sur l'ancienne version sans prévenir. Pour ajouter une fonction, il faut en regrouper deux, ou ranger le code partagé dans `lib/`.
