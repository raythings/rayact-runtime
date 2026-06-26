import type { HostBridge, RayactDevClient, RayactGlobal, WebSocketLike } from './types';

interface DevClientOptions {
  serverUrl: string;
  bridge: HostBridge;
  global?: RayactGlobal;
}

interface DevMessage {
  type: string;
  payload?: unknown;
}

interface ManifestInfo {
  revision?: number;
  bundleFormat?: 'js' | 'qjsbc';
  bundleUrl?: string;
  hmrUrl?: string;
}

function joinUrl(serverUrl: string, path: string): string {
  return `${serverUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

function toWsUrl(serverUrl: string, channel: string): string {
  return joinUrl(serverUrl, channel).replace(/^https:/, 'wss:').replace(/^http:/, 'ws:');
}

function serializeError(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return { message: error.message, stack: error.stack };
  }
  return { message: String(error) };
}

export function createDevClient(options: DevClientOptions): RayactDevClient {
  const globalObject = options.global ?? globalThis as RayactGlobal;
  let debuggerSocket: WebSocketLike | null = null;
  let hmrSocket: WebSocketLike | null = null;
  let debuggerReconnect: ReturnType<typeof setTimeout> | null = null;
  let hmrReconnect: ReturnType<typeof setTimeout> | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let lastRevision: number | null = null;
  let manifest: ManifestInfo = {};

  const send = (type: string, payload?: unknown) => {
    if (!debuggerSocket || debuggerSocket.readyState !== 1) return;
    debuggerSocket.send(JSON.stringify({ type, payload }));
  };

  const fetchManifest = async (): Promise<ManifestInfo> => {
    const fetchFn = globalObject.fetch;
    if (typeof fetchFn !== 'function') return {};
    const response = await fetchFn(joinUrl(options.serverUrl, '/rayact/manifest.json'));
    return JSON.parse(await response.text()) as ManifestInfo;
  };

  const loadBundle = async (): Promise<boolean> => {
    try {
      const fetchFn = globalObject.fetch;
      if (typeof fetchFn !== 'function') {
        throw new Error('Rayact dev client requires fetch()');
      }
      manifest = await fetchManifest();
      const bundlePath = manifest.bundleFormat === 'qjsbc' ? '/rayact/bundle.qjsbc' : '/rayact/bundle';
      const bundleUrl = manifest.bundleUrl ?? joinUrl(options.serverUrl, bundlePath);
      const response = await fetchFn(bundleUrl);

      if (manifest.bundleFormat === 'qjsbc') {
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (typeof globalObject.loadBytecode === 'function') {
          await globalObject.loadBytecode(bytes);
        } else {
          throw new Error('Rayact dev client requires loadBytecode() for .qjsbc bundles');
        }
      } else {
        const source = await response.text();
        await options.bridge.reload(source);
      }
      send('client:reloaded');
      return true;
    } catch (error) {
      const serialized = serializeError(error);
      options.bridge.showError?.(serialized.message, serialized.stack);
      send('client:error', serialized);
      return false;
    }
  };

  const pollStatus = async () => {
    try {
      const fetchFn = globalObject.fetch;
      if (typeof fetchFn !== 'function') return;
      const response = await fetchFn(joinUrl(options.serverUrl, '/rayact/status'));
      const status = JSON.parse(await response.text()) as { revision?: number };
      if (typeof status.revision !== 'number') return;

      if (lastRevision === null) {
        lastRevision = status.revision;
        return;
      }

      if (status.revision !== lastRevision) {
        globalObject.console?.info?.(`[rayact] revision ${status.revision} detected (poll fallback)`);
        if (await loadBundle()) lastRevision = status.revision;
      }
    } catch (error) {
      globalObject.console?.warn?.('[rayact] revision poll failed', error);
    }
  };

  const handleHmrMessage = (message: DevMessage) => {
    if (message.type === 'reload' || message.type === 'hmr-update') {
      globalObject.console?.info?.(`[rayact] ${message.type} received`);
      const revision = typeof (message.payload as { revision?: unknown } | undefined)?.revision === 'number'
        ? (message.payload as { revision: number }).revision
        : null;
      void loadBundle().then(ok => {
        if (ok && revision !== null) lastRevision = revision;
      });
    } else if (message.type === 'build:error') {
      const payload = message.payload as { message?: string; stack?: string };
      options.bridge.showError?.(payload.message ?? 'Build error', payload.stack);
    }
  };

  const connectHmr = () => {
    const WebSocketCtor = globalObject.WebSocket;
    if (typeof WebSocketCtor !== 'function') return;
    if (hmrSocket) return;

    const hmrUrl = manifest.hmrUrl ?? toWsUrl(options.serverUrl, '/rayact/hmr');
    globalObject.console?.info?.(`[rayact] connecting hmr: ${hmrUrl}`);
    hmrSocket = new WebSocketCtor(hmrUrl);
    hmrSocket.onopen = () => {
      globalObject.console?.info?.('[rayact] hmr connected');
    };
    hmrSocket.onclose = () => {
      globalObject.console?.warn?.('[rayact] hmr disconnected');
      hmrSocket = null;
      hmrReconnect = setTimeout(connectHmr, 1000);
    };
    hmrSocket.onerror = event => {
      globalObject.console?.warn?.('[rayact] hmr socket error', event);
    };
    hmrSocket.onmessage = event => {
      try {
        handleHmrMessage(JSON.parse(event.data));
      } catch {
        // ignore
      }
    };
  };

  const connectDebugger = () => {
    const WebSocketCtor = globalObject.WebSocket;
    if (typeof WebSocketCtor !== 'function') return;
    if (debuggerSocket) return;

    const debuggerUrl = toWsUrl(options.serverUrl, '/rayact/debugger');
    globalObject.console?.info?.(`[rayact] connecting debugger: ${debuggerUrl}`);
    debuggerSocket = new WebSocketCtor(debuggerUrl);
    debuggerSocket.onopen = () => {
      globalObject.console?.info?.('[rayact] debugger connected');
      send('client:ready', { serverUrl: options.serverUrl });
    };
    debuggerSocket.onclose = () => {
      globalObject.console?.warn?.('[rayact] debugger disconnected');
      debuggerSocket = null;
      debuggerReconnect = setTimeout(connectDebugger, 1000);
    };
    debuggerSocket.onerror = event => {
      globalObject.console?.warn?.('[rayact] debugger socket error', event);
    };
  };

  const connect = () => {
    void fetchManifest().then(m => {
      manifest = m;
      connectHmr();
      connectDebugger();
    });

    if (!pollTimer) {
      pollTimer = setInterval(() => { void pollStatus(); }, 5000);
      void pollStatus();
    }
  };

  const disconnect = () => {
    if (debuggerReconnect) { clearTimeout(debuggerReconnect); debuggerReconnect = null; }
    if (hmrReconnect) { clearTimeout(hmrReconnect); hmrReconnect = null; }
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    if (debuggerSocket) { debuggerSocket.close(); debuggerSocket = null; }
    if (hmrSocket) { hmrSocket.close(); hmrSocket = null; }
  };

  return { connect, disconnect, send };
}

export function installConsoleForwarding(client: RayactDevClient, globalObject: RayactGlobal = globalThis as RayactGlobal): void {
  const consoleObject = globalObject.console;
  if (!consoleObject || (globalObject as { __rayactConsoleForwarding?: boolean }).__rayactConsoleForwarding) return;

  (globalObject as { __rayactConsoleForwarding?: boolean }).__rayactConsoleForwarding = true;

  for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    const original = consoleObject[level]?.bind(consoleObject);
    if (!original) continue;
    consoleObject[level] = (...args: unknown[]) => {
      original(...args);
      client.send('console', {
        level,
        args: args.map(arg => {
          try {
            return typeof arg === 'string' ? arg : JSON.stringify(arg);
          } catch {
            return String(arg);
          }
        })
      });
    };
  }
}
