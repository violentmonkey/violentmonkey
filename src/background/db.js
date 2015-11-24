function VMDB() {
  var _this = this;
  _this.initialized = _this.openDB().then(_this.initPosition.bind(_this));
}

VMDB.prototype.openDB = function () {
  var _this = this;
  return new Promise(function (resolve, reject) {
    var request = indexedDB.open('Violentmonkey', 1);
    request.onsuccess = function (e) {
      _this.db = request.result;
    };
    request.onerror = function (e) {
      var err = e.target.error;
      console.log('IndexedDB error: ' + err.message);
      reject(err);
    };
    request.onupgradeneeded = function (e) {
      var r = e.currentTarget.result;
      // scripts: id uri custom meta enabled update code position
      var o = r.createObjectStore('scripts', {
        keyPath: 'id',
        autoIncrement: true,
      });
      o.createIndex('uri', 'uri', {unique: true});
      o.createIndex('update', 'update', {unique: false});
      // position should be unique at last
      o.createIndex('position', 'position', {unique: false});
      // require: uri code
      o = r.createObjectStore('require', {keyPath: 'uri'});
      // cache: uri data
      o = r.createObjectStore('cache', {keyPath: 'uri'});
      // values: uri values
      o = r.createObjectStore('values', {keyPath: 'uri'});
    };
  });
};

VMDB.prototype.initPosition = function () {
  var _this = this;
  _this.position = 0;
  var o = _this.db.transaction('scripts', 'readwrite').objectStore('scripts');
  return new Promise(function (resolve, reject) {
    o.index('position').openCursor(null, 'prev').onsuccess = function (e) {
      var result = e.target.result;
      if (result && _this.position < result.key)
        _this.position = result.key;
      resolve();
    };
  });
};

VMDB.prototype.getScript = function (id, os) {
  os = os || this.db.transaction('scripts').objectStore('scripts');
  return new Promise(function (resolve, reject) {
    os.get(id).onsuccess = function (e) {
      resolve(e.target.result);
    };
  });
};

VMDB.prototype.queryScript = function (id, meta) {
  return id ? this.getScript(id)
  : new Promise(function (resolve, reject) {
    var uri = getNameURI({meta: meta});
    if (uri !== '::')
      this.db.transaction('scripts').objectStore('scripts')
      .index('uri').get(uri).onsuccess = function (e) {
        resolve(e.target.result);
      };
    else
      resolve(newScript());
  });
};

VMDB.prototype.getScriptData = function (id) {
  return this.getScript(id).then(function (script) {
    if (!script) return Promise.reject();
    var data = getMeta(script);
    data.code = script.code;
    return data;
  });
};

VMDB.prototype.getScriptInfos = function (ids) {
  var _this = this;
  var os = _this.db.transaction('scripts').objectStore('scripts');
  return Promise.all(ids.map(function (id) {
    return _this.getScript(id, os);
  })).then(function (scripts) {
    return scripts.filter(function (x) {return x;}).map(getMeta);
  });
};

VMDB.prototype.getScriptsByURL = function (url) {
  function getScripts() {
    return new Promise(function (resolve, reject) {
      var data = {
        scripts: [],
        uris: [],
      };
      var require = {};
      var cache = {};
      var o = db.transaction('scripts').objectStore('scripts');
      o.index('position').openCursor().onsuccess = function (e) {
        var result = e.target.result;
        if (result) {
          var value = result.value;
          if (testURL(url, value)) {
            data.scripts.push(value);
            data.uris.push(value.uri);
            value.meta.require.forEach(function (key) {
              require[key] = 1;
            });
            for (var k in value.meta.resources)
              cache[value.meta.resources[k]] = 1;
          }
          result.continue();
        } else {
          data.require = Object.getOwnPropertyNames(require);
          data.cache = Object.getOwnPropertyNames(cache);
          resolve(data);
        }
      };
    });
  }
  function getRequire(uris) {
    var o = db.transaction('require').objectStore('require');
    return Promise.all(uris.map(function (uri) {
      return new Promise(function (resolve, reject) {
        o.get(uri).onsuccess = function (e) {
          resolve(e.target.result);
        };
      });
    })).then(function (data) {
      return data.reduce(function (result, value, i) {
        if (value) result[uris[i]] = value.code;
        return result;
      }, {});
    });
  }
  function getValues(uris) {
    var o = db.transaction('values').objectStore('values');
    return Promise.all(uris.map(function (uri) {
      return new Promise(function (resolve, reject) {
        o.get(uri).onsuccess = function (e) {
          resolve(e.target.result);
        };
      });
    })).then(function (data) {
      return data.reduce(function (result, value, i) {
        if (value) result[uris[i]] = value.values;
        return result;
      }, {});
    });
  }
  var _this = this;
  var db = _this.db;
  return getScripts().then(function (data) {
    return Promise.all([
      getRequire(data.require),
      getValues(data.uris),
      _this.getCacheB64(data.cache),
    ]).then(function (res) {
      return {
        scripts: data.scripts,
        require: res[0],
        values: res[1],
        cache: res[2],
      };
    });
  });
};

VMDB.prototype.getData = function () {
  function getScripts() {
    return new Promise(function (resolve, reject) {
      var data = {
        scripts: [],
      };
      var cache = {};
      var o = db.transaction('scripts').objectStore('scripts');
      o.index('position').openCursor().onsuccess = function (e) {
        var result = e.target.result;
        if (result) {
          var value = result.value;
          if (isRemote(value.meta.icon)) cache[value.meta.icon] = 1;
          data.scripts.push(getMeta(value));
          result.continue();
        } else {
          data.cache = Object.getOwnPropertyNames(cache);
          resolve(data);
        }
      }
    });
  }
  function getCache(uris) {
    return _this.getCacheB64(uris).then(function (cache) {
      for (var k in cache)
        cache[k] = 'data:image/png;base64,' + cache[k];
      return cache;
    });
  }
  var _this = this;
  var db = _this.db;
  return getScripts().then(function (data) {
    return getCache(data.cache).then(function (cache) {
      return {
        scripts: data.scripts,
        cache: cache,
      };
    });
  });
};

VMDB.prototype.removeScript = function (id) {
	var o = this.db.transaction('scripts', 'readwrite').objectStore('scripts');
	o.delete(id);
  return Promise.resolve();
};

VMDB.prototype.moveScript = function (id, offset) {
  var o = this.db.transaction('scripts', 'readwrite').objectStore('scripts');
  return this.getScript(id).then(function (script) {
    var pos = script.position;
    var range, order;
    if (offset < 0) {
      range = IDBKeyRange.upperBound(pos, true);
      order = 'prev';
      offset = -offset;
    } else {
      range = IDBKeyRange.lowerBound(pos, true);
      order = 'next';
    }
    return new Promise(function (resolve, reject) {
      o.index('position').openCursor(range, order).onsuccess = function (e) {
        var result = e.target.result;
        if (result) {
          offset --;
          var value = result.value;
          value.position = pos;
          pos = result.key;
          result.update(value);
          if (offset) result.continue();
          else {
            script.position = pos;
            o.put(script).onsuccess = function () {
              resolve();
            };
          }
        }
      };
    });
  });
};

VMDB.prototype.getCacheB64 = function (urls) {
  var o = this.db.transaction('cache').objectStore('cache');
  return Promise.all(urls.map(function (url) {
    return new Promise(function (resolve, reject) {
      o.get(url).onsuccess = function (e) {
        resolve(e.target.result);
      };
    });
  })).then(function (data) {
    return data.reduce(function (map, value, i) {
      map[urls[i]] = value;
    }, {});
  });
};

VMDB.prototype.saveCache = function (url, data) {
  var o = this.db.transaction('cache', 'readwrite').objectStore('cache');
  return new Promise(function (resolve, reject) {
    o.put({uri: url, data: data}).onsuccess = function () {
      resolve();
    };
  });
};

VMDB.prototype.saveRequire = function (url, data) {
  var o = this.db.transaction('require', 'readwrite').objectStore('require');
  return new Promise(function (resolve, reject) {
    o.put({uri: url, code: data}).onsuccess = function () {
      resolve();
    };
  });
};

VMDB.prototype.saveScript = function (script) {
  script.enabled = script.enabled ? 1 : 0;
  script.update = script.update ? 1 : 0;
  if (!script.position) script.position = ++ this.position;
  var o = this.db.transaction('scripts', 'readwrite').objectStore('scripts');
  return new Promise(function (resolve, reject) {
    o.put(script).onsuccess = function () {
      resolve();
    };
  });
};

VMDB.prototype.fetch = function (url, type, headers) {
  var xhr = new XMLHttpRequest;
  xhr.open('GET', url, true);
  if (type) xhr.responseType = type;
  if (headers) for (var k in headers)
    xhr.setRequestHeader(k, headers[k]);
  return new Promise(function (resolve, reject) {
    xhr.onload = function () {
      resolve(this);
    };
    xhr.onerror = function () {
      reject(this);
    };
    xhr.send();
  });
};

VMDB.prototype.fetchCache = function () {
  var requests = {};
  return function (url, check) {
    var _this = this;
    return requests[url]
    || (requests[url] = _this.fetch(url, 'blob').then(function (res) {
      return check ? check(res.response) : res.response;
    }).then(function (data) {
      return new Promise(function (resolve, reject) {
        var reader = new FileReader;
        reader.onload = function (e) {
          _this.saveCache(url, window.btoa(this.result)).then(function () {
            delete requests[url];
            resolve();
          });
        };
        reader.onerror = function (e) {
          reject(e);
        };
        reader.readAsBinaryString(data);
      });
    }));
  };
}();

VMDB.prototype.fetchRequire = function () {
  var requests = {};
  return function (url) {
    var _this = this;
    return requests[url]
    || (requests[url] = _this.fetch(url).then(function (res) {
      return _this.saveRequire(url, res.responseText);
    }).then(function () {
      delete requests[url];
    }));
  };
}();

VMDB.prototype.setValue = function (uri, values) {
  var o = this.db.transaction('values', 'readwrite').objectStore('values');
  return new Promise(function (resolve, reject) {
    o.put({uri: uri, values: values}).onsuccess = function () {
      resolve();
    };
  });
};

VMDB.prototype.updateScriptInfo = function (id, data) {
  var o = this.db.transaction('scripts', 'readwrite').objectStore('scripts');
  return new Promise(function (resolve, reject) {
    o.get(id).onsuccess = function (e) {
      var script = e.target.result;
      if (!script) return reject();
      for (var k in data)
        if (k in script) script[k] = data[k];
      o.put(script).onsuccess = function (e) {
        resolve(getMeta(script));
      };
    };
  });
};

VMDB.prototype.getExportData = function (ids, withValues) {
  function getScripts(ids) {
    var o = db.transaction('scripts').objectStore('scripts');
    return Promise.all(ids.map(function (id) {
      return new Promise(function (resolve, reject) {
        o.get(id).onsuccess = function (e) {
          resolve(e.target.result);
        };
      });
    })).then(function (data) {
      return data.filter(function (x) {return x;});
    });
  }
  function getValues(uris) {
    var o = db.transaction('values').objectStore('values');
    return Promise.all(uris.map(function (uri) {
      return new Promise(function (resolve, reject) {
        o.get(uri).onsuccess = function (e) {
          resolve(e.target.result);
        };
      });
    })).then(function (data) {
      return data.reduce(function (result, value, i) {
        if (value) result[uris[i]] = value.values;
        return result;
      }, {});
    });
  }
  var db = this.db;
  return getScripts(ids).then(function (scripts) {
    var res = {
      scripts: scripts,
    };
    return withValues
    ? getValues(scripts.map(function (script) {return script.uri;})).then(function (values) {
      res.values = values;
      return res;
    }) : res;
  });
};

// Common functions

function parseMeta(code) {
	// initialize meta, specify those with multiple values allowed
	var meta = {
		include: [],
		exclude: [],
		match: [],
		require: [],
		resource: [],
		grant: [],
	};
	var flag = -1;
	code.replace(/(?:^|\n)\/\/\s*([@=]\S+)(.*)/g, function(value, group1, group2) {
		if (flag < 0 && group1 == '==UserScript==')
			// start meta
			flag = 1;
		else if(flag > 0 && group1 == '==/UserScript==')
			// end meta
			flag = 0;
		if (flag == 1 && group1[0] == '@') {
			var key = group1.slice(1);
			var val = group2.replace(/^\s+|\s+$/g, '');
			var value = meta[key];
      // multiple values allowed
			if (value && value.push) value.push(val);
      // only first value will be stored
			else if (!(key in meta)) meta[key] = val;
		}
	});
	meta.resources = {};
	meta.resource.forEach(function(line) {
		var pair = line.match(/^(\w\S*)\s+(.*)/);
		if (pair) meta.resources[pair[1]] = pair[2];
	});
	delete meta.resource;
	// @homepageURL: compatible with @homepage
	if (!meta.homepageURL && meta.homepage) meta.homepageURL = meta.homepage;
	return meta;
}

function newScript() {
	var script = {
		custom: {},
		enabled: 1,
		update: 1,
		code: '// ==UserScript==\n// @name New Script\n// ==/UserScript==\n',
	};
	script.meta = parseMeta(script.code);
	return script;
}

function getMeta(script) {
	return {
		id: script.id,
		custom: script.custom,
		meta: script.meta,
		enabled: script.enabled,
		update: script.update,
	};
}

function getNameURI(script) {
	var ns = script.meta.namespace || '';
	var name = script.meta.name || '';
	var nameURI = escape(ns) + ':' + escape(name) + ':';
	if (!ns && !name) nameURI += script.id || '';
	return nameURI;
}

var tester = function () {
  function testURL(url, script) {
    var custom = script.custom;
    var meta = script.meta;
    var inc = [], exc = [], mat = [];
    var ok = true;
    if (custom._match !== false && meta.match) mat = mat.concat(meta.match);
    if (custom.match) mat = mat.concat(custom.match);
    if (custom._include !== false && meta.include) inc = inc.concat(meta.include);
    if (custom.include) inc = inc.concat(custom.include);
    if (custom._exclude !== false && meta.exclude) exc = exc.concat(meta.exclude);
    if (custom.exclude) exc = exc.concat(custom.exclude);
    if (mat.length) {
      // @match
      var urlParts = url.match(match_reg);
      ok = mat.some(function (str) {
        return matchTest(str, urlParts);
      });
    } else {
      // @include
      ok = inc.some(function (str) {
        return autoReg(str).test(url);
      });
    }
    // exclude
    ok = ok && !exc.some(function (str) {
      return autoReg(str).test(url);
    });
    return ok;
  }

  function str2RE(str) {
    return RegExp('^' + str.replace(/([.?\/])/g, '\\$1').replace(/\*/g, '.*?') + '$');
  }

  function autoReg(str) {
    if (/^\/.*\/$/.test(str))
      return RegExp(str.slice(1, -1));	// Regular-expression
    else
      return str2RE(str);	// String with wildcards
  }

  var match_reg = /(.*?):\/\/([^\/]*)\/(.*)/;
  function matchTest(str, urlParts) {
    if (str == '<all_urls>') return true;
    var parts = str.match(match_reg);
    var ok = !!parts;
    // scheme
    ok = ok && (
      // exact match
      parts[1] == urlParts[1]
      // * = http | https
      || parts[1] == '*' && /^https?$/i.test(urlParts[1])
    );
    // host
    ok = ok && (
      // * matches all
      parts[2] == '*'
      // exact match
      || parts[2] == urlParts[2]
      // *.example.com
      || /^\*\.[^*]*$/.test(parts[2]) && str2RE(parts[2]).test(urlParts[2])
    );
    // pathname
    ok = ok && str2RE(parts[3]).test(urlParts[3]);
    return ok;
  }

  return {
    testURL: testURL,
  };
}();
