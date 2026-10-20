---
description: "PR Radar tests: node:test on the pure logic of src/lib, cargo test on the Rust side."
paths:
  - "src/lib/**"
  - "src-tauri/src/**"
---

# Tests

## Front

- Runner: native `node --test` (`npm test` = `src/lib/*.test.ts`), assertions from `node:assert/strict`. No Jest/Vitest.
- `<module>.test.ts` next to the module, relative imports with the `.ts` extension (`./tree.ts`).
- Test the pure logic of `src/lib/` (tree, sort, filters, states). No React component tests, no network calls: a module that touches `fetch` or Tauri is tested through its extracted pure functions.
- Test data: a small local factory with a `Partial<T>` override (see `pr()` in `tree.test.ts`).
- Test names describe a behavior. Existing tests use French names; keep the language of the file you edit.
- One test = one behavior. Arrange / Act / Assert readable without comments.

## Rust

- `cargo test` in `src-tauri/`, tests in a `#[cfg(test)] mod tests` inside the file under test.

## When

- Every bug fixed in `src/lib/` or `src-tauri/` → a test that fails without the fix.
- New non-trivial logic (branch, loop, parsing) → at least one test. No test for a one-liner.
