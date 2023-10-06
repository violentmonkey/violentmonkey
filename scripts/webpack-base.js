const { resolve } = require('path');
const { VueLoaderPlugin } = require('vue-loader');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const CssMinimizerPlugin = require('css-minimizer-webpack-plugin');
const TerserPlugin = require('terser-webpack-plugin');
const deepmerge = require('deepmerge');
const GroupAssetsPlugin = require('./webpack-group-assets-plugin');
const { alias, extensions, isProd } = require('./common');

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
  'background',
  'confirm',
  'options',
  'popup',
];
const createHtmlPage = key => new HtmlWebpackPlugin({
  ...defaultHtmlOptions,
  filename: `${key}/index.html`,
  chunks: [`${key}/index`],
  title: 'Violentmonkey',
  scriptLoading: 'blocking', // we don't need `defer` and it breaks in some browsers, see #1632
  // For GroupAssetsPlugin, inject only `index.js` into `body` to avoid FOUC
  injectTo: item => ((item.attributes.src || '').endsWith('/index.js') ? 'body' : 'head'),
});

const splitVendor = prefix => ({
  [prefix]: {
    test: new RegExp(`node_modules[/\\\\]${prefix}`),
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

const getBaseConfig = () => ({
  mode: isProd ? 'production' : 'development',
  target: 'web', // required by live reloading
  devtool: isProd ? false : 'inline-source-map',
  output: {
    path: resolve('dist'),
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
        use: 'babel-loader',
        exclude: file => /node_modules/.test(file) && !/vueleton|@vue[/\\]shared/.test(file),
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
    ],
  },
  optimization: {
    runtimeChunk: false,
    splitChunks: {
      cacheGroups: {
        'common-ui': {
          name: 'common-ui',
          test: new RegExp([
            /\bsvg/,
            // don't extract CSS as it'll change the relative order of rules which breaks appearance
            'src/common/(?!zip|.*\\.css$)',
            'node_modules/@violentmonkey/shortcut',
            'node_modules/@?vue',
          ].map(re => re.source || re).join('|').replace(/\\?\//g, '[/\\\\]')),
          chunks: c => ![
            'background/index', // only 4kB of common code
            'injected',
            'injected-web',
          ].includes(c.name),
        },
        ...splitVendor('codemirror'),
      },
    },
    minimizer: isProd ? [
      new CssMinimizerPlugin(),
      new TerserPlugin(MIN_OPTS_PUBLIC),
      new TerserPlugin(MIN_OPTS_MAIN),
    ] : [],
  },
  plugins: [
    new VueLoaderPlugin(),
    new GroupAssetsPlugin(),
    ...styleOptions.extract ? [new MiniCssExtractPlugin({
      filename: '[name].css',
    })] : [],
  ],
});

const getPageConfig = () => {
  const config = getBaseConfig();
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
