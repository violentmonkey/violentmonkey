const fs = require('fs');
const path = require('path');
const gutil = require('gulp-util');
const through = require('through2');
const yaml = require('js-yaml');

function readFile(file) {
  return new Promise((resolve, reject) => {
    fs.readFile(file, 'utf8', (err, data) => err ? reject(err) : resolve(data));
  });
}

const transformers = {
  '.yml': data => yaml.safeLoad(data),
  '.json': data => JSON.parse(data),
};

function Locale(lang, basepath, basedir) {
  this.lang = lang;
  const ext = path.extname(basepath);
  if (ext) {
    console.warn(`Extension name is ignored in basepath: ${basepath}`);
    basepath = basepath.slice(0, -ext.length);
  }
  this.basepath = basepath;
  this.basedir = basedir || '.';
  this.data = {};
  this.loaded = this.load();
}
Locale.prototype.extensions = ['.yml', '.json'];
Locale.prototype.load = function () {
  const file = `${this.basedir}/${this.basepath}`;
  const data = {};
  return this.extensions.reduce((promise, ext) => promise.then(() =>
    readFile(file + ext)
    .then(res => {
      Object.assign(data, transformers[ext](res));
    }, err => {})
  ), Promise.resolve())
  .then(() => Object.keys(data).reduce((desc, key) => {
    this.data[key] = data[key].message;
    desc[key] = data[key].description;
    return desc;
  }, {}));
};
Locale.prototype.get = function (key, def) {
  return this.data[key] || def;
};
Locale.prototype.dump = function (data, ext) {
  if (ext === '.json') {
    data = JSON.stringify(data, null, 2);
  } else if (ext === '.yml') {
    data = yaml.safeDump(data);
  } else {
    throw 'Unknown extension name!';
  }
  return {
    path: this.basepath + ext,
    data,
  };
};

function Locales(prefix, base) {
  this.prefix = prefix || '.';
  this.base = base || '.';
  this.langs = [];
  this.data = {};
  this.desc = {};
  this.loaded = this.load();
}
Locales.prototype.defaultLang = 'en';
Locales.prototype.newLocaleItem = 'NEW_LOCALE_ITEM';
Locales.prototype.getLanguages = function () {
  const localeDir = this.base + '/' + this.prefix;
  return new Promise((resolve, reject) => {
    fs.readdir(localeDir, (err, files) => err ? reject(err) : resolve(files));
  });
};
Locales.prototype.load = function () {
  return this.getLanguages().then(langs => {
    this.langs = langs;
    return Promise.all(langs.map(lang => {
      const locale = this.data[lang] = new Locale(lang, `${this.prefix}/${lang}/messages`, this.base);
      return locale.loaded;
    }));
  })
  .then(data => {
    const desc = data[this.langs.indexOf(this.defaultLang)];
    Object.keys(desc).forEach(key => {
      this.desc[key] = {
        touched: false,
        value: desc[key],
      };
    });
  });
};
Locales.prototype.getData = function (lang, options) {
  options = options || {};
  const data = {};
  const langData = this.data[lang];
  const defaultData = options.useDefaultLang && lang != this.defaultLang && this.data[this.defaultLang];
  for (let key in this.desc) {
    if (options.touchedOnly && !this.desc[key].touched) continue;
    data[key] = {
      description: this.desc[key].value || this.newLocaleItem,
      message: langData.get(key) || defaultData && defaultData.get(key) || '',
    };
    if (options.markUntouched && !this.desc[key].touched)
      data[key].touched = false;
  }
  return data;
};
Locales.prototype.dump = function (options) {
  return this.langs.map(lang => {
    const data = this.getData(lang, options);
    const locale = this.data[lang];
    const out = locale.dump(data, options.extension);
    return new gutil.File({
      base: '',
      path: out.path,
      contents: new Buffer(out.data),
    });
  });
};
Locales.prototype.touch = function (key) {
  let item = this.desc[key];
  if (!item) item = this.desc[key] = {
    value: this.newLocaleItem,
  };
  item.touched = true;
};

function extract(options) {
  const keys = new Set();
  const patterns = {
    default: ['\\bi18n\\(\'(\\w+)\'', 1],
    json: ['__MSG_(\\w+)__', 1],
  };
  const types = {
    '.js': 'default',
    '.json': 'json',
    '.html': 'default',
    '.vue': 'default',
  };

  const locales = new Locales(options.prefix, options.base);

  function extract(data, types) {
    if (!Array.isArray(types)) types = [types];
    data = String(data);
    types.forEach(function (type) {
      const patternData = patterns[type];
      const pattern = new RegExp(patternData[0], 'g');
      const groupId = patternData[1];
      let groups;
      while (groups = pattern.exec(data)) {
        keys.add(groups[groupId]);
      }
    });
  }

  function bufferContents(file, enc, cb) {
    if (file.isNull()) return cb();
    if (file.isStream()) return this.emit('error', new gutil.PluginError('VM-i18n', 'Stream is not supported.'));
    const extname = path.extname(file.path);
    const type = types[extname];
    type && extract(file.contents, type);
    cb();
  }

  function endStream(cb) {
    locales.loaded.then(() => {
      keys.forEach(key => {
        locales.touch(key);
      });
      return locales.dump({
        touchedOnly: options.touchedOnly,
        useDefaultLang: options.useDefaultLang,
        markUntouched: options.markUntouched,
        extension: options.extension,
      });
    }).then(files => {
      files.forEach(file => {
        this.push(file);
      });
      cb();
    });
  }

  return through.obj(bufferContents, endStream);
}

module.exports = {
  extract,
};
