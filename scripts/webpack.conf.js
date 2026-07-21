const fs = require('node:fs');
const { resolve } = require('path');
const webpack = require('webpack');
const { ListBackgroundScriptsPlugin } = require('./manifest-helper');
const { addWrapperWithGlobals, getCodeMirrorThemes } = require('./webpack-util');
const ProtectWebpackBootstrapPlugin = require('./webpack-protect-bootstrap-plugin');
const { getVersion } = require('./version-helper');
const { MV3 } = require('./common');
const { configLoader } = require('./config-helper');
const { getBaseConfig, getPageConfig, isProd } = require('./webpack-base');

// Avoiding collisions with globals of a content-mode userscript
const INIT_FUNC_NAME = '**VMInitInjection**';
const VAULT_ID = 'VAULT_ID';
const PAGE_MODE_HANDSHAKE = 'PAGE_MODE_HANDSHAKE';
const VM_VER = getVersion();

global.localStorage = {}; // workaround for node 25 and HtmlWebpackPlugin's `...global`

configLoader
  // Default values
  .add({
    DEBUG: false,
  })
  // Load from `./.env`
  .envFile()
  // Load from `process.env`
  .env()
  // Override values
  .add({
    VM_VER,
  });

const pickEnvs = (items) => {
  return Object.assign({}, ...items.map(key => ({
    [`__.${key}`]: JSON.stringify(configLoader.get(key)),
  })));
};

const defsObj = {
  ...pickEnvs([
    'VM_VER',
    'SYNC_GOOGLE_DESKTOP_ID',
    'SYNC_GOOGLE_DESKTOP_SECRET',
    'SYNC_ONEDRIVE_CLIENT_ID',
    'SYNC_ONEDRIVE_ACCOUNT_TYPE',
    'SYNC_DROPBOX_CLIENT_ID',
  ]),
  ...Object.fromEntries(Object.entries({
    INIT_FUNC_NAME,
    MV3,
    CODEMIRROR_THEMES: getCodeMirrorThemes(),
    DEBUG: +process.env.DEBUG,
    DEV: !isProd,
    TEST: process.env.BABEL_ENV === 'test',
  }).map(([k, v]) => ['__.' + k, /string|object/.test(typeof v) ? JSON.stringify(v) : v])),
  __VUE_OPTIONS_API__: true,
  __VUE_PROD_DEVTOOLS__: false,
  __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
};
// avoid running webpack bootstrap in a potentially hacked environment
// after documentElement was replaced which triggered reinjection of content scripts
const skipReinjectionHeader = `{
  const INIT_FUNC_NAME = '${INIT_FUNC_NAME}';
  if (window[INIT_FUNC_NAME] !== 1)`;
const ownWrappers = (getGlobals) => ({
  header: () => `"use strict"; { ${getGlobals()}`,
  footer: '}',
  test: /^(?!injected|public).*\.js$/,
});

const buildConfig = (page, entry, globalsScope, wrap, init) => {
  const SW = page === 'sw' ? 1 : 0;
  const vars = {
    ...defsObj,
    '__.EXT': SW || !page,
    '__.INJECTED': JSON.stringify(/injected/.test(page) && page),
    '__.SW': SW,
    '__.SW_CLIENT': MV3 && (!page || page === 'offscreen'),
  };
  const config = (entry ? getBaseConfig : getPageConfig)(page);
  config.plugins.push(new webpack.DefinePlugin(vars));
  if (entry) config.entry = { [page]: entry };
  if (init) init(config);
  if (wrap) addWrapperWithGlobals(globalsScope, config, vars, wrap);
  return config;
};

module.exports = [
  buildConfig('', '', 'common', ownWrappers, (config) => {
    if (!MV3) config.plugins.push(new ListBackgroundScriptsPlugin({
      minify: false, // keeping readable
    }));
    config.resolve.alias = {
      ...config.resolve.alias,
      '../css/css$': resolve('src/common/ui/codemirror-ovr/css.js'),
    };
    (config.ignoreWarnings ??= []).push({
      // suppressing a false warning (the HTML spec allows it) as we don't need SSR
      message: /<tr> cannot be child of <table>/,
    });
  }),

  MV3 && buildConfig('sw', './src/background/sw', 'common', ownWrappers),

  MV3 && buildConfig('offscreen', './src/offscreen', 'common', ownWrappers, (config) => {
    const dir = `${config.output.path}/offscreen`;
    config.output.filename = 'offscreen/index.js';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    fs.writeFileSync(`${dir}/index.html`, '<script src=index.js></script>', 'utf8');
  }),

  MV3 && buildConfig('tld', 'tldts', '', null, (config) => {
    config.output.path += '/public/lib';
    config.output.library = {
      type: 'global',
      name: 'tld',
    };
  }),

  buildConfig('injected', './src/injected', 'injected/content', (getGlobals) => ({
    header: () => `${skipReinjectionHeader} { ${getGlobals()}`,
    footer: '}}',
  }), (config) => {
    config.plugins.push(new ProtectWebpackBootstrapPlugin());
  }),

  buildConfig('injected-web', './src/injected/web', 'injected/web', (getGlobals) => ({
    header: () => `${skipReinjectionHeader}
      window[INIT_FUNC_NAME] = function (IS_FIREFOX, ${PAGE_MODE_HANDSHAKE},${VAULT_ID}) {
        const module = { __proto__: null };
        ${getGlobals()}`,
    footer: `
        const { exports } = module;
        return exports.__esModule ? exports.default : exports;
      }};0;`,
  }), (config) => {
    config.output.libraryTarget = 'commonjs2';
    config.plugins.push(new ProtectWebpackBootstrapPlugin());
  }),
].filter(Boolean);
