"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.PlaywrightConnection = void 0;

var _server = require("../server");

var _browser = require("../server/browser");

var _instrumentation = require("../server/instrumentation");

var _processLauncher = require("../utils/processLauncher");

var _socksProxy = require("../common/socksProxy");

var _utils = require("../utils");

/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
class PlaywrightConnection {
  constructor(lock, mode, ws, options, preLaunched, log, onClose) {
    this._ws = void 0;
    this._onClose = void 0;
    this._dispatcherConnection = void 0;
    this._cleanups = [];
    this._debugLog = void 0;
    this._disconnected = false;
    this._preLaunched = void 0;
    this._options = void 0;
    this._root = void 0;
    this._ws = ws;
    this._preLaunched = preLaunched;
    this._options = options;
    if (mode === 'reuse-browser' || mode === 'use-pre-launched-browser') (0, _utils.assert)(preLaunched.playwright);
    if (mode === 'use-pre-launched-browser') (0, _utils.assert)(preLaunched.browser);
    this._onClose = onClose;
    this._debugLog = log;
    this._dispatcherConnection = new _server.DispatcherConnection();

    this._dispatcherConnection.onmessage = async message => {
      await lock;
      if (ws.readyState !== ws.CLOSING) ws.send(JSON.stringify(message));
    };

    ws.on('message', async message => {
      await lock;

      this._dispatcherConnection.dispatch(JSON.parse(Buffer.from(message).toString()));
    });
    ws.on('close', () => this._onDisconnect());
    ws.on('error', error => this._onDisconnect(error));
    this._root = new _server.RootDispatcher(this._dispatcherConnection, async scope => {
      if (mode === 'reuse-browser') return await this._initReuseBrowsersMode(scope);
      if (mode === 'use-pre-launched-browser') return await this._initPreLaunchedBrowserMode(scope);
      if (!options.browserName) return await this._initPlaywrightConnectMode(scope);
      return await this._initLaunchBrowserMode(scope);
    });
  }

  async _initPlaywrightConnectMode(scope) {
    this._debugLog(`engaged playwright.connect mode`);

    const playwright = (0, _server.createPlaywright)('javascript'); // Close all launched browsers on disconnect.

    this._cleanups.push(() => (0, _processLauncher.gracefullyCloseAll)());

    const socksProxy = this._options.enableSocksProxy ? await this._enableSocksProxy(playwright) : undefined;
    return new _server.PlaywrightDispatcher(scope, playwright, socksProxy);
  }

  async _initLaunchBrowserMode(scope) {
    this._debugLog(`engaged launch mode for "${this._options.browserName}"`);

    const playwright = (0, _server.createPlaywright)('javascript');
    const socksProxy = this._options.enableSocksProxy ? await this._enableSocksProxy(playwright) : undefined;
    const browser = await playwright[this._options.browserName].launch((0, _instrumentation.serverSideCallMetadata)(), this._options.launchOptions);

    this._cleanups.push(async () => {
      for (const browser of playwright.allBrowsers()) await browser.close();
    });

    browser.on(_browser.Browser.Events.Disconnected, () => {
      // Underlying browser did close for some reason - force disconnect the client.
      this.close({
        code: 1001,
        reason: 'Browser closed'
      });
    });
    return new _server.PlaywrightDispatcher(scope, playwright, socksProxy, browser);
  }

  async _initPreLaunchedBrowserMode(scope) {
    this._debugLog(`engaged pre-launched mode`);

    const playwright = this._preLaunched.playwright;
    const browser = this._preLaunched.browser;
    browser.on(_browser.Browser.Events.Disconnected, () => {
      // Underlying browser did close for some reason - force disconnect the client.
      this.close({
        code: 1001,
        reason: 'Browser closed'
      });
    });
    const playwrightDispatcher = new _server.PlaywrightDispatcher(scope, playwright, undefined, browser); // In pre-launched mode, keep only the pre-launched browser.

    for (const b of playwright.allBrowsers()) {
      if (b !== browser) await b.close();
    }

    this._cleanups.push(() => playwrightDispatcher.cleanup());

    return playwrightDispatcher;
  }

  async _initReuseBrowsersMode(scope) {
    this._debugLog(`engaged reuse browsers mode for ${this._options.browserName}`);

    const playwright = this._preLaunched.playwright;
    const requestedOptions = launchOptionsHash(this._options.launchOptions);
    let browser = playwright.allBrowsers().find(b => {
      if (b.options.name !== this._options.browserName) return false;
      const existingOptions = launchOptionsHash(b.options.originalLaunchOptions);
      return existingOptions === requestedOptions;
    }); // Close remaining browsers of this type+channel. Keep different browser types for the speed.

    for (const b of playwright.allBrowsers()) {
      if (b === browser) continue;
      if (b.options.name === this._options.browserName && b.options.channel === this._options.launchOptions.channel) await b.close();
    }

    if (!browser) {
      browser = await playwright[this._options.browserName].launch((0, _instrumentation.serverSideCallMetadata)(), { ...this._options.launchOptions,
        headless: false
      });
      browser.on(_browser.Browser.Events.Disconnected, () => {
        // Underlying browser did close for some reason - force disconnect the client.
        this.close({
          code: 1001,
          reason: 'Browser closed'
        });
      });
    }

    this._cleanups.push(async () => {
      // Don't close the pages so that user could debug them,
      // but close all the empty browsers and contexts to clean up.
      for (const browser of playwright.allBrowsers()) {
        for (const context of browser.contexts()) {
          if (!context.pages().length) await context.close((0, _instrumentation.serverSideCallMetadata)());
        }

        if (!browser.contexts()) await browser.close();
      }
    });

    const playwrightDispatcher = new _server.PlaywrightDispatcher(scope, playwright, undefined, browser);
    return playwrightDispatcher;
  }

  async _enableSocksProxy(playwright) {
    const socksProxy = new _socksProxy.SocksProxy();
    playwright.options.socksProxyPort = await socksProxy.listen(0);

    this._debugLog(`started socks proxy on port ${playwright.options.socksProxyPort}`);

    this._cleanups.push(() => socksProxy.close());

    return socksProxy;
  }

  async _onDisconnect(error) {
    this._disconnected = true;

    this._debugLog(`disconnected. error: ${error}`);

    this._root._dispose();

    this._debugLog(`starting cleanup`);

    for (const cleanup of this._cleanups) await cleanup().catch(() => {});

    this._onClose();

    this._debugLog(`finished cleanup`);
  }

  async close(reason) {
    if (this._disconnected) return;

    this._debugLog(`force closing connection: ${(reason === null || reason === void 0 ? void 0 : reason.reason) || ''} (${(reason === null || reason === void 0 ? void 0 : reason.code) || 0})`);

    try {
      this._ws.close(reason === null || reason === void 0 ? void 0 : reason.code, reason === null || reason === void 0 ? void 0 : reason.reason);
    } catch (e) {}
  }

}

exports.PlaywrightConnection = PlaywrightConnection;

function launchOptionsHash(options) {
  const copy = { ...options
  };

  for (const k of Object.keys(copy)) {
    const key = k;
    if (copy[key] === defaultLaunchOptions[key]) delete copy[key];
  }

  for (const key of optionsThatAllowBrowserReuse) delete copy[key];

  return JSON.stringify(copy);
}

const defaultLaunchOptions = {
  ignoreAllDefaultArgs: false,
  handleSIGINT: false,
  handleSIGTERM: false,
  handleSIGHUP: false,
  headless: true,
  devtools: false
};
const optionsThatAllowBrowserReuse = ['headless'];