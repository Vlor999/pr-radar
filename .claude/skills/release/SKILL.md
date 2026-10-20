---
name: release
description: Publier une nouvelle version de PR Radar (bump, tag, suivi du workflow release). Utiliser quand l'utilisateur demande une release, un tag ou « sortir la vX.Y.Z ».
---

# Release PR Radar

1. Pré-requis : `main` propre et à jour, aucun run `release.yml` en cours (`gh run list --workflow release.yml --limit 3`). Une release à la fois.
2. Vérifs : `npm run typecheck && npm test && (cd src-tauri && cargo clippy -- -D warnings && cargo test)`.
3. Bump la même version `X.Y.Z` dans :
   - `package.json`
   - `src-tauri/tauri.conf.json`
   - `src-tauri/Cargo.toml` (`[package] version`)
   puis `npm install --package-lock-only` (et `cargo check` dans `src-tauri` pour `Cargo.lock`).
4. Commit `chore: release vX.Y.Z` (ou message `feat:`/`fix:` décrivant le contenu), avec le trailer Co-Authored-By.
5. Confirmer avec l'utilisateur avant de pousser (action publique), puis :
   ```sh
   git push origin main
   git tag vX.Y.Z && git push origin vX.Y.Z
   ```
6. Suivre : `gh run watch $(gh run list --workflow release.yml --limit 1 --json databaseId -q '.[0].databaseId')`. Les 4 builds (macOS arm64/x64, Windows, Linux) doivent être verts.
7. Vérifier la release : `gh release view vX.Y.Z` → assets présents, `latest.json` contient la nouvelle version.
8. Si les secrets Apple existent (`gh secret list | grep APPLE`) : vérifier la notarisation du `.dmg` arm64 (voir `docs/apple-notarization.md`, étape 7).
