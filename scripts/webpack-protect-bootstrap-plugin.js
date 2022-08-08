const escapeStringRegexp = require('escape-string-regexp');
const webpack = require('webpack');

const G = webpack.RuntimeGlobals;
const OBJ_RULE = [
  /([[(,=:]\s*{)(?!__proto__:)\s*(.)/g,
  (_, str, next) => `${str}__proto__: null${next === '}' ? '' : ','}${next}`,
];
const BOOTSTRAP_RULES = [
  OBJ_RULE,
  [
    "typeof Symbol !== 'undefined' && Symbol.toStringTag",
    'true',
    G.makeNamespaceObject,
  ], [
    'Symbol.toStringTag',
    'toStringTagSym',
    G.makeNamespaceObject,
  ], [
    'Object.defineProperty(',
    'defineProperty(',
    G.definePropertyGetters,
  ], [
    `${G.hasOwnProperty}(definition, key) && !${G.hasOwnProperty}(exports, key)`,
    '!(key in exports)',
    G.definePropertyGetters,
  ], [
    'Object.prototype.hasOwnProperty.call(',
    'safeCall(hasOwnProperty, ',
    G.hasOwnProperty,
  ],
];
const MAIN_RULES = [
  [
    /(__webpack_modules__\[moduleId])\.call\(/g,
    'safeCall($1, ',
    false,
  ], [
    new RegExp(`var (__webpack_module_cache__|${G.require}) = {};.*?var ${G.exports} =`, 's'),
    patchBootstrap,
  ], [
    new RegExp(`(${[
      `${G.definePropertyGetters}\\(${G.exports}, {`,
      `var ${G.exports} = {`,
      `var __webpack_modules__ = \\({`,
    ].join('|')})(?!__proto__:)\\s*(.)`, 'g'),
    OBJ_RULE[1],
  ],
];

/**
 * WARNING! The following globals must be correctly assigned using wrapper-webpack-plugin.
 * toStringTagSym = Symbol.toStringTag
 * defineProperty = Object.defineProperty
 * hasOwnProperty = Object.prototype.hasOwnProperty
 * safeCall = Function.prototype.call.bind(Function.prototype.call)
 */
class WebpackProtectBootstrapPlugin {
  apply(compiler) {
    const NAME = WebpackProtectBootstrapPlugin.name;
    compiler.hooks.compilation.tap(NAME, (compilation) => {
      const hooks = webpack.javascript.JavascriptModulesPlugin.getCompilationHooks(compilation);
      hooks.renderMain.tap(NAME, replace.bind(null, MAIN_RULES));
    });
  }
}

function patchBootstrap(src) {
  const props = src.match(new RegExp(`(?<=\\b${G.require}\\.)(\\w+)`, 'g'));
  const uniq = [...new Set(props)].join('');
  const guard = uniq
    ? `for (let i = 0, props=${JSON.stringify(uniq)}; i < props.length; i++)
      defineProperty(${G.require}, props[i], {__proto__: null, value: 0, writable: 1});\n`
    : '';
  return guard + replace(BOOTSTRAP_RULES, src, this);
}

function replace(rules, src, info) {
  src = src.source?.() || src;
  let res = src;
  for (const rule of rules) {
    const [from, to, test = true] = rule;
    const fromRe = typeof from === 'string'
      ? new RegExp(escapeStringRegexp(from), 'g')
      : from;
    const dst = res.replace(fromRe, to.bind?.(info) || to);
    const mandatory = test === true
      || test.test?.(src)
      || typeof test === 'string' && src.includes(test);
    if (dst === res && mandatory) {
      const err = `[${WebpackProtectBootstrapPlugin.name}] `
        + `"${from}" not found in ${info.chunk.name || 'bootstrap'}`;
      console.log(`${err}:\n${src}`); // this prints immediately
      throw new Error(err); // this prints at the end of build
    }
    res = dst;
  }
  return res;
}

module.exports = WebpackProtectBootstrapPlugin;
