import { cn } from "cn"
import { Plus, X } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import { GithubMark } from "@/components/auth-source-icon"
import {
  Count,
  LIST_ROW,
  ListFooter,
  ListToolbar,
  pulse,
  ScrollList,
  SlackAvatar,
} from "@/components/settings/slack-list"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { UserCommand } from "@/components/user-command"
import { GITHUB } from "@/lib/accounts"
import { allAccounts, findAccount } from "@/lib/auth"
import { searchAssignable, type AssignableUser } from "@/lib/github"
import { locale, strings, useStrings } from "@/lib/i18n"
import { matchRecipients } from "@/lib/reviewers"
import {
  confirmLink,
  contactCounts,
  contactKey,
  filterContacts,
  linkAccount,
  resolveLinks,
  unlinkAccount,
  useSlackGithubMap,
  type ContactFilter,
  type ContactRow,
  type ContactStatus,
  type ResolvedLink,
} from "@/lib/slack-github-map"
import { getRepos } from "@/lib/store"
import type { SlackConversation } from "@/lib/types"

const SEARCH_DEBOUNCE_MS = 250 // une requête GraphQL par frappe sinon
/** repos lus par compte, comme MAP_REPOS_MAX de src/lib/github.ts (message de liste tronquée) */
const REPOS_PER_ACCOUNT = 30
const STATUSES: ContactStatus[] = ["todo", "linked", "none"]
/** pastille de chaque statut (texte à côté : décorative) ; aucun compte = couleur des filets */
const DOT: Record<ContactStatus, string> = {
  todo: "bg-amber-500",
  linked: "bg-primary",
  none: "bg-border",
}

/** Clé d'un compte GitHub vu par un compte PR Radar : le même utilisateur peut l'être par deux comptes. */
const userKey = (u: { account?: string; login: string }) =>
  `${u.account ?? ""}|${u.login.toLowerCase()}`

const S = strings(
  {
    title: "Comptes GitHub des contacts",
    contacts: (n: number) =>
      `${n} contact${n > 1 ? "s" : ""} de DM Slack, proposés en reviewers des PR que tu leur envoies`,
    contactsLoading: "Chargement des contacts de DM Slack…",
    counts: { todo: "à confirmer", linked: "liés", none: "sans compte" },
    filters: {
      all: "Tous",
      todo: "À confirmer",
      linked: "Liés",
      none: "Aucun",
    },
    filterBy: "Filtrer par statut",
    search: "Rechercher un contact",
    searchPlaceholder: "Nom, @identifiant ou login GitHub",
    noMatch: (q: string) => `Aucun contact ne correspond à « ${q} ».`,
    legend: "Pointillés = trouvé par le nom · plein = confirmé",
    loading: "Recherche des correspondances…",
    none: "Aucun compte",
    empty: "Aucun DM 1:1",
    auto: "trouvé par le nom",
    manual: "ajouté à la main",
    add: (name: string) => `Lier un compte GitHub à ${name}`,
    remove: (login: string) => `Retirer ${login}`,
    confirm: (login: string) => `Confirmer ${login}`,
    loadError: "Impossible de lire les utilisateurs GitHub des repos suivis.",
    searchError: "Recherche GitHub impossible.",
    retry: "Réessayer",
    truncated: (max: number) =>
      `Seuls les ${max} premiers repos suivis de chaque compte sont lus.`,
  },
  {
    title: "Contacts' GitHub accounts",
    contacts: (n: number) =>
      `${n} Slack DM contact${n > 1 ? "s" : ""}, suggested as reviewers of the PRs you send them`,
    contactsLoading: "Loading Slack DM contacts…",
    counts: { todo: "to confirm", linked: "linked", none: "no account" },
    filters: { all: "All", todo: "To confirm", linked: "Linked", none: "None" },
    filterBy: "Filter by status",
    search: "Search contacts",
    searchPlaceholder: "Name, @handle or GitHub login",
    noMatch: (q: string) => `No contact matches “${q}”.`,
    legend: "Dashed = found by name · solid = confirmed",
    loading: "Looking for matches…",
    none: "No account",
    empty: "No 1:1 DM",
    auto: "found by name",
    manual: "added by hand",
    add: (name: string) => `Link a GitHub account to ${name}`,
    remove: (login: string) => `Remove ${login}`,
    confirm: (login: string) => `Confirm ${login}`,
    loadError: "Could not read the GitHub users of the followed repos.",
    searchError: "GitHub search failed.",
    retry: "Retry",
    truncated: (max: number) =>
      `Only the first ${max} followed repos of each account are read.`,
  },
)

type Contact = NonNullable<SlackConversation["contact"]> & { name: string }
type Row = ContactRow & { contact: Contact }

/**
 * Table Slack → GitHub (1:N) : un contact par DM 1:1, ses comptes liés en pastilles, avec recherche, filtres
 * par statut et hauteur bornée (~8 lignes, défilement propre). `convs` absent : lignes fantômes. Pas de
 * virtualisation : 50 à 200 lignes restent légères. Correspondances automatiques calculées en local sur
 * les utilisateurs assignables des repos suivis (`searchAssignable` : une requête par compte, en cache
 * 10 min), pas une requête par contact ; elles s'ajoutent aux lignes déjà affichées.
 */
export function SlackGithubTable({
  convs,
  team,
}: {
  convs: SlackConversation[] | null
  team: string
}) {
  const t = useStrings(S)
  const map = useSlackGithubMap()
  const [found, setFound] = useState<{
    users: AssignableUser[]
    truncated: boolean
  } | null>(null)
  // échec : `found` reste null, message traduit et « Réessayer » (relance par `attempt`)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<ContactFilter>("all")
  const users = found?.users
  const multi = allAccounts().length > 1
  const contacts = useMemo(() => {
    const collator = new Intl.Collator(locale(), { sensitivity: "base" })
    return convs
      ?.flatMap((c) =>
        c.kind === "im" && c.contact ? [{ ...c.contact, name: c.name }] : [],
      )
      .sort(
        // pas encore nommés (id Slack) à la fin
        (a, b) =>
          Number(!a.names.length) - Number(!b.names.length) ||
          collator.compare(a.name, b.name),
      )
  }, [convs])
  const count = contacts?.length ?? 0

  useEffect(() => {
    if (!count) return
    let live = true
    setFailed(false)
    searchAssignable(getRepos() ?? [], "").then(
      (r) => live && setFound(r),
      () => live && setFailed(true), // détail dans le journal (github.error)
    )
    return () => {
      live = false
    }
  }, [count, attempt])

  const rows = useMemo(
    () =>
      contacts?.map((c): Row => {
        const auto = matchRecipients(
          [{ id: c.user, names: c.names.length ? c.names : [c.name] }],
          users ?? [],
        ).map((u) => ({
          provider: "github" as const,
          login: u.login,
          id: u.id,
          ...(multi && { account: u.account }),
        }))
        return {
          user: c.user,
          name: c.name,
          names: c.names,
          ...(c.handle && { handle: c.handle }),
          links: resolveLinks(map[contactKey(team, c.user)], auto),
          contact: c,
        }
      }),
    [contacts, users, map, team, multi],
  )
  const counts = rows && contactCounts(rows)
  const shown = rows && filterContacts(rows, query, filter)
  const matching = !users && !failed

  return (
    <div className="-mx-4 border-t">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2 px-4 py-3">
        <div className="min-w-0">
          <div className="text-sm font-medium">{t.title}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {rows ? t.contacts(count) : t.contactsLoading}
          </div>
        </div>
        {counts && count > 0 && (
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground tabular-nums">
            {STATUSES.map((s) => (
              <Count key={s} n={counts[s]} label={t.counts[s]} dot={DOT[s]} />
            ))}
          </div>
        )}
      </div>
      {failed && (
        <p className="flex items-center gap-2 px-4 pb-3 text-xs text-destructive">
          {t.loadError}
          <Button
            variant="outline"
            size="xs"
            className="cursor-pointer"
            onClick={() => setAttempt((n) => n + 1)}
          >
            {t.retry}
          </Button>
        </p>
      )}
      {found?.truncated && (
        <p className="px-4 pb-3 text-xs text-muted-foreground">
          {t.truncated(REPOS_PER_ACCOUNT)}
        </p>
      )}
      {rows && !count ? (
        <p className="px-4 pb-3 text-sm text-muted-foreground">{t.empty}</p>
      ) : (
        <>
          <ListToolbar
            query={query}
            onQuery={setQuery}
            placeholder={t.searchPlaceholder}
            searchLabel={t.search}
            filter={filter}
            onFilter={setFilter}
            filterLabel={t.filterBy}
            options={(["all", ...STATUSES] as const).map((f) => ({
              value: f,
              label: t.filters[f],
              ...(f !== "all" && counts && { count: counts[f] }),
            }))}
          />
          <ScrollList
            query={query}
            noMatch={t.noMatch}
            rows={
              shown?.map((r) => (
                <ContactItem
                  key={r.user}
                  row={r}
                  team={team}
                  matching={matching}
                  multi={multi}
                />
              )) ?? null
            }
            skeleton={
              <>
                <span className={cn("size-6 shrink-0 rounded-full", pulse)} />
                <span className="flex w-40 shrink-0 flex-col gap-1.5">
                  <span className={cn("h-3 w-28 rounded-sm", pulse)} />
                  <span className={cn("h-2.5 w-16 rounded-sm", pulse)} />
                </span>
                <span className={cn("h-6 w-24 rounded-sm", pulse)} />
              </>
            }
          />
          <ListFooter
            shown={shown?.length}
            total={count}
            status={shown && matching ? t.loading : undefined}
          >
            <span>{t.legend}</span>
          </ListFooter>
        </>
      )}
    </div>
  )
}

/** Ligne d'un contact : avatar, nom et @identifiant, pastilles des comptes liés, « + ». */
function ContactItem({
  row,
  team,
  matching,
  multi,
}: {
  row: Row
  team: string
  /** correspondances par nom pas encore lues */
  matching: boolean
  multi: boolean
}) {
  const t = useStrings(S)
  const { contact: c, links } = row
  const other = c.names.filter((n) => n !== c.name).join(" · ")
  return (
    <li className={LIST_ROW}>
      <SlackAvatar contact={c} />
      <div className="w-40 min-w-0 shrink-0">
        <p className="truncate text-sm" title={other || undefined}>
          {c.name}
        </p>
        {c.handle && (
          <p className="truncate text-xs text-muted-foreground">@{c.handle}</p>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        {links.map((l) => (
          <LinkChip
            key={`${l.account ?? ""}|${l.login}`}
            link={l}
            onConfirm={() => confirmLink(team, c.user, l)}
            onRemove={() => unlinkAccount(team, c.user, l)}
          />
        ))}
        {!links.length &&
          (matching ? (
            <span aria-hidden className={cn("h-6 w-24 rounded-sm", pulse)} />
          ) : (
            <span className="text-xs text-muted-foreground">{t.none}</span>
          ))}
        <LinkPicker
          label={t.add(c.name)}
          linked={links.map(userKey)}
          onPick={(u) =>
            linkAccount(team, c.user, {
              provider: "github",
              login: u.login,
              id: u.id,
              ...(multi && { account: u.account }),
            })
          }
        />
      </div>
    </li>
  )
}

/** Compte lié : automatique en pointillés grisés (comme le reviewer fantôme d'une carte), un clic le confirme
 * (il devient manuel, plein) ; manuel plein, seule la croix agit. */
function LinkChip({
  link,
  onConfirm,
  onRemove,
}: {
  link: ResolvedLink
  onConfirm: () => void
  onRemove: () => void
}) {
  const t = useStrings(S)
  const auto = link.origin === "auto"
  const account = link.account && findAccount(link.account)
  const origin = auto ? t.auto : t.manual
  const where = account ? ` · ${account.login} · ${account.host}` : ""
  const body = (
    <>
      <GithubMark className="size-3 shrink-0" />
      <span className="font-mono">{link.login}</span>
    </>
  )
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded-sm border text-xs",
        auto
          ? "border-dashed text-muted-foreground transition-colors duration-150 ease-out hover:bg-muted/50"
          : "bg-muted/50",
      )}
    >
      {auto ? (
        <button
          type="button"
          onClick={onConfirm}
          aria-label={t.confirm(link.login)}
          title={`${t.confirm(link.login)} (${origin}${where})`}
          className="inline-flex h-full cursor-pointer items-center gap-1 rounded-sm pr-1 pl-1.5 transition-colors duration-150 ease-out hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {body}
        </button>
      ) : (
        <span
          title={`${link.login} (${origin}${where})`}
          className="inline-flex items-center gap-1 pr-1 pl-1.5"
        >
          {body}
          <span className="sr-only">({origin})</span>
        </span>
      )}
      <Button
        variant="ghost"
        size="icon-xs"
        // dans la pastille de 24 px bordure comprise : 20 px
        className="size-5 cursor-pointer"
        onClick={onRemove}
        aria-label={t.remove(link.login)}
        title={t.remove(link.login)}
      >
        <X />
      </Button>
    </span>
  )
}

/** « + » d'un contact : recherche parmi les utilisateurs assignables des repos suivis. */
function LinkPicker({
  label,
  linked,
  onPick,
}: {
  label: string
  linked: string[]
  onPick: (u: AssignableUser) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const t = useStrings(S)
  const [users, setUsers] = useState<AssignableUser[] | null>(null)
  const [error, setError] = useState<string>()
  const q = query.trim()
  const multi = allAccounts().length > 1

  useEffect(() => {
    if (!open) return
    let live = true
    const id = setTimeout(
      () =>
        searchAssignable(getRepos() ?? [], q).then(
          (r) => {
            if (!live) return
            setUsers(r.users)
            setError(undefined)
          },
          () => {
            if (!live) return
            setUsers(null)
            setError(t.searchError) // détail dans le journal (github.error)
          },
        ),
      q ? SEARCH_DEBOUNCE_MS : 0,
    )
    return () => {
      live = false
      clearTimeout(id)
    }
  }, [open, q, t.searchError])

  // déjà liés (sur ce compte, ou sans compte précisé), et mes propres comptes : jamais reviewers de mes PR
  const mine = new Set(
    allAccounts().flatMap((a) => (a.login ? [a.login.toLowerCase()] : [])),
  )
  const taken = (u: AssignableUser) =>
    mine.has(u.login.toLowerCase()) ||
    linked.includes(userKey(u)) ||
    linked.includes(userKey({ login: u.login }))
  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v)
        if (!v) {
          setQuery("")
          setUsers(null)
          setError(undefined)
        }
      }}
    >
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            className="cursor-pointer"
            aria-label={label}
            title={label}
          />
        }
      >
        <Plus />
      </PopoverTrigger>
      <PopoverContent align="start" aria-label={label} className="p-2">
        <UserCommand
          query={query}
          onQueryChange={setQuery}
          users={users?.filter((u) => !taken(u)) ?? null}
          error={error}
          // avatars par login : seulement si tous les comptes sont sur github.com (voir `Avatar`)
          url={
            allAccounts().every((a) => a.host === GITHUB)
              ? "https://github.com/"
              : undefined
          }
          // même utilisateur vu par deux comptes : deux lignes, chacune avec son compte
          keyOf={(u) => `${u.account}|${u.id}`}
          note={(u) => (multi ? findAccount(u.account)?.login : undefined)}
          onPick={(u) => {
            onPick(u)
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}
