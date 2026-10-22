export type Reviewer = { login: string; id: string }

/**
 * Candidats reviewers d'une PR : suggestions GitHub en tête, puis utilisateurs assignables,
 * sans doublon (casse ignorée) ni login exclu (l'auteur, les reviews déjà demandées).
 */
export function reviewerCandidates(
  suggested: Reviewer[],
  assignable: Reviewer[],
  exclude: string[],
): Reviewer[] {
  const seen = new Set(exclude.map((l) => l.toLowerCase()))
  return [...suggested, ...assignable].filter(({ login }) => {
    const k = login.toLowerCase()
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}
