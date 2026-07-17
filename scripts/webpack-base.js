const { resolve } = require('path');
const { VueLoaderPlugin } = require('vue-loader');
const webpack = require('webpack');
const progressBarPlugin = require('progress-bar-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const CssMinimizerPlugin = require('css-minimizer-webpack-plugin');
const InlineConstantExportsPlugin = require('@automattic/webpack-inline-constant-exports-plugin');
const TerserPlugin = require('terser-webpack-plugin');
const deepmerge = require('deepmerge');
const escapeStringRegexp = require('escape-string-regexp').default;
const GroupAssetsPlugin = require('./webpack-group-assets-plugin');
const { alias, extensions, isProd, MV3, DIST } = require('./common');

const defaultHtmlOptions = {
  minify: isProd && {
    collapseWhitespace: true,
    removeAttributeQuotes: true,
    removeComments: true,
    removeOptionalTags: true,
    removeRedundantAttributes: true,
    removeScriptTypeAttributes: true,
    removeStyleLinkTypeAttributes: true,
  },
  meta: { viewport: 'width=device-width,initial-scale=1.0,minimum-scale=1.0,maximum-scale=1.0' },
};
const MIN_OPTS = {
  extractComments: false,
  parallel: true,
  terserOptions: {
    compress: {
      // `terser` often inlines big one-time functions inside a small "hot" function
      reduce_funcs: false,
    },
    output: {
      ascii_only: true,
      comments: false,
      wrap_func_args: false, // disabling a premature optimization designed for old browsers
    },
  },
};
const MIN_OPTS_PUBLIC = isProd && {
  include: 'public/',
  ...MIN_OPTS,
};
const MIN_OPTS_MAIN = isProd && deepmerge.all([{}, MIN_OPTS, {
  exclude: 'public/',
  terserOptions: {
    compress: {
      ecma: 8, // ES2017 Object.entries and so on
      passes: 2, // necessary now since we removed plaid's minimizer
      unsafe_arrows: true, // it's 'safe' since we don't rely on function prototypes
    },
  },
}]);
const nodeModules = resolve('node_modules');

const pages = [
  !MV3 && 'background',
  'confirm',
  'options',
  'popup',
].filter(Boolean);
const createHtmlPage = key => new HtmlWebpackPlugin({
  ...defaultHtmlOptions,
  filename: `${key}/index.html`,
  chunks: [`${key}/index`],
  title: 'Violentmonkey',
  scriptLoading: 'blocking', // we don't need `defer` and it breaks in some browsers, see #1632
  inject: false,
  // For GroupAssetsPlugin, inject only `index.js` into `body` to avoid FOUC
  injectTo: item => ((item.attributes.src || '').endsWith('/index.js') ? 'body' : 'head'),
  templateContent: ({ htmlWebpackPlugin: { tags: { headTags: head, bodyTags: body } } }) =>
    `<!DOCTYPE html><meta charset=utf-8><script src=/get-data.js?${key}></script>${head}<body>${body}</body>`,
});

const splitVendor = prefix => ({
  [prefix]: {
    test: new RegExp('[\\\\/]' + prefix),
    name: `public/lib/${prefix}`,
    chunks: 'all',
    priority: 100,
  },
});

function styleLoader(options) {
  const {
    extract,
    loaders = [],
    fallback = 'style-loader',
    modules = false,
  } = options || {};
  const cssLoader = {
    loader: 'css-loader',
    options: {
      modules,
      importLoaders: 1,
      sourceMap: false,
    },
  };
  return [
    extract ? MiniCssExtractPlugin.loader : fallback,
    cssLoader,
    ...loaders,
  ];
}

function styleRule(options, rule) {
  return {
    test: /\.css$/,
    use: styleLoader(options),
    ...rule,
  };
}

const styleOptions = {
  extract: isProd,
};
const postcssLoader = {
  loader: 'postcss-loader',
};
const getBaseConfig = (page) => ({
  mode: isProd ? 'production' : 'development',
  target: 'web', // required by live reloading
  devtool: isProd ? false : page.startsWith('injected') ? 'inline-source-map' : 'source-map',
  output: {
    path: resolve(DIST),
    publicPath: '/',
    filename: '[name].js',
    hashFunction: 'xxhash64',
  },
  node: {
    global: false,
  },
  performance: {
    maxEntrypointSize: 1e6,
    maxAssetSize: 0.5e6,
  },
  resolve: {
    alias,
    extensions,
  },
  module: {
    rules: [
      // JS/TS
      {
        test: /\.m?[jt]sx?$/,
        loader: 'babel-loader',
        exclude: file => /node_modules/.test(file) &&
          !/vueleton|@vue[/\\]shared|@usync/.test(file),
      },
      // CSS
      {
        oneOf: [
          // library CSS files: node_modules/**/*.css
          styleRule(styleOptions, {
            include: [nodeModules],
          }),
          // CSS modules: src/**/*.module.css
          styleRule({
            ...styleOptions,
            loaders: [postcssLoader],
            modules: {},
          }, {
            test: /\.module\.css$/,
          }),
          // normal CSS files: src/**/*.css
          styleRule({
            ...styleOptions,
            loaders: [postcssLoader],
          }),
        ],
      },
      // SVG
      {
        test: /\.svg$/,
        use: [{
          loader: 'svg-sprite-loader',
          options: {
            // extract: extractSVG,
          },
        }],
        include: [resolve('src/resources/svg')],
      },
      // Vue
      {
        test: /\.vue$/,
        loader: 'vue-loader',
        options: {
          babelParserPlugins: ['functionBind'],
          compilerOptions: {
            whitespace: 'condense',
          },
        },
      },
      // Patch fflate to expose file timestamp
      {
        test: /fflate/,
        loader: 'string-replace-loader',
        options: {
          search: / size: sc,/g,
          replace: '$& time: b4(data,o+12),',
          strict: true,
        }
      },
    ],
  },
  optimization: {
    runtimeChunk: false,
    splitChunks: !page && {
      cacheGroups: {
        'common-ui': {
          name: 'common-ui',
          test: new RegExp([
            /\bsvg/,
            // don't extract CSS as it'll change the relative order of rules which breaks appearance
            'src/common/(?!zip|.*\\.css$)',
            '@violentmonkey/shortcut',
            '/@?vue',
          ].map(re => re.source || re).join('|').replace(/\\?\//g, '[/\\\\]')),
          chunks: c => ![
            'background/index', // only 4kB of common code
          ].includes(c.name),
        },
        ...splitVendor('codemirror'),
      },
    },
    minimizer: isProd ? [
      !page && new CssMinimizerPlugin(),
      new TerserPlugin(MIN_OPTS_PUBLIC),
      new TerserPlugin(MIN_OPTS_MAIN),
    ].filter(Boolean) : [],
  },
  plugins: [
    page === 'sw' && MV3 && new webpack.NormalModuleReplacementPlugin(/\/common\/tld$/, (r) => {
      r.request += '-mv3';
    }),
    !process.env.GITHUB_ACTIONS && new progressBarPlugin({
      format: '[:bar] :percent (:elapsed seconds), :msg',
      summary: false,
    }),
    !page && new VueLoaderPlugin(),
    !page && new GroupAssetsPlugin(),
    !page && styleOptions.extract && new MiniCssExtractPlugin({
      filename: '[name].css',
    }),
    !page && require('unplugin-icons/webpack')(),
    new InlineConstantExportsPlugin([
      RegExp(`/(${[
        'consts.js',
        'consts-sync.js',
        'utils/dnr.js',
        'utils/on-installed.js',
        'utils/storage.js',
      ].map(escapeStringRegexp).join('|')
      })$`.replaceAll('/', String.raw`[/\\]`)),
    ])
  ].filter(Boolean),
});

const getPageConfig = (...args) => {
  const config = getBaseConfig(...args);
  config.entry = Object.fromEntries(pages.map(name => [`${name}/index`, `./src/${name}`]));
  config.plugins = [
    ...config.plugins,
    ...pages.filter(key => key !== 'background').map(createHtmlPage),
  ];
  return config;
};

exports.isProd = isProd;
exports.getBaseConfig = getBaseConfig;
exports.getPageConfig = getPageConfig;
