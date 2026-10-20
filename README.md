<p align="center"><img src="assets/logo/logo.svg" width="96" alt="PR Radar"></p>

<h1 align="center">PR Radar</h1>

Vos PR GitHub ouvertes, en arbre : stacks, reviews, discussions et merges, dans une app de bureau légère.

## Fonctionnalités

- Arbre des PR par repo, avec stacks « dépend de / bloque »
- Statut review, CI et conflits
- Discussions non résolues affichées avec le code, réponse directe
- Filtres et recherche
- PR prêtes à merger / inactives
- Nouveau depuis ta dernière visite
- Calendrier des merges : mois, semaine, jour
- Choix des repos par organisation
- Notifications système
- Thème clair / sombre / auto
- Raccourcis clavier : `j` `k` `o` `e` `d`

## Télécharger

- Page de téléchargement : https://vlor999.github.io/pr-radar/
- Releases : https://github.com/Vlor999/pr-radar/releases

## Premier lancement

L'app n'a pas de certificat Apple payant (signature ad hoc seulement).

- macOS : lancer l'app une fois (macOS la bloque), puis Réglages Système > Confidentialité et sécurité > « Ouvrir quand même ». À faire une seule fois : les mises à jour s'installent ensuite depuis l'app. Ou
  ```sh
  xattr -dr com.apple.quarantine "/Applications/PR Radar.app"
  ```
- Windows (SmartScreen) : Informations complémentaires > Exécuter quand même.

## Connexion GitHub

Deux options :

1. **Se connecter avec GitHub** (device flow) : pas de serveur, le token est stocké dans le trousseau du système. Rien ne quitte votre machine hormis les appels à api.github.com.
2. **Personal access token** :
   - fine-grained : accès en lecture à Pull requests + Contents/Metadata, et écriture sur Pull requests pour répondre ;
   - ou classic avec le scope `repo`.

Les repos d'organisation peuvent exiger l'approbation de l'OAuth app par l'organisation, ou l'autorisation SSO du token.

## Confidentialité

Pas de backend, pas de télémétrie.

## Développement

Prérequis : Node 22+, Rust stable, [prérequis Tauri](https://v2.tauri.app/start/prerequisites/).

```sh
npm install
npm run tauri dev
npm test
```

Release : mettre à jour la version dans `src-tauri/tauri.conf.json` et `package.json`, puis :

```sh
git tag vX.Y.Z && git push --tags
```

### Mises à jour intégrées

L'app se met à jour toute seule : elle lit `latest.json` sur la dernière release, vérifie la signature avec la clé publique de `src-tauri/tauri.conf.json`, installe puis redémarre. La CI signe chaque version avec la clé privée stockée dans les secrets du repo (`TAURI_SIGNING_PRIVATE_KEY` et `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`). Sans cette clé, plus aucune mise à jour ne peut être publiée pour les apps déjà installées : en garder une copie hors du repo.

## Licence

MIT
