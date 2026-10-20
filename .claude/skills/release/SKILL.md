---
name: release
description: Publier une nouvelle version de PR Radar (bump sur dev, PR dev → main, suivi du workflow release). Utiliser quand l'utilisateur demande une release, un tag ou « sortir la vX.Y.Z ».
---

# Release PR Radar

Flux : tout passe par `dev` ; le merge de la PR `dev → main` déclenche `release.yml`, qui publie si la version de `package.json` n'a pas encore de release (sinon rien).

1. Pré-requis : `dev` propre et à jour, aucun run `release.yml` en cours (`gh run list --workflow release.yml --limit 3`). Une release à la fois.
2. Vérifs : `npm run typecheck && npm test && (cd src-tauri && cargo clippy -- -D warnings && cargo test)`.
3. Bump la même version `X.Y.Z` dans :
   - `package.json`
   - `src-tauri/tauri.conf.json`
   - `src-tauri/Cargo.toml` (`[package] version`)
   puis `npm install --package-lock-only` (et `cargo check` dans `src-tauri` pour `Cargo.lock`).
4. Commit `chore: release vX.Y.Z` sur `dev`, avec le trailer Co-Authored-By.
5. Confirmer avec l'utilisateur avant de pousser (action publique), puis :
   ```sh
   git push origin dev
   gh pr create --base main --head dev --title "chore: release vX.Y.Z" --body "..."
   gh pr checks --watch && gh pr merge --merge   # merge commit, pas de squash (sinon dev et main divergent)
   ```
   Pas de tag manuel : `tauri-action` crée le tag `vX.Y.Z` et la release.
6. Suivre : `gh run watch $(gh run list --workflow release.yml --limit 1 --json databaseId -q '.[0].databaseId')`. Les 4 builds (macOS arm64/x64, Windows, Linux) doivent être verts.
7. Vérifier la release : `gh release view vX.Y.Z` → assets présents, `latest.json` contient la nouvelle version.
8. Si les secrets Apple existent (`gh secret list | grep APPLE`) : vérifier la notarisation du `.dmg` arm64 (voir `docs/apple-notarization.md`, étape 7).
