const del = require('del');
const gulp = require('gulp');
const concat = require('gulp-concat');
const merge2 = require('merge2');
const cssnano = require('gulp-cssnano');
const gulpFilter = require('gulp-filter');
const eslint = require('gulp-eslint');
const uglify = require('gulp-uglify');
const svgSprite = require('gulp-svg-sprite');
const definePack = require('define-commonjs/pack/gulp');
const templateCache = require('./scripts/templateCache');
const i18n = require('./scripts/i18n');
const wrap = require('./scripts/wrap');
const json = require('./scripts/json');
const pkg = require('./package.json');
const isProd = process.env.NODE_ENV === 'production';

const paths = {
  cache: 'src/cache.js',
  manifest: 'src/manifest.json',
  templates: [
    'src/**/*.html',
    '!src/*/index.html',
  ],
  jsCollect: [
    'src/**/*.js',
    '!src/public/**',
    '!src/injected.js',
  ],
  jsCommon: 'src/common.js',
  jsBg: 'src/background/**/*.js',
  jsOptions: 'src/options/**/*.js',
  jsPopup: 'src/popup/**/*.js',
  locales: [
    'src/**/*.js',
    'src/**/*.html',
    'src/**/*.json',
    'src/**/*.yml',
  ],
  copy: [
    'src/injected.js',
    'src/public/**',
    'src/*/*.html',
    'src/*/*.css',
  ],
};

gulp.task('clean', () => del(['dist']));

gulp.task('watch', ['build'], () => {
  gulp.watch([].concat(paths.cache, paths.templates), ['templates']);
  gulp.watch(paths.jsCollect, ['js']);
  gulp.watch(paths.copy, ['copy-files']);
  gulp.watch(paths.locales, ['copy-i18n']);
});

gulp.task('lint', () => (
  gulp.src([
    'src/**/*.js',
    '!src/public/**',
  ])
  .pipe(eslint())
  .pipe(eslint.format())
));

var cacheObj;
var collect;

gulp.task('collect-js', () => {
  collect = definePack();
  return gulp.src(paths.jsCollect)
  .pipe(collect);
});

gulp.task('templates', ['collect-js'], () => {
  cacheObj = templateCache('cache');
  var stream = merge2([
    gulp.src(paths.cache),
    gulp.src(paths.templates).pipe(cacheObj),
  ])
  .pipe(concat('cache.js'))
  .pipe(collect.pack({
    getPath(file) {
      return 'src/cache.js';
    },
  }));
  if (isProd) stream = stream.pipe(uglify());
  return stream.pipe(gulp.dest('dist'));
});

gulp.task('js-common', ['collect-js'], () => {
  var stream = gulp.src(paths.jsCommon)
  .pipe(collect.pack());
  if (isProd) stream = stream.pipe(uglify());
  return stream.pipe(gulp.dest('dist'));
});

gulp.task('js-bg', ['collect-js'], () => {
  var stream = gulp.src(paths.jsBg)
  .pipe(collect.pack({main: 'src/background/app.js'}))
  .pipe(concat('background/app.js'));
  if (isProd) stream = stream.pipe(uglify());
  return stream.pipe(gulp.dest('dist'));
});

gulp.task('js-options', ['templates', 'collect-js'], () => {
  var stream = gulp.src(paths.jsOptions)
  .pipe(cacheObj.replace())
  .pipe(collect.pack({main: 'src/options/app.js'}))
  .pipe(concat('options/app.js'));
  if (isProd) stream = stream.pipe(uglify());
  return stream.pipe(gulp.dest('dist'));
});

gulp.task('js-popup', ['templates', 'collect-js'], () => {
  var stream = gulp.src(paths.jsPopup)
  .pipe(cacheObj.replace())
  .pipe(collect.pack({main: 'src/popup/app.js'}))
  .pipe(concat('popup/app.js'));
  if (isProd) stream = stream.pipe(uglify());
  return stream.pipe(gulp.dest('dist'))
});

gulp.task('js', [
  'js-common',
  'js-bg',
  'js-options',
  'js-popup',
]);

gulp.task('manifest', () => (
  gulp.src(paths.manifest, {base: 'src'})
  .pipe(json(data => {
    data.version = pkg.version;
    return data;
  }))
  .pipe(gulp.dest('dist'))
));

gulp.task('copy-files', () => {
  const injectedFilter = gulpFilter(['**/injected.js'], {restore: true});
  const jsFilter = gulpFilter(['**/*.js'], {restore: true});
  const cssFilter = gulpFilter(['**/*.css'], {restore: true});
  var stream = gulp.src(paths.copy)
  .pipe(injectedFilter)
  .pipe(wrap({
    header: '!function(){\n',
    footer: '\n}();',
  }))
  .pipe(injectedFilter.restore);
  if (isProd) stream = stream
  .pipe(jsFilter)
  .pipe(uglify())
  .pipe(jsFilter.restore);
  stream = stream
  .pipe(cssFilter)
  .pipe(cssnano({
    zindex: false,
  }))
  .pipe(cssFilter.restore)
  .pipe(gulp.dest('dist/'));
});

gulp.task('copy-i18n', () => (
  gulp.src(paths.locales)
  .pipe(i18n.extract({
    base: 'src',
    prefix: '_locales',
    touchedOnly: true,
    useDefaultLang: true,
    markUntouched: false,
    extension: '.json',
  }))
  .pipe(gulp.dest('dist'))
));

gulp.task('svg', () => (
  gulp.src('icons/*.svg')
  .pipe(svgSprite({
    mode: {
      symbol: {
        dest: '',
        sprite: 'sprite.svg',
      },
    },
  }))
  .pipe(gulp.dest('dist/images'))
));

gulp.task('build', [
  'js',
  'manifest',
  'copy-files',
  'copy-i18n',
  'svg',
]);

gulp.task('i18n', () => (
  gulp.src(paths.locales)
  .pipe(i18n.extract({
    base: 'src',
    prefix: '_locales',
    touchedOnly: false,
    useDefaultLang: false,
    markUntouched: true,
    extension: '.yml',
  }))
  .pipe(gulp.dest('src'))
));

gulp.task('default', ['build']);
