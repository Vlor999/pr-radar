import { cn } from "cn"
import { Search } from "lucide-react"
import { useState, type ReactNode } from "react"

import { Button } from "@/components/ui/button"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import { SLACK_SKELETON_ROWS } from "@/lib/constants"
import { strings, useStrings } from "@/lib/i18n"

// Briques des listes Slack des réglages (conversations surveillées, comptes GitHub des contacts) :
// recherche + filtres, liste bornée à ~8 lignes avec son défilement, pied « X sur N affichés ».

const S = strings(
  {
    noneInFilter: "Rien dans ce filtre.",
    shown: (x: number, n: number) => `${x} sur ${n} affichés`,
  },
  {
    noneInFilter: "Nothing in this filter.",
    shown: (x: number, n: number) => `${x} of ${n} shown`,
  },
)

/** chargement : fond qui pulse (arrêté si le mouvement est réduit) */
export const pulse = "animate-pulse bg-muted motion-reduce:animate-none"
/** ligne de 44 px, filet entre deux lignes */
export const LIST_ROW =
  "flex min-h-11 items-center gap-3 border-t px-4 py-1 first:border-t-0"

/** Compteur d'en-tête : nombre en avant, libellé discret, pastille décorative éventuelle. */
export function Count(props: { n: number; label: string; dot?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {props.dot && (
        <span aria-hidden className={cn("size-1.5 rounded-full", props.dot)} />
      )}
      <span className="font-medium text-foreground">{props.n}</span>
      {props.label}
    </span>
  )
}

/** Recherche et boutons de filtre (le compteur d'un filtre est du texte, pas un badge). */
export function ListToolbar<F extends string>(props: {
  query: string
  onQuery: (q: string) => void
  placeholder: string
  searchLabel: string
  filter: F
  onFilter: (f: F) => void
  filterLabel: string
  options: { value: F; label: string; count?: number }[]
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
      <InputGroup className="h-8 min-w-48 flex-1">
        <InputGroupAddon>
          <Search />
        </InputGroupAddon>
        <InputGroupInput
          type="search"
          value={props.query}
          onChange={(e) => props.onQuery(e.target.value)}
          placeholder={props.placeholder}
          aria-label={props.searchLabel}
          autoComplete="off"
        />
      </InputGroup>
      <div
        className="flex flex-wrap gap-1"
        role="group"
        aria-label={props.filterLabel}
      >
        {props.options.map((o) => (
          <Button
            key={o.value}
            size="sm"
            variant={props.filter === o.value ? "default" : "outline"}
            aria-pressed={props.filter === o.value}
            onClick={() => props.onFilter(o.value)}
          >
            {o.label}
            {o.count !== undefined && (
              <span className="tabular-nums opacity-70">{o.count}</span>
            )}
          </Button>
        ))}
      </div>
    </div>
  )
}

/**
 * Liste bornée à 8 lignes de 44 px, puis défilement. `rows` absent : lignes fantômes (`skeleton`) ;
 * vide : `noMatch` (recherche) ou « rien dans ce filtre ».
 */
export function ScrollList(props: {
  rows: ReactNode[] | null
  skeleton: ReactNode
  query: string
  noMatch: (q: string) => string
}) {
  const t = useStrings(S)
  const q = props.query.trim()
  return (
    <ul
      aria-busy={!props.rows}
      // relative : bloc conteneur des descendants positionnés (`sr-only` des pastilles), sinon ils
      // échappent au défilement et allongent la page jusqu'à leur position dans la liste
      className="relative max-h-88 overflow-y-auto border-t"
    >
      {!props.rows
        ? Array.from({ length: SLACK_SKELETON_ROWS }, (_, i) => (
            <li key={i} aria-hidden className={LIST_ROW}>
              {props.skeleton}
            </li>
          ))
        : props.rows}
      {props.rows && !props.rows.length && (
        <li className="px-4 py-6 text-center text-sm text-muted-foreground">
          {q ? props.noMatch(q) : t.noneInFilter}
        </li>
      )}
    </ul>
  )
}

/** Pied : « X sur N affichés » (annoncé), état éventuel, puis `children` à droite. */
export function ListFooter(props: {
  shown?: number
  total: number
  status?: string
  children?: ReactNode
}) {
  const t = useStrings(S)
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t px-4 py-2 text-xs text-muted-foreground tabular-nums">
      <span aria-live="polite">
        {props.shown !== undefined &&
          [t.shown(props.shown, props.total), props.status]
            .filter(Boolean)
            .join(" · ")}
      </span>
      {props.children}
    </div>
  )
}

/** Avatar Slack (48 px, affiché en 24 px), sinon l'initiale du nom. */
export function SlackAvatar({
  contact,
}: {
  contact: { name: string; image?: string }
}) {
  const [failed, setFailed] = useState(false)
  const base = "size-6 shrink-0 rounded-full bg-muted"
  return contact.image && !failed ? (
    <img
      src={contact.image}
      alt=""
      onError={() => setFailed(true)}
      className={base}
    />
  ) : (
    <span
      aria-hidden
      className={cn(
        base,
        "grid place-items-center text-xs font-medium uppercase",
      )}
    >
      {contact.name[0]}
    </span>
  )
}
