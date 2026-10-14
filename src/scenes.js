// -----------------------------------------------------------------------------
// Scene actions (manifest `scene_actions`). They receive the resolved fields
// and no language: errors follow the configured `language`.
// The core already sets a volume, plays, pauses and skips through the device
// features; these actions add what it cannot: favorites, every player at
// once, announcements that give the music back, groups.
// -----------------------------------------------------------------------------

export const SCENE_ACTIONS = {
  async play_favorite(hub, { fields }) {
    const player = hub.playerOf(fields.device);
    const favorite = await hub.playFavorite(player, fields.favorite);
    return { favorite: favorite.name };
  },

  /** No player chosen: every connected player of the server. */
  async set_volume(hub, { fields }) {
    if (typeof fields.device === 'string' && fields.device !== '') {
      await hub.setVolume(hub.playerOf(fields.device), fields.volume);
      return undefined;
    }
    await hub.refresh();
    const players = [...hub.players.values()].filter((p) => p.connected);
    for (const player of players) {
      await hub.setVolume(player, fields.volume);
    }
    return undefined;
  },

  async pause_all(hub) {
    return { paused: await hub.pauseAll() };
  },

  async announce(hub, { fields }) {
    await hub.announce(hub.playerOf(fields.device), fields.url, fields.volume ?? null);
    return undefined;
  },

  async join_group(hub, { fields }) {
    await hub.join(hub.playerOf(fields.device), hub.playerOf(fields.target));
    return undefined;
  },

  async leave_group(hub, { fields }) {
    await hub.leave(hub.playerOf(fields.device));
    return undefined;
  },
};
