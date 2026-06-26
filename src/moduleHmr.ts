import type { HostBridge, RayactGlobal, WebSocketLike } from './types';

export interface ModuleHmrOptions {
  serverUrl: string;
  bridge?: HostBridge;
  global?: RayactGlobal;
  /** When set, HTTP + WS are handled natively (Android without RAYACT_NO_NET). */
  nativeTransport?: boolean;
}

export interface DevManifestModule {
  hmrMode?: string;
  bootstrapUrl?: string;
  entryModuleUrl?: string;
  hmrUrl?: string;
  bundleUrl?: string;
  revision?: number;
}

type ModuleFactory = () => unknown;

// The engine's minimal QuickJS build has no global URL/URLSearchParams, so we
// parse module URLs by hand. Using `new URL()` here throws "URL is not defined"
// inside the bootstrap and the project pane renders black.
function parseUrlParts(url: string): { pathname: string; search: string } {
  let rest = url;
  const schemeIdx = rest.indexOf('://');
  if (schemeIdx >= 0) {
    const afterAuthority = rest.slice(schemeIdx + 3);
    const slash = afterAuthority.indexOf('/');
    rest = slash >= 0 ? afterAuthority.slice(slash) : '/';
  }
  const hashIdx = rest.indexOf('#');
  if (hashIdx >= 0) rest = rest.slice(0, hashIdx);
  const qIdx = rest.indexOf('?');
  if (qIdx >= 0) return { pathname: rest.slice(0, qIdx), search: rest.slice(qIdx) };
  return { pathname: rest, search: '' };
}

function getQueryParam(search: string, key: string): string | null {
  const q = search.startsWith('?') ? search.slice(1) : search;
  if (!q) return null;
  for (const pair of q.split('&')) {
    const eq = pair.indexOf('=');
    const rawKey = eq >= 0 ? pair.slice(0, eq) : pair;
    if (decodeURIComponent(rawKey) === key) {
      return eq >= 0 ? decodeURIComponent(pair.slice(eq + 1)) : '';
    }
  }
  return null;
}

const VENDOR_MODULE_KEYS: Record<string, string> = {
  react: 'react',
  'react/jsx-runtime': 'jsxRuntime',
  'react/jsx-dev-runtime': 'jsxDevRuntime'
};

function normalizeVendorSpecifier(specifier: string): string | null {
  const bare = specifier.replace(/^\u0000rayact-vendor:/, '').replace(/^\0rayact-vendor:/, '');
  return VENDOR_MODULE_KEYS[bare] ? bare : null;
}

function getVendorNamespace(globalObject: GlobalHmr, specifier: string): unknown | null {
  const bare = normalizeVendorSpecifier(specifier);
  if (!bare) return null;
  const vendorKey = VENDOR_MODULE_KEYS[bare]!;
  const mod = globalObject.__RAYACT_VENDOR__?.[vendorKey];
  if (!mod) return null;
  if (bare === 'react') {
    return { default: mod, ...mod };
  }
  return {
    default: mod,
    Fragment: mod.Fragment,
    jsx: mod.jsx,
    jsxs: mod.jsxs,
    jsxDEV: mod.jsxDEV
  };
}

type GlobalHmr = RayactGlobal & {
  __rayactModuleRegistry?: Map<string, ModuleFactory>;
  __rayactModuleLoading?: Map<string, Promise<unknown>>;
  __rayactRequire?: (specifier: string, fromUrl?: string) => unknown;
  __rayactRegisterModule?: (url: string, factory: ModuleFactory) => void;
  __rayactApplyModuleUpdate?: (path: string, source: string) => void;
  __rayactDevFetch?: (url: string) => string;
  __rayactHmrRuntime?: ModuleHmrRuntime;
  __RAYACT_HMR_ACTIVE__?: boolean;
  __RAYACT_VENDOR__?: Record<string, Record<string, unknown>>;
  __REACT_REFRESH__?: { performReactRefresh: () => void };
};

export class ModuleHmrRuntime {
  private readonly globalObject: GlobalHmr;
  private readonly serverUrl: string;
  private readonly bridge?: HostBridge;
  private hmrSocket: WebSocketLike | null = null;
  private hmrReconnect: ReturnType<typeof setTimeout> | null = null;
  private manifest: DevManifestModule = {};
  private readonly bootstrapUrls = new Set<string>();

  constructor(options: ModuleHmrOptions) {
    this.serverUrl = options.serverUrl.replace(/\/+$/, '');
    this.bridge = options.bridge;
    this.globalObject = (options.global ?? globalThis) as GlobalHmr;
    this.installRegistry();
    this.globalObject.__rayactHmrRuntime = this;
    this.globalObject.__rayactApplyModuleUpdate = (path, source) => {
      this.applyModuleUpdate(path, source);
    };
  }

  private installRegistry(): void {
    if (!this.globalObject.__rayactModuleRegistry) {
      this.globalObject.__rayactModuleRegistry = new Map();
    }
    if (!this.globalObject.__rayactModuleLoading) {
      this.globalObject.__rayactModuleLoading = new Map();
    }

    this.globalObject.__rayactRegisterModule = (url, factory) => {
      this.globalObject.__rayactModuleRegistry!.set(normalizeModuleUrl(url), () =>
        normalizeModuleExport(factory())
      );
    };

    this.globalObject.__rayactRequire = (specifier, fromUrl) => {
      const vendor = getVendorNamespace(this.globalObject, specifier);
      if (vendor) return vendor;
      const resolved = resolveModuleUrl(specifier, fromUrl ?? '', this.serverUrl);
      return normalizeModuleExport(this.loadModuleSync(resolved));
    };
  }

  markBootstrap(url: string): void {
    this.bootstrapUrls.add(normalizeModuleUrl(url));
  }

  async startFromManifest(manifest?: DevManifestModule): Promise<void> {
    if (!manifest) {
      manifest = await this.fetchManifest();
    }
    this.manifest = manifest;

    if (manifest.bootstrapUrl) {
      this.markBootstrap(manifest.bootstrapUrl);
    }

    const entryUrl = manifest.entryModuleUrl;
    if (!entryUrl) {
      throw new Error('Dev manifest missing entryModuleUrl');
    }

    await this.loadModule(entryUrl);

    if (!this.globalObject.__RAYACT_HMR_ACTIVE__) {
      this.globalObject.__RAYACT_HMR_ACTIVE__ = true;
    }

    this.connectHmr(manifest.hmrUrl);
  }

  async fetchManifest(): Promise<DevManifestModule> {
    const g = this.globalObject as GlobalHmr & { __RAYACT_DEV_MANIFEST__?: DevManifestModule };
    if (g.__RAYACT_DEV_MANIFEST__) {
      return g.__RAYACT_DEV_MANIFEST__;
    }
    const text = await this.devFetchText(`${this.serverUrl}/rayact/manifest.json`);
    return JSON.parse(text) as DevManifestModule;
  }

  loadModuleSync(moduleUrl: string): unknown {
    const key = normalizeModuleUrl(moduleUrl);
    const registry = this.globalObject.__rayactModuleRegistry!;
    const loading = this.globalObject.__rayactModuleLoading!;

    if (registry.has(key)) {
      return registry.get(key)!();
    }

    const pending = loading.get(key);
    if (pending) {
      throw new Error(`Circular or async module dependency while loading ${key}`);
    }

    const fetchUrl = toRayactModuleUrl(moduleUrl, this.serverUrl);
    const parsed = parseUrlParts(fetchUrl);
    if (parsed.pathname === '/rayact/resolve') {
      const spec = getQueryParam(parsed.search, 'spec') ?? '';
      const vendor = getVendorNamespace(this.globalObject, spec);
      if (vendor) return vendor;
    }

    const source = this.devFetchTextSync(fetchUrl);
    this.evalModule(key, source);
    return registry.get(key)?.() ?? null;
  }

  async loadModule(moduleUrl: string): Promise<unknown> {
    if (typeof this.globalObject.__rayactDevFetch === 'function') {
      return this.loadModuleSync(moduleUrl);
    }

    const key = normalizeModuleUrl(moduleUrl);
    const registry = this.globalObject.__rayactModuleRegistry!;
    const loading = this.globalObject.__rayactModuleLoading!;

    if (registry.has(key)) {
      return registry.get(key)!();
    }

    const pending = loading.get(key);
    if (pending) return pending;

    const task = (async () => {
      const fetchUrl = toRayactModuleUrl(moduleUrl, this.serverUrl);
      const parsed = parseUrlParts(fetchUrl);
      if (parsed.pathname === '/rayact/resolve') {
        const spec = getQueryParam(parsed.search, 'spec') ?? '';
        const vendor = getVendorNamespace(this.globalObject, spec);
        if (vendor) return vendor;
      }
      const source = await this.devFetchText(fetchUrl);
      this.evalModule(key, source);
      return registry.get(key)?.() ?? null;
    })();

    loading.set(key, task);
    try {
      return await task;
    } finally {
      loading.delete(key);
    }
  }

  applyModuleUpdate(path: string, source: string): void {
    const absolute = path.startsWith('http')
      ? path
      : `${this.serverUrl}${path.startsWith('/') ? path : `/${path}`}`;
    const key = normalizeModuleUrl(toRayactModuleUrl(absolute, this.serverUrl));
    if (this.bootstrapUrls.has(key)) {
      this.globalObject.console?.warn?.('[rayact:hmr] ignoring bootstrap module update', key);
      return;
    }
    this.globalObject.__rayactModuleRegistry?.delete(key);
    this.globalObject.__rayactModuleLoading?.delete(key);
    this.evalModule(key, source);
    this.performRefresh();
  }

  private evalModule(moduleUrl: string, source: string): void {
    const g = this.globalObject;
    const previousRequire = g.__rayactRequire;
    const previousRegister = g.__rayactRegisterModule;
    try {
      // eslint-disable-next-line no-eval
      (0, eval)(source);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.bridge?.showError?.(`Module eval failed: ${moduleUrl}\n${message}`, stack);
      throw error;
    } finally {
      g.__rayactRequire = previousRequire;
      g.__rayactRegisterModule = previousRegister;
    }
  }

  private performRefresh(): void {
    try {
      this.globalObject.__REACT_REFRESH__?.performReactRefresh();
    } catch (error) {
      this.globalObject.console?.error?.('[rayact:hmr] refresh failed', error);
    }
  }

  private connectHmr(hmrUrl?: string): void {
    const WebSocketCtor = this.globalObject.WebSocket;
    if (typeof WebSocketCtor !== 'function') {
      this.globalObject.console?.info?.('[rayact:hmr] WebSocket unavailable — native transport expected');
      return;
    }

    const url = hmrUrl ?? this.serverUrl.replace(/^http/, 'ws') + '/rayact/hmr';
    if (this.hmrSocket) return;

    this.globalObject.console?.info?.(`[rayact:hmr] connecting ${url}`);
    this.hmrSocket = new WebSocketCtor(url);

    this.hmrSocket.onopen = () => {
      this.globalObject.console?.info?.('[rayact:hmr] connected');
    };

    this.hmrSocket.onclose = () => {
      this.globalObject.console?.warn?.('[rayact:hmr] disconnected');
      this.hmrSocket = null;
      this.hmrReconnect = setTimeout(() => this.connectHmr(url), 1000);
    };

    this.hmrSocket.onerror = event => {
      this.globalObject.console?.warn?.('[rayact:hmr] socket error', event);
    };

    this.hmrSocket.onmessage = event => {
      void this.handleHmrMessage(String(event.data));
    };
  }

  private async handleHmrMessage(raw: string): Promise<void> {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }

    const type = message.type;
    if (type === 'server:hello') return;

    if (type === 'full-reload' || type === 'reload') {
      await this.reloadEntry();
      return;
    }

    if (type === 'build:error' || type === 'error') {
      const payload = (message.payload ?? message.err ?? message) as { message?: string; stack?: string };
      this.bridge?.showError?.(payload.message ?? 'Build error', payload.stack);
      return;
    }

    if (type === 'update') {
      const updates = message.updates as Array<{ type?: string; path?: string; timestamp?: number }> | undefined;
      if (!updates?.length) return;
      for (const update of updates) {
        if (update.type !== 'js-update' || !update.path) continue;
        const moduleUrl = `${this.serverUrl}${update.path}${update.timestamp ? `?t=${update.timestamp}` : ''}`;
        try {
          const source = await this.devFetchText(toRayactModuleUrl(moduleUrl, this.serverUrl));
          this.applyModuleUpdate(update.path, source);
        } catch (error) {
          this.globalObject.console?.error?.('[rayact:hmr] module update failed', update.path, error);
        }
      }
      return;
    }

    if (type === 'hmr-update') {
      // Legacy revision broadcast — module mode ignores full bundle reloads.
      this.globalObject.console?.info?.('[rayact:hmr] ignoring legacy hmr-update (module mode)');
    }
  }

  private async reloadEntry(): Promise<void> {
    const entryUrl = this.manifest.entryModuleUrl;
    if (!entryUrl) return;
    const key = normalizeModuleUrl(entryUrl);
    this.globalObject.__rayactModuleRegistry?.delete(key);
    this.globalObject.__rayactModuleLoading?.delete(key);
    await this.loadModule(entryUrl);
    this.performRefresh();
  }

  private devFetchTextSync(url: string): string {
    const g = this.globalObject;
    if (typeof g.__rayactDevFetch !== 'function') {
      throw new Error('Sync module load requires __rayactDevFetch()');
    }
    const text = g.__rayactDevFetch(url);
    if (text.startsWith('Error:') || text.startsWith('SyntaxError:')) {
      throw new Error(text.slice(0, 300));
    }
    return text;
  }

  private async devFetchText(url: string): Promise<string> {
    const g = this.globalObject;
    let text: string;
    if (typeof g.__rayactDevFetch === 'function') {
      text = g.__rayactDevFetch(url);
    } else {
      const fetchFn = g.fetch;
      if (typeof fetchFn !== 'function') {
        throw new Error('Rayact module HMR requires fetch() or __rayactDevFetch()');
      }
      const response = await fetchFn(url) as { text(): Promise<string>; ok?: boolean; status?: number };
      text = await response.text();
      if (response.ok === false) {
        throw new Error(`Module fetch failed (${response.status}): ${text.slice(0, 200)}`);
      }
    }
    if (text.startsWith('Error:') || text.startsWith('SyntaxError:')) {
      throw new Error(text.slice(0, 300));
    }
    return text;
  }

  disconnect(): void {
    if (this.hmrReconnect) {
      clearTimeout(this.hmrReconnect);
      this.hmrReconnect = null;
    }
    if (this.hmrSocket) {
      this.hmrSocket.close();
      this.hmrSocket = null;
    }
  }
}

export function installModuleHmrRuntime(options: ModuleHmrOptions): ModuleHmrRuntime {
  return new ModuleHmrRuntime(options);
}

export function normalizeModuleExport(value: unknown): unknown {
  if (value == null) return value;
  const t = typeof value;
  if (t !== 'object' && t !== 'function') return value;
  const mod = value as Record<string, unknown>;
  // CJS interop: `module.exports = fn` / `= {...}` has no `default` binding, so a
  // default import (`import x from 'cjs'`, transformed to `mod.default`) resolves
  // to undefined — e.g. use-latest-callback's function default → "not a function".
  // ESM modules already expose `default`, so only synthesize it for CJS.
  if (!('default' in mod)) {
    if (t === 'function') {
      (mod as { default?: unknown }).default = mod;
      return mod;
    }
    return { ...mod, default: mod };
  }
  const def = mod.default;
  if (def && typeof def === 'object') {
    return { ...(def as Record<string, unknown>), ...mod };
  }
  return mod;
}

export function normalizeModuleUrl(url: string): string {
  const { pathname, search } = parseUrlParts(url);
  return pathname + search;
}

export function resolveModuleUrl(specifier: string, fromUrl: string, serverUrl: string): string {
  if (specifier.startsWith('http://') || specifier.startsWith('https://')) {
    return specifier;
  }
  if (specifier.startsWith('/@fs/') || specifier.startsWith('/@id/') || specifier.startsWith('/src/')) {
    return `${serverUrl}/rayact/m${specifier}`;
  }
  if (specifier.startsWith('/')) {
    return `${serverUrl}/rayact/m${specifier}`;
  }
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    const from = fromUrl || '/';
    return `${serverUrl}/rayact/resolve?spec=${encodeURIComponent(specifier)}&from=${encodeURIComponent(from)}`;
  }
  const from = fromUrl || '/';
  return `${serverUrl}/rayact/resolve?spec=${encodeURIComponent(specifier)}&from=${encodeURIComponent(from)}`;
}

export function toRayactModuleUrl(moduleUrl: string, serverUrl: string): string {
  const absolute = moduleUrl.startsWith('http') ? moduleUrl : `${serverUrl}${moduleUrl.startsWith('/') ? '' : '/'}${moduleUrl}`;
  const parsed = parseUrlParts(absolute);
  if (parsed.pathname === '/rayact/entry.js' || parsed.pathname === '/rayact/resolve') {
    return absolute;
  }
  if (parsed.pathname.startsWith('/rayact/m/')) {
    return absolute;
  }
  const path = `/rayact/m${parsed.pathname}${parsed.search}`;
  return `${serverUrl.replace(/\/+$/, '')}${path}`;
}
