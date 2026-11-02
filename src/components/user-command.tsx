import { Loader2 } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { Avatar } from "@/components/avatar"
import { SlackLogo } from "@/components/slack-logo"
import {
  Command,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { strings, useStrings } from "@/lib/i18n"
import type { Candidate } from "@/lib/reviewers"

const S = strings(
  {
    search: "Rechercher un utilisateur",
    none: "Aucun utilisateur",
    slackTitle: "Tu lui as envoyé la PR en DM sur Slack",
  },
  {
    search: "Search a user",
    none: "No user",
    slackTitle: "You sent them the PR in a Slack DM",
  },
)

/**
 * Recherche d'un utilisateur GitHub dans un popover (reviewers d'une PR, table Slack → GitHub des réglages).
 * cmdk : flèches, Entrée, survol et ARIA de combobox ; la recherche est faite par GitHub, pas de filtre local.
 * `users` null : chargement. Après un choix, le focus reste à la recherche.
 */
export function UserCommand(props: {
  query: string
  onQueryChange: (q: string) => void
  users: Candidate[] | null
  error?: string
  /** URL GitHub d'un objet du même hôte : avatars (voir `Avatar`) */
  url?: string
  onPick: (u: Candidate) => void
}) {
  const t = useStrings(S)
  const input = useRef<HTMLInputElement>(null)
  /** ligne active (flèches, Entrée) : login, valeur de l'item cmdk */
  const [active, setActive] = useState("")
  // résultats changés (recherche, choix) : la 1re ligne redevient active
  const logins = props.users?.map((u) => u.login).join("\n") ?? ""
  useEffect(() => setActive(logins.split("\n")[0]), [logins])

  return (
    <Command
      shouldFilter={false}
      vimBindings={false}
      value={active}
      onValueChange={setActive}
      className="gap-2 rounded-none bg-transparent p-0 **:data-[slot=command-input-wrapper]:p-0"
    >
      <CommandInput
        ref={input}
        autoFocus
        value={props.query}
        onValueChange={props.onQueryChange}
        placeholder={t.search}
        aria-label={t.search}
      />
      {props.error && (
        <p role="alert" className="px-2 text-xs text-destructive">
          {props.error}
        </p>
      )}
      <CommandList className="max-h-64">
        {!props.users ? (
          !props.error && (
            <Loader2 className="mx-auto my-2 size-4 animate-spin text-muted-foreground motion-reduce:animate-none" />
          )
        ) : props.users.length ? (
          props.users.map((u) => (
            <CommandItem
              key={u.id}
              value={u.login}
              onSelect={() => {
                props.onPick(u)
                input.current?.focus()
              }}
              className="px-2 py-1.5 font-normal"
            >
              <Avatar login={u.login} url={props.url} />
              <span className="min-w-0 flex-1 truncate">{u.login}</span>
              {u.name && (
                <span className="min-w-0 truncate text-xs text-muted-foreground">
                  {u.name}
                </span>
              )}
              {u.slack && (
                <span
                  role="img"
                  aria-label={t.slackTitle}
                  title={t.slackTitle}
                  className="text-muted-foreground"
                >
                  <SlackLogo mono className="size-3.5" />
                </span>
              )}
            </CommandItem>
          ))
        ) : (
          <p className="px-2 py-1 text-muted-foreground">{t.none}</p>
        )}
      </CommandList>
    </Command>
  )
}
