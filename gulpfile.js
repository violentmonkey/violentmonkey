const gulp = require('gulp');
const concat = require('gulp-concat');
const replace = require('gulp-replace');
const merge2 = require('merge2');
const cssnano = require('gulp-cssnano');
const gulpFilter = require('gulp-filter');
const order = require('gulp-order');
const del = require('del');
const templateCache = require('./scripts/templateCache');
const i18n = require('./scripts/i18n');
const pkg = require('./package.json');

const paths = {
  cache: 'src/cache.js',
  manifest: 'src/manifest.json',
  templates: 'src/**/templates/*.html',
  jsBg: 'src/background/**/*.js',
  jsOptions: 'src/options/**/*.js',
  jsPopup: 'src/popup/**/*.js',
  locales: [
    'src/**/*.js',
    'src/**/*.html',
    'src/**/*.json',
  ],
  copy: [
    'src/*.js',
    '!src/cache.js',
    'src/public/**',
    'src/*/*.html',
    'src/*/*.css',
  ],
};

gulp.task('watch', () => {
  gulp.watch([].concat(paths.cache, paths.templates), ['templates']);
  gulp.watch(paths.jsBg, ['js-bg']);
  gulp.watch(paths.jsOptions, ['js-options']);
  gulp.watch(paths.jsPopup, ['js-popup']);
  gulp.watch(paths.copy, ['copy-files']);
  gulp.watch(paths.locales, ['copy-i18n']);
});

gulp.task('templates', () => (
  merge2([
    gulp.src(paths.cache),
    gulp.src(paths.templates).pipe(templateCache()),
  ]).pipe(concat('cache.js'))
  .pipe(gulp.dest('dist'))
));

gulp.task('js-bg', () => (
  gulp.src(paths.jsBg)
  .pipe(concat('background/app.js'))
  .pipe(gulp.dest('dist'))
));

gulp.task('js-options', () => (
  gulp.src(paths.jsOptions)
  .pipe(order([
    '**/tab-*.js',
    '!**/app.js',
  ]))
  .pipe(concat('options/app.js'))
  .pipe(gulp.dest('dist'))
));

gulp.task('js-popup', () => (
  gulp.src(paths.jsPopup)
  .pipe(order([
    '**/base.js',
    '!**/app.js',
  ]))
  .pipe(concat('popup/app.js'))
  .pipe(gulp.dest('dist'))
))

gulp.task('manifest', () => (
  gulp.src(paths.manifest, {base: 'src'})
  .pipe(replace('__VERSION__', pkg.version))
  .pipe(gulp.dest('dist'))
));

gulp.task('copy-files', () => {
  const cssFilter = gulpFilter(['**/*.css'], {restore: true});
  return gulp.src(paths.copy)
  .pipe(cssFilter)
  .pipe(cssnano())
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
  }))
  .pipe(gulp.dest('dist'))
));

gulp.task('build', [
  'templates',
  'js-bg',
  'js-options',
  'js-popup',
  'manifest',
  'copy-files',
  'copy-i18n',
]);

gulp.task('i18n', () => (
  gulp.src(paths.locales)
  .pipe(i18n.extract({
    base: 'src',
    prefix: '_locales',
    touchedOnly: false,
    useDefaultLang: false,
    markUntouched: true,
  }))
  .pipe(gulp.dest('src'))
));

gulp.task('default', ['build']);
