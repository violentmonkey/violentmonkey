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


/** Header names as written in `// @…` lines, for editor autocomplete. */
export const USERSCRIPT_META_HEADERS = [
  ...Object.keys(metaTypes),
  ...Object.keys(metaOptionalTypes),
  // other props
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
]
  .map(prop => prop.replace(/[A-Z](?=[a-z])/g, s => '-' + s.toLowerCase()))
  .sort((a, b) => a.localeCompare(b));
