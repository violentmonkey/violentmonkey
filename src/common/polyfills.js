// import 'core-js/features/object/assign'; // Chrome >= 45, Firefox >= 34
// import 'core-js/features/object/values'; // Chrome >= 54, Firefox >= 47
// import 'core-js/features/array/includes'; // Chrome >= 47, Firefox >= 43
// import 'core-js/features/array/find'; // Chrome >= 45, Firefox >= 25
// import 'core-js/features/array/find-index'; // Chrome >= 45, Firefox >= 25
// import 'core-js/features/string/includes'; // Chrome >= 41, Firefox >= 40
// import 'core-js/features/string/starts-with'; // Chrome >= 41, Firefox >= 17
// import 'core-js/features/string/ends-with'; // Chrome >= 41, Firefox >= 17
// import 'core-js/features/string/repeat'; // Chrome >= 41, Firefox >= 24

// Must use native Promise for Firefox to work
// import 'core-js/features/promise';

// function polyfill(obj, name, value) {
//   if (!obj[name]) {
//     Object.defineProperty(obj, name, { value });
//   }
// }
//
// polyfill(Object, 'assign', (obj, ...args) => {
//   args.forEach(arg => arg && Object.keys(arg).forEach((key) => {
//     obj[key] = arg[key];
//   }));
//   return obj;
// });
//
// polyfill(String.prototype, 'startsWith', function startsWith(str) {
//   return this.slice(0, str.length) === str;
// });
//
// polyfill(String.prototype, 'endsWith', function endsWith(str) {
//   return this.slice(-str.length) === str;
// });
//
// polyfill(String.prototype, 'includes', function includes(str) {
//   return this.indexOf(str) >= 0;
// });
//
// polyfill(Array.prototype, 'findIndex', function findIndex(predicate) {
//   let index = -1;
//   this.some((item, i, thisObj) => {
//     if (predicate(item, i, thisObj)) {
//       index = i;
//       return true;
//     }
//   });
//   return index;
// });
//
// polyfill(Array.prototype, 'find', function find(predicate) {
//   return this[this.findIndex(predicate)];
// });
//
// polyfill(Array.prototype, 'includes', function includes(item) {
//   return this.indexOf(item) >= 0;
// });
