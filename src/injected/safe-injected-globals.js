/* eslint-disable no-unused-vars */

// Not exporting the built-in globals because this also runs in node
const { CustomEvent, Error, dispatchEvent } = global;
export const Prototype = 'prototype';
export const { createElementNS, getElementsByTagName } = document;
export const { then } = Promise[Prototype];
export const { filter, forEach, includes, indexOf, join, map, push } = [];
export const { charCodeAt, slice, replace } = '';
export const { append, appendChild, remove, setAttribute } = Element[Prototype];
export const { toString: objectToString } = {};
export const {
  assign,
  defineProperty,
  getOwnPropertyDescriptor: describeProperty,
  entries: objectEntries,
  keys: objectKeys,
  values: objectValues,
} = Object;
export const { parse: jsonParse } = JSON;
// Using __proto__ because Object.create(null) may be spoofed
export const createNullObj = () => ({ __proto__: null });
