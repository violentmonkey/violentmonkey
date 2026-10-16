import { HOMEPAGE_URL, SUPPORT_URL, TL_AWAIT, UNWRAP, kTag } from '@/common/consts';

const arrayType = {
  default: () => [],
  transform: (res, val) => {
    res.push(val);
    return res;
  },
};
const booleanType = {
  default: () => false,
  transform: () => true,
};
export const defaultMetaType = {
  default: () => null,
  transform: (res, val) => (res == null ? val : res),
};

export const metaTypes = {
  include: arrayType,
  exclude: arrayType,
  match: arrayType,
  excludeMatch: arrayType,
  require: arrayType,
  resource: {
    default: () => ({}),
    transform: (res, val) => {
      const pair = val.match(/^(\w\S*)\s+(.*)/);
      if (pair) res[pair[1]] = pair[2];
      return res;
    },
  },
  grant: arrayType,
};

export const metaOptionalTypes = {
  antifeature: arrayType,
  compatible: arrayType,
  connect: arrayType,
  noframes: booleanType,
  [kTag]: arrayType,
  [TL_AWAIT]: booleanType,
  [UNWRAP]: booleanType,
};

const metaOtherProps = [
  'author',
  'description',
  'downloadURL',
  'icon',
  'injectInto',
  'name',
  'namespace',
  'runAt',
  'updateURL',
  'version',
  HOMEPAGE_URL,
  SUPPORT_URL,
];

/** `@` header when it differs from the internal camelCase property name. */
const metaPropToHeader = {
  excludeMatch: 'exclude-match',
  injectInto: 'inject-into',
  runAt: 'run-at',
  [TL_AWAIT]: 'top-level-await',
};

// properties that are not particularly important/documented
const uncommonHeaders = new Set(['antifeature', 'compatible', 'connect']);

/** Header names as written in `// @…` lines, for editor autocomplete. */
export const USERSCRIPT_META_HEADERS = [
  ...Object.keys(metaTypes),
  ...Object.keys(metaOptionalTypes),
  ...metaOtherProps,
]
  .map((prop) => metaPropToHeader[prop] ?? prop)
  .sort((a, b) => {
    const aLast = uncommonHeaders.has(a);
    const bLast = uncommonHeaders.has(b);
    if (aLast !== bLast) return aLast ? 1 : -1;
    return a.localeCompare(b);
  });
