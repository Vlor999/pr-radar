---
description: "Conventions TypeScript / React de PR Radar : syntaxe, imports, état, erreurs, UI."
paths:
  - "src/**/*.ts"
  - "src/**/*.tsx"
---

# TypeScript / React

## Syntaxe

- `strict` + `noUnusedLocals/Parameters` : `npm run typecheck` doit passer. Pas de `any` ; `unknown` puis cast ciblé (`as { data?: T }`) aux frontières (JSON GitHub, localStorage).
- Prettier `semi: false`, guillemets doubles, virgules finales.
- `type` plutôt qu'`interface`. Types de domaine partagés dans `src/lib/types.ts`.
- Exports nommés, pas de `export default` (seule exception : `App`). Composants en `function Nom()`, petits helpers en `const f = () =>`.
- Fichiers en `kebab-case` (`pr-card.tsx`, `use-seen.ts`). Hooks dans `src/hooks/use-*.ts`.

## Imports

Ordre, séparé par une ligne vide : paquets externes → `@/…` (alias de `src/`) → relatifs (`./github`). Dans `src/lib/`, imports relatifs entre modules ; ailleurs, `@/lib/…`. `cn` s'importe depuis `"cn"`, pas `@/lib/utils`.

## Constantes

- Constantes de module en `UPPER_SNAKE_CASE` en tête de fichier, unité dans le nom (`CACHE_TTL_MS`), avec un commentaire quand la valeur vient d'une contrainte (quota GraphQL, limite GitHub).
- Une seule déclaration par objet : chercher l'existant (`grep`) avant d'écrire un helper, un appel API ou une clé de stockage.

## État et stockage

- État partagé : stores module + `useSyncExternalStore` (`src/lib/store.ts`, `settings.ts`). Pas de librairie d'état, pas de Context pour ça.
- `localStorage` : clé préfixée `pr-radar:`, lecture et écriture dans `try/catch` avec repli (`null`, valeur par défaut).

## Erreurs

- Appels GitHub uniquement via `src/lib/github.ts` (fetch de `@tauri-apps/plugin-http`, `trackQuota`, cache). Jeton refusé → `AuthError`, l'UI repasse à la connexion.
- `catch {}` vide accepté seulement pour du best-effort (stockage, notification) ; sinon remonter un message lisible à l'UI.
- Pas de `console.log` laissé dans le code livré.

## UI

- Composants shadcn dans `src/components/ui/` (base-ui), ajoutés via `npx shadcn add`, pas réécrits à la main.
- Tailwind v4, classes fusionnées avec `cn(...)`. Icônes `lucide-react`.
- Textes d'interface en français.
- Toute nouvelle fonction de `src/lib/github.ts` ou commande `invoke` a son mock dans `src/demo/` (même signature), sinon `npm run demo` casse.

## Côté Rust (`src-tauri/`)

- Nouvelle commande `#[tauri::command]` → `Result<_, String>`, enregistrée dans `invoke_handler`.
- Nouvel accès réseau ou plugin → permission minimale dans `src-tauri/capabilities/` et CSP de `tauri.conf.json` à jour.
- `cargo clippy -- -D warnings` propre.
