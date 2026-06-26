import type { HostBridge, HostEventName, HostNode, HostNodeType, RayactGlobal } from './types';
import { isRayactAsset, resolveAssetUrl } from './assets';

function isSharedValue(value: unknown): value is { value: number; bindToNode: Function } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'bindToNode' in value &&
    typeof (value as any).bindToNode === 'function'
  );
}

const SLAB_SIZE = 8;
const OFFSETS = {
  translateX: 0,
  translateY: 1,
  scale: 2,
  opacity: 3,
  rotation: 4,
  dirty: 5,
};

let sharedFloatArray: Float32Array | null = null;

function writeSharedStyle(nodeId: number, property: string, value: number) {
  const propOffset = OFFSETS[property as keyof typeof OFFSETS];
  if (propOffset !== undefined) {
    const globalObj = globalThis as any;
    const buffer = globalObj.__rayactAnimatedStyleBuffer ?? globalObj.__rayactSharedStyleBuffer;
    if (buffer && !sharedFloatArray) {
      sharedFloatArray = new Float32Array(buffer);
    }
    if (sharedFloatArray) {
      const index = nodeId * SLAB_SIZE + propOffset;
      const dirtyIndex = nodeId * SLAB_SIZE + OFFSETS.dirty;
      sharedFloatArray[index] = value;
      sharedFloatArray[dirtyIndex] = 1.0;
    }
    if (typeof globalObj.__rayactSetAnimatedStyle === 'function') {
      globalObj.__rayactSetAnimatedStyle(nodeId, { [property]: value });
    }
  }
}

function animatedStyleSnapshot(style: Record<string, unknown>): Record<string, number> {
  const animated: Record<string, number> = {};
  for (const key of Object.keys(OFFSETS)) {
    if (key === 'dirty') continue;
    const value = style[key];
    if (typeof value === 'number') animated[key] = value;
  }
  return animated;
}

function registerAnimatedHostNode(node: HostNode, style: Record<string, unknown>): HostNode {
  const globalObj = globalThis as RayactGlobal;
  const animated = animatedStyleSnapshot(style);
  if (Object.keys(animated).length > 0 && typeof globalObj.__rayactRegisterAnimatedNode === 'function') {
    globalObj.__rayactRegisterAnimatedNode(node.id, animated);
  }
  return node;
}

function flattenStyleValue(style: unknown, isCreate: boolean, nodeId?: number): Record<string, unknown> {
  if (Array.isArray(style)) {
    return Object.assign({}, ...style.map(s => flattenStyleValue(s, isCreate, nodeId)));
  }
  if (!style || typeof style !== 'object') return {};

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(style as Record<string, unknown>)) {
    if (value == null) continue;
    if (isSharedValue(value)) {
      if (isCreate) {
        result[key] = value.value;
      }
    } else if (OFFSETS[key as keyof typeof OFFSETS] !== undefined) {
      if (isCreate) {
        result[key] = value;
      } else if (nodeId !== undefined && typeof value === 'number') {
        writeSharedStyle(nodeId, key, value);
      }
    } else {
      result[key] = value;
    }
  }
  return result;
}

// React-Native exposes transforms as an ordered array of single-key objects,
// e.g. [{ translateX: 10 }, { scale: 0.9 }, { rotate: '90deg' }]. The native
// bridge only reads FLAT style keys (translateX/translateY/scale/rotation), so
// fold the array into those keys here. Without this, slide/scale animations
// produce no visible movement (only opacity-based transitions work).
function parseAngle(value: unknown): number | undefined {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const n = parseFloat(value);
    if (Number.isNaN(n)) return undefined;
    return value.trim().endsWith('rad') ? (n * 180) / Math.PI : n;
  }
  return undefined;
}

function flattenTransform(style: Record<string, unknown>, isCreate: boolean, nodeId?: number): void {
  const t = style.transform;
  if (!Array.isArray(t)) return;
  for (const entry of t) {
    if (!entry || typeof entry !== 'object') continue;
    for (const [key, raw] of Object.entries(entry as Record<string, unknown>)) {
      switch (key) {
        case 'translateX':
        case 'translateY':
        case 'scale': {
          if (isSharedValue(raw)) {
            if (isCreate) {
              style[key] = raw.value;
            }
          } else if (typeof raw === 'number') {
            if (isCreate) {
              style[key] = raw;
            } else if (nodeId !== undefined) {
              writeSharedStyle(nodeId, key, raw);
            }
          }
          break;
        }
        case 'rotate':
        case 'rotation': {
          const keyName = 'rotation';
          if (isSharedValue(raw)) {
            if (isCreate) {
              const deg = parseAngle(raw.value);
              if (deg !== undefined) style[keyName] = deg;
            }
          } else {
            const deg = parseAngle(raw);
            if (deg !== undefined) {
              if (isCreate) {
                style[keyName] = deg;
              } else if (nodeId !== undefined) {
                writeSharedStyle(nodeId, keyName, deg);
              }
            }
          }
          break;
        }
        // Other transform ops (scaleX/scaleY/skew/…) are not yet supported
        // by the native bridge; ignore rather than forward an unknown key.
      }
    }
  }
  delete style.transform;
}

function toStyleProps(props: Record<string, unknown> = {}, isCreate: boolean, nodeId?: number): Record<string, unknown> {
  // Style numbers are dp-space values. The native raym3 host converts them to
  // physical pixels only at render/input/raster boundaries.
  const style = flattenStyleValue(props.style, isCreate, nodeId);
  flattenTransform(style, isCreate, nodeId);

  if (typeof props.className === 'string') {
    style.className = props.className;
  }

  return style;
}

function requireFunction<T extends Function>(value: T | undefined, name: string): T {
  if (typeof value !== 'function') {
    throw new Error(`Rayact native bridge is missing global ${name}()`);
  }
  return value;
}

function asHostNode(id: number | null, type: HostNodeType): HostNode {
  if (typeof id !== 'number') {
    throw new Error(`Failed to create native ${type} node`);
  }
  return { id, type };
}

function resolveImageSource(value: unknown, native: RayactGlobal): string {
  if (isRayactAsset(value)) {
    return typeof native.resolveAssetPath === 'function'
      ? native.resolveAssetPath(value)
      : resolveAssetUrl(value, native);
  }
  return String(value ?? '');
}

const materialHostTypes = new Set<HostNodeType>([
  'appBar',
  'badge',
  'banner',
  'bottomAppBar',
  'bottomSheet',
  'dataTable',
  'dockedToolbar',
  'floatingToolbar',
  'buttonGroup',
  'card',
  'carousel',
  'checkbox',
  'chip',
  'datePicker',
  'dialog',
  'divider',
  'extendedFab',
  'fab',
  'fabMenu',
  'iconButton',
  'list',
  'loadingIndicator',
  'menu',
  'menuItem',
  'navigationBar',
  'navigationBarItem',
  'navigationDrawer',
  'navigationRail',
  'progressIndicator',
  'radioButton',
  'rangeSlider',
  'search',
  'searchBar',
  'segmentedButton',
  'sideSheet',
  'slider',
  'snackbar',
  'splitButton',
  'switch',
  'tabs',
  'textField',
  'timePicker',
  'toolbar',
  'tooltip',
  'popover'
]);

function materialProps(type: HostNodeType, props: Record<string, unknown>, style: Record<string, unknown>): Record<string, unknown> {
  const childLabel = typeof props.children === 'string' || typeof props.children === 'number'
    ? props.children
    : undefined;
  return {
    ...style,
    ...props,
    component: type,
    label: props.label ?? props.text ?? props.title ?? childLabel
  };
}

export function createBridge(globalObject: RayactGlobal = globalThis as RayactGlobal): HostBridge {
  const native = globalObject;

  const bridge: HostBridge = {
    createNode(type, props = {}) {
      const style = toStyleProps(props, true);

      switch (type) {
        case 'root':
        case 'view': {
          // appBarTitle marks the AppBar title slot so the native renderer can
          // recenter it (centerTitle). It is not a style key, so forward it
          // alongside style on the create payload.
          const viewArg = props.appBarTitle ? { ...style, appBarTitle: true } : style;
          return registerAnimatedHostNode(asHostNode(requireFunction(native.createView, 'createView')(viewArg), type), style);
        }
        case 'text': {
          const text = String(props.text ?? props.children ?? '');
          return registerAnimatedHostNode(asHostNode(requireFunction(native.createText, 'createText')(text, style), type), style);
        }
        case 'button': {
          const label = String(props.label ?? props.text ?? props.children ?? '');
          return registerAnimatedHostNode(asHostNode(requireFunction(native.createButton, 'createButton')(label, style), type), style);
        }
        case 'image':
          return registerAnimatedHostNode(asHostNode(requireFunction(native.createImage, 'createImage')(resolveImageSource(props.source ?? props.src, native), style), type), style);
        case 'icon':
          return registerAnimatedHostNode(asHostNode(
            requireFunction(native.createIcon, 'createIcon')(
              String(props.name ?? props.icon ?? ''),
              typeof props.size === 'number' ? props.size : undefined,
              typeof props.color === 'number' || typeof props.color === 'string' ? props.color : undefined,
              style,
              typeof props.variant === 'string' ? props.variant : undefined,
              typeof props.filled === 'boolean' ? props.filled : undefined
            ),
            type
          ), style);
        case 'textInput':
          return registerAnimatedHostNode(asHostNode(
            requireFunction(native.createTextInput, 'createTextInput')(
              String(props.value ?? props.defaultValue ?? ''),
              { ...style, ...props }
            ),
            type
          ), style);
        case 'scrollView':
          return registerAnimatedHostNode(asHostNode(requireFunction(native.createScrollView, 'createScrollView')({ ...style, ...props }), type), style);
        case 'externalView':
          return registerAnimatedHostNode(asHostNode(
            requireFunction(native.createExternalView, 'createExternalView')(
              String(props.kind ?? 'stub'), { ...style, ...props }
            ), type), style);
        case 'modal':
          return registerAnimatedHostNode(asHostNode(requireFunction(native.createModal, 'createModal')({ ...style, ...props }), type), style);
        case 'safeArea':
          return registerAnimatedHostNode(asHostNode(
            (native.createSafeArea ?? native.createView ?? requireFunction(native.createView, 'createView'))({ ...style, ...props }),
            type
          ), style);
        case 'statusBar':
          return registerAnimatedHostNode(asHostNode(
            (native.createStatusBar ?? native.createView ?? requireFunction(native.createView, 'createView'))({ ...style, ...props }),
            type
          ), style);
        case 'activityIndicator':
          return registerAnimatedHostNode(asHostNode(requireFunction(native.createActivityIndicator, 'createActivityIndicator')({ ...style, ...props }), type), style);
        default:
          if (materialHostTypes.has(type)) {
            return registerAnimatedHostNode(asHostNode(
              requireFunction(native.createMaterialComponent, 'createMaterialComponent')(type, materialProps(type, props, style)),
              type
            ), style);
          }
          throw new Error(`Unsupported Rayact host node type: ${type}`);
      }
    },

    updateNode(node, props) {
      const style = toStyleProps(props, false, node.id);
      if (materialHostTypes.has(node.type) && typeof native.setMaterialComponentProps === 'function') {
        native.setMaterialComponentProps(node.id, materialProps(node.type, props, style));
      }

      if (Object.keys(style).length > 0) {
        requireFunction(native.setStyle, 'setStyle')(node.id, style);
      }

      if (node.type === 'externalView' && typeof native.setExternalViewProps === 'function') {
        native.setExternalViewProps(node.id, { ...props });
      }

      if (node.type === 'icon' && typeof native.setIconProps === 'function') {
        native.setIconProps(
          node.id,
          typeof props.size === 'number' ? props.size : undefined,
          typeof props.color === 'number' || typeof props.color === 'string' ? props.color : undefined,
          typeof props.variant === 'string' ? props.variant : undefined,
          typeof props.name === 'string' ? props.name : typeof props.icon === 'string' ? props.icon : undefined,
          typeof props.filled === 'boolean' ? props.filled : undefined
        );
      }

      if (node.type === 'text' && ('text' in props || 'children' in props)) {
        requireFunction(native.setText, 'setText')(node.id, String(props.text ?? props.children ?? ''));
      }

      if (
        node.type === 'button' &&
        ('label' in props || 'text' in props || 'title' in props ||
          typeof props.children === 'string' || typeof props.children === 'number')
      ) {
        requireFunction(native.setText, 'setText')(node.id, String(props.label ?? props.text ?? props.title ?? props.children ?? ''));
      }

      if (node.type === 'textInput' && ('value' in props) && typeof native.setValue === 'function') {
        native.setValue(node.id, String(props.value ?? ''));
      }
    },

    appendChild(parent, child) {
      requireFunction(native.appendChild, 'appendChild')(parent.id, child.id);
    },

    removeChild(parent, child) {
      requireFunction(native.removeChild, 'removeChild')(parent.id, child.id);
    },

    insertBefore(parent, child, beforeChild) {
      requireFunction(native.insertBefore, 'insertBefore')(parent.id, child.id, beforeChild.id);
    },

    setRoot(node) {
      if (node) {
        requireFunction(native.setRootNode, 'setRootNode')(node.id);
      } else if (typeof native.clearRootNode === 'function') {
        native.clearRootNode();
      } else {
        requireFunction(native.setRootNode, 'setRootNode')(null);
      }
    },

    setEventHandler(node, eventName: HostEventName, handler) {
      if (eventName === 'press' || eventName === 'click') {
        requireFunction(native.setOnPress, 'setOnPress')(node.id, (handler ?? null) as (() => void) | null);
      } else if (eventName === 'changeText' && typeof native.setOnChangeText === 'function') {
        native.setOnChangeText(node.id, handler as ((value: string) => void) | null);
      } else if (eventName === 'changeValue' && typeof native.setOnChangeValue === 'function') {
        native.setOnChangeValue(node.id, handler as ((value: number) => void) | null);
      } else if (eventName === 'scroll' && typeof native.setOnScroll === 'function') {
        native.setOnScroll(node.id, handler as ((event: unknown) => void) | null);
      } else if (eventName === 'requestClose' && typeof native.setOnRequestClose === 'function') {
        native.setOnRequestClose(node.id, (handler ?? null) as (() => void) | null);
      } else if (eventName === 'focus' && typeof native.setOnFocus === 'function') {
        native.setOnFocus(node.id, (handler ?? null) as (() => void) | null);
      } else if (eventName === 'blur' && typeof native.setOnBlur === 'function') {
        native.setOnBlur(node.id, (handler ?? null) as (() => void) | null);
      } else if (eventName === 'submitEditing' && typeof native.setOnSubmitEditing === 'function') {
        native.setOnSubmitEditing(node.id, handler as ((e: { nativeEvent: { text: string } }) => void) | null);
      } else if (eventName === 'endEditing' && typeof native.setOnEndEditing === 'function') {
        native.setOnEndEditing(node.id, handler as ((e: { nativeEvent: { text: string } }) => void) | null);
      } else if (eventName === 'selectionChange' && typeof native.setOnSelectionChange === 'function') {
        native.setOnSelectionChange(node.id, handler as ((e: { nativeEvent: { selection: { start: number; end: number } } }) => void) | null);
      } else if (eventName === 'keyPress' || eventName === 'contentSizeChange') {
        // Accepted for RN parity; not yet fired by the host. No-op so the
        // reconciler can register/strip them without error.
      } else if (eventName === 'dragStart' && typeof native.setOnDragStart === 'function') {
        native.setOnDragStart(node.id, handler as ((event: { x: number; y: number }) => void) | null);
      } else if (eventName === 'dragMove' && typeof native.setOnDragMove === 'function') {
        native.setOnDragMove(node.id, handler as ((event: { x: number; y: number }) => void) | null);
      } else if (eventName === 'dragEnd' && typeof native.setOnDragEnd === 'function') {
        native.setOnDragEnd(node.id, handler as ((event: { x: number; y: number }) => void) | null);
      } else if (eventName === 'layout' && typeof native.setOnLayout === 'function') {
        native.setOnLayout(
          node.id,
          handler as ((event: { nativeEvent: { layout: { x: number; y: number; width: number; height: number } } }) => void) | null
        );
      }
    },

    disposeNode(node) {
      if (typeof native.disposeNode === 'function') {
        native.disposeNode(node.id);
      }
    },

    async reload(source) {
      if (!source) return;
      if (typeof native.eval !== 'function') {
        throw new Error('Rayact reload requires global eval()');
      }
      native.eval(source);
    },

    showError(message, stack) {
      const detail = stack ? `${message}\n\n${stack}` : message;
      try {
        const root = bridge.createNode('view', {
          style: {
            backgroundColor: 0x2B1111FF,
            padding: 24,
            gap: 12,
            flexGrow: 1
          }
        });
        const title = bridge.createNode('text', {
          text: 'Rayact runtime error',
          style: { text: { color: 0xFFFFFFFF, fontSize: 24 } }
        });
        const body = bridge.createNode('text', {
          text: detail,
          style: { text: { color: 0xFFB4B4FF, fontSize: 14 } }
        });
        bridge.appendChild(root, title);
        bridge.appendChild(root, body);
        bridge.setRoot(root);
      } catch (overlayError) {
        native.console?.error?.('Failed to show Rayact error overlay', overlayError);
      }
    }
  };

  return bridge;
}
