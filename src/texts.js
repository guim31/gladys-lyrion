// -----------------------------------------------------------------------------
// Every text the container produces, in the four languages of Gladys (German
// says "du", Spanish "usted"). Feature names follow the configured `language`
// (frozen by Gladys once a device is added); action and widget messages are
// multi-language objects, Gladys picks the user's language.
// -----------------------------------------------------------------------------

export const NAMES = {
  en: {
    power: 'Power',
    playback_state: 'Playback state',
    play: 'Play',
    pause: 'Pause',
    stop: 'Stop',
    previous: 'Previous',
    next: 'Next',
    volume: 'Volume',
    mute: 'Mute',
    title: 'Title',
    artist: 'Artist',
    album: 'Album',
    artwork: 'Artwork',
    duration: 'Duration',
    position: 'Position',
    shuffle: 'Shuffle',
    repeat: 'Repeat',
    notification: 'Announcement',
  },
  fr: {
    power: 'Marche',
    playback_state: 'État de lecture',
    play: 'Lecture',
    pause: 'Pause',
    stop: 'Stop',
    previous: 'Précédent',
    next: 'Suivant',
    volume: 'Volume',
    mute: 'Sourdine',
    title: 'Titre',
    artist: 'Artiste',
    album: 'Album',
    artwork: 'Pochette',
    duration: 'Durée',
    position: 'Position',
    shuffle: 'Aléatoire',
    repeat: 'Répétition',
    notification: 'Annonce',
  },
  de: {
    power: 'Ein/Aus',
    playback_state: 'Wiedergabestatus',
    play: 'Wiedergabe',
    pause: 'Pause',
    stop: 'Stopp',
    previous: 'Vorheriger Titel',
    next: 'Nächster Titel',
    volume: 'Lautstärke',
    mute: 'Stumm',
    title: 'Titel',
    artist: 'Interpret',
    album: 'Album',
    artwork: 'Cover',
    duration: 'Dauer',
    position: 'Position',
    shuffle: 'Zufallswiedergabe',
    repeat: 'Wiederholen',
    notification: 'Durchsage',
  },
  es: {
    power: 'Encendido',
    playback_state: 'Estado de reproducción',
    play: 'Reproducir',
    pause: 'Pausa',
    stop: 'Detener',
    previous: 'Anterior',
    next: 'Siguiente',
    volume: 'Volumen',
    mute: 'Silencio',
    title: 'Título',
    artist: 'Artista',
    album: 'Álbum',
    artwork: 'Carátula',
    duration: 'Duración',
    position: 'Posición',
    shuffle: 'Aleatorio',
    repeat: 'Repetir',
    notification: 'Anuncio',
  },
};

// The state of a player, as the widget shows it.
export const STATE_LABELS = {
  en: { play: 'Playing', pause: 'Paused', stop: 'Stopped', off: 'Off', offline: 'Offline' },
  fr: {
    play: 'En lecture',
    pause: 'En pause',
    stop: 'Arrêté',
    off: 'Éteint',
    offline: 'Hors ligne',
  },
  de: {
    play: 'Wiedergabe',
    pause: 'Pausiert',
    stop: 'Gestoppt',
    off: 'Aus',
    offline: 'Offline',
  },
  es: {
    play: 'Reproduciendo',
    pause: 'En pausa',
    stop: 'Detenido',
    off: 'Apagado',
    offline: 'Desconectado',
  },
};

// A text state is never empty, or Gladys ignores it.
export const NOTHING_PLAYING = { en: '—', fr: '—', de: '—', es: '—' };

export const UNKNOWN_TITLE = {
  en: 'Unknown title',
  fr: 'Titre inconnu',
  de: 'Unbekannter Titel',
  es: 'Título desconocido',
};

/** The language of a table, English when absent. */
export const pick = (table, language) => table[language] ?? table.en;

const all = (en, fr, de, es) => ({ en, fr, de, es });

// Errors of the commands (scene actions, widget buttons, device controls).
export const COMMAND_ERRORS = {
  not_configured: all(
    'Type the address of the Lyrion server in the integration settings.',
    "Saisissez l'adresse du serveur Lyrion dans les réglages de l'intégration.",
    'Gib die Adresse des Lyrion-Servers in den Einstellungen der Integration ein.',
    'Escriba la dirección del servidor Lyrion en los ajustes de la integración.',
  ),
  unreachable: all(
    'The Lyrion server does not answer: check its address and port.',
    'Le serveur Lyrion ne répond pas : vérifiez son adresse et son port.',
    'Der Lyrion-Server antwortet nicht: prüfe Adresse und Port.',
    'El servidor Lyrion no responde: compruebe su dirección y su puerto.',
  ),
  auth: all(
    'Lyrion refused the user name or the password.',
    "Lyrion a refusé le nom d'utilisateur ou le mot de passe.",
    'Lyrion hat Benutzername oder Passwort abgelehnt.',
    'Lyrion rechazó el nombre de usuario o la contraseña.',
  ),
  timeout: all(
    'The Lyrion server did not answer in time.',
    "Le serveur Lyrion n'a pas répondu à temps.",
    'Der Lyrion-Server hat nicht rechtzeitig geantwortet.',
    'El servidor Lyrion no respondió a tiempo.',
  ),
  protocol: all(
    'The Lyrion server sent an unexpected answer.',
    'Le serveur Lyrion a envoyé une réponse inattendue.',
    'Der Lyrion-Server hat eine unerwartete Antwort gesendet.',
    'El servidor Lyrion envió una respuesta inesperada.',
  ),
  unknown_player: all(
    'This player is not known to the Lyrion server.',
    'Ce lecteur est inconnu du serveur Lyrion.',
    'Dieser Player ist dem Lyrion-Server nicht bekannt.',
    'El servidor Lyrion no conoce este reproductor.',
  ),
  offline: all(
    'This player is not connected to the Lyrion server.',
    "Ce lecteur n'est pas connecté au serveur Lyrion.",
    'Dieser Player ist nicht mit dem Lyrion-Server verbunden.',
    'Este reproductor no está conectado al servidor Lyrion.',
  ),
  no_favorite: all(
    'Give the name or the position of a favorite.',
    "Indiquez le nom ou la position d'un favori.",
    'Gib den Namen oder die Position eines Favoriten an.',
    'Indique el nombre o la posición de un favorito.',
  ),
  favorite_not_found: all(
    'No playable favorite has this name or position in Lyrion.',
    'Aucun favori jouable ne porte ce nom ou cette position dans Lyrion.',
    'Kein abspielbarer Favorit hat diesen Namen oder diese Position in Lyrion.',
    'Ningún favorito reproducible tiene ese nombre o esa posición en Lyrion.',
  ),
  bad_url: all(
    'The announcement needs an http or https address.',
    "L'annonce a besoin d'une adresse http ou https.",
    'Die Durchsage braucht eine http- oder https-Adresse.',
    'El anuncio necesita una dirección http o https.',
  ),
  busy: all(
    'An announcement is already playing on this player.',
    'Une annonce est déjà en cours sur ce lecteur.',
    'Auf diesem Player läuft schon eine Durchsage.',
    'Ya hay un anuncio en curso en este reproductor.',
  ),
  same_player: all(
    'A player cannot join itself: choose another one.',
    'Un lecteur ne peut pas se rejoindre lui-même : choisissez-en un autre.',
    'Ein Player kann sich nicht selbst beitreten: wähle einen anderen.',
    'Un reproductor no puede unirse a sí mismo: elija otro.',
  ),
  not_playable: all(
    'Lyrion cannot play this item.',
    'Lyrion ne peut pas lire cet élément.',
    'Lyrion kann dieses Element nicht abspielen.',
    'Lyrion no puede reproducir este elemento.',
  ),
  folder_not_playable: all(
    'Open this folder and choose what to play in it.',
    'Ouvrez ce dossier et choisissez ce qu’il faut y lire.',
    'Öffne diesen Ordner und wähle darin aus, was abgespielt werden soll.',
    'Abra esta carpeta y elija qué reproducir en ella.',
  ),
  not_in_queue: all(
    'This item is no longer in the queue.',
    "Cet élément n'est plus dans la file d'attente.",
    'Dieses Element ist nicht mehr in der Warteschlange.',
    'Este elemento ya no está en la cola.',
  ),
  bad_volume: all(
    'The volume goes from 0 to 100.',
    'Le volume va de 0 à 100.',
    'Die Lautstärke geht von 0 bis 100.',
    'El volumen va de 0 a 100.',
  ),
};

// The root folders of the Gladys 5.3 music panel (src/catalog.js).
export const CATALOG_FOLDERS = {
  favorites: all('Favorites', 'Favoris', 'Favoriten', 'Favoritos'),
  playlists: all('Playlists', 'Listes de lecture', 'Wiedergabelisten', 'Listas de reproducción'),
  artists: all('Artists', 'Artistes', 'Interpreten', 'Artistas'),
  albums: all('Albums', 'Albums', 'Alben', 'Álbumes'),
};

/** The multi-language message of an error code (protocol when unknown). */
export const commandMessage = (code) => COMMAND_ERRORS[code] ?? COMMAND_ERRORS.protocol;

// The connection status shown in the integration page.
export const STATUS_TEXT = {
  not_configured: COMMAND_ERRORS.not_configured,
  invalid_host: all(
    'The server address is not valid: type an IP address or a host name, with an optional port.',
    "L'adresse du serveur n'est pas valide : saisissez une adresse IP ou un nom d'hôte, avec un port si besoin.",
    'Die Serveradresse ist ungültig: gib eine IP-Adresse oder einen Hostnamen ein, optional mit Port.',
    'La dirección del servidor no es válida: escriba una dirección IP o un nombre de host, con un puerto si hace falta.',
  ),
  unreachable: COMMAND_ERRORS.unreachable,
  auth: COMMAND_ERRORS.auth,
  timeout: COMMAND_ERRORS.timeout,
  protocol: COMMAND_ERRORS.protocol,
};

export const INIT_FAILED = all(
  'The integration could not start: see its logs.',
  "L'intégration n'a pas pu démarrer : consultez ses journaux.",
  'Die Integration konnte nicht starten: sieh dir ihre Protokolle an.',
  'La integración no pudo iniciarse: consulte sus registros.',
);

// Toasts of the widget buttons and results of the scene actions.
export const DONE_TEXT = {
  play_pause: all('Done', 'C’est fait', 'Erledigt', 'Hecho'),
  next: all('Next song', 'Morceau suivant', 'Nächster Titel', 'Siguiente canción'),
  previous: all('Previous song', 'Morceau précédent', 'Vorheriger Titel', 'Canción anterior'),
  volume_down: all('Volume down', 'Volume baissé', 'Leiser', 'Volumen bajado'),
  volume_up: all('Volume up', 'Volume monté', 'Lauter', 'Volumen subido'),
  pause_all: all(
    'Every player is paused',
    'Tous les lecteurs sont en pause',
    'Alle Player sind pausiert',
    'Todos los reproductores están en pausa',
  ),
};
