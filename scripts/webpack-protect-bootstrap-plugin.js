const escapeStringRegexp = require('escape-string-regexp');

/**
 * WARNING! The following globals must be correctly assigned using wrapper-webpack-plugin.
 * toStringTag = Symbol.toStringTag
 * defineProperty = Object.defineProperty
 * hasOwnProperty = Object.prototype.hasOwnProperty
 * safeCall = Function.prototype.call.bind(Function.prototype.call)
 */
class WebpackProtectBootstrapPlugin {
  apply(compiler) {
    const NAME = this.constructor.name;
    const NULL_PROTO = '__proto__: null';
    const NULL_OBJ = `{ ${NULL_PROTO} }`;
    compiler.hooks.compilation.tap(NAME, (compilation) => {
      const { hooks, requireFn } = compilation.mainTemplate;
      hooks.localVars.tap(NAME, src => replace(src, [[
        'installedModules = {};',
        `installedModules = ${NULL_OBJ}; \
         for (let i = 0, c, str = "cdmnoprt"; i < str.length && (c = str[i++]);) \
           defineProperty(${requireFn}, c, { value: undefined, writable: true });`,
      ]]));
      hooks.moduleObj.tap(NAME, src => replace(src, [[
        'exports: {}',
        `exports: ${NULL_OBJ}, ${NULL_PROTO}`,
      ]]));
      hooks.require.tap(NAME, src => replace(src, [[
        'modules[moduleId].call(',
        'safeCall(modules[moduleId], ',
      ]]));
      hooks.requireExtensions.tap(NAME, src => replace(src, [
        ["(typeof Symbol !== 'undefined' && Symbol.toStringTag)", '(true)'],
        ['Symbol.toStringTag', 'toStringTag'],
        ['Object.defineProperty', 'defineProperty'],
        ['Object.create(null)', NULL_OBJ],
        ['for(var key in value)', 'for(const key in value)'],
        ['function(key) { return value[key]; }.bind(null, key)',
          '() => value[key]'],
        [/function[^{]+{[^}]+?hasOwnProperty\.call[^}]+}/g,
          '(obj, key) => safeCall(hasOwnProperty, obj, key)'],
      ]));
    });
  }
}

function replace(src, fromTo) {
  const origSrc = src;
  for (const [from, to] of fromTo) {
    const fromRe = typeof from === 'string'
      ? new RegExp(escapeStringRegexp(from), 'g')
      : from;
    const dst = src.replace(fromRe, to);
    if (dst === src) {
      throw new Error(`${WebpackProtectBootstrapPlugin.constructor.name}: `
        + `"${from}" not found in "${origSrc}"`);
    }
    src = dst;
  }
  return src;
}

module.exports = WebpackProtectBootstrapPlugin;
