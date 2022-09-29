declare namespace VM {

  declare type BadgeMode = 'unique' | 'total' | ''
  declare type NumBool = 0 | 1
  /** null means "default" or "inherit from global" */
  declare type NumBoolNull = 0 | 1 | null
  declare type StringMap = Object<string,string>

  declare interface Script {
    config: Script.Config
    custom: Script.Custom
    meta: Script.Meta
    props: Script.Props
  }

  declare namespace Script {
    declare type Config = {
      enabled: NumBool
      removed: NumBool
      shouldUpdate: NumBool
      notifyUpdates?: NumBoolNull
    }
    declare type Custom = {
      name?: string
      downloadURL:? string
      homepageURL?: string
      lastInstallURL?: string
      updateURL?: string
      injectInto?: VMScriptInjectInto
      noframes?: NumBoolNull
      exclude?: string[]
      excludeMatch?: string[]
      include?: string[]
      match?: string[]
      origExclude: boolean
      origExcludeMatch: boolean
      origInclude: boolean
      origMatch: boolean
      pathMap?: StringMap
      runAt?: VMScriptRunAt
    }
    declare type Meta = {
      description?: string
      downloadURL?: string
      exclude: string[]
      excludeMatch: string[]
      grant: string[]
      homepageURL?: string
      icon?: string
      include: string[]
      injectInto?: VMScriptInjectInto
      match: string[]
      namespace?: string
      name: string
      noframes?: boolean
      require: string[]
      resources: StringMap
      runAt?: VMScriptRunAt
      supportURL?: string
      unwrap?: boolean
      version?: string
    }
    declare type Props = {
      id: number
      lastModified: number
      lastUpdated: number
      position: number
      uri: string
      uuid: string
    }
  }

  /**
   * Related to injection itself in the background script
   */
  declare namespace Injection {
    declare interface Env {
      cache: StringMap
      cacheKeys: string[]
      code: StringMap
      depsMap: Object<string,number[]>
      /** Only present in envStart */
      disabledIds?: number[]
      /** Only present in envStart */
      envDelayed?: Env
      ids: number[]
      promise: Promise<Env>
      reqKeys: string[]
      require: StringMap
      scripts: VM.Script[]
      sizing?: boolean
      value: Object<string,StringMap>
      valueIds: number[]
    }
    /**
     * Contains the injected data and non-injected auxiliaries
     */
    declare interface Bag {
      inject: Sent
      feedback: (string|number)[] | false
      csar: Promise<browser.contentScripts.RegisteredContentScript>
    }
    declare interface Info {
      ua: VMScriptGMInfoPlatform
    }
    /**
     * The injected data
     */
    declare interface Sent {
      expose: string | false
      scripts: Script[]
      injectInto: VMScriptInjectInto
      injectPage: boolean
      cache: StringMap
      feedId: {
        /** InjectionFeedback cache key for cleanup when getDataFF outruns GetInjected */
        cacheKey: string
        /** InjectionFeedback cache key for envDelayed */
        envKey: string
      }
      /** tells content bridge to expect envDelayed */
      hasMore: boolean
      /** content bridge adds the actually running ids and sends via SetPopup */
      ids: number[]
      info: Info
      isPopupShown?: boolean
    }
    /**
     * Script prepared for injection
     */
    declare interface Script extends VM.Script {
      dataKey: string
      displayName: string
      code: string
      metaStr: string
      runAt?: 'start' | 'body' | 'end' | 'idle'
      values?: StringMap
    }
  }

  /**
   * Injected::Content and Injected::Web
   */
  declare namespace Injected {
    declare interface RealmData {
      lists: {
        start: Script[]
        body: Script[]
        end: Script[]
        idle: Script[]
      }
      is: boolean
      info: Sent
    }
    /**
     * Script context object used by GM### API
     */
    declare interface Context {
      async?: boolean
      dataKey: string
      id: number
      resCache: StringMap
      resources: StringMap
      script: VM.Script
    }
  }

  /**
   * Own function request()
   */
  declare namespace Req {
    interface Options extends RequestInit {
      /** @implements XMLHttpRequestResponseType */
      responseType: '' | 'arraybuffer' | 'blob' | 'json' | 'text'
    }
    declare interface Response {
      url: string,
      status: number,
      headers: Headers,
      data: string | ArrayBuffer | Blob | Object
    }
  }

  /**
   * GM_xmlhttpRequest paraphernalia
   */
  declare namespace Xhr {
    type EventType = keyof XMLHttpRequestEventMap;
    type UserOpts = VMScriptGMDownloadOptions | VMScriptGMXHRDetails;
    declare interface BG {
      anonymous: boolean
      blobbed: boolean
      cb: function(Object)
      chunked: boolean
      coreId: number
      eventsToNotify: string[]
      frameId: number
      id: string
      noNativeCookie: boolean
      responseHeaders: string
      storeId: string
      tabId: number
      url: string
      xhr: XMLHttpRequest
    }
    declare interface Content {
      realm: VMScriptInjectInto
      wantsBlob: boolean
      eventsToNotify: EventType[]
      fileName: string
      arr?: Uint8Array
      resolve?: function
      dataSize?: number
      contentType?: string
      gotChunks?: boolean
    }
    declare interface Web {
      id: string
      scriptId: number
      opts: UserOpts
      raw: string | Blob | ArrayBuffer
      response: string | Blob | ArrayBuffer
      headers: string
      text?: string
    }
    declare namespace Message {
      type Chunk = {
        pos: number
        data: string
        last: boolean
      }
      declare interface BG {
        blobbed: boolean
        chunked: boolean
        contentType: string
        data: VMScriptResponseObject
        dataSize: number
        id: string
        numChunks?: number
        type: EventType
        chunk?: Chunk
      }
      declare interface Web {
        id: string
        scriptId: number
        anonymous: boolean
        fileName: string
        data: Array
        eventsToNotify: EventType[]
        headers?: StringMap
        method?: string
        overrideMimeType?: string
        password?: string
        timeout?: number
        url: string
        user?: string
        xhrType: XMLHttpRequestResponseType
      }
    }
  }

  declare type SearchOptions = {
    reversed?: boolean
    wrapAround?: chrome.tabs.Tab
    reuseCursor?: boolean
    pos?: { line: number, ch: number }
  }

  declare interface UA extends VMScriptGMInfoPlatform {
    /** Chrome/ium version number */
    chrome: number | NaN
    /** derived from UA string initially, a real number when `ready` */
    firefox: number | NaN
    /** resolves when `browser` API returns real versions */
    ready: Promise<void>
  }
}
