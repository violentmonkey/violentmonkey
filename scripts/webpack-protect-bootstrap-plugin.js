const escapeStringRegexp = require('escape-string-regexp');
const webpack = require('webpack');

const G = webpack.RuntimeGlobals;
const OPTIONAL = false;
const OBJ_RULE = [
  /([[(,=:]\s*{)(?!__proto__:)\s*(.)/g,
  (_, str, next) => `${str}__proto__: null${next === '}' ? '' : ','}${next}`
];
const BOOTSTRAP_RULES = [
  OBJ_RULE,
  ["typeof Symbol !== 'undefined' && Symbol.toStringTag",
    'true'],
  ['Symbol.toStringTag',
    'toStringTagSym'],
  ['Object.defineProperty(',
    'defineProperty('],
  ['Object.prototype.hasOwnProperty.call(',
    'safeCall(hasOwnProperty, '],
  [`${G.hasOwnProperty}(definition, key) && !${G.hasOwnProperty}(exports, key)`,
    '!(key in exports)'], // these objects have null proto
];
const MAIN_RULES = [
  [
    /(__webpack_modules__\[moduleId])\.call\(/g,
    'safeCall($1, ',
    OPTIONAL,
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

function patchBootstrap(src, group1) {
  let guard = '';
  if (group1 !== G.require) {
    // webpack didn't concatenate all modules into one, let's patch the machinery
    const props = src.match(new RegExp(`(?<=\\b${G.require}\\.)(\\w+)`, 'g'));
    const uniq = [...new Set(props)].join('');
    if (uniq) {
      guard = `for (let i = 0, props=${JSON.stringify(uniq)}; i < props.length; i++)
      defineProperty(${G.require}, props[i], {__proto__: null, value: 0, writable: 1});\n`;
    }
  }
  return guard + replace(guard ? BOOTSTRAP_RULES : [OBJ_RULE], src, this);
}

function replace(rules, src, info) {
  src = src.source?.() || src;
  let res = src;
  for (const rule of rules) {
    const [from, to, mandatory = true] = rule;
    const fromRe = typeof from === 'string'
      ? new RegExp(escapeStringRegexp(from), 'g')
      : from;
    const dst = res.replace(fromRe, to.bind?.(info) || to);
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
