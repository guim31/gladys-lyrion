// -----------------------------------------------------------------------------
// A world for the tests: the SDK's fake Gladys, the real wiring (src/app.js)
// and a scripted Lyrion server, with short timings.
// -----------------------------------------------------------------------------

import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { FakeLms, until } from './fakeLms.js';

export const FAST = {
  fastPollMs: 40,
  slowPollMs: 400,
  debounceMs: 5,
  announceCheckMs: 10,
  announceStartMs: 200,
  cliSettleMs: 20,
  cliReconnectMs: 20,
};

export const deviceId = (playerId) =>
  `ext:test-integration:player:${playerId.toLowerCase().replace(/[^a-z0-9]/g, '')}`;

export const featureId = (playerId, key) => `${deviceId(playerId)}:${key}`;

export async function createWorld({
  lms = new FakeLms(),
  config = {},
  timings = {},
  connect = true,
} = {}) {
  const gladys = createFakeGladys({ config: { host: '192.0.2.10', language: 'en', ...config } });
  const app = registerHandlers(gladys, {
    fetch: lms.fetch,
    connect: lms.connect,
    timings: { ...FAST, ...timings },
  });
  if (connect) {
    await gladys.connect();
  }
  return { gladys, app, hub: app.hub, lms };
}

/** "Add to Gladys" every discovered player. */
export async function createAll(gladys) {
  for (const device of gladys.fake.discoveredDevices) {
    await gladys.fake.deviceCreated(device);
  }
}

export const deviceOf = (gladys, playerId) =>
  gladys.fake.discoveredDevices.find((d) => d.external_id === deviceId(playerId));

export const featureOf = (gladys, playerId, key) =>
  deviceOf(gladys, playerId).features.find((f) => f.external_id === featureId(playerId, key));

export { until };
