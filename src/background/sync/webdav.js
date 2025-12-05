import { tryUrl } from '@/common';
import {
  ANONYMOUS,
  PASSWORD,
  SERVER_URL,
  USER_CONFIG,
  USERNAME,
} from '@/common/consts-sync';
import {
  BaseService,
  getItemFilename,
  getURI,
  isScriptFile,
  register,
} from './base';

const KEY_CHILDREN = Symbol('children');

class XNode {
  constructor(node, nsMap) {
    this.node = node;
    this.nsMap = { ...nsMap };
    this.parseAttrs();
    this.parseName();
  }

  static fromXML(xml) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'application/xml');
    return new XNode(doc);
  }

  parseAttrs() {
    const { node, nsMap } = this;
    const attrs = {};
    const { attributes } = node;
    if (attributes) {
      for (const attr of node.attributes) {
        const { name, value } = attr;
        if (name === 'xmlns') nsMap.$ = value;
        else if (name.startsWith('xmlns:')) nsMap[name.slice(6)] = value;
        attrs[name] = value;
      }
    }
    this.attrs = attrs;
  }

  parseName() {
    const { node, nsMap } = this;
    if (node.nodeType === 1) {
      let name = node.tagName;
      let ns = nsMap.$;
      if (name.includes(':')) {
        let prefix;
        [prefix, name] = name.split(':');
        ns = nsMap[prefix];
        if (!ns) throw new Error(`Unknown namespace: ${prefix}`);
      }
      this.name = ns + name;
    }
  }

  text() {
    const { node } = this;
    if (node) return (node.textContent || '').trim();
  }

  children() {
    if (!this[KEY_CHILDREN]) {
      const { node, nsMap } = this;
      this[KEY_CHILDREN] = [...node.children].map(
        (child) => new XNode(child, nsMap),
      );
    }
    return this[KEY_CHILDREN];
  }

  map(callback) {
    return this.children().map(callback);
  }

  getCallback(callback) {
    if (typeof callback === 'string') {
      return (
        (tagName) => (node) =>
          node.name === tagName
      )(callback);
    }
    return callback;
  }

  filter(callback) {
    return this.children().filter(this.getCallback(callback));
  }

  find(callback) {
    return this.children().find(this.getCallback(callback));
  }

  attr(key) {
    return this.attrs[key];
  }
}

const DEFAULT_CONFIG = {
  [SERVER_URL]: '',
  [ANONYMOUS]: false,
  [USERNAME]: '',
  [PASSWORD]: '',
};

const WebDAV = BaseService.extend({
  name: 'webdav',
  displayName: 'WebDAV',
  properties: {
    authType: PASSWORD,
    [SERVER_URL]: null,
  },
  getUserConfig() {
    return (this[USER_CONFIG] ||= {
      ...DEFAULT_CONFIG,
      ...this.config.get(USER_CONFIG),
    });
  },
  setUserConfig(config) {
    Object.assign(this[USER_CONFIG], config);
    this.config.set(USER_CONFIG, this[USER_CONFIG]);
  },
  initToken() {
    const config = this.getUserConfig();
    let url = config[SERVER_URL]?.trim() || '';
    if (!url.includes('://')) url = `http://${url}`;
    if (!url.endsWith('/')) url += '/';
    if (!tryUrl(url)) {
      this.properties[SERVER_URL] = null;
      return false;
    }
    this.properties[SERVER_URL] = `${url}${VIOLENTMONKEY}/`;
    const { anonymous, username, password } = config;
    if (anonymous) return true;
    if (!username || !password) return false;
    const auth = window.btoa(`${username}:${password}`);
    this.headers = { Authorization: `Basic ${auth}` };
    return true;
  },
  async requestAuth() {
    await this.list();
  },
  loadData(options) {
    // Bypassing login CSRF protection in Nextcloud / Owncloud by not sending cookies.
    // We are not using web UI and cookie authentication, so we don't have to worry about that.
    // See https://github.com/violentmonkey/violentmonkey/issues/976
    return BaseService.prototype.loadData.call(
      this,
      Object.assign(
        {
          credentials: 'omit',
        },
        options,
      ),
    );
  },
  metaError(res) {
    if (
      ![
        404, // File not exists
        409, // Directory not exists
      ].includes(res.status)
    )
      throw res;
  },
  list() {
    const { serverUrl } = this.properties;
    const mkdir = () =>
      this.loadData({
        method: 'MKCOL',
        url: serverUrl,
      });
    const readdir = () =>
      this.loadData({
        method: 'PROPFIND',
        url: serverUrl,
        headers: {
          depth: '1',
        },
      }).then((xml) => {
        const doc = XNode.fromXML(xml);
        const items = doc
          .children()[0]
          .map((node) => {
            const prop = node.find('DAV:propstat').find('DAV:prop');
            const type = prop.find('DAV:resourcetype').find('DAV:collection')
              ? 'directory'
              : 'file';
            if (type === 'file') {
              const displayNameNode = prop.find('DAV:displayname');
              const displayName = decodeURIComponent(
                displayNameNode
                  ? displayNameNode.text() // some servers also encode DAV:displayname
                  : node.find('DAV:href').text().split('/').pop(), // extracting file name
              );
              if (isScriptFile(displayName)) {
                const size = prop.find('DAV:getcontentlength');
                return normalize({
                  name: displayName,
                  size: size ? +size.text() : 0,
                });
              }
            }
            return null;
          })
          .filter(Boolean);
        return items;
      });
    return readdir().catch((err) => {
      if (err.status === 404) {
        return mkdir().then(readdir);
      }
      throw err;
    });
  },
  get(item) {
    const name = getItemFilename(item);
    const { serverUrl } = this.properties;
    return this.loadData({
      url: serverUrl + name,
    });
  },
  put(item, data) {
    const name = getItemFilename(item);
    const headers = {
      'Content-Type': 'text/plain',
    };
    const lock = this.config.get('lock');
    if (lock) headers.If = `(<${lock}>)`;
    const { serverUrl } = this.properties;
    return this.loadData({
      method: 'PUT',
      url: serverUrl + name,
      body: data,
      headers,
    });
  },
  remove(item) {
    const name = getItemFilename(item);
    const headers = {};
    const lock = this.config.get('lock');
    if (lock) headers.If = `(<${lock}>)`;
    const { serverUrl } = this.properties;
    return this.loadData({
      method: 'DELETE',
      url: serverUrl + name,
      headers,
    });
  },
});
register(WebDAV);

function normalize(item) {
  return {
    name: item.name,
    size: item.size,
    uri: getURI(item.name),
  };
}
