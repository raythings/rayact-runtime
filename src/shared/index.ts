/**
 * Shared types and utilities for Rayact.
 *
 * Material icon name → codepoint map: import '@rayact/shared/material-icons'
 * (sets `globalThis.Icons` as a side effect).
 */

/**
 * Common color format definitions
 */
export type ColorFormat = 'hex' | 'rgb' | 'rgba' | 'hsl' | 'hsla';

export interface Color {
  r: number;
  g: number;
  b: number;
  a?: number;
  hex?: string;
}

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export interface RGBA extends RGB {
  a: number;
}

export interface HSL {
  h: number;
  s: number;
  l: number;
}

export interface HSLA extends HSL {
  a: number;
}

/**
 * Screen dimensions
 */
export interface Size {
  width: number;
  height: number;
}

/**
 * Rectangle with position
 */
export interface Rectangle extends Size {
  x: number;
  y: number;
}

/**
 * Point coordinates
 */
export interface Point {
  x: number;
  y: number;
}

/**
 * Layout properties
 */
export interface LayoutProps {
  padding?: number;
  margin?: number | Padding;
  align?: 'flex-start' | 'flex-end' | 'center' | 'stretch';
  justify?: 'flex-start' | 'flex-end' | 'center' | 'space-between' | 'space-around' | 'space-evenly';
  flex?: number;
  flexDirection?: 'row' | 'column';
  wrap?: boolean;
  gap?: number;
}

export interface Padding {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

/**
 * Pointer event types
 */
export enum PointerEventType {
  DOWN = 'pointerdown',
  UP = 'pointerup',
  MOVE = 'pointermove',
  ENTER = 'pointerenter',
  LEAVE = 'pointerleave',
  OUT = 'pointerout'
}

export interface PointerEvent {
  type: PointerEventType;
  x: number;
  y: number;
  target: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
}

/**
 * Touch event types
 */
export enum TouchEventType {
  START = 'touchstart',
  MOVE = 'touchmove',
  END = 'touchend',
  CANCEL = 'touchcancel'
}

export interface TouchEvent {
  type: TouchEventType;
  touches: TouchPoint[];
  changedTouches: TouchPoint[];
}

export interface TouchPoint {
  identifier: number;
  x: number;
  y: number;
}

/**
 * Keyboard event types
 */
export enum KeyboardEventType {
  DOWN = 'keydown',
  UP = 'keyup',
  PRESS = 'keypress'
}

export interface KeyboardEvent {
  type: KeyboardEventType;
  key: string;
  code: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  repeat?: boolean;
}

/**
 * Window event types
 */
export enum WindowEventType {
  RESIZE = 'resize',
  FOCUS = 'focus',
  BLUR = 'blur',
  CLOSE = 'close',
  MINIMIZE = 'minimize',
  MAXIMIZE = 'maximize',
  FULLSCREEN = 'fullscreenchange'
}

export interface WindowEvent {
  type: WindowEventType;
  width: number;
  height: number;
}

/**
 * Device orientation
 */
export interface DeviceOrientation {
  alpha: number; // Rotation around z-axis (compass direction)
  beta: number;  // Front-to-back tilt (-180 to 180)
  gamma: number; // Left-to-right tilt (-90 to 90)
}

/**
 * Screen size information
 */
export interface ScreenInfo {
  width: number;
  height: number;
  orientation: 'portrait' | 'landscape';
  density: number; // Pixels per inch
  pixelRatio: number;
}

/**
 * Platform detection
 */
export enum Platform {
  WINDOWS = 'windows',
  LINUX = 'linux',
  MACOS = 'macos',
  IOS = 'ios',
  ANDROID = 'android',
  WEB = 'web'
}

export interface PlatformInfo {
  platform: Platform;
  osVersion: string;
  deviceModel: string;
  isTouchDevice: boolean;
  supportsPointerEvents: boolean;
}

/**
 * Utility functions for color conversions
 */

export function hexToRgb(hex: string): RGB {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : { r: 0, g: 0, b: 0 };
}

export function rgbToHex(rgb: RGB): string {
  return '#' + [rgb.r, rgb.g, rgb.b].map(x => {
    const hex = Math.round(x).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  }).join('');
}

export function rgbToRgba(rgb: RGB, a: number = 1): RGBA {
  return { ...rgb, a };
}

export function hexToRgba(hex: string, a: number = 1): RGBA {
  const rgb = hexToRgb(hex);
  return rgbToRgba(rgb, a);
}

/**
 * Utility functions for layout
 */

export function createPadding(padding: number | Padding = 0): Padding {
  if (typeof padding === 'number') {
    return {
      top: padding,
      right: padding,
      bottom: padding,
      left: padding
    };
  }
  return {
    top: padding.top ?? 0,
    right: padding.right ?? padding.top ?? 0,
    bottom: padding.bottom ?? padding.top ?? 0,
    left: padding.left ?? padding.top ?? 0
  };
}

export function getPaddingSum(padding: Padding): number {
  return (padding.top ?? 0) + (padding.right ?? 0) + (padding.bottom ?? 0) + (padding.left ?? 0);
}

/**
 * Utility functions for screen calculations
 */

export function calculateAspectRatio(rect: Rectangle): number {
  if (rect.height === 0) return 0;
  return rect.width / rect.height;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function normalizeValue(value: number, min: number, max: number): number {
  return (value - min) / (max - min);
}

/**
 * Utility functions for event handling
 */

export function extractPointerEventTarget(event: PointerEvent): string {
  return event.target;
}

export function extractTouchPointCount(event: TouchEvent): number {
  return event.touches.length;
}

export function getPointerPosition(event: PointerEvent): Point {
  return { x: event.x, y: event.y };
}

export function getTouchPoint(event: TouchEvent, identifier: number): TouchPoint | undefined {
  return event.touches.find(t => t.identifier === identifier);
}

/**
 * Platform detection utility
 */

export function detectPlatform(): Platform {
  // Native hosts (desktop/android) inject the authoritative platform via
  // globalThis.__rayactPlatform at context init — prefer it over userAgent.
  const injected = (globalThis as any).__rayactPlatform;
  if (injected && typeof injected.os === 'string') {
    switch (injected.os.toLowerCase()) {
      case 'android': return Platform.ANDROID;
      case 'ios': return Platform.IOS;
      case 'macos': return Platform.MACOS;
      case 'windows': return Platform.WINDOWS;
      case 'linux': return Platform.LINUX;
      case 'web': return Platform.WEB;
    }
  }
  if (typeof window !== 'undefined') {
    if (/Android/i.test(navigator.userAgent)) return Platform.ANDROID;
    if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) return Platform.IOS;
    if (/iPad/i.test(navigator.userAgent)) return Platform.IOS;
    if (/Windows/i.test(navigator.userAgent)) return Platform.WINDOWS;
    if (/Macintosh|Mac OS X/i.test(navigator.userAgent)) return Platform.MACOS;
    if (/Linux/i.test(navigator.userAgent)) return Platform.LINUX;
    if (typeof navigator !== 'undefined' && (navigator as any).vendor === 'Google Inc.' && (navigator as any).platform === 'Win32') {
      return Platform.WINDOWS;
    }
  }
  return Platform.WEB;
}

export function isTouchDevice(): boolean {
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

/**
 * React-Native-style Platform module (merged with the Platform enum above via
 * declaration merging, so `Platform.ANDROID` constants and `Platform.OS`
 * coexist). Apps write `Platform.OS === Platform.ANDROID` / `Platform.select`.
 */
export namespace Platform {
  /** The current platform, resolved once at module load (native injects __rayactPlatform before app JS runs). */
  export const OS: Platform = detectPlatform();
  /** OS version string from the native host, when available. */
  export const Version: string =
    ((globalThis as any).__rayactPlatform?.version as string | undefined) ?? '';
  /** Pick a value by platform, RN-style. Falls back to `default`. */
  export function select<T>(specifics: Partial<Record<Platform | 'native' | 'default', T>>): T | undefined {
    if (OS in specifics) return specifics[OS];
    if (OS !== Platform.WEB && 'native' in specifics) return specifics.native;
    return specifics.default;
  }
}
