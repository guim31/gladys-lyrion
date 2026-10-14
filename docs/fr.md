# Lyrion Music Server

Pilotez depuis Gladys les lecteurs de votre **Lyrion Music Server** (ex-Logitech Media Server, LMS) :
Squeezebox Touch, Radio, Boom, Duet, piCorePlayer, squeezelite et tout lecteur compatible. Gladys suit
ce que joue chaque lecteur, le pilote, joue vos favoris Lyrion, met toute la maison en pause et
diffuse des annonces qui rendent la musique là où elle en était.

Testée avec Lyrion Music Server 9.1 et des lecteurs squeezelite, pas avec une Squeezebox physique :
vos retours sont les bienvenus. Cette intégration n'est affiliée ni au projet Lyrion ni à Logitech.

## Prérequis

- Gladys Assistant 5.1 ou plus récent.
- Un Lyrion Music Server joignable depuis Gladys sur le réseau local : port web **9000** et, pour des
  mises à jour immédiates, port CLI **9090** (ouverts par défaut). Logitech Media Server 8 a la même
  API et devrait fonctionner aussi.
- Rien à installer sur les lecteurs.

## Configuration

1. Dans **Intégrations**, ouvrez **Lyrion Music Server** et saisissez l'**adresse du serveur**
   (adresse IP ou nom d'hôte, par exemple `192.168.1.20`). Changez le **port web** s'il ne vaut pas 9000.
2. Si la protection par mot de passe est active dans Lyrion (**Réglages → Avancé → Sécurité**),
   saisissez le **nom d'utilisateur** et le **mot de passe**.
3. **Port CLI** : Lyrion y signale chaque changement (9090 par défaut), Gladys voit donc aussitôt un
   nouveau morceau ou un changement de volume. `0` le désactive : Gladys lit alors les lecteurs
   toutes les 5 secondes.
4. **Langue des noms de fonctionnalités** : le français par défaut. Elle sert aussi aux messages
   d'erreur des actions de scène.
5. Ouvrez l'onglet **Découverte** : chaque lecteur du serveur y figure. Cliquez sur **Ajouter à
   Gladys**.

## Appareils

Un appareil par lecteur, identifié par son identifiant de lecteur Lyrion (l'adresse MAC d'une
Squeezebox ou de squeezelite) : renommer un lecteur ou changer son adresse IP garde le même appareil.

| Fonctionnalité     | Ce qu'elle fait                                                                                    |
| ------------------ | -------------------------------------------------------------------------------------------------- |
| Marche             | Allume ou éteint le lecteur (le bouton marche de Lyrion).                                          |
| État de lecture    | 1 quand le lecteur joue, 0 sinon (pause, arrêt, éteint).                                           |
| Lecture, Pause     | Lit ou reprend, met en pause.                                                                      |
| Stop               | Arrête la lecture.                                                                                 |
| Précédent, Suivant | Morceau précédent ou suivant de la file.                                                           |
| Volume             | De 0 à 100.                                                                                        |
| Sourdine           | Coupe ou rétablit le son (chaque appui bascule).                                                   |
| Titre, Artiste     | Ce qui joue ; pour une radio, le morceau qu'elle annonce si elle le fait, sinon la station.        |
| Annonce            | Cible de l'action de scène **Parler sur une enceinte** de Gladys : parle, puis la musique reprend. |

Les boutons de lecture et le volume appartiennent à la catégorie **Musique** de Gladys : la boîte
**Musique** du tableau de bord les pilote. Le widget **Lecteurs Lyrion** ci-dessous montre le reste.

## Widget du tableau de bord

**Lecteurs Lyrion** a un réglage facultatif, un **lecteur** :

- **Vide** : tous les lecteurs du serveur en liste, avec ce qu'ils jouent et leur état, et un bouton
  **Tout en pause** quand quelque chose joue.
- **Un lecteur** : la pochette (quand Lyrion en a une), le morceau, l'artiste et l'album, l'état, le
  volume, le groupe avec lequel il joue, et quatre boutons : lecture/pause, suivant, volume − et
  volume +. Un lecteur éteint propose **Allumer**.

## Déclencheurs de scène

| Déclencheur      | Quand                                                                         | Filtres                                        | Variables                             |
| ---------------- | ----------------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------- |
| Lecture démarrée | Un lecteur commence ou reprend la lecture.                                    | Lecteur                                        | Nom du lecteur, titre, artiste, album |
| Lecture arrêtée  | Un lecteur cesse de jouer.                                                    | Lecteur, raison (mis en pause, arrêté, éteint) | Les mêmes, plus la raison (clé)       |
| Morceau changé   | Un lecteur passe à un nouveau morceau, ou une radio annonce un nouveau titre. | Lecteur                                        | Nom du lecteur, titre, artiste, album |

Les déclencheurs reflètent ce que font vraiment les lecteurs, quelle que soit l'origine de l'ordre :
une scène qui relance la musique sur « Lecture arrêtée » tournerait en boucle. Rien ne se déclenche
pour ce qui jouait déjà au démarrage de l'intégration, ni pendant une annonce.

## Actions de scène

| Action                            | Champs                                                 | Résultat                                     |
| --------------------------------- | ------------------------------------------------------ | -------------------------------------------- |
| Jouer un favori Lyrion            | Lecteur, favori (nom ou position : `FIP`, `1`)         | Allume le lecteur et le joue.                |
| Régler le volume                  | Lecteur (vide : tous les lecteurs), volume             |                                              |
| Mettre tous les lecteurs en pause | —                                                      | Sortie : le nombre de lecteurs mis en pause. |
| Diffuser une annonce              | Lecteur, adresse audio (http/https), volume facultatif | La joue, puis rend la musique.               |
| Rejoindre un groupe de lecteurs   | Lecteur, lecteur à rejoindre                           | Les deux jouent ensemble (synchro Lyrion).   |
| Quitter le groupe                 | Lecteur                                                | Le lecteur joue de nouveau seul.             |

Un favori est trouvé par son nom (sans tenir compte des majuscules ni des accents), sinon par sa
position parmi les favoris jouables du premier niveau de Lyrion (les dossiers ne comptent pas). Une
annonce est insérée après le morceau en cours, jouée, puis retirée : le lecteur retrouve son morceau,
sa position, son volume, son état, son mode de répétition et sa marche.

## Exemples de scènes

- **Radio du matin** : à 7 h 30 en semaine, _Jouer un favori Lyrion_ `FIP` sur le lecteur de la
  cuisine, puis _Régler le volume_ à 25.
- **Sonnette** : quand on sonne, _Diffuser une annonce_ avec l'adresse d'un MP3 de carillon sur
  le lecteur de l'entrée (une action par lecteur), au volume 60.
- **Départ de la maison** : quand la dernière personne part, _Mettre tous les lecteurs en pause_.
- **Soirée** : _Rejoindre un groupe_ pour le salon et la cuisine, et _Quitter le groupe_ à minuit.

## Dépannage

- **« Le serveur Lyrion ne répond pas »** : vérifiez l'adresse et le port web (ouvrez
  `http://<adresse>:9000` dans un navigateur depuis le même réseau).
- **« Lyrion a refusé le nom d'utilisateur ou le mot de passe »** : les mêmes identifiants que
  l'interface web de Lyrion.
- **Les changements mettent 5 secondes** : le port CLI est fermé ou désactivé ; Gladys lit alors
  les lecteurs toutes les 5 secondes. Vérifiez le port 9090, ou le plugin « CLI » de Lyrion.
- **Un lecteur manque** : il doit être connecté à ce serveur (il figure dans l'interface web de
  Lyrion), puis relancez une recherche dans l'onglet Découverte.
- Journaux : dans la page de l'intégration ; `LOG_LEVEL=debug` montre chaque lecture.

## Limites

- Un seul serveur Lyrion par intégration ; pas de découverte automatique (Lyrion ne répond qu'aux
  requêtes en broadcast, que le bac à sable ne transmet pas) : saisissez son adresse.
- Les fonctionnalités musicales n'ont pas de ligne dans la boîte « appareils d'une pièce » de
  Gladys : utilisez la boîte Musique ou le widget Lecteurs Lyrion.
- Une annonce sur un groupe joue sur tout le groupe ; en lecture aléatoire, la position rendue peut
  différer. Un flux sans fin est coupé au bout de 10 minutes.
- Seul le premier niveau des favoris est proposé.
- Réseau local uniquement : l'intégration parle au serveur, jamais à un service cloud.
