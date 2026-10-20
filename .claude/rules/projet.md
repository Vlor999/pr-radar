---
description: "Règles projet de PR Radar : branches, commits, PR, validation, release, sécurité."
---

# Projet

## Branches

- `dev` = branche de travail (par défaut). Petit changement : commit direct sur `dev`. Sinon branche `<type>/<slug>` depuis `origin/dev` → PR vers `dev` (skill `worktree`).
- `main` ne reçoit que la PR `dev → main`, en merge commit (pas de squash : `dev` et `main` divergeraient). Ruleset + check `source-branch` l'imposent.
- Merge sur `main` = release si la version de `package.json` est nouvelle (skill `release`). Pas de tag manuel.
- Pas de force-push ni de suppression sur `dev`/`main`. Après un push, corriger par un nouveau commit, pas d'`--amend`.

## Commits et PR

- Conventional Commits (`feat`, `fix`, `perf`, `ci`, `chore`, `docs`, `refactor`, `test`), en anglais, avec le trailer `Co-Authored-By`.
- Commits atomiques ordonnés par dépendance : skill `logical-commit-sequencer`.
- Body de PR en français : `## Intention` / `## Choix et points d'attention`. Aucune question dans le body : une décision ouverte se tranche avec l'utilisateur avant d'ouvrir la PR.
- Revue : skill `mr-review`.

## Validation

- Vérifs vertes avant tout push (`CLAUDE.md` § Vérifs). Jamais `--no-verify`.
- Changement visible : démo `npm run demo` (skill `demo`) et validation explicite de l'utilisateur avant commit.
- Rester dans le périmètre demandé : pas de refactor ni de feature spéculative. Simplicité d'abord (`ponytail`).

## Sécurité

- Jamais afficher ni commiter la clé de signature (`~/.tauri/pr-radar.key`) ni le jeton GitHub de l'utilisateur.
- `site/` et `src/demo/` : données fictives uniquement (`acme`, `globex`).
- Workflows GitHub : actions épinglées par SHA, `permissions` minimales, valeurs contrôlables par un tiers (`head_ref`, titres de PR) passées par `env`, jamais interpolées dans `run`.
