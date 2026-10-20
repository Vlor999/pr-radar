---
description: "Protocole des sous-agents d'implémentation et de revue sur PR Radar : modèle, worktree, skills, sortie."
---

# Sous-agents

**Une tâche = un sous-agent = un worktree = une PR vers `dev`.**

## Lancement

- **Modèle** : renseigné à chaque lancement (`model` de l'outil Agent), selon la tâche.
  - Opus : implémentation (code, tests, PR), conception, revue de sécurité, bug dont la cause n'est pas trouvée.
  - Sonnet : tâche bornée et mécanique (doc, renommage, migration répétitive), relecteurs `mr-review`.
  - Haiku : recherche et exploration en lecture seule.
  - Fable : planification ou correction extrême. **Demander à l'utilisateur avant.**
  En cas de doute, le plus capable, sauf Fable.
- **Isolation** : worktree depuis `origin/dev` (skill `worktree`, dossier `.claude/worktrees/<slug>`). Jamais deux agents sur les mêmes fichiers.
- **Contexte dans le prompt** : la tâche (ou l'issue GitHub), les règles applicables (`CLAUDE.md`, `.claude/rules/`), les fichiers d'entrée connus. L'agent ne doit rien deviner.

## Skills à donner systématiquement

- `ponytail` : la solution la plus simple qui marche, réutiliser l'existant.
- `logical-commit-sequencer` : commits atomiques ordonnés avant le push.
- `worktree` pour une implémentation, `mr-review` (mode lecture seule) pour une revue.

## Exigences de sortie

1. Vérifs vertes avant push (`CLAUDE.md` § Vérifs).
2. Changement visible : l'agent ne commit pas avant validation. Il rend la main à l'orchestrateur, qui lance `npm run demo` et obtient la validation de l'utilisateur.
3. PR `gh pr create --base dev`, format de `projet.md`, aucune question dans le body.
4. Rapport final : URL de la PR, décisions prises, travail restant.

## Après la revue

- Un sous-agent ne lance pas d'agents : l'orchestrateur lance les relecteurs et consolide.
- Les commentaires de revue retournent à l'agent d'origine (il a le contexte), qui corrige par de nouveaux commits sur la même branche.
- Après merge : worktree supprimé.
- Agents en parallèle uniquement sur des zones de code disjointes.
