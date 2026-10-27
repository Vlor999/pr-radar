/** Lien d'un commentaire GitHub ouvrable dans le navigateur du système : https absolu seulement
 * (ancre, lien relatif, `mailto:` : rien à ouvrir, l'opener n'autorise que `https://**`). */
export const isExternalHref = (href: string) => {
  try {
    return new URL(href).protocol === "https:"
  } catch {
    return false
  }
}
