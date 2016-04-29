const gulp = require('gulp');
const concat = require('gulp-concat');
const replace = require('gulp-replace');
const merge2 = require('merge2');
const cssnano = require('gulp-cssnano');
const gulpFilter = require('gulp-filter');
const order = require('gulp-order');
const eslint = require('gulp-eslint');
const uglify = require('gulp-uglify');
const templateCache = require('./scripts/templateCache');
const i18n = require('./scripts/i18n');
const pkg = require('./package.json');
const isProd = process.env.NODE_ENV === 'production';

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
    'src/**/*.yml',
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

gulp.task('eslint', () => (
  gulp.src([
    'src/**/*.js',
    '!src/public/**',
  ])
  .pipe(eslint())
  .pipe(eslint.format())
));

gulp.task('templates', () => {
  var stream = merge2([
    gulp.src(paths.templates).pipe(templateCache()),
    gulp.src(paths.cache),
  ])
  .pipe(concat('cache.js'));
  if (isProd) stream = stream.pipe(uglify());
  return stream.pipe(gulp.dest('dist'));
});

gulp.task('js-bg', () => {
  var stream = gulp.src(paths.jsBg)
  .pipe(order([
    '**/utils.js',
    '!**/app.js',
  ]))
  .pipe(concat('background/app.js'));
  if (isProd) stream = stream.pipe(uglify());
  return stream.pipe(gulp.dest('dist'));
});

gulp.task('js-options', () => {
  var stream = gulp.src(paths.jsOptions)
  .pipe(order([
    '**/tab-*.js',
    '!**/app.js',
  ]))
  .pipe(concat('options/app.js'));
  if (isProd) stream = stream.pipe(uglify());
  return stream.pipe(gulp.dest('dist'));
});

gulp.task('js-popup', () => {
  var stream = gulp.src(paths.jsPopup)
  .pipe(order([
    '**/base.js',
    '!**/app.js',
  ]))
  .pipe(concat('popup/app.js'));
  if (isProd) stream = stream.pipe(uglify());
  return stream.pipe(gulp.dest('dist'))
});

gulp.task('manifest', () => (
  gulp.src(paths.manifest, {base: 'src'})
  .pipe(replace('__VERSION__', pkg.version))
  .pipe(gulp.dest('dist'))
));

gulp.task('copy-files', () => {
  const jsFilter = gulpFilter(['**/*.js'], {restore: true});
  const cssFilter = gulpFilter(['**/*.css'], {restore: true});
  return gulp.src(paths.copy)
  .pipe(jsFilter)
  .pipe(uglify())
  .pipe(jsFilter.restore)
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
    extension: '.yml',
  }))
  .pipe(gulp.dest('src'))
));

gulp.task('default', ['build']);
