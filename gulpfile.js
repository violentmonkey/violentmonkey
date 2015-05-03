#!node
var gulp = require('gulp');
var inject = require('gulp-inject');
var less = require('gulp-less');
var minifyCss = require('gulp-minify-css');

gulp.task('inject-html', function() {
	return gulp.src('src/*.html')
		.pipe(inject(
			gulp.src('src/style.less')
				.pipe(less())
				.pipe(minifyCss())
				.pipe(gulp.dest('dist/')),
			{
				name: 'common',
				ignorePath: '/dist/',
				addRootSlash: false,
			}
		))
		.pipe(gulp.dest('dist/'));
});

gulp.task('copy-files',function(){
	return gulp.src([
		'src/*.json',
		'src/*.js',
		'src/_locales/**/*',
		'src/images/*',
		'src/lib/**/*',
		'!src/lib/*',
		'src/mylib/**/*',
	], {base:'src'})
		.pipe(gulp.dest('dist/'));
});

gulp.task('default', ['inject-html', 'copy-files']);
