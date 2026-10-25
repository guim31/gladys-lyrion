# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration**: a Node.js service (Node 22+, ESM,
no build step) that runs in its own sandboxed Docker container and talks to
Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency. It started from the official JavaScript template.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/hub.test.js              # one file
node --test --test-name-pattern "announce" # tests whose name matches
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on
Node 22 and 24, and builds the Docker image: run the three commands before
pushing.

## Architecture

```
index.js                          SDK wiring only: handlers registered before connect()
src/app.js                        registers every SDK handler on a Gladys client (tests use the same)
src/hub.js                        the server, its players, states, scene events, commands, announcements
src/lms/client.js                 JSON-RPC client (POST /jsonrpc.js, basic auth, timeouts, images)
src/lms/listener.js               CLI `listen 1` on port 9090: "player changed" signals, reconnection
src/lms/model.js                  LMS answers -> snapshots (status, serverstatus, favorites)
src/devices.js                    player -> Gladys device, snapshot -> now playing + feature states
src/catalog.js                    Gladys 5.3 music panel: browse, search, play, queue (manifest `music`)
src/scenes.js                     scene action handlers (manifest `scene_actions`)
src/widgets.js                    dashboard widget "players" (manifest `widgets`)
src/texts.js                      every text of the container, in en/fr/de/es
src/config.js                     DEFAULT_CONFIG (mirrors the manifest defaults) + normalization
gladys-assistant-integration.json manifest: name, config_schema, triggers, actions, widget...
docs/{en,fr,de,es}.md             user documentation, re-hosted by Gladys (en and fr mandatory)
test/                             node --test, against the SDK's fake Gladys (integration-sdk/testing)
test/helpers/fakeLms.js           scripted Lyrion server (JSON-RPC + CLI) built on test/fixtures/lms/
.github/scripts/release.mjs       release helpers (manifest bump, changelog), tested in test/
```

## Rules

- **External ids are forever.** Build them with
  `gladys.externalIds(type, platformId)`, `platformId` being the unique id the
  platform gives the device (serial, cloud id, MAC), never a label. Gladys keys
  devices, their history, scenes and dashboards on them: changing one creates a
  new device and orphans the old one. The same goes for every key users store:
  manifest `config_schema`, `actions`, widget and scene keys, feature keys.
- **The container rootfs is read-only.** Write only under `/data`, the one
  writable volume. Never log tokens, passwords or API keys.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag,
  by hand — except on the README's hand-pushed tag path, which bumps all three
  together before tagging. `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md` (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`).
  Never write a version heading: the Release workflow moves the section, and it
  becomes the notes of the GitHub Release.
- **Manifest.** Texts are multi-language objects `{ "en": ..., "fr": ... }`:
  `label`, `description` and `placeholder` alike, never a plain string. The
  catalog `description` holds 10 to 100 characters per language. A field the
  older cores do not know needs a higher `gladys_version` minimum
  (`categories`: 4.86.0; `widgets`, `scene_triggers`, `scene_actions`,
  `type: "provider"`: 5.1.0). `test/manifest.test.js` ties the manifest to the
  code (defaults, action, scene and widget handlers): change both sides
  together.
- **User-facing text** exists in English, French, German and Spanish: action
  messages, widget texts, feature names, manifest texts, and `docs/{en,fr,de,es}.md`,
  kept in sync (`test/i18n.test.js`).
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network.

---

# Notes du mainteneur (guim31)

Ce qui suit complète les règles du template ci-dessus. Ce sont des faits vérifiés dans le code du
cœur Gladys ou payés sur les intégrations déjà publiées par guim31. Ils ne se lisent pas dans le
code de ce dépôt. Compléter ce fichier quand un nouveau piège est découvert.

## Travailler sur ce dépôt

- Mêmes étapes que la CI, dans le même ordre : `npm ci`, `npm run format:check`, `npm run lint`,
  `npm test`. Prettier contrôle **aussi le Markdown** : lancer `npm run format` après avoir
  modifié ce fichier, le README ou la documentation, sinon la CI tombe.
- Une session de code n'a **ni instance Gladys ni appareil réel**. La suite de tests, le lint et
  le validateur du store sont les seules vérifications possibles : le test réel se fait ailleurs.
  Le dire, plutôt que de conclure que « ça marche ».
- **Tout le code de démonstration du template disparaît** : station météo, prise, lampe, caméra,
  capteur de mouvement, `src/weather.js`, leurs tests, leurs entrées du manifeste et de la
  documentation. Il ne reste que ce que l'intégration fait vraiment.
- **Publier n'est jamais le travail d'une session de code** : ni Release, ni tag, ni topic, ni
  version modifiée à la main. L'orchestrateur s'en charge une fois la PR fusionnée. Les workflows
  sont ceux du template : ne pas les modifier.
- Le dépôt est **public** : aucun secret, aucune adresse ni détail d'infrastructure privée, ni
  ici, ni dans les tests, ni dans les captures.

## Pièges du cœur Gladys

**Appareils et fonctionnalités**

- **Polling** : le planificateur n'interroge un appareil que si `should_poll: true` **et**
  `poll_frequency` vaut une valeur de la liste fixe, **en millisecondes** (1000, 2000, 10000,
  15000, 30000, 60000). Le template publie `poll_frequency: 300` sans `should_poll` : c'est faux,
  le cœur répond 400 à la découverte. Pour une cadence hors liste, publier `should_poll: false` et
  pousser les états depuis le conteneur, en gardant un `onPoll` de repli.
  **Piège du 5.2.0** (GladysAssistant/Gladys#3198, correctif #3199, relevé sur gladys-ping-wol) :
  un appareil **créé sans `should_poll`** n'est jamais sondé, même après correction du cœur (valeur
  stockée à la création), et la 5.2.1 du 13/10/2026 ne le corrige pas. **Le conteneur sonde donc
  lui-même** par un minuteur, qui saute un appareil sondé il y a moins d'une demi-période, en gardant
  `onPoll` comme repli ; seuls les appareils ajoutés (`gladys.devices`) sont lus. Un test le prouve
  sans appeler `onPoll`.
- **`min` et `max` sont NOT NULL** dans `t_device_feature`, y compris pour `text/text` : sans eux,
  « Ajouter à Gladys » échoue en HTTP 422. Mettre 0/0, comme Zigbee2MQTT.
- Un état publié sur une fonctionnalité **pas encore ajoutée** dans Gladys reçoit un 200 puis est
  jeté (simple ligne de log) : republier les états dans `onDeviceCreated`.
- `level-sensor/decimal` n'existe pas côté serveur. `light-sensor/binary` n'a pas de libellé dans
  le front (pastille vide) : préférer `input/binary`. Un `text/text` reçoit `{ text }`, jamais
  vide, sinon l'état est ignoré.
- **Détecteur d'ouverture (`opening-sensor`) : 0 = ouvert, 1 = fermé** (`OPENING_SENSOR_STATE`), à
  l'inverse de l'intuition et des autres détecteurs (mouvement, fuite, fumée : 1 = détecté). Une
  porte ouverte publiée à 1 s'affiche « Fermé » et fausse scènes et historique. Le figer par un test.
- **Un `external_id` de fonctionnalité ne change jamais d'appareil** d'une version à l'autre. UniFi
  1.5.2 avait sorti les ports PoE dans un appareil dédié, la 1.6.0 les a remis dans la passerelle avec
  les mêmes identifiants : ceux qui avaient ajouté l'appareil dédié ne peuvent plus « Mettre à jour » la
  passerelle (409 `external_id must be unique`). Pour regrouper, garder l'appareil existant
  (`gladys.getDevices()`) ou changer d'identifiant.
- Les **noms de fonctionnalités sont figés à la création**. Et quand une fonctionnalité est seule
  de son type sur l'appareil, le tableau de bord affiche le libellé générique du type à la place
  du nom publié.
- **Aucune commande d'appareil ne permet un choix multiple** : un `text/select` n'a qu'un choix
  actif.
- Un changement de structure fait proposer « Mettre à jour » dans l'onglet Découverte
  (`structure_changed`). Un changement des seules `supported_options` ne le déclenche pas.
- **Jauge** : l'aiguille se place par `(value - min) / (max - min)` des bornes de la
  fonctionnalité. `gauge_min`/`gauge_max` ne pilotent que les couleurs, et le cœur n'applique
  jamais `min`/`max` en écriture : ce sont des bornes d'affichage. Une valeur signée exige des
  bornes symétriques.
- Le cœur plafonne à **300 états par minute** et réévalue les scènes à chaque état : ne publier
  que les changements.
- Une intégration `device` ne reçoit pas la langue de l'utilisateur, une action de scène non
  plus (un widget, si) : prévoir un champ de config `language` si des textes partent du
  conteneur. Le superviseur injecte `TZ`, le fuseau de Gladys. La sandbox est limitée à 256 Mo.

**Formulaires de configuration et actions**

- Les champs `number` sont rendus **sans `step`** : le navigateur n'accepte alors que `min + k`.
  Min et défaut **entiers** seulement ; une valeur décimale passe par un `select` ou par un
  `string` parsé (virgule acceptée).
- Un champ `secret` dans les `fields` d'une **action** est impossible à remplir, et une action
  n'applique **aucun `default`** tout en exigeant les champs `required` (422). Issues
  GladysAssistant/Gladys#3154 et #3155.

**SDK et journaux**

- SDK **^0.16.0** depuis la 1.1.0 (25/10/2026) : lecteur de musique de Gladys 5.3 (`publishNowPlaying`,
  `artworkKey`, `onMusic*`, `validateMediaItems`), contrat dans
  `Gladys/docs/specs/external-integrations/capabilities/music.md`. Le manifeste déclare `music` : donc
  `gladys_version` `>=5.3.0`.
- SDK `@gladysassistant/integration-sdk` **^0.15.0** (12/10/2026) : `DEVICE_POLL_FREQUENCIES`, faux
  Gladys de test (`@gladysassistant/integration-sdk/testing`, à préférer à un faux maison),
  déduplication des états, `parseMdnsTxt`. Lire son README et son CHANGELOG.
- **Journaux calmes** (demande de Guilhem, 13/10/2026) : rien au niveau info pour un cycle normal de
  lecture, un état publié ou un message reçu. L'info ne garde que le cycle de vie : démarrage,
  connexion, perte et retour d'un appareil ou d'un service, erreurs utiles, une ligne par action de
  l'utilisateur. Le reste passe en debug (`LOG_LEVEL=debug`). Une erreur qui se répète écrit une ligne
  au premier échec et une au rétablissement, pas une par tentative. Jamais de secret ni d'adresse
  avec identifiants. Un test vérifie qu'un cycle normal n'écrit rien en info.
- **Heartbeat** : republier au moins toutes les 12 h une valeur qui ne change pas, sinon le front
  affiche « Pas de valeur récente » au-delà de 48 h.

**Widgets, déclencheurs, actions de scène (SDK ≥ 0.14, Gladys ≥ 5.1)**

- **Cibler la dernière version publiée du cœur, pas `master`** : la spec de `master` décrit des
  fonctions non publiées. Les boutons de widget qui ouvrent un formulaire (#3168, commit 3feb2cf8)
  sont absents de la 5.1.4 mais **livrés dans la 5.2.0** (sortie le 12/10/2026) : `gladys_version`
  `>=5.2.0` si on s'en sert, ou un bouton direct en repli. Vérifier par `git tag --contains`.

- Un réglage de widget ne propose en liste que les **appareils** de l'intégration
  (`source: "devices"`, seule source dynamique).
- Budget du cœur : **8 composants par widget, dont 2 textes au plus**, appliqué **avant** la
  résolution des références ; un contenu amputé reste en cache jusqu'au TTL. Appeler
  `requestWidgetRefresh` à la création d'un appareil. `validateWidgetContent` est exporté pour les
  tests, mais ne vérifie pas que les `external_id` liés existent : les croiser avec `buildDevice`.
- Une ligne de `status` exige un `value` (nombre ou texte ≤ 40).
- Le cœur **jette un bouton dont la clé d'action est déjà prise** : clés numérotées.
- Le vocabulaire des widgets n'a ni liste ni curseur, **par choix** du cœur. Seul un bouton
  `device_feature` numérique a un état actif natif.
- **En mode sombre, le style `primary` d'un bouton de widget ne se voit pas** (#3153) : signaler
  un choix courant par l'icône (`check-circle`), jamais par le style.
- Dans une grille `card-list`, la `date` s'affiche **à la place** du sous-titre.
- `onWidgetAction` fait recharger le widget dès la résolution, alors que `requestWidgetRefresh`
  est plafonné à un appel toutes les 10 s. Un toast d'action est tronqué à 200 caractères.
- Le cœur met le contenu d'un widget en cache par (réglages, langue, unités) : pré-localiser
  d'après `language` est correct.
- Les filtres de scène ne font qu'égalité et appartenance : un seuil reste le travail d'un capteur.
- **Les clés de widgets, de déclencheurs et d'actions sont figées une fois publiées.**
- `gladys_version` `>=5.1.0` dès qu'il y a widgets, déclencheurs ou actions de scène.

## Store

- Validateur officiel, depuis la racine : `npx -y github:GladysAssistant/integration-store .`
  (schéma, `description` **100 caractères au plus par langue**, documentation de 300 caractères
  au moins, image Docker, cover de **150 Ko au plus**). Il demande Node ≥ 24 mais tourne sous
  Node 22 avec un avertissement.
- L'indexeur lit le manifeste de la **dernière release**, pas celui de `main` : une correction du
  manifeste (catégorie, description…) n'atteint le store qu'avec une release.
- L'indexeur rejette **en silence** : la raison n'apparaît que dans `rejected.json`, à côté de
  `https://integration-store-storage.gladysassistant.com/index.json`.
- **Image de base** : `FROM public.ecr.aws/docker/library/node:…` (miroir officiel ECR Public, même
  empreinte) et non `node:…` de Docker Hub, qui refuse en 429 les pulls anonymes des runners GitHub
  dès qu'il y a plusieurs builds à la fois. Un échec 429 dans le job « Docker build » n'est pas un bug
  du code. Même parade dans `.github/workflows/build.yml` (posée par l'orchestrateur, ne pas la
  retirer) : QEMU et BuildKit tirés de `mirror.gcr.io`.
- La règle `data/` du `.gitignore` du template (pour le volume `/data`) exclut aussi `src/data/` :
  l'ancrer en `/data/`, dans `.prettierignore` aussi.

### Langues (depuis le 11/10/2026)

Tout texte montré à l'utilisateur existe en **`en`, `fr`, `de` et `es`** : manifeste, contenu des widgets, messages,
noms de fonctionnalités. L'allemand **tutoie** (« du »), l'espagnol **vouvoie** (« usted ») : décision de Guilhem,
appliquée à ses 21 intégrations. `test/i18n.test.js` doit échouer sur une langue manquante, un texte vide ou trop
long, et sur un « Sie »/« Ihr… » de politesse en allemand. Le store exige `docs/en.md` et `docs/fr.md`
(`DOCS_LANGUAGES`) et publie aussi `docs/de.md` et `docs/es.md` quand ils existent
(`DOCS_OPTIONAL_LANGUAGES` d'integration-store) : écrire les quatre, avec les mêmes sections.

## Choix par défaut de Guilhem (12/10/2026)

- Langue par défaut des noms de fonctionnalités et des textes produits par le conteneur : **`fr`**.
- Fichier `LICENSE` Apache-2.0 (texte complet) à la racine.
- `transports` : `local` seul quand le cloud n'est qu'une option annexe.
- Docs `en`, `fr`, `de`, `es` avec les mêmes sections.
- Chauffe, ouverture, sécurité : ne rien rendre pilotable « comme un thermostat » ou par un assistant
  vocal quand une erreur serait dangereuse (leçon d'OctoPrint).

## Lyrion Music Server (appris sur cette intégration)

Faits vérifiés sur un vrai Lyrion Music Server 9.1.1 (image `lmscommunity/lyrionmusicserver`) avec
deux lecteurs squeezelite 1.9.9 en Docker. Réponses enregistrées dans `test/fixtures/lms/`.

- **API** : `POST /jsonrpc.js`, `{ "method": "slim.request", "params": [<playerid ou "">, [commande…]] }`,
  les commandes de la CLI. Authentification HTTP basique quand « Sécurité du serveur » est active
  (401 sinon) ; la CLI (9090) veut alors `login <user> <pass>` (le mot de passe est masqué dans
  l'écho) et, sans lui, **répond `listen 1` puis ferme** : la souscription ne compte qu'après 1,5 s
  sans fermeture (`SETTLE_MS`).
- **LMS ne répond jamais à une commande ou un lecteur inconnus** : la requête pend. Délai de 5 s sur
  chaque appel.
- `status - 1 tags:acdjKlNu` : `mixer volume` **négatif quand le son est coupé** (le niveau à rétablir) ;
  `sync_master` / `sync_slaves` (liste séparée par des virgules) quand le lecteur est groupé ; une
  pochette n'existe que si `coverart` vaut `"1"` (sinon LMS sert une image générique). Un fichier
  sans étiquettes a pour artiste la chaîne `No Artist`.
- **Piège LMS 9.1** : quand l'artiste d'un morceau est illisible (vu sur un morceau renommé par
  `playlist preview`), le tag `a` fait disparaître **tout** `playlist_loop` : le client relit sans
  `a` (`LmsClient.status`).
- **`<A> sync <B>` met B dans le groupe de A** (A maître). `<B> sync -` le sort.
- **Annonce** : `playlist preview url:… / cmd:stop` (ce que fait l'alarme de LMS) ne restaure rien
  sur 9.1, même avec un `playlistdir` réglé. Méthode retenue, vérifiée : `playlist insert <url>`
  (après le morceau courant), `playlist index <i+1>`, attendre la fin (index qui change ou `stop`),
  puis `playlist delete <i+1>`, `playlist index <i>`, `time <t>`, et pause/stop/volume/sourdine/
  répétition/marche rendus. Couper la répétition pendant l'annonce (répéter un morceau la jouerait
  sans fin). Un flux injoignable passe aussitôt en `stop` sur l'annonce.
- `favorites items 0 200` : `isaudio: 1` pour un favori jouable, `hasitems: 1` pour un dossier ;
  `favorites playlist play item_id:<id>` le joue.
- Événements CLI : `<playerid encodé> playlist newsong …`, `mixer volume 40`, `power 0`, `pause 1`,
  `sync …`, des `prefset` et `menustatus` (bruit). Le hub n'analyse rien : tout événement déclenche
  une relecture JSON-RPC (anti-rebond 300 ms).
- **Banc de test** : la sortie ALSA `null` de squeezelite **n'a pas d'horloge** (un morceau de 40 s
  est « joué » en 0,4 s, le lecteur repasse aussitôt en `stop`). Sortie `-o -` vers `pv -L` pour
  jouer en temps réel. Fichiers WAV générés, dossier musical par `pref audiodir /music` puis
  `rescan`.
- Avant Gladys 5.3, la catégorie `music` n'avait pas de ligne dans la boîte « appareils d'une
  pièce » ; la 5.3 y montre état de lecture, volume, muet, aléatoire, répétition et textes (pas les
  boutons ponctuels). `music/play_notification` reçoit l'URL MP3 de l'action « Parler sur une
  enceinte ».
- **Écart assumé à la note « seuls les appareils ajoutés sont lus »** : le hub lit tous les lecteurs
  connectés (le widget et les déclencheurs en ont besoin, un `status` par lecteur et par cycle reste
  léger) ; seuls les appareils ajoutés reçoivent des états.
- **Annonce, fin et reprise** (relecture indépendante) : la fin est la première lecture hors de
  l'emplacement ou en `stop` (un carillon est souvent fini avant la première lecture) ; une pause
  sur l'annonce est celle de l'utilisateur (la musique revient en pause) ; si la file n'est plus la
  nôtre (un favori lancé entre-temps), seuls volume, sourdine et répétition sont rendus ; serveur
  perdu ou nouvelle configuration : abandon, rien n'est rejoué des heures plus tard.

### Lecteur Musique de Gladys 5.3 (1.1.0, vérifié sur LMS 9.1.1 et squeezelite 1.9.9)

- **Identifiants** : les clés de fonctionnalités valent les types `music` (`title`, `position`…) :
  les identifiants par défaut de `publishNowPlaying` (`${device}:${type}`) sont les nôtres, aucun
  `featureExternalIds`. `title`, `artist` (text/text) et `mute` (television/volume_mute) de la 1.0
  sont convertis sur place (même id) ; tout ce qui est `music` passe par `publishNowPlaying`, seule la
  marche reste sur `publishChangedStates`. `onDeviceUpdated` republie tout (« Mettre à jour »).
- `playback_state` : éteint, hors ligne ou file vide = IDLE (2) ; arrêté avec une file = IDLE, le
  morceau reste affiché. `playlist repeat` de LMS : 0 non, **1 le morceau, 2 la file** (inverse de
  `MUSIC_REPEAT_MODE`). `playlist shuffle` 1 ou 2 (albums) = aléatoire.
- **Radio** : `remote` est au premier niveau de `status`, pas dans `playlist_loop` (sans tag `r`) ;
  sans métadonnées, LMS nomme le flux d'après son fichier (`title` et `current_title` =
  `fip-midfi.mp3`) : traité comme « pas de morceau », la station (`remote_title`, tag `N`) sert de
  titre.
- **Pochettes** : LMS redimensionne lui-même : `/music/<coverid>/cover_300x300_o.jpg` (JPEG 38 Ko
  pour une pochette de 2 Mo ; sans `.jpg`, le format de la source : un GIF serait refusé par le cœur),
  `/imageproxy/<url>/image_64x64_o.jpg`, et toute image de
  son serveur web avec `_WxH_o` avant l'extension (`music/4/cover_64x64_o.png`). Un `coverid` inconnu
  rend une image générique (PNG), `html/images/*` sont des icônes génériques : ignorées. Dans
  `playlists tracks`, un morceau sans pochette a `coverart: "1"` **sans** `coverid` et
  `artwork_url: "0"`. Les clés passent par `artworkKey(<URL absolue>)` et `hub.artwork` les lit avec
  le client LMS (authentification, 300 Ko au plus) : jamais le gestionnaire par défaut du SDK.
- **Catalogue** : toutes les commandes de bibliothèque se paginent (`<start> <count>`, `count` = le
  total). Lecture par **URL** (`playlist play|insert|add <url> [titre]`) : fichiers, flux, listes
  `file:///…m3u`, et `db:album.title=…&contributor.name=…` (le `favorites_url` d'un album ou d'un
  artiste) ; l'id `album:<id>:<url>` sert l'id au parcours et l'URL à la lecture (stable après une
  réanalyse complète, contrairement aux ids). `playlist play` d'une URL inconnue et
  `playlistcontrol cmd:load` d'un id inconnu **vident la file** et répondent `{}` / `count: 0` : le
  remplacement est vérifié par la longueur de la file.
- **Favoris** : `favorites items` donne au premier niveau des ids `<session>.<n>` (préfixe différent à
  chaque appel) et dans un dossier (`item_id:3`) des ids `3.<n>` sans préfixe : seule la dernière
  position est lue. `item_id:<n>` sans préfixe fonctionne pour jouer.
- **Pièges du banc** : `playlist save <nom>` et `pref playlistdir` sans valeur **ferment la connexion
  HTTP** sans réponse (9.1.1) ; écrire les `.m3u` dans `/playlist` puis `pref playlistdir /playlist`
  et `rescan playlists`. Alpine n'a pas de paquet squeezelite : image Debian (`node:22-slim` +
  `apt install squeezelite pv`), sortie `-o -` vers `pv -L 176400` pour jouer en temps réel.
