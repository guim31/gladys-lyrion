// -----------------------------------------------------------------------------
// Registers every SDK handler on a GladysIntegration (or the SDK's fake Gladys
// in the tests) and returns the hub, so index.js stays a few lines and the
// tests drive the very same wiring.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import { Hub } from './hub.js';
import { SCENE_ACTIONS } from './scenes.js';
import { INIT_FAILED } from './texts.js';
import { WIDGETS } from './widgets.js';

const logger = createLogger({ name: 'lyrion-app' });

/**
 * @param {object} gladys GladysIntegration instance
 * @param {object} [options] test seams: fetch, connect (net.createConnection), timings, now
 */
export function registerHandlers(gladys, options = {}) {
  const hub = new Hub({ gladys, ...options });

  // Resolved once the hub has started; every handler waits for it, so a
  // command arriving during the start is not lost.
  let resolveReady;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });
  let started = false;
  const whenReady =
    (fn) =>
    async (...args) => {
      await ready;
      return fn(...args);
    };

  gladys.on('connected', async () => {
    try {
      if (started) {
        // A reconnection (Gladys restarted): re-sync what Gladys may have lost.
        await hub.resync();
        return;
      }
      started = true;
      await hub.start(normalizeConfig(await gladys.getConfig()));
    } catch (err) {
      logger.error('Initialization failed', err);
      await gladys.setConnectionStatus(false, INIT_FAILED).catch(() => {});
    } finally {
      resolveReady();
    }
  });

  gladys.onScanRequest(
    whenReady(async () => {
      await hub.refresh();
      await hub.publishDevices();
    }),
  );
  gladys.onSetValue(whenReady((device, feature, value) => hub.setValue(device, feature, value)));
  // The devices are published with should_poll: false (the container reads
  // LMS itself); this only serves a Gladys that would poll anyway.
  gladys.onPoll(whenReady(() => hub.refresh()));
  gladys.onDeviceCreated(whenReady((device) => hub.onDeviceCreated(device)));
  gladys.onConfigUpdated(whenReady((config) => hub.reconfigure(normalizeConfig(config))));

  for (const [key, handler] of Object.entries(SCENE_ACTIONS)) {
    gladys.onSceneAction(
      key,
      whenReady((fields) => handler(hub, { fields: fields ?? {} })),
    );
  }

  for (const [key, widget] of Object.entries(WIDGETS)) {
    gladys.onWidgetGet(
      key,
      whenReady((request) => widget.get(hub, request)),
    );
    gladys.onWidgetAction(
      key,
      whenReady((actionKey, params, context = {}) =>
        widget.action(hub, { actionKey, params, ...context }),
      ),
    );
  }
  gladys.onWidgetGetImage(whenReady((imageKey) => hub.widgetImage(imageKey)));

  return { hub, ready, stop: () => hub.stop() };
}
