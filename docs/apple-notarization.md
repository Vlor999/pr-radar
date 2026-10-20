# Signature et notarisation Apple

En place depuis v0.3.4 : `release.yml` signe + notarise les builds macOS avec les 6 secrets ci-dessous. Sans eux → signature ad hoc. Étapes ci-dessous = pour renouveler le certificat.

Ne jamais coller les valeurs (mots de passe, .p12, base64) dans un chat ou un commit.

## 1. Attendre l'activation du compte

Email « Welcome to the Apple Developer Program ». Vérifier sur https://developer.apple.com/account que l'adhésion est active.

## 2. Créer le certificat Developer ID Application

1. Trousseau d'accès > Assistant de certification > Demander un certificat à une autorité → « Enregistré sur disque » → `CertificateSigningRequest.certSigningRequest`.
2. https://developer.apple.com/account/resources/certificates → **+** → **Developer ID Application** (pas « Apple Development », pas « Mac App Distribution ») → envoyer le CSR → télécharger le `.cer`.
3. Double-cliquer le `.cer` → s'installe dans le trousseau « session ».
4. Vérifier :
   ```sh
   security find-identity -v -p codesigning
   ```
   Ligne attendue : `"Developer ID Application: Prénom Nom (TEAMID)"`.

## 3. Exporter en .p12

Trousseau d'accès > Mes certificats > clic droit sur « Developer ID Application: … » (avec sa clé privée) > Exporter → format `.p12` → choisir un mot de passe.

```sh
base64 -i DeveloperID.p12 | pbcopy
```

## 4. Mot de passe d'app Apple ID

https://account.apple.com → Connexion et sécurité → Mots de passe pour app → en créer un (« pr-radar-notary »). Format `xxxx-xxxx-xxxx-xxxx`.

## 5. Team ID

https://developer.apple.com/account → Membership details → Team ID (10 caractères). Aussi visible entre parenthèses dans l'identité du certificat.

## 6. Ajouter les 6 secrets GitHub

Repo → Settings → Secrets and variables → Actions → New repository secret. Ou en CLI (la valeur est demandée en saisie masquée) :

```sh
pbpaste | gh secret set APPLE_CERTIFICATE           # base64 du .p12 (étape 3)
gh secret set APPLE_CERTIFICATE_PASSWORD            # mot de passe du .p12
gh secret set APPLE_SIGNING_IDENTITY                # "Developer ID Application: Prénom Nom (TEAMID)"
gh secret set APPLE_ID                              # email de l'Apple ID
gh secret set APPLE_PASSWORD                        # mot de passe d'app (étape 4)
gh secret set APPLE_TEAM_ID                         # Team ID (étape 5)
gh secret list
```

Ensuite : supprimer le `.p12` et le CSR du disque (le certificat reste dans le trousseau).

## 7. Prévenir Claude : « c'est fait »

Claude s'occupe de :
- tagger une nouvelle release ;
- télécharger le `.dmg` arm64 et vérifier :
  ```sh
  # Tauri notarise l'app, pas le .dmg (qui reste seulement signé) → vérifier l'app montée
  hdiutil attach -nobrowse -readonly PR.Radar_*.dmg
  spctl --assess --type execute -v "/Volumes/PR Radar/PR Radar.app"   # accepted, Notarized Developer ID
  xcrun stapler validate "/Volumes/PR Radar/PR Radar.app"
  hdiutil detach "/Volumes/PR Radar"
  ```

## À retenir

- Certificat actuel (Team `4WTQGGKVHL`) expire le **19 novembre 2027** → recréer (étapes 2-3) et remettre `APPLE_CERTIFICATE` + `APPLE_CERTIFICATE_PASSWORD` avant ; l'adhésion se renouvelle chaque année (99 $). Adhésion expirée → les builds déjà notarisés restent valides, les nouveaux ne le sont plus.
- Mot de passe d'app révoqué ou mot de passe Apple ID changé → recréer `APPLE_PASSWORD`.
- Erreur `HTTP status code: 401` à la notarisation → `APPLE_ID`/`APPLE_PASSWORD` faux. Tester en local : `xcrun notarytool history --apple-id EMAIL --team-id 4WTQGGKVHL`.

## Reste à tester

- [x] Mise à jour intégrée
- [x] Désinstallation
- [ ] Notifications macOS : reçue une fois, fiabilité non confirmée. Tester via Réglages > bouton de test, vérifier Réglages Système > Notifications > PR Radar (style « Bannières » ou « Alertes »), puis attendre un vrai événement PR. À refaire après la release notarisée (identité de signature change → macOS peut redemander l'autorisation).
