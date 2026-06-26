import type { RayactAsset, RayactAssetMetadata, RayactGlobal } from './types';

function getGlobal(): RayactGlobal {
  return globalThis as RayactGlobal;
}

function encodePathPart(value: string): string {
  return encodeURIComponent(value).replace(/%2F/g, '/');
}

function metadata(asset: RayactAsset): RayactAssetMetadata {
  return {
    id: asset.id,
    name: asset.name,
    type: asset.type,
    hash: asset.hash,
    size: asset.size,
    outputName: asset.outputName,
    kind: asset.kind
  };
}

export function resolveAssetUrl(asset: RayactAssetMetadata, globalObject: RayactGlobal = getGlobal()): string {
  if (typeof globalObject.resolveAssetUrl === 'function') {
    return globalObject.resolveAssetUrl(asset);
  }
  const devServer = globalObject.__RAYACT_DEV_SERVER__;
  if (typeof devServer === 'string' && devServer.length > 0) {
    return `${devServer.replace(/\/+$/, '')}/rayact/assets/${encodeURIComponent(asset.id)}/${encodePathPart(asset.name)}`;
  }
  const base = typeof globalObject.__RAYACT_RELEASE_ASSET_BASE__ === 'string'
    ? globalObject.__RAYACT_RELEASE_ASSET_BASE__.replace(/\/+$/, '')
    : 'assets';
  return `${base}/${asset.outputName ?? asset.name}`;
}

export async function readAssetBytes(asset: RayactAssetMetadata, globalObject: RayactGlobal = getGlobal()): Promise<Uint8Array> {
  if (typeof globalObject.readAssetBytes === 'function') {
    const value = globalObject.readAssetBytes(asset);
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    return new Uint8Array(value);
  }
  const fetchFn = globalObject.fetch;
  if (typeof fetchFn !== 'function') {
    throw new Error(`Cannot read Rayact asset ${asset.name}: fetch() is unavailable`);
  }
  const response = await fetchFn(resolveAssetUrl(asset, globalObject));
  const anyResponse = response as unknown as { arrayBuffer?: () => Promise<ArrayBuffer>; text(): Promise<string> };
  if (typeof anyResponse.arrayBuffer === 'function') {
    return new Uint8Array(await anyResponse.arrayBuffer());
  }
  const text = await anyResponse.text();
  return new TextEncoder().encode(text);
}

export function createAsset(raw: RayactAssetMetadata): RayactAsset {
  const globalObject = getGlobal();
  globalObject.__RAYACT_ASSETS__ ??= {};
  globalObject.__RAYACT_ASSETS__[raw.id] = raw;
  installAssetAwareSpawnWorker(globalObject);

  const asset: RayactAsset = {
    ...raw,
    url() {
      return resolveAssetUrl(raw, globalObject);
    },
    bytes() {
      return readAssetBytes(raw, globalObject);
    }
  };
  return asset;
}

export function isRayactAsset(value: unknown): value is RayactAsset {
  return Boolean(
    value &&
    typeof value === 'object' &&
    typeof (value as RayactAsset).id === 'string' &&
    typeof (value as RayactAsset).url === 'function' &&
    typeof (value as RayactAsset).bytes === 'function'
  );
}

export function resolveWorkerSpecifier(value: unknown, globalObject: RayactGlobal = getGlobal()): unknown {
  if (isRayactAsset(value)) {
    const assetMeta = metadata(value);
    if (typeof globalObject.resolveAssetPath === 'function') {
      return globalObject.resolveAssetPath(assetMeta);
    }
    return value.url();
  }

  if (value && typeof value === 'object') {
    const descriptor = value as Record<string, unknown>;
    if (isRayactAsset(descriptor.path)) {
      const assetMeta = metadata(descriptor.path);
      return {
        ...descriptor,
        path: typeof globalObject.resolveAssetPath === 'function'
          ? globalObject.resolveAssetPath(assetMeta)
          : descriptor.path.url()
      };
    }
  }

  return value;
}

export function installAssetAwareSpawnWorker(globalObject: RayactGlobal = getGlobal()): void {
  if (globalObject.__rayactRawSpawnWorker || typeof globalObject.spawnWorker !== 'function') return;
  const rawSpawnWorker = globalObject.spawnWorker.bind(globalObject);
  globalObject.__rayactRawSpawnWorker = rawSpawnWorker;
  globalObject.spawnWorker = (worker, initialData) => {
    return rawSpawnWorker(resolveWorkerSpecifier(worker, globalObject) as string | RayactAsset | Record<string, unknown>, initialData);
  };
}
