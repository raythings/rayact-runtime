/// <reference types="node" />

/**
 * QuickJS Runtime management
 */

export interface QuickJSRuntimeOptions {
  /**
   * Heap size in bytes (default: 16MB)
   */
  heapSize?: number;

  /**
   * Stack size in bytes (default: 8MB)
   */
  stackSize?: number;

  /**
   * Enable source map support
   */
  sourceMap?: boolean;

  /**
   * Custom module loader
   */
  moduleLoader?: ModuleLoader;

  /**
   * Custom function resolver
   */
  resolver?: FunctionResolver;

  /**
   * Debug mode
   */
  debug?: boolean;
}

export interface ModuleLoader {
  loadModule(url: string): Promise<string | null>;
  resolveModule(url: string, parentUrl: string): Promise<string | null>;
}

export interface FunctionResolver {
  resolve(name: string): Function | undefined;
}

export interface JSModule {
  url: string;
  source: string;
  exports: any;
}

export interface JSContext {
  readonly runtime: QuickJSRuntime;
  readonly global: any;
  registerFunction(name: string, fn: Function): void;
  registerModule(name: string, module: JSModule): void;
  execute(source: string, url?: string): any;
  call(funcName: string, thisArg: any, ...args: any[]): any;
}

export interface QuickJSRuntime {
  createContext(): JSContext;
  createModule(url: string, source: string): JSModule;
  loadModule(module: JSModule): any;
  unloadModule(module: JSModule): void;
  getRuntimeInfo(): RuntimeInfo;
  destroy(): void;
}

export interface RuntimeInfo {
  version: string;
  features: string[];
}

export interface ModuleExport {
  default?: any;
  [key: string]: any;
}

export type JSValue = number | string | boolean | null | object;

/**
 * QuickJS Module type for runtime construction
 */
export class JSModuleType {
  constructor(
    public readonly url: string,
    public readonly source: string,
    public readonly exports: ModuleExport = {}
  ) {}
}

/**
 * QuickJS Context wrapper for JavaScript interop
 */
export class JSContextImpl implements JSContext {
  constructor(
    public readonly runtime: QuickJSRuntimeImpl,
    public readonly global: any
  ) {}

  registerFunction(name: string, fn: Function): void {
    const module = new JSModuleType('__native__', '', {});
    module.exports[name] = fn;
    this.runtime.loadModule(module);
  }

  registerModule(name: string, module: JSModule): void {
    const jsModule = new JSModuleType(name, module.source, module.exports);
    this.runtime.loadModule(jsModule);
  }

  execute(source: string, url?: string): any {
    const module = new JSModuleType(url || '<inline>', source);
    return this.runtime.loadModule(module);
  }

  call(_funcName: string, _thisArg: any, ..._args: any[]): any {
    // Implementation will be filled in with native bridge
    return null;
  }
}

/**
 * QuickJS Runtime implementation
 */
export class QuickJSRuntimeImpl implements QuickJSRuntime {
  private contexts: JSContextImpl[] = [];
  private modules: Map<string, JSModuleType> = new Map();
  private featureFlags: Set<string> = new Set();

  constructor(private options: QuickJSRuntimeOptions = {}) {
    this.setupDefaults();
  }

  private setupDefaults(): void {
    // Set default heap size to 16MB
    this.options.heapSize = this.options.heapSize || 16 * 1024 * 1024;

    // Set default stack size to 8MB
    this.options.stackSize = this.options.stackSize || 8 * 1024 * 1024;

    // Enable source map support
    this.options.sourceMap = this.options.sourceMap ?? true;

    // Set default debug mode
    this.options.debug = this.options.debug ?? false;
  }

  createContext(): JSContextImpl {
    const context = new JSContextImpl(this, null);
    this.contexts.push(context);
    return context;
  }

  createModule(url: string, source: string): JSModuleType {
    const module = new JSModuleType(url, source);
    this.modules.set(url, module);
    return module;
  }

  loadModule(module: JSModuleType): any {
    // Get or create the context
    if (this.contexts.length === 0) {
      this.createContext();
    }

    // For now, just return the module exports
    // Native implementation will add actual JS evaluation
    return module.exports;
  }

  unloadModule(module: JSModuleType): void {
    this.modules.delete(module.url);
  }

  getRuntimeInfo(): RuntimeInfo {
    return {
      version: '0.15.0', // QuickJS version
      features: Array.from(this.featureFlags)
    };
  }

  destroy(): void {
    this.contexts = [];
    this.modules.clear();
    this.featureFlags.clear();
  }

  // Feature flags
  enableFeature(feature: string): void {
    this.featureFlags.add(feature);
  }

  disableFeature(feature: string): void {
    this.featureFlags.delete(feature);
  }

  isFeatureEnabled(feature: string): boolean {
    return this.featureFlags.has(feature);
  }
}

/**
 * Initialize a QuickJS runtime
 */
export function createRuntime(options?: QuickJSRuntimeOptions): QuickJSRuntime {
  return new QuickJSRuntimeImpl(options);
}

/**
 * Create a JS context from runtime
 */
export function createContext(runtime: QuickJSRuntime): JSContext {
  return runtime.createContext();
}

/**
 * Execute JavaScript code
 */
export function executeScript(
  runtime: QuickJSRuntime,
  source: string,
  url?: string
): any {
  const context = runtime.createContext();
  return context.execute(source, url);
}

/**
 * Register a native function
 */
export function registerNativeFunction(
  context: JSContext,
  name: string,
  fn: Function
): void {
  context.registerFunction(name, fn);
}

/**
 * Register a native module
 */
export function registerNativeModule(
  context: JSContext,
  name: string,
  module: JSModule
): void {
  context.registerModule(name, module);
}

/**
 * Call a registered function
 */
export function callFunction(
  context: JSContext,
  funcName: string,
  thisArg: any,
  ...args: any[]
): any {
  return context.call(funcName, thisArg, ...args);
}
