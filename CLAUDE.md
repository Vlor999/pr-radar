# PR Radar

App desktop Tauri v2 + React 19 + Vite + Tailwind v4 + shadcn (preset `b7ClNF3YW`, base-ui, `cn` importé depuis `"cn"`). TypeScript strict, prettier `semi: false`. Pas de backend : appels directs à api.github.com via `@tauri-apps/plugin-http`.

## Vérifs

```sh
npm run typecheck
npm test
cd src-tauri && cargo clippy -- -D warnings && cargo test
npm run tauri build -- --bundles app   # build macOS local
```

## Règles

- Jamais afficher ni commiter `~/.tauri/pr-radar.key` ou son mot de passe (secrets CI `TAURI_SIGNING_PRIVATE_KEY*`).
- `site/` (landing GitHub Pages) : données fictives uniquement (`acme`), jamais de vrais repos privés.
- Le client ID OAuth dans `src/lib/auth.ts` est public, pas un secret.
- Release : skill `release` (`.claude/skills/release/SKILL.md`).
- Notarisation Apple : `docs/apple-notarization.md`.
