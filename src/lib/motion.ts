/** Animations de l'interface : préférence « réduire les animations » du système. */
export const reducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches

export const wait = (ms: number) =>
  new Promise<void>((done) => setTimeout(done, ms))

/** Attend la fin d'une animation de `ms`, sans attendre si les animations sont réduites. */
export const pause = (ms: number) => wait(reducedMotion() ? 0 : ms)

/** coche de succès d'une action affichée avant la suite (rétractation du bouton, relecture) */
export const DONE_MS = 700

/** Coche verte de succès d'une action (comme dans les réglages). */
export const DONE_ICON =
  "text-green-600 animate-in zoom-in-50 fade-in duration-300 motion-reduce:animate-none dark:text-green-400"
