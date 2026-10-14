// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `players`, "Lyrion
// players".
//
// Without a chosen player: every player of the server in a list (name, what
// it plays, a state badge) and a "Pause all" button.
// With a chosen player: its cover (when LMS has one), the song, the artist and
// album, a status list (state, volume, group) and four buttons — play/pause,
// next, volume down and up — or "Turn on" when it is off.
// Budget: at most 1 focal, 2 texts, 1 status, 4 buttons (8 components).
// No button opens a form: Gladys 5.1 is enough.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { deviceIds } from './devices.js';
import { CommandError, WIDGET_KEY } from './hub.js';
import { isPlaying } from './lms/model.js';
import { DONE_TEXT, NOTHING_PLAYING, STATE_LABELS, UNKNOWN_TITLE, pick } from './texts.js';

export { WIDGET_KEY };

export const VOLUME_STEP = 5;

export const TEXT = {
  empty: {
    en: 'No player on the Lyrion server yet.',
    fr: 'Aucun lecteur sur le serveur Lyrion pour le moment.',
    de: 'Noch kein Player auf dem Lyrion-Server.',
    es: 'Todavía no hay reproductores en el servidor Lyrion.',
  },
  unknown: {
    en: 'This player is not on the Lyrion server anymore.',
    fr: "Ce lecteur n'est plus sur le serveur Lyrion.",
    de: 'Dieser Player ist nicht mehr auf dem Lyrion-Server.',
    es: 'Este reproductor ya no está en el servidor Lyrion.',
  },
  unavailable: {
    en: 'The Lyrion server is unavailable.',
    fr: 'Le serveur Lyrion est indisponible.',
    de: 'Der Lyrion-Server ist nicht erreichbar.',
    es: 'El servidor Lyrion no está disponible.',
  },
  state: { en: 'State', fr: 'État', de: 'Status', es: 'Estado' },
  volume: { en: 'Volume', fr: 'Volume', de: 'Lautstärke', es: 'Volumen' },
  muted: { en: 'muted', fr: 'coupé', de: 'stumm', es: 'silenciado' },
  group: { en: 'Group', fr: 'Groupe', de: 'Gruppe', es: 'Grupo' },
  play: { en: 'Play', fr: 'Lire', de: 'Abspielen', es: 'Reproducir' },
  pause: { en: 'Pause', fr: 'Pause', de: 'Pause', es: 'Pausa' },
  next: { en: 'Next', fr: 'Suivant', de: 'Weiter', es: 'Siguiente' },
  volume_down: { en: 'Volume −', fr: 'Volume −', de: 'Leiser', es: 'Volumen −' },
  volume_up: { en: 'Volume +', fr: 'Volume +', de: 'Lauter', es: 'Volumen +' },
  power_on: { en: 'Turn on', fr: 'Allumer', de: 'Einschalten', es: 'Encender' },
  pause_all: { en: 'Pause all', fr: 'Tout en pause', de: 'Alle pausieren', es: 'Pausar todo' },
  cover: { en: 'Cover', fr: 'Pochette', de: 'Cover', es: 'Carátula' },
};

export const WIDGET_ACTIONS = [
  'play_pause',
  'next',
  'volume_down',
  'volume_up',
  'power_on',
  'pause_all',
];

const COLORS = {
  play: WIDGET_COLORS.SUCCESS,
  pause: WIDGET_COLORS.WARNING,
  stop: WIDGET_COLORS.NEUTRAL,
  off: WIDGET_COLORS.NEUTRAL,
  offline: WIDGET_COLORS.DANGER,
};

const textOnly = (text, ttl = 60) => ({
  ttl_seconds: ttl,
  components: [{ type: 'text', variant: 'body', text }],
});

const button = (lang, key, icon, label = key) => ({
  type: 'button',
  label: pick(TEXT[label], lang),
  icon,
  action: { key },
});

/** play | pause | stop | off | offline */
export function stateOf(snapshot) {
  if (!snapshot || !snapshot.connected) {
    return 'offline';
  }
  if (!snapshot.power) {
    return 'off';
  }
  return snapshot.mode;
}

function songLine(snapshot, lang) {
  if (!snapshot || snapshot.tracks === 0) {
    return pick(NOTHING_PLAYING, lang);
  }
  const title = snapshot.title || snapshot.station || pick(UNKNOWN_TITLE, lang);
  return snapshot.artist ? `${snapshot.artist} – ${title}` : title;
}

function listContent(hub, lang) {
  const players = [...hub.players.values()].slice(0, 8);
  if (players.length === 0) {
    return textOnly(
      pick(hub.client && hub.serverError === null ? TEXT.empty : TEXT.unavailable, lang),
    );
  }
  const components = [
    {
      type: 'card-list',
      display: 'list',
      items: players.map((player) => {
        const state = stateOf(player.snapshot);
        return {
          title: hub.deviceName(player).slice(0, 60),
          subtitle: songLine(player.snapshot, lang).slice(0, 120),
          badge: { text: pick(STATE_LABELS, lang)[state].slice(0, 16), color: COLORS[state] },
        };
      }),
    },
  ];
  if (players.some((player) => isPlaying(player.snapshot))) {
    components.push(button(lang, 'pause_all', 'pause-circle'));
  }
  const playing = players.some((player) => isPlaying(player.snapshot));
  return { ttl_seconds: playing ? 30 : 120, components };
}

function playerContent(hub, player, lang) {
  const { snapshot } = player;
  const state = stateOf(snapshot);
  const components = [];
  const cover = state === 'offline' ? null : hub.coverKey(player);
  if (cover) {
    components.push({ type: 'image', key: cover, alt: pick(TEXT.cover, lang), fit: 'contain' });
  }
  const loaded = snapshot && snapshot.tracks > 0;
  const title = loaded
    ? snapshot.title || snapshot.station || pick(UNKNOWN_TITLE, lang)
    : pick(NOTHING_PLAYING, lang);
  components.push({ type: 'text', variant: 'heading', text: title.slice(0, 40) });
  const caption = [];
  if (title.length > 40) {
    caption.push(title);
  }
  if (loaded && snapshot.artist) {
    caption.push(snapshot.artist);
  }
  if (loaded && snapshot.album) {
    caption.push(snapshot.album);
  }
  caption.push(hub.deviceName(player));
  components.push({ type: 'text', variant: 'caption', text: caption.join(' · ').slice(0, 80) });

  const items = [
    {
      label: pick(TEXT.state, lang),
      value: pick(STATE_LABELS, lang)[state].slice(0, 40),
      color: COLORS[state],
    },
  ];
  if (state !== 'offline' && snapshot.volume !== null) {
    items.push({
      label: pick(TEXT.volume, lang),
      value: snapshot.muted
        ? `${snapshot.volume} % (${pick(TEXT.muted, lang)})`
        : `${snapshot.volume} %`,
      icon: snapshot.muted ? 'volume-x' : 'volume-2',
    });
  }
  if (snapshot?.syncSlaves.length) {
    const members = [snapshot.syncMaster, ...snapshot.syncSlaves]
      .filter((id) => id && id !== player.id)
      .map((id) => (hub.players.get(id) ? hub.deviceName(hub.players.get(id)) : id));
    if (members.length) {
      items.push({
        label: pick(TEXT.group, lang),
        value: members.join(', ').slice(0, 40),
        icon: 'link',
      });
    }
  }
  components.push({ type: 'status', items });

  if (state === 'off') {
    components.push(button(lang, 'power_on', 'power'));
  } else if (state !== 'offline') {
    if (loaded) {
      components.push(
        state === 'play'
          ? button(lang, 'play_pause', 'pause', 'pause')
          : button(lang, 'play_pause', 'play', 'play'),
        button(lang, 'next', 'skip-forward'),
      );
    }
    if (snapshot.volume !== null) {
      components.push(
        button(lang, 'volume_down', 'volume-1'),
        button(lang, 'volume_up', 'volume-2'),
      );
    }
  }
  return { ttl_seconds: state === 'play' ? 30 : 120, components };
}

/**
 * @param {object} hub
 * @param {{ settings?: object, language?: string }} request
 */
export function buildContent(hub, { settings = {}, language = 'en' } = {}) {
  const lang = STATE_LABELS[language] ? language : 'en';
  if (typeof settings.device !== 'string' || settings.device === '') {
    return listContent(hub, lang);
  }
  const player = [...hub.players.values()].find(
    (candidate) => deviceIds(hub.gladys, candidate.id).device === settings.device,
  );
  if (!player) {
    return textOnly(pick(TEXT.unknown, lang), 300);
  }
  return playerContent(hub, player, lang);
}

export const WIDGETS = {
  [WIDGET_KEY]: {
    get(hub, request) {
      return buildContent(hub, request ?? {});
    },

    /** Resolves the toast (a widget action receives no language: all four). */
    async action(hub, { actionKey, settings = {} }) {
      try {
        if (actionKey === 'pause_all') {
          await hub.pauseAll();
          return DONE_TEXT.pause_all;
        }
        const player = hub.playerOf(settings.device);
        switch (actionKey) {
          case 'play_pause':
            await hub.playPause(player);
            return DONE_TEXT.play_pause;
          case 'next':
            await hub.send(player.id, ['playlist', 'index', '+1']);
            return DONE_TEXT.next;
          case 'volume_down':
          case 'volume_up':
            await hub.stepVolume(player, actionKey === 'volume_up' ? VOLUME_STEP : -VOLUME_STEP);
            return DONE_TEXT[actionKey];
          case 'power_on':
            await hub.send(player.id, ['power', '1']);
            return DONE_TEXT.play_pause;
          default:
            throw new Error(`Unknown widget action ${actionKey}`);
        }
      } catch (err) {
        if (err instanceof CommandError) {
          return err.messages;
        }
        throw err;
      }
    },
  },
};
