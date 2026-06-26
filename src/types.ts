export type RayactMutationOp =
  | { op: 'appendChild'; parentId: number; childId: number }
  | { op: 'removeChild'; parentId: number; childId: number }
  | { op: 'insertBefore'; parentId: number; childId: number; beforeChildId: number }
  | { op: 'disposeNode'; nodeId: number }
  | { op: 'setRoot'; nodeId: number }
  | { op: 'setText'; nodeId: number; text: string }
  | { op: 'setValue'; nodeId: number; value: string }
  | { op: 'setStyle'; nodeId: number; style: Record<string, unknown> }
  | { op: 'setMaterialProps'; nodeId: number; component: string; props: Record<string, unknown> };

export type HostNodeType =
  | 'root'
  | 'view'
  | 'text'
  | 'button'
  | 'image'
  | 'icon'
  | 'textInput'
  | 'scrollView'
  | 'modal'
  | 'externalView'
  | 'safeArea'
  | 'statusBar'
  | 'activityIndicator'
  | 'appBar'
  | 'badge'
  | 'banner'
  | 'bottomAppBar'
  | 'bottomSheet'
  | 'dataTable'
  | 'dockedToolbar'
  | 'floatingToolbar'
  | 'buttonGroup'
  | 'card'
  | 'carousel'
  | 'checkbox'
  | 'chip'
  | 'datePicker'
  | 'dialog'
  | 'divider'
  | 'extendedFab'
  | 'fab'
  | 'fabMenu'
  | 'iconButton'
  | 'list'
  | 'loadingIndicator'
  | 'menu'
  | 'menuItem'
  | 'navigationBar'
  | 'navigationBarItem'
  | 'navigationDrawer'
  | 'navigationRail'
  | 'progressIndicator'
  | 'radioButton'
  | 'rangeSlider'
  | 'search'
  | 'searchBar'
  | 'segmentedButton'
  | 'sideSheet'
  | 'slider'
  | 'snackbar'
  | 'splitButton'
  | 'switch'
  | 'tabs'
  | 'textField'
  | 'timePicker'
  | 'toolbar'
  | 'tooltip'
  | 'popover';

export type HostNodeId = number;

export interface HostNode {
  id: HostNodeId;
  type: HostNodeType;
}

export type HostPointerEvent = { x: number; y: number };

export type HostEventName =
  | 'press'
  | 'click'
  | 'changeText'
  | 'changeValue'
  | 'scroll'
  | 'requestClose'
  | 'focus'
  | 'blur'
  | 'submitEditing'
  | 'endEditing'
  | 'selectionChange'
  | 'keyPress'
  | 'contentSizeChange'
  | 'dragStart'
  | 'dragMove'
  | 'dragEnd'
  | 'layout';

export interface RayactAsset {
  id: string;
  name: string;
  type: string;
  hash: string;
  size: number;
  outputName?: string;
  kind?: 'asset' | 'worker';
  url(): string;
  bytes(): Promise<Uint8Array>;
}

export interface RayactAssetMetadata {
  id: string;
  name: string;
  type: string;
  hash: string;
  size: number;
  outputName?: string;
  kind?: 'asset' | 'worker';
}

export interface HostBridge {
  createNode(type: HostNodeType, props?: Record<string, unknown>): HostNode;
  updateNode(node: HostNode, props: Record<string, unknown>): void;
  appendChild(parent: HostNode, child: HostNode): void;
  removeChild(parent: HostNode, child: HostNode): void;
  insertBefore(parent: HostNode, child: HostNode, beforeChild: HostNode): void;
  setRoot(node: HostNode | null): void;
  setEventHandler(
    node: HostNode,
    eventName: HostEventName,
    handler?: (() => void) | ((event: HostPointerEvent) => void) | null
  ): void;
  disposeNode(node: HostNode): void;
  reload(source?: string): Promise<void> | void;
  showError?(message: string, stack?: string): void;
}

export interface RayactRuntime {
  bridge: HostBridge;
  devClient?: RayactDevClient;
  reportError(error: unknown): void;
}

export interface RayactRuntimeOptions {
  bridge?: HostBridge;
  devClient?: RayactDevClient | boolean;
  global?: RayactGlobal;
}

export interface RayactDevClient {
  connect(): void;
  disconnect(): void;
  send(type: string, payload?: unknown): void;
}

export interface RayactGlobal {
  [key: string]: unknown;
  createView?: (props?: Record<string, unknown>) => number;
  createText?: (text: string, props?: Record<string, unknown>) => number;
  createButton?: (label: string, props?: Record<string, unknown>) => number;
  createImage?: (src: string | RayactAsset, props?: Record<string, unknown>) => number | null;
  createIcon?: (name: string, size?: number, color?: number | string, props?: Record<string, unknown>, variant?: string, filled?: boolean) => number;
  setIconProps?: (nodeId: number, size?: number, color?: number | string, variant?: string, name?: string, filled?: boolean) => void;
  createTextInput?: (value: string, props?: Record<string, unknown>) => number;
  createScrollView?: (props?: Record<string, unknown>) => number;
  createModal?: (props?: Record<string, unknown>) => number;
  createExternalView?: (kind: string, props?: Record<string, unknown>) => number;
  setExternalViewProps?: (nodeId: number, props: Record<string, unknown>) => void;
  createSafeArea?: (props?: Record<string, unknown>) => number;
  createStatusBar?: (props?: Record<string, unknown>) => number;
  createActivityIndicator?: (props?: Record<string, unknown>) => number;
  createAvoidKeyboard?: (props?: Record<string, unknown>) => number;
  createMaterialComponent?: (component: string, props?: Record<string, unknown>) => number;
  setMaterialComponentProps?: (nodeId: number, props: Record<string, unknown>) => void;
  appendChild?: (parentId: number, childId: number) => void;
  removeChild?: (parentId: number, childId: number) => void;
  insertBefore?: (parentId: number, childId: number, beforeChildId: number) => void;
  setRootNode?: (nodeId: number | null) => void;
  setStyle?: (nodeId: number, props: Record<string, unknown>) => void;
  __rayactRegisterAnimatedNode?: (nodeId: number, initialStyle?: Record<string, number>) => void;
  __rayactCreateNodeFast?: (type: string, props: Record<string, unknown>) => number;
  __rayactUpdateNodeFast?: (
    nodeId: number,
    type: string,
    oldProps: Record<string, unknown>,
    newProps: Record<string, unknown>
  ) => boolean;
  __rayactBatchMutations?: (ops: RayactMutationOp[]) => void;
  __RAYACT_PERF_LOG?: boolean;
  __rayactStartStyleAnimation?: (
    nodeId: number,
    targetStyle: Record<string, number>,
    config: Record<string, unknown>,
    onComplete?: () => void
  ) => void;
  __rayactStopStyleAnimation?: (nodeId: number, property?: string) => void;
  __rayactSetAnimatedStyle?: (nodeId: number, partialStyle: Record<string, number>) => void;
  setText?: (nodeId: number, text: string) => void;
  setValue?: (nodeId: number, value: string) => void;
  setOnPress?: (nodeId: number, handler?: (() => void) | null) => void;
  setOnChangeText?: (nodeId: number, handler?: ((value: string) => void) | null) => void;
  setOnChangeValue?: (nodeId: number, handler?: ((value: number) => void) | null) => void;
  setOnScroll?: (nodeId: number, handler?: ((event: unknown) => void) | null) => void;
  setOnRequestClose?: (nodeId: number, handler?: (() => void) | null) => void;
  setOnDragStart?: (nodeId: number, handler?: ((event: HostPointerEvent) => void) | null) => void;
  setOnDragMove?: (nodeId: number, handler?: ((event: HostPointerEvent) => void) | null) => void;
  setOnDragEnd?: (nodeId: number, handler?: ((event: HostPointerEvent) => void) | null) => void;
  setOnLayout?: (
    nodeId: number,
    handler?: ((event: { nativeEvent: { layout: { x: number; y: number; width: number; height: number } } }) => void) | null
  ) => void;
  setOnFocus?: (nodeId: number, handler?: (() => void) | null) => void;
  setOnBlur?: (nodeId: number, handler?: (() => void) | null) => void;
  // TextInput (react-native parity). Submit/end-editing carry the final text;
  // selectionChange carries the new caret/selection range.
  setOnSubmitEditing?: (nodeId: number, handler?: ((e: { nativeEvent: { text: string } }) => void) | null) => void;
  setOnEndEditing?: (nodeId: number, handler?: ((e: { nativeEvent: { text: string } }) => void) | null) => void;
  setOnSelectionChange?: (
    nodeId: number,
    handler?: ((e: { nativeEvent: { selection: { start: number; end: number } } }) => void) | null
  ) => void;
  disposeNode?: (nodeId: number) => void;
  clearRootNode?: () => void;
  resolveAssetUrl?: (asset: RayactAssetMetadata) => string;
  resolveAssetPath?: (asset: RayactAssetMetadata) => string;
  readAssetBytes?: (asset: RayactAssetMetadata) => Uint8Array | ArrayBuffer | number[];
  spawnWorker?: (path: string | RayactAsset | Record<string, unknown>, initialData?: unknown) => number;
  fetch?: (url: string) => Promise<{ text(): Promise<string>; arrayBuffer(): Promise<ArrayBuffer> }>;
  loadBytecode?: (bytes: Uint8Array) => Promise<void> | void;
  eval?: (source: string) => unknown;
  WebSocket?: new (url: string) => WebSocketLike;
  console?: Console;
  __RAYACT_DEV_SERVER__?: string;
  __RAYACT_RELEASE_ASSET_BASE__?: string;
  __RAYACT_ASSETS__?: Record<string, RayactAssetMetadata>;
  __rayactRawSpawnWorker?: (path: string | RayactAsset | Record<string, unknown>, initialData?: unknown) => number;
  __rayactPlatform?: { os: string; version?: string };
  __rayactGetColorScheme?: () => Record<string, number | boolean> & { isDark: boolean };
  __rayactSetColorScheme?: (mode: 'dark' | 'light', seed?: number) => void;
  onColorSchemeChange?: (isDark: boolean) => void;
}

export interface WebSocketLike {
  onopen?: (() => void) | null;
  onclose?: (() => void) | null;
  onerror?: ((event: unknown) => void) | null;
  onmessage?: ((event: { data: string }) => void) | null;
  readyState?: number;
  send(data: string): void;
  close(): void;
}

export interface DevServerManifest {
  entry: string;
  platform: string;
  mode: 'development';
  bundleUrl: string;
  websocketUrl: string;
  assets?: Array<RayactAssetMetadata & { url?: string }>;
}
