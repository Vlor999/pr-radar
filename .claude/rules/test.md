---
description: "Tests de PR Radar : node:test sur la logique pure de src/lib, cargo test côté Rust."
paths:
  - "src/lib/**"
  - "src-tauri/src/**"
---

# Tests

## Front

- Runner : `node --test` natif (`npm test` = `src/lib/*.test.ts`), assertions `node:assert/strict`. Pas de Jest/Vitest.
- Fichier `<module>.test.ts` à côté du module, imports relatifs avec l'extension `.ts` (`./tree.ts`).
- On teste la logique pure de `src/lib/` (arbre, tri, filtres, états). Pas de test de composant React, pas d'appel réseau : un module qui touche `fetch` ou Tauri se teste via ses fonctions pures extraites.
- Données de test : petite factory locale avec `Partial<T>` en surcharge (cf. `pr()` dans `tree.test.ts`).
- Noms de test en français, sous forme de comportement : `test("une PR stackée est rangée sous la PR dont elle part", …)`.
- Un test = un comportement. Arrange / Act / Assert lisibles sans commentaires.

## Rust

- `cargo test` dans `src-tauri/`, tests `#[cfg(test)] mod tests` dans le fichier concerné.

## Quand

- Tout bug corrigé dans `src/lib/` ou `src-tauri/` → un test qui échoue sans le correctif.
- Nouvelle logique non triviale (branche, boucle, parsing) → au moins un test. Pas de test pour un one-liner.
