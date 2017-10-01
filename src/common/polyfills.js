import 'core-js/fn/object/assign';
import 'core-js/fn/object/values';
import 'core-js/fn/array/includes';
import 'core-js/fn/array/find';
import 'core-js/fn/array/find-index';
import 'core-js/fn/string/includes';
import 'core-js/fn/string/starts-with';
import 'core-js/fn/string/ends-with';

// Must use native Promise for Firefox to work
// import 'core-js/fn/promise';

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
