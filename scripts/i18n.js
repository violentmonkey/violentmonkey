const fs = require('fs').promises;
const path = require('path');
const Vinyl = require('vinyl');
const PluginError = require('plugin-error');
const through = require('through2');
const yaml = require('js-yaml');

const transformers = {
  '.yml': data => yaml.load(data),
  '.json': data => JSON.parse(data),
};

class Locale {
  constructor(lang, base) {
    this.defaultLocale = 'messages.yml';
    this.lang = lang;
    this.base = base;
    this.data = {};
    this.desc = {};
  }

  async load() {
    const localeDir = `${this.base}/${this.lang}`;
    let files = await fs.readdir(localeDir);
    files = [this.defaultLocale].concat(files.filter(file => file !== this.defaultLocale));
    for (const file of files) {
      const ext = path.extname(file);
      const transformer = transformers[ext];
      if (transformer) {
        try {
          const res = await fs.readFile(`${localeDir}/${file}`, 'utf8');
          Object.assign(this.data, transformer(res));
        } catch (err) {
          if (err.code !== 'ENOENT') {
            throw err;
          }
        }
      }
    }
    Object.keys(this.data)
    .forEach(key => {
      this.desc[key] = this.desc[key] || this.data[key].description;
    });
  }

  getMessage(key, def) {
    const item = this.data[key];
    return item && item.message || def;
  }

  get(key) {
    return this.data[key];
  }

  dump(data, { extension, stripDescriptions }) {
    if (extension === '.json') {
      if (stripDescriptions) {
        data = Object.entries(data).reduce((res, [key, value]) => {
          // eslint-disable-next-line no-unused-vars
          const { description, ...stripped } = value;
          res[key] = stripped;
          return res;
        }, {});
      }
      data = JSON.stringify(data, null, 2);
    } else if (extension === '.yml') {
      data = yaml.dump(data, { sortKeys: true });
    } else {
      throw 'Unknown extension name!';
    }
    return {
      path: `${this.lang}/messages${extension}`,
      data,
    };
  }
}

class Locales {
  constructor(options) {
    this.options = options;
    this.defaultLang = 'en';
    this.newLocaleItem = 'NEW_LOCALE_ITEM';
    this.base = options.base || '.';
    this.langs = [];
    this.locales = {};
    this.data = {};
  }

  async load() {
    const langs = await fs.readdir(this.base);
    this.langs = langs;
    await Promise.all(langs.map(async lang => {
      const locale = new Locale(lang, this.base);
      await locale.load();
      this.locales[lang] = locale;
    }));
    const defaultData = this.locales[this.defaultLang];
    Object.keys(defaultData.desc).forEach(key => {
      this.data[key] = {
        ...defaultData.data[key],
        touched: this.options.markUntouched ? false : defaultData.get(key).touched !== false,
      };
    });
  }

  getData(lang, options) {
    options = options || {};
    const data = {};
    const langData = this.locales[lang];
    const defaultData = options.useDefaultLang && lang !== this.defaultLang
      ? this.locales[this.defaultLang]
      : null;
    const colons = defaultData && !/^(ja|ko|zh)/.test(lang);
    Object.keys(this.data).forEach(key => {
      if (options.touchedOnly && !this.data[key].touched) return;
      const msg = langData.getMessage(key) || defaultData?.getMessage(key) || '';
      data[key] = {
        description: this.data[key].description || this.newLocaleItem,
        message: colons
          ? normalizeTrailingColon(msg, defaultData.getMessage(key))
          : msg,
      };
      if (options.markUntouched && !this.data[key].touched) data[key].touched = false;
    });
    return data;
  }

  dump(options) {
    options = { ...this.options, ...options };
    return this.langs.map(lang => {
      const data = this.getData(lang, options);
      const locale = this.locales[lang];
      return locale.dump(data, options);
    });
  }

  touch(key) {
    let item = this.data[key];
    if (!item) item = this.data[key] = {
      description: this.newLocaleItem,
    };
    item.touched = true;
  }
}

function extract(options) {
  const keys = new Set();
  const patterns = {
    default: ['\\b(?:i18n\\(\'|i18n-key=")(\\w+)[\'"]', 1],
    json: ['__MSG_(\\w+)__', 1],
  };
  const typePatternMap = {
    '.js': 'default',
    '.json': 'json',
    '.html': 'default',
    '.vue': 'default',
  };
  const locales = new Locales(options);

  function extractFile(data, types) {
    if (!Array.isArray(types)) types = [types];
    data = String(data);
    types.forEach(function (type) {
      const patternData = patterns[type];
      const pattern = new RegExp(patternData[0], 'g');
      const groupId = patternData[1];
      let groups;
      while ((groups = pattern.exec(data))) {
        keys.add(groups[groupId]);
      }
    });
  }

  function bufferContents(file, enc, cb) {
    if (file.isNull()) return cb();
    if (file.isStream()) return this.emit('error', new PluginError('VM-i18n', 'Stream is not supported.'));
    const extname = path.extname(file.path);
    const type = typePatternMap[extname];
    if (type) extractFile(file.contents, type);
    cb();
  }

  function endStream(cb) {
    locales.load()
    .then(() => {
      keys.forEach(key => {
        locales.touch(key);
      });
      return locales.dump()
      .map(out => new Vinyl({
        path: out.path,
        contents: Buffer.from(out.data),
      }));
    })
    .then(files => {
      files.forEach(file => {
        this.push(file);
      });
      cb();
    })
    .catch(cb);
  }

  if (options.manifest) {
    const mf = require('fs').readFileSync(options.manifest, 'utf8');
    extractFile(mf, 'json');
  }
  return through.obj(bufferContents, endStream);
}

function read(options) {
  const stream = extract(options);
  process.nextTick(() => stream.end());
  return stream;
}

function normalizeTrailingColon(str, sourceStr = '') {
  if (sourceStr.endsWith(': ') && str.endsWith(':')) {
    return str + ' ';
  }
  if (sourceStr.endsWith(':') && str.endsWith(': ')) {
    return str.slice(0, -1);
  }
  return str;
}

module.exports = {
  extract,
  read,
};
