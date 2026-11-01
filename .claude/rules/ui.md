---
description: "PR Radar visual direction (unslop pass): radius, color semantics, counts, icons, type, motion. Keep new UI consistent with it."
paths:
  - "src/components/**"
  - "src/index.css"
---

# UI

New screen or visible change: run the `unslop` skill (`.claude/skills/unslop/`) in polish mode, with the direction below as given. Do not invent a new one.

## Direction

- **Product:** desktop radar of every open GitHub PR a developer owns, reviews or is blocked on, as branch stacks, with CI and merge state at a glance.
- **Character:** exact, quiet, triage-first.
- **World:** a terminal and a git branch graph: mono refs, hairline rails, one green "go" light.
- **Moments:** the stacked-PR branch tree (rails + cards), and the CI graph when opened.
- **Signature:** the branch rail joining stacked cards, plus the card status edge (green = ready to merge, red = needs action), the only colour that marks state on a card.

## Radius by size

`--radius: 0.625rem` in `src/index.css` gives `rounded-sm` 6, `md` 8, `lg` 10, `xl` 14, `2xl` 18 px.

- Keycap, tag, badge, `xs` button: `rounded-sm`. `sm` button: `rounded-md`. Control (button, input, select, textarea, row): `rounded-lg`. Card, popover, menu: `rounded-xl`. Dialog, palette: `rounded-2xl`.
- Nested: inner = outer − padding, never below 4px.
- `rounded-full` only for avatars, dots, the switch and progress bars. No `rounded-3xl` / `rounded-4xl`.

### `src/components/ui/*`: hand-edited radius (deviation from the `base-luma` preset)

`npx shadcn add` / update brings back the preset pills: `components.json` has no radius setting per component. After any add or update, reapply:

| File | Class |
| --- | --- |
| `badge.tsx` | `rounded-sm` |
| `button.tsx` | base `rounded-lg`; `xs`, `icon-xs` `rounded-sm`; `sm`, `icon-sm` `rounded-md` |
| `card.tsx` | `rounded-xl` (+ `rounded-t-xl`, `rounded-b-xl`), `shadow-xs ring-foreground/8` |
| `dialog.tsx` | `rounded-2xl` |
| `command.tsx` | root `rounded-xl`, dialog `rounded-2xl!`, item `rounded-lg` (also in dialog) |
| `popover.tsx` | `rounded-xl` |
| `select.tsx` | trigger `rounded-lg`, popup `rounded-xl`, item `rounded-lg` |
| `input.tsx`, `textarea.tsx` | `rounded-lg` |
| `input-group.tsx` | group `rounded-lg` (`rounded-xl` with block addons, `rounded-lg` with textarea), button `rounded-md`, `xs` / `icon-xs` `rounded-sm`, addon kbd `rounded-sm` |
| `kbd.tsx` | `rounded-sm` |

Only radius and the card shadow were edited. Everything else stays as shadcn generates it.

## Color

- Solid `primary` badge = "Ready to merge" only. Approved = `outline` badge + `Check` in `text-green-600 dark:text-green-400`.
- Unseen PR ("New") = `size-2 rounded-full bg-emerald-500` dot before the title, with `role="img"`, `aria-label` and `title` (FR + EN). Same emerald dot for "has open PRs" and "requested from me".
- Card status edge: 3px inset bar (`before:w-0.75 before:inset-y-3`), `bg-destructive` = needs action, `bg-primary` = ready to merge. No `border-l-4`.
- Surfaces stay neutral (mist). Semantic colours (green/red/amber) carry meaning only.

## Components

- Counts are text, not a nested `Badge`: `tabular-nums`, muted (`opacity-70` inside a button, `text-muted-foreground` elsewhere).
- Cards: `Card` default `shadow-xs` + hairline. No `shadow-md`/`shadow-lg`; keyboard focus = ring + `bg-primary/5`.
- Icons: `lucide-react` only, one size per context (badge icons from `Badge`, `size-4` in tabs and nav). No text glyphs as icons (`✓ ✗ … ● ◌`).

## Type and spacing

- Sentence case. No `uppercase` + `tracking-*` labels. No `tracking-tight` under display sizes (≥ 40px).
- Weights 400–600. Numbers `tabular-nums`.
- 4px grid. No arbitrary sizes (`text-[0.7rem]`, `mt-[13px]`); exception: `text-[10px]` initials in 20px avatars.

## Motion

- One curve: `ease-out` = `cubic-bezier(0.22, 1, 0.36, 1)` (`--ease-out` in `src/index.css`).
- Durations: 150ms state/hover, 200ms thumbs, underlines, menus, 300ms entrances.
- Animate `transform`, `opacity`, colours only; `transition-colors` / `transition-transform`, not `transition-all`. Known exceptions, do not copy: the segmented thumbs (`settings-ui.tsx`, `merge-calendar.tsx`) and the collapsing PR action button (`pr-card.tsx`).
- Looping animation only on things that are live (spinners, loading skeletons), always with `motion-reduce:animate-none`.
