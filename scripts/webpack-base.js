const { resolve } = require('path');
const InlineConstantExportsPlugin = require('@automattic/webpack-inline-constant-exports-plugin');
const escapeStringRegexp = require('escape-string-regexp').default;
const { alias, extensions, isProd, DIST } = require('./common');
const { getBrowserTargets } = require('./manifest-helper');
const minimizer = isProd && require('./webpack-minimizer');

const PUBLIC_LIB = '/public/lib';
const sharedPlugins = [
  new InlineConstantExportsPlugin([
    RegExp(`/(${[
      'consts.js',
      'consts-sync.js',
      'utils/dnr.js',
      'utils/on-installed.js',
      'utils/storage.js',
    ].map(escapeStringRegexp).join('|')
    })$`.replaceAll('/', String.raw`[/\\]`)),
  ]),
];
/** @param {Array<string|RegExp>} items */
const makePathTester = items => RegExp(
  items.map(re => re.source || re).join('|').replace(/\\?\//g, '[/\\\\]')
);

const getBaseConfig = (page) => /** @type {import('webpack/types').Configuration} */({
  mode: isProd ? 'production' : 'development',
  target: 'browserslist:' + getBrowserTargets(),
  devtool: isProd ? false : page.startsWith('injected') ? 'inline-source-map' : 'source-map',
  experiments: { css: !page, html: !page },
  infrastructureLogging: {
    progress: 'auto',
  },
  output: {
    path: resolve(DIST),
    publicPath: '/',
    filename: '[name].js',
    cssFilename: '[name].css',
    htmlFilename: data => `${data.filename}.html`,
    hashFunction: 'xxhash64',
    html: !page && /** @type {import('webpack/types').Configuration['output']['html']} */({
      meta: {
        charset: 'utf-8',
        viewport: 'width=device-width,initial-scale=1.0,minimum-scale=1.0,maximum-scale=1.0'
      },
      title: 'Violentmonkey',
      scriptLoading: 'blocking', // we don't need `defer` and it breaks in some browsers, see #1632
      inject: 'head', // index.js will be moved to 'body' by GroupAssetsPlugin
    }),
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
          !/vueleton|@vue[/\\]shared|@usync|@violentmonkey/.test(file),
      },
      // CSS including .module.css
      {
        include: [resolve('src')],
        test: /\.css$/,
        type: 'css/auto',
        loader: 'postcss-loader',
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
          experimentalInlineMatchResource: true,
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
    concatenateModules: true, // makes output simpler and closer to prod in debugging
    inlineExports: true, // to match prod in dev
    runtimeChunk: false,
    splitChunks: !page &&
    /** @type {import('webpack/types').Configuration['optimization']['splitChunks']} */
    ({
      cacheGroups: {
        codemirror: {
          name: PUBLIC_LIB.slice(1) + '/codemirror',
          test: makePathTester([
            '/codemirror',
            '/src/common/ui/code.*css$',
          ]),
          chunks: 'all',
          enforce: true,
          priority: 100,
        },
        'common-ui': {
          name: 'common-ui',
          test: makePathTester([
            /\bsvg/,
            '/src/common/(?!zip|router|.*cron)',
            '/@violentmonkey/shortcut',
            '/@?vue',
          ]),
          chunks: 'all',
          enforce: true,
        },
      },
    }),
    minimize: isProd,
    minimizeOptions: {
      css: {
        charset: false, // we have one in html so it's applied to sub-resources
        comments: false,
        reorderDeclarations: false, // for easier debugging without sourcemaps
      },
      html: {
        collapseWhitespace: true,
      },
      javascript: false, // we use Terser
    },
    minimizer: minimizer || [],
  },
  plugins: [
    ...sharedPlugins,
    // new (require('webpack-bundle-analyzer').BundleAnalyzerPlugin)({
    //   analyzerMode: 'static',
    //   openAnalyzer: false,
    //   reportFilename: `.report${page ? '-' + page : ''}.html`,
    // }),
  ],
});

exports.getBaseConfig = getBaseConfig;
exports.PUBLIC_LIB = PUBLIC_LIB;
