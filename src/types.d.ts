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
  dataKey: string;
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
  type UserOpts = VMScriptGMDownloadOptions | VMScriptGMXHRDetails;
  interface BG {
    anonymous: boolean;
    blobbed: boolean;
    cb: (data: GMReq.Message.BG | GMReq.Message.Chunk) => Promise<void>;
    chunked: boolean;
    coreId: number;
    eventsToNotify: string[];
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
    realm: VMScriptInjectInto;
    wantsBlob: boolean;
    eventsToNotify: EventType[];
    fileName: string;
    arr?: Uint8Array;
    resolve?: (data: any) => void;
    dataSize?: number;
    contentType?: string;
    gotChunks?: boolean;
  }
  interface Web {
    id: string;
    scriptId: number;
    opts: UserOpts;
    raw: string | Blob | ArrayBuffer;
    response: string | Blob | ArrayBuffer;
    headers: string;
    text?: string;
  }
  namespace Message {
    type Chunk = {
      pos: number;
      data: string;
      last: boolean;
    }
    /** From background */
    interface BG {
      blobbed: boolean;
      chunked: boolean;
      contentType: string;
      data: VMScriptResponseObject;
      dataSize: number;
      id: string;
      numChunks?: number;
      type: EventType;
      chunk?: Chunk;
    }
    /** From web/content bridge */
    interface Web {
      id: string;
      scriptId: number;
      anonymous: boolean;
      fileName: string;
      data: any[];
      eventsToNotify: EventType[];
      headers?: StringMap;
      method?: string;
      overrideMimeType?: string;
      password?: string;
      timeout?: number;
      url: string;
      user?: string;
      xhrType: XMLHttpRequestResponseType;
    }
  }
}
declare type VMBridgePostFunc = (
  cmd: string,
  data: PlainJSONValue,
  context?: { dataKey: string },
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
    /** Added in memory at extension start */
    sizes?: number[];
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
  scripts: VMInjection.Script[];
  injectInto: VMScriptInjectInto;
  injectPage: boolean;
  cache: StringMap;
  errors: string[];
  /** cache key for envDelayed, which also tells content bridge to expect envDelayed */
  more: string;
  /** content bridge adds the actually running ids and sends via SetPopup */
  ids: number[];
  info: VMInjection.Info;
}
/**
 * Injection paraphernalia in the background script
 */
declare namespace VMInjection {
  interface Env {
    cache: StringMap;
    cacheKeys: string[];
    code: StringMap;
    /** Dependencies by key to script ids */
    depsMap: { [url: string]: number[] };
    /** Only present in envStart */
    disabledIds?: number[];
    /** Only present in envStart */
    envDelayed?: Env;
    ids: number[];
    promise: Promise<Env>;
    reqKeys: string[];
    require: StringMap;
    scripts: VMScript[];
    sizing?: boolean;
    value: { [scriptId: string]: StringMap };
    valueIds: number[];
  }
  /**
   * Contains the injected data and non-injected auxiliaries
   */
  interface Bag {
    inject: VMInjection;
    feedback: (string|number)[] | false;
    csar: Promise<browser.contentScripts.RegisteredContentScript>;
  }
  interface Info {
    ua: VMScriptGMInfoPlatform;
  }
  /**
   * Script prepared for injection
   */
  interface Script extends VMScript {
    dataKey: string;
    displayName: string;
    code: string;
    injectInto: VMScriptInjectInto;
    metaStr: string;
    runAt?: 'start' | 'body' | 'end' | 'idle';
    values?: StringMap;
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
  wrapAround?: chrome.tabs.Tab;
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
