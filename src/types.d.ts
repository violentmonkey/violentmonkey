/* tslint:disable:no-namespace */
//#region Generic

declare type NumBool = 0 | 1
/** null means "default" or "inherit from global" */
declare type NumBoolNull = 0 | 1 | null
declare type StringMap = { [key: string]: string }
declare type PlainJSONValue = browser.extensionTypes.PlainJSONValue;

//#endregion Generic
//#region GM-specific

/**
 * Script context object used by GM### API
 */
declare interface GMContext {
  async?: boolean;
  id: number;
  resCache: StringMap;
  resources: StringMap;
  script: VMScript;
}

/**
 * GM_xmlhttpRequest paraphernalia
 */
declare namespace GMReq {
  type EventType = keyof XMLHttpRequestEventMap;
  type Response = string | Blob | ArrayBuffer;
  type UserOpts = VMScriptGMDownloadOptions | VMScriptGMXHRDetails;
  interface BG {
    anonymous: boolean;
    cb: (data: GMReq.Message.BGAny) => Promise<void>;
    coreId: number;
    frameId: number;
    id: string;
    noNativeCookie: boolean;
    responseHeaders: string;
    storeId: string;
    tabId: number;
    url: string;
    xhr: XMLHttpRequest;
  }
  interface Content {
    arr?: Uint8Array;
    asBlob: boolean;
    fileName: string;
    realm: VMScriptInjectInto;
    response?: Response;
  }
  interface Web {
    id: string;
    scriptId: number;
    cb: { [name: EventType]: typeof VMScriptGMXHRDetails.onload };
    context?: any;
    raw?: Response;
    response?: Response;
    responseHeaders?: string;
    responseText?: string;
    responseType?: XMLHttpRequestResponseType;
  }
  namespace Message {
    /** From background */
    type BGAny = BG | BGChunk | BGError;
    interface BG {
      blobbed: boolean;
      chunked: boolean;
      contentType: string;
      data: VMScriptResponseObject;
      id: string;
      type: EventType;
    }
    interface BGChunk {
      id: string;
      chunk: number;
      data: string;
      size: number;
    }
    interface BGError {
      id: string;
      type: 'error';
      data: null; // helps avoid the need for hasOwnProperty in HttpRequested
      error: string;
    }
    /** From web/content bridge */
    interface Web {
      id: string;
      scriptId: number;
      anonymous: boolean;
      fileName: string;
      data: any[];
      events: EventType[];
      headers?: StringMap;
      method?: string;
      overrideMimeType?: string;
      password?: string;
      responseType: XMLHttpRequestResponseType;
      timeout?: number;
      url: string;
      user?: string;
      /** responseType to use in the actual XHR */
      xhrType: XMLHttpRequestResponseType;
    }
  }
}

declare type VMBridgeMode = Exclude<VMScriptInjectInto, 'auto'>;

declare type VMBridgeContentIds = {
  /** -1 = bad realm, 0 = disabled, 1 = enabled, 2 = starting, context name = running */
  [id: string]: -1 | 0 | 1 | 2 | VMBridgeMode;
}

declare type VMBridgePostFunc = (
  cmd: string,
  data: any, // all types supported by structuredClone algo
  realm?: VMBridgeMode,
  node?: Node,
) => void;

//#endregion Generic
//#region VM-specific

declare type VMBadgeMode = 'unique' | 'total' | ''

/**
 * Internal script representation
 */
declare interface VMScript {
  config: VMScript.Config;
  custom: VMScript.Custom;
  meta: VMScript.Meta;
  props: VMScript.Props;
  /** Automatically inferred from other props in getData, in-memory only and not in storage */
  inferred?: {
    homepageURL?: string;
    supportURL?: string;
  },
}

declare namespace VMScript {
  type Config = {
    enabled: NumBool;
    removed: NumBool;
    shouldUpdate: NumBool;
    notifyUpdates?: NumBoolNull;
  }
  type Custom = {
    name?: string;
    downloadURL?: string;
    homepageURL?: string;
    lastInstallURL?: string;
    updateURL?: string;
    injectInto?: VMScriptInjectInto;
    noframes?: NumBoolNull;
    exclude?: string[];
    excludeMatch?: string[];
    include?: string[];
    match?: string[];
    origExclude: boolean;
    origExcludeMatch: boolean;
    origInclude: boolean;
    origMatch: boolean;
    pathMap?: StringMap;
    runAt?: VMScriptRunAt;
  }
  type Meta = {
    description?: string;
    downloadURL?: string;
    exclude: string[];
    excludeMatch: string[];
    grant: string[];
    homepageURL?: string;
    icon?: string;
    include: string[];
    injectInto?: VMScriptInjectInto;
    match: string[];
    namespace?: string;
    name: string;
    noframes?: boolean;
    require: string[];
    resources: StringMap;
    runAt?: VMScriptRunAt;
    supportURL?: string;
    unwrap?: boolean;
    version?: string;
  }
  type Props = {
    id: number;
    lastModified: number;
    lastUpdated: number;
    position: number;
    uri: string;
    uuid: string;
  }
}

/**
 * Injection data sent to the content bridge when injection is disabled
 */
declare interface VMInjectionDisabled {
  expose: string | false;
}

/**
 * Injection data sent to the content bridge when injection is enabled
 */
declare interface VMInjection extends VMInjectionDisabled {
  cache: StringMap;
  clipFF?: boolean;
  errors: string[];
  forceContent?: boolean;
  /** content bridge adds the actually running ids and sends via SetPopup */
  ids: number[];
  info: VMInjection.Info;
  injectInto: VMScriptInjectInto;
  /** cache key for envDelayed, which also tells content bridge to expect envDelayed */
  more: string;
  /** `page` mode will be necessary */
  page: boolean;
  scripts: VMInjection.Script[];
  sessionId: string;
}

/**
 * Injection paraphernalia in the background script
 */
declare namespace VMInjection {
  type RunAt = 'start' | 'body' | 'end' | 'idle';
  interface Env {
    cache: StringMap;
    cacheKeys: string[];
    code: StringMap;
    /** Dependencies by key to script ids */
    depsMap: { [url: string]: number[] };
    ids: number[];
    reqKeys: string[];
    require: StringMap;
    runAt: { [id: string]: RunAt };
    scripts: VMScript[];
    value: { [scriptId: string]: StringMap };
    valueIds: number[];
  }
  interface EnvStart extends Env {
    allIds: { [id: string]: NumBool };
    clipFF?: boolean;
    forceContent?: boolean;
    more: EnvDelayed;
    /** `null` = env was processed and contains data now */
    promise: Promise<EnvStart>;
  }
  interface EnvDelayed extends Env {
    /** cache key for Bag */
    more: string;
    /** `null` = env was processed and contains data now */
    promise: Promise<EnvDelayed>;
  }
  /**
   * Contains the injected data and non-injected auxiliaries
   */
  interface Bag {
    csReg?: Promise<browser.contentScripts.RegisteredContentScript>;
    forceContent?: boolean;
    inject: VMInjection;
    more: EnvDelayed;
  }
  interface Info {
    ua: VMScriptGMInfoPlatform;
  }
  /**
   * Script prepared for injection
   */
  interface Script {
    displayName: string;
    /** -1 ID_BAD_REALM if the desired realm is PAGE which is not injectable */
    code: string | -1;
    /** Omitted props are added in makeGmApiWrapper */
    gmi: Omit<VMScriptGMInfoObject, 'injectInto' | 'resources' | 'script' | 'scriptMetaStr'>;
    id: number;
    injectInto: VMScriptInjectInto;
    key: { data: string, win: string };
    /** `resources` is still an object, converted later in makeGmApiWrapper */
    meta: VMScript.Meta | VMScriptGMInfoScriptMeta;
    metaStr: (string|number)[];
    pathMap: StringMap;
    runAt?: RunAt;
    val?: StringMap;
  }
}

declare interface VMRealmData {
  lists: {
    start: VMScript[];
    body: VMScript[];
    end: VMScript[];
    idle: VMScript[];
  }
  is: boolean;
  info: VMInjection.Info;
}

/**
 * Internal request()
 */
declare namespace VMReq {
  interface Options extends RequestInit {
    /** @implements XMLHttpRequestResponseType */
    responseType: '' | 'arraybuffer' | 'blob' | 'json' | 'text';
  }
  interface Response {
    url: string;
    status: number;
    headers: Headers;
    data: string | ArrayBuffer | Blob | PlainJSONValue;
  }
}

declare type VMSearchOptions = {
  reversed?: boolean;
  wrapAround?: boolean;
  reuseCursor?: boolean;
  pos?: { line: number, ch: number };
}

/** Throws on error */
declare type VMStorageFetch = (
  url: string,
  options?: VMReq.Options,
  check?: (...args) => void // throws on error
) => Promise<void>

declare interface VMUserAgent extends VMScriptGMInfoPlatform {
  /** Chrome/ium version number */
  chrome: number | typeof NaN;
  /** derived from UA string initially, a real number when `ready` */
  firefox: number | typeof NaN;
  /** resolves when `browser` API returns real versions */
  ready: Promise<void>;
}

//#endregion Generic
