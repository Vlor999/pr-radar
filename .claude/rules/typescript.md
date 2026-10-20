---
description: "PR Radar TypeScript / React conventions: syntax, imports, state, errors, UI."
paths:
  - "src/**/*.ts"
  - "src/**/*.tsx"
---

# TypeScript / React

## Syntax

- `strict` + `noUnusedLocals/Parameters`: `npm run typecheck` must pass. No `any`; `unknown` then a targeted cast (`as { data?: T }`) at boundaries (GitHub JSON, localStorage).
- Prettier `semi: false`, double quotes, trailing commas.
- `type` over `interface`. Shared domain types in `src/lib/types.ts`.
- Named exports, no `export default` (only exception: `App`). Components as `function Name()`, small helpers as `const f = () =>`.
- `kebab-case` file names (`pr-card.tsx`, `use-seen.ts`). Hooks in `src/hooks/use-*.ts`.

## Imports

Order, separated by a blank line: external packages → `@/…` (alias for `src/`) → relative (`./github`). Inside `src/lib/`, relative imports between modules; elsewhere, `@/lib/…`. `cn` is imported from `"cn"`, not `@/lib/utils`.

## Constants

- Module constants in `UPPER_SNAKE_CASE` at the top of the file, unit in the name (`CACHE_TTL_MS`), with a comment when the value comes from a constraint (GraphQL quota, GitHub limit).
- One declaration per object: search the existing code (`grep`) before writing a helper, an API call or a storage key.

## State and storage

- Shared state: module stores + `useSyncExternalStore` (`src/lib/store.ts`, `settings.ts`). No state library, no Context for this.
- `localStorage`: keys prefixed with `pr-radar:`, reads and writes inside `try/catch` with a fallback (`null`, default value).

## Errors

- GitHub calls only through `src/lib/github.ts` (`fetch` from `@tauri-apps/plugin-http`, `trackQuota`, cache). Rejected token → `AuthError`, the UI goes back to login.
- Empty `catch {}` only for best-effort work (storage, notification); otherwise surface a readable message to the UI.
- No `console.log` left in shipped code.

## UI

- shadcn components in `src/components/ui/` (base-ui), added with `npx shadcn add`, not rewritten by hand.
- Tailwind v4, classes merged with `cn(...)`. Icons from `lucide-react`.
- UI strings in French and English: a `strings(fr, en)` dictionary `S` at the top of the file (`src/lib/i18n.ts`), read with `useStrings(S)` in components and `pick(S)` outside React. Dates and numbers with `locale()`, never a hardcoded `"fr-FR"`.
- Every new function in `src/lib/github.ts` or new `invoke` command gets its mock in `src/demo/` (same signature), otherwise `npm run demo` breaks.

## Rust side (`src-tauri/`)

- New `#[tauri::command]` → `Result<_, String>`, registered in `invoke_handler`.
- New network access or plugin → minimal permission in `src-tauri/capabilities/` and updated CSP in `tauri.conf.json`.
- `cargo clippy -- -D warnings` clean.
