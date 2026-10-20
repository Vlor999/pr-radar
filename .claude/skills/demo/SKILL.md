---
name: demo
description: Lancer une démo locale de PR Radar dans le navigateur (localhost:1420) avec GitHub et Tauri mockés, pour que l'utilisateur valide une feature. Utiliser après chaque feature, ou quand l'utilisateur demande une démo, un aperçu ou « montre-moi ».
---

# Démo locale (navigateur, données fictives)

`npm run demo` = `vite --mode demo` sur http://localhost:1420. En mode `demo`, `vite.config.ts` remplace :
- `@/lib/github` / `./github` → `src/demo/github.ts` (repos et PR fictifs, orgs `acme`, `globex`, `me`) ;
- `@tauri-apps/api/{core,app}` et `@tauri-apps/plugin-*` → `src/demo/tauri.ts` (jeton factice, pas d'updater, `invoke` journalisé dans la console).

Pas de connexion gh, aucun appel réseau à GitHub.

## Étapes

1. Si la feature dépend de données absentes (nouveau champ de `Pr`, nouvel état CI, cas limite), compléter `src/demo/github.ts`. Garder des données fictives uniquement.
2. Si la feature appelle une nouvelle fonction de `src/lib/github.ts` ou une nouvelle commande `invoke`, l'ajouter au mock (même signature). Vérifier : `npm run typecheck`.
3. Lancer en arrière-plan : `npm run demo` (port 1420 strict, le même que `tauri dev` : arrêter `tauri dev` avant ; si la démo tourne déjà, la réutiliser).
4. Ouvrir : `open http://localhost:1420`.
5. Donner à l'utilisateur une liste courte de quoi tester (étapes concrètes, tailles de fenêtre si responsive).
6. Attendre sa validation explicite avant commit/release (règle de `CLAUDE.md`).

État navigateur (repos suivis, réglages) en localStorage de `localhost:1420`, séparé de l'app installée. Repartir de zéro : vider le stockage du site dans le navigateur.
