'use strict';

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

function Locale(lang, _path, base) {
  this.lang = lang;
  const ext = this.ext = path.extname(_path);
  if (ext) _path = _path.slice(0, -ext.length);
  this.path = _path;
  this.base = base || '.';
  this.data = {};
  this.loaded = this.load();
}
Locale.prototype.extensions = ['.yml', '.json'];
Locale.prototype.load = function () {
  const file = this.base + '/' + this.path;
  return (
    this.ext
      ? readFile(file + this.ext)
      : this.extensions.reduce((promise, ext) => promise.catch(() => (
        readFile(file + ext)
        .then(data => {
          this.ext = ext;
          return data;
        })
      )), Promise.reject())
  ).then(data => {
    const desc = {};
    if (this.ext === '.json') {
      data = JSON.parse(data);
    } else if (this.ext === '.yml') {
      data = yaml.safeLoad(data);
    } else {
      throw 'Unknown extension name!';
    }
    for (let key in data) {
      this.data[key] = data[key].message;
      desc[key] = data[key].description;
    }
    return desc;
  });
};
Locale.prototype.get = function (key, def) {
  return this.data[key] || def;
};
Locale.prototype.dump = function (data, ext) {
  ext = ext || this.ext;
  if (ext === '.json') {
    data = JSON.stringify(data, null, 2);
  } else if (ext === '.yml') {
    data = yaml.safeDump(data);
  } else {
    throw 'Unknown extension name!';
  }
  return {
    path: this.path + ext,
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
  return this.getLanguages().then((langs) => {
    this.langs = langs;
    return Promise.all(langs.map((lang) => {
      const locale = this.data[lang] = new Locale(lang, `${this.prefix}/${lang}/messages`, this.base);
      return locale.loaded;
    }));
  }).then((data) => {
    const desc = data[this.langs.indexOf(this.defaultLang)];
    for (let key in desc) {
      this.desc[key] = {
        touched: false,
        value: desc[key],
      };
    }
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
    js: ['_.i18n\\(([\'"])(\\w+)\\1', 2],
    json: ['__MSG_(\\w+)__', 1],
    html: ['data-i18n=([\'"]?)(\\w+)\\1', 2],
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
    if (file.isStream())
      return this.emit('error', new gutil.PluginError('VM-i18n', 'Stream is not supported.'));
    if (file.path.endsWith('.js'))
      extract(file.contents, 'js');
    else if (file.path.endsWith('.json'))
      extract(file.contents, 'json');
    else if (file.path.endsWith('.html'))
      extract(file.contents, ['html', 'js']);
    cb();
  }

  function endStream(cb) {
    locales.loaded.then(() => {
      keys.forEach((key) => {
        locales.touch(key);
      });
      return locales.dump({
        touchedOnly: options.touchedOnly,
        useDefaultLang: options.useDefaultLang,
        markUntouched: options.markUntouched,
        extension: options.extension,
      });
    }).then((files) => {
      files.forEach((file) => {
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
