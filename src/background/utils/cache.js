function get(key) {
  var obj = cache[key];
  return obj && obj.value;
}
function set(key, value) {
  if (value) {
    var obj = cache[key];
    if (!obj) obj = cache[key] = {
      key: key,
    };
    obj.value = value;
    if (obj.timer) clearTimeout(obj.timer);
    obj.timer = setTimeout(set, 3000, key);
  } else {
    delete cache[key];
  }
}
var cache = {};
module.exports = {
  get: get,
  set: set,
};
