// -----------------------------------------------------------------------------
// The "Lyrion players" widget: both views fit the core vocabulary and budget
// (validateWidgetContent), the buttons act on LMS, the cover is served.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent, validateWidgetImage } from '@gladysassistant/integration-sdk';
import { FakeLms, KITCHEN, SALON, SONGS } from './helpers/fakeLms.js';
import { createWorld, deviceId, until } from './helpers/world.js';

async function world(t, setup = () => {}) {
  const lms = new FakeLms();
  setup(lms);
  const w = await createWorld({ lms });
  t.after(() => w.app.stop());
  await until(() => w.hub.players.get(KITCHEN)?.snapshot, 2000, 'first read');
  return w;
}

const get = async (gladys, settings, language = 'en') => {
  const ack = await gladys.fake.widgetGet('players', { settings, language });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(validateWidgetContent(ack.data.content), [], 'rendered as sent');
  return ack.data.content;
};

test('without a player: every player in a list, and "Pause all" while one plays', async (t) => {
  const { gladys } = await world(t, (lms) => {
    lms.load(KITCHEN, SONGS);
    lms.player(SALON).power = 0;
  });
  const content = await get(gladys, {}, 'fr');
  const [list, button] = content.components;
  assert.equal(list.type, 'card-list');
  assert.deepEqual(
    list.items.map((i) => [i.title, i.subtitle, i.badge.text]),
    [
      ['Kitchen', 'The Larks – Morning Song', 'En lecture'],
      ['Salon', '—', 'Éteint'],
    ],
  );
  assert.equal(button.action.key, 'pause_all');
  const ack = await gladys.fake.widgetAction('players', 'pause_all', {}, { settings: {} });
  assert.equal(ack.data.message.fr, 'Tous les lecteurs sont en pause');
});

test('one player: cover, song, artist and album, state, four buttons', async (t) => {
  const { gladys, lms } = await world(t, (lms) => lms.load(KITCHEN, SONGS));
  const content = await get(gladys, { device: deviceId(KITCHEN) });
  const types = content.components.map((c) => c.type);
  assert.deepEqual(types, [
    'image',
    'text',
    'text',
    'status',
    'button',
    'button',
    'button',
    'button',
  ]);
  assert.equal(content.components[1].text, 'Morning Song');
  assert.equal(content.components[2].text, 'The Larks · Daybreak · Kitchen');
  assert.deepEqual(
    content.components.slice(4).map((b) => b.action.key),
    ['play_pause', 'next', 'volume_down', 'volume_up'],
  );

  const image = await gladys.fake.widgetGetImage(content.components[0].key);
  assert.equal(image.success, true, image.error);
  assert.deepEqual(validateWidgetImage(image.data.image), []);
  assert.equal(lms.requests.at(-1).path, '/music/a1b2c3d4/cover_300x300_o.jpg');

  const act = (key) =>
    gladys.fake.widgetAction('players', key, {}, { settings: { device: deviceId(KITCHEN) } });
  await act('play_pause');
  assert.equal(lms.player(KITCHEN).mode, 'pause');
  await act('volume_up');
  assert.equal(lms.player(KITCHEN).volume, 55);
  await act('next');
  assert.equal(lms.player(KITCHEN).index, 1);
});

test('a song without cover has no image; an off player offers "Turn on"', async (t) => {
  const { gladys, lms, hub } = await world(t, (lms) => {
    lms.load(KITCHEN, SONGS, { index: 2 });
    lms.player(SALON).power = 0;
  });
  const kitchen = await get(gladys, { device: deviceId(KITCHEN) });
  assert.notEqual(kitchen.components[0].type, 'image');
  const salon = await get(gladys, { device: deviceId(SALON) }, 'de');
  const buttons = salon.components.filter((c) => c.type === 'button');
  assert.deepEqual(
    buttons.map((b) => [b.action.key, b.label]),
    [['power_on', 'Einschalten']],
  );
  await gladys.fake.widgetAction(
    'players',
    'power_on',
    {},
    { settings: { device: deviceId(SALON) } },
  );
  assert.equal(lms.player(SALON).power, 1);
  await until(() => hub.players.get(SALON).snapshot.power, 2000, 'on');
});

test('a group shows its members; a removed player and an empty server have a message', async (t) => {
  const { gladys, hub, lms } = await world(t, (lms) => {
    lms.load(KITCHEN, SONGS);
    lms.player(SALON).master = KITCHEN;
  });
  const content = await get(gladys, { device: deviceId(KITCHEN) });
  const status = content.components.find((c) => c.type === 'status');
  assert.deepEqual(status.items.at(-1), { label: 'Group', value: 'Salon', icon: 'link' });

  const gone = await get(gladys, { device: 'ext:test-integration:player:nope' }, 'es');
  assert.equal(gone.components[0].text, 'Este reproductor ya no está en el servidor Lyrion.');
  lms.players.clear();
  hub.players.clear();
  const empty = await get(gladys, {}, 'fr');
  assert.match(empty.components[0].text, /Aucun lecteur/);
});

test('a failing button resolves a toast in the four languages', async (t) => {
  const { gladys, lms } = await world(t);
  lms.down = true;
  const ack = await gladys.fake.widgetAction(
    'players',
    'volume_up',
    {},
    {
      settings: { device: deviceId(KITCHEN) },
    },
  );
  assert.equal(ack.success, true);
  assert.deepEqual(Object.keys(ack.data.message), ['en', 'fr', 'de', 'es']);
  assert.match(ack.data.message.en, /does not answer/);
});
