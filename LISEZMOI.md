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

## Fichiers
- `index.html` et `media/` : le site.
- `api/` : le serveur, une fonction par fichier (config, login, me, library, director, review, image, clip, generate, job, check, media).
- `lib/` : le code partagé (`common.js` : outils).

**Attention : 12 fichiers au maximum dans `api/`.** C'est la limite de l'offre gratuite de Vercel (Hobby). Avec un 13ᵉ fichier, Vercel refuse la mise en ligne et le site reste sur l'ancienne version sans prévenir. Pour ajouter une fonction, il faut en regrouper deux, ou ranger le code partagé dans `lib/`.
