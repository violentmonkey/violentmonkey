/**
 * Modernized CSS mode from CodeMirror 5 modified by tophf for Stylus:
 * https://github.com/openstyles/stylus/blob/v2.3.18/src/cm/css.js
 * CodeMirror, copyright (c) by Marijn Haverbeke and others
 * Distributed under an MIT license: https://codemirror.net/5/LICENSE
 * Modded by Stylus Team: switched to charCodeAt, Set, unicode in ids, keywords from csslint-mod
 */
/* eslint-disable no-shadow,one-var,one-var-declaration-per-line,prefer-const */
import CodeMirror from 'codemirror';
import * as cssData from './css-data';

const rxColon = /(?:\s+|\/\*(?:[^*]+|\*(?!\/))*(?:\*\/|$))*:/y;
const rxDocFunc = /(?:url(?:-prefix)?|domain|regexp)\(\s*(['")])?/iy;
const rxHexColor = /#[\da-f]{3}(?:[\da-f](?:[\da-f]{2}(?:[\da-f]{2})?)?)?/yi;
const rxNumberDigit = /\d*(?:\.\d*)?(?:e[-+]\d+)?(?:\w+|%)?/y;
const rxNumberDot = /\d+(?:e[-+]\d+)?(?:\w+|%)?/y;
const rxNumberSign = /(?:\d+(?:\.\d*)?|\.?\d+)(?:e[-+]\d+)?(?:\w+|%)?/y;
const rxSpace = /[\s\u00a0]+/y;
const rxSpaceRParenEOL = /[\s\u00a0]*(?=\)|$)/y;
/** [1] = whether the comment is closed */
const rxCommentTail = /(?:[^*]+|\*(?!\/))*(\*\/|$)/y;
const rxStringDoubleQ = /\s*(?:[^\\"]+|\\(?:[0-9a-fA-F]{1,6}\s?|.|$))*/y;
const rxStringSingleQ = /\s*(?:[^\\']+|\\(?:[0-9a-fA-F]{1,6}\s?|.|$))*/y;
const rxUniAny = /[-\w\\\u00A1-\uFFFF]*/y;
const rxUniVar = /-[-\w\\\u00A1-\uFFFF]*/y;
const rxUniClass = /-?[_a-zA-Z\\\u00A1-\uFFFF][-\w\\\u00A1-\uFFFF]*/y;
const rxUnquotedUrl = /\s*(?:[^()\s\\'"]+|\\(?:[0-9a-fA-F]{1,6}\s?|.|$))*\s*/y;
const rxUnquotedBadUrl = /(?:[^)\\]|\\[^)])+/y;
/**
 * @param {CodeMirror.StringStream} stream
 * @param {RegExp} rx - must be sticky
 * @param {boolean} [consume]
 * @return {boolean}
 */
const stickyMatch = (stream, rx, consume = true) => {
  rx.lastIndex = stream.pos;
  return rx.test(stream.string) && (consume && (stream.pos = rx.lastIndex), true);
};

let tokenStringDouble, tokenStringSingle, tokenUrl, tokenUrlEnd, tokenBadUrl;

// TODO: patch `eatWhile` and `match` + use WeakMap for converted non-sticky regexps
CodeMirror.StringStream.prototype.eatSpace = function () {
  rxSpace.lastIndex = this.pos;
  return rxSpace.test(this.string) && !!(this.pos = rxSpace.lastIndex);
};

CodeMirror.defineMode('css', function (config, parserConfig) {
  const inline = parserConfig.inline;
  if (!parserConfig.propertyKeywords) parserConfig = CodeMirror.resolveMode('text/css');

  const indentUnit = config.indentUnit,
    tokenHooks = parserConfig.tokenHooks,
    documentTypes = parserConfig.documentTypes || new Set(),
    mediaTypes = parserConfig.mediaTypes || new Set(),
    mediaFeatures = parserConfig.mediaFeatures || new Set(),
    mediaValueKeywords = parserConfig.mediaValueKeywords || new Set(),
    propertyKeywords = parserConfig.propertyKeywords || new Set(),
    nonStandardPropertyKeywords = parserConfig.nonStandardPropertyKeywords || new Set(),
    fontProperties = parserConfig.fontProperties || new Set(),
    counterDescriptors = parserConfig.counterDescriptors || new Set(),
    colorKeywords = parserConfig.colorKeywords || new Set(),
    valueKeywords = parserConfig.valueKeywords || new Set(),
    allowNested = parserConfig.allowNested,
    lineComment = parserConfig.lineComment,
    supportsAtComponent = parserConfig.supportsAtComponent === true,
    highlightNonStandardPropertyKeywords = config.highlightNonStandardPropertyKeywords !== false;

  let type, override;

  // Tokenizers

  /**
   * @param {CodeMirror.StringStream} stream
   * @param {CodeMirror.CSS.State} state
   */
  function tokenBase(stream, state) {
    let res;
    const str = stream.string;
    const c = str.charCodeAt(stream.pos);
    const pos = stream.pos += c != null;
    if (tokenHooks[c]) {
      res = tokenHooks[c](stream, state);
      if (res === false) res = null;
    } else if (c === 64/* @ */ && stickyMatch(stream, /[-\w\\]+/y)) {
      res = 'def';
      type = stream.current().toLowerCase();
    } else if (c === 61/* = */
    || (c === 126/* ~ */ || c === 124/* | */ || c === 42/* * */ || c === 36/* $ */)
    && str.charCodeAt(pos) === 61/* = */ && stream.pos++) {
      type = 'compare';
    } else if (
      c === 34/* " */ ? res = tokenStringDouble ??= tokenString.bind(rxStringDoubleQ, c)
        : c === 39/* ' */ && (res = tokenStringSingle ??= tokenString.bind(rxStringSingleQ, c))) {
      state.tokenize = res;
      return state.tokenize(stream, state);
    } else if (c === 35/* # */) {
      stickyMatch(stream, rxUniAny);
      res = 'atom';
      type = 'hash';
    } else if (c === 33/* ! */) {
      stickyMatch(stream, /\s*\w*/y);
      res = 'keyword';
      type = 'important';
    } else if (c === 46/* . */ ? stickyMatch(stream, rxNumberDot)
      : c === 43/* + */ || c === 45/* - */ ? stickyMatch(stream, rxNumberSign)
      : c >= 48 && c <= 57 /* 0-9 */ && stickyMatch(stream, rxNumberDigit)) {
      res = 'number';
      type = 'unit';
    } else if (c === 45/* - */) {
      if (stickyMatch(stream, rxUniVar)) {
        res = 'variable-2';
        type = stickyMatch(stream, rxColon, false) ? 'variable-definition' : 'variable';
      } else if (stickyMatch(stream, /\w+-/y)) {
        res = type = 'meta';
      } else {
        type = null;
      }
    } else if (c === 44/* , */ || c === 43/* + */ || c === 62/* > */ || c === 47/* / */) {
      type = 'select-op';
    } else if (c === 46/* . */ && stickyMatch(stream, rxUniClass)) {
      res = type = 'qualifier';
    } else if (c === 58/* : */ || c === 59/* ; */ || c === 123/* { */ || c === 125/* } */
    || c === 91/* [ */ || c === 93/* ] */ || c === 40/* ( */ || c === 41/* ) */) {
      type = String.fromCharCode(c);
    } else if (c === 45/* - */ || c === 92/* \ */ || c >= 48 && c <= 57 /* 0-9 */ || c === 95/* _ */
    || c >= 65 && c <= 90/* A-Z */ || c >= 97 && c <= 122/* a-z */ || c > 160/* Unicode */) {
      stickyMatch(stream, rxUniAny);
      if (str.charCodeAt(res = stream.pos) === 40/* ( */) {
        res -= pos - 1;
        if ((
          res === 6 ? /*domain*/c === 100 || c === 68 || /*regexp*/c === 114 || c === 82
          : res === 3 /*url*/ || res === 10 /*url-prefix*/ && (c === 117 || c === 85)
        ) && (
          rxDocFunc.lastIndex = pos - 1,
          (res = rxDocFunc.exec(str)) && !res[1]
        )) state.tokenize = tokenParenthesized;
        res = 'variable callee';
        type = 'variable';
      } else {
        res = 'property';
        type = 'word';
      }
    } else {
      type = null;
    }
    return res;
  }

  /**
   * @this {RegExp}
   * @param {number} quote - bound param
   * @param {CodeMirror.StringStream} stream
   * @param {CodeMirror.CSS.State} state
   */
  function tokenString(quote, stream, state) {
    type = !stickyMatch(stream, this) || this === rxUnquotedBadUrl ? 'error' : 'string';
    const next = stream.string.charCodeAt(stream.pos);
    if (next === quote) {
      stream.pos += quote !== 41/* ) */;
      state.tokenize = null;
    } else if (next) {
      state.tokenize = quote === 41
        ? tokenBadUrl ??= tokenString.bind(rxUnquotedBadUrl, 41/* ) */)
        : (type = 'error', null);
    } else if (quote === 41) {
      state.tokenize = tokenUrlEnd ??= tokenString.bind(rxSpaceRParenEOL, 41/* ) */);
    } else if (stream.string.charCodeAt(stream.pos - 1) !== 92/* \ */) {
      type = 'error';
      state.tokenize = null;
    }
    return type;
  }

  /**
   * @param {CodeMirror.StringStream} stream
   * @param {CodeMirror.CSS.State} state
   */
  function tokenParenthesized(stream, state) {
    stream.pos++; // Must be '('
    state.tokenize = tokenUrl ??= tokenString.bind(rxUnquotedUrl, 41/* ) */);
    type = '(';
  }

  // Context management

  function Context(type, indent, prev) {
    this.type = type;
    this.indent = indent;
    this.prev = prev;
  }

  /**
   * @param {string} type
   * @param {CodeMirror.StringStream} stream
   * @param {CodeMirror.CSS.State} state
   * @param {boolean} [indent=true]
   */
  function pushContext(state, stream, type, indent) {
    state.context = new Context(type, stream.indentation() + (indent === false ? 0 : indentUnit),
      state.context);
    return type;
  }

  /** @param {CodeMirror.CSS.State} state */
  function popContext(state) {
    if (state.context.prev) {
      state.context = state.context.prev;
    }
    return state.context.type;
  }

  /**
   * @param {string} type
   * @param {CodeMirror.StringStream} stream
   * @param {CodeMirror.CSS.State} state
   */
  function pass(type, stream, state) {
    return states[state.context.type](type, stream, state);
  }

  /**
   * @param {string} type
   * @param {CodeMirror.StringStream} stream
   * @param {CodeMirror.CSS.State} state
   * @param {number} [n=1]
   */
  function popAndPass(type, stream, state, n) {
    for (let i = n || 1; i > 0; i--) {
      state.context = state.context.prev;
    }
    return pass(type, stream, state);
  }

  // Parser

  /** @param {CodeMirror.StringStream} stream */
  function wordAsValue(stream) {
    const word = stream.current().toLowerCase();
    if (valueKeywords.has(word)) {
      override = 'atom';
    } else if (colorKeywords.has(word)) {
      override = 'keyword';
    } else {
      override = 'variable';
    }
  }

  const states = {};

  /**
   * @param {string} type
   * @param {CodeMirror.StringStream} stream
   * @param {CodeMirror.CSS.State} state
   */
  states.top = (type, stream, state) => {
    switch (type) {
      case '{':
        return pushContext(state, stream, 'block');
      case '}':
        return state.context.prev ? popContext(state) : state.context.type;
      case 'hash':
        override = 'builtin';
        break;
      case 'word':
        override = 'tag';
        break;
      case 'variable-definition':
        return 'maybeprop';
      case 'interpolation':
        return pushContext(state, stream, 'interpolation');
      case ':':
        return 'pseudo';
      case '(':
        if (allowNested) return pushContext(state, stream, 'parens');
        break;
      case '@component':
        return pushContext(state, stream, supportsAtComponent ? 'atComponentBlock' : 'at');
      case '@document':
      case '@-moz-document':
        return pushContext(state, stream, 'documentTypes');
      case '@import':
      case '@media':
      case '@page':
      case '@supports':
      case '@starting-style':
      case '@view-transition':
        return pushContext(state, stream, 'atBlock');
      case '@counter-style':
      case '@container':
      case '@font-face':
      case '@font-palette-values':
      case '@function':
      case '@property':
        state.stateArg = type;
        return 'restricted_atBlock_before';
      case '@keyframes':
      case '@-moz-keyframes':
      case '@-ms-keyframes':
      case '@-o-keyframes':
      case '@-webkit-keyframes':
        return 'keyframes';
      default:
        if (type && type.charCodeAt(0) === 64/* @ */)
          return pushContext(state, stream, 'at');
    }
    return state.context.type;
  };

  /**
   * @param {string} type
   * @param {CodeMirror.StringStream} stream
   * @param {CodeMirror.CSS.State} state
   */
  states.block = (type, stream, state) => {
    switch (type) {
      case 'word':
        type = stream.current().toLowerCase();
        if (propertyKeywords.has(type)) {
          override = 'property';
          type = 'maybeprop';
        } else if (nonStandardPropertyKeywords.has(type)) {
          override = highlightNonStandardPropertyKeywords ? 'string-2' : 'property';
          type = 'maybeprop';
        } else if (allowNested) {
          override = stickyMatch(stream, /\s*:(?:\s|$)/y, false) ? 'property' : 'tag';
          type = 'block';
        } else {
          override += ' error';
          type = 'maybeprop';
        }
        return type;
      case 'meta':
        return 'block';
      case 'hash':
      case 'qualifier':
        if (!allowNested) {
          override = 'error';
          return 'block';
        }
        // fallthrough to default
      default:
        return states.top(type, stream, state);
    }
  };

  /**
   * @param {string} type
   * @param {CodeMirror.StringStream} stream
   * @param {CodeMirror.CSS.State} state
   */
  states.maybeprop = (type, stream, state) =>
    type === ':'
      ? pushContext(state, stream, 'prop')
      : pass(type, stream, state);

  /**
   * @param {string} type
   * @param {CodeMirror.StringStream} stream
   * @param {CodeMirror.CSS.State} state
   */
  states.prop = (type, stream, state) => {
    switch (type) {
      case ';':
        return popContext(state);
      case '{':
        if (allowNested) return pushContext(state, stream, 'propBlock');
        // fallthrough to '}'
      case '}':
        return popAndPass(type, stream, state);
      case '(':
        return pushContext(state, stream, 'parens');
      case 'hash':
        rxHexColor.lastIndex = stream.start;
        if (!rxHexColor.exec(stream.string))
          override += ' error';
        break;
      case 'word':
        wordAsValue(stream);
        break;
      case 'interpolation':
        return pushContext(state, stream, 'interpolation');
    }
    return 'prop';
  };

  /**
   * @param {string} type
   * @param {CodeMirror.StringStream} stream
   * @param {CodeMirror.CSS.State} state
   */
  states.propBlock = (type, stream, state) => {
    switch (type) {
      case '}':
        return popContext(state);
      case 'word':
        override = 'property';
        return 'maybeprop';
    }
    return state.context.type;
  };

  /**
   * @param {string} type
   * @param {CodeMirror.StringStream} stream
   * @param {CodeMirror.CSS.State} state
   */
  states.parens = (type, stream, state) => {
    switch (type) {
      case '{':
      case '}':
        return popAndPass(type, stream, state);
      case ')':
        return popContext(state);
      case '(':
        return pushContext(state, stream, 'parens');
      case 'interpolation':
        return pushContext(state, stream, 'interpolation');
      case 'word':
        wordAsValue(stream);
        break;
    }
    return 'parens';
  };

  /**
   * @param {string} type
   * @param {CodeMirror.StringStream} stream
   * @param {CodeMirror.CSS.State} state
   */
  states.pseudo = (type, stream, state) => {
    switch (type) {
      case 'meta':
        return 'pseudo';
      case 'word':
        override = 'variable-3';
        return state.context.type;
    }
    return pass(type, stream, state);
  };

  /**
   * @param {string} type
   * @param {CodeMirror.StringStream} stream
   * @param {CodeMirror.CSS.State} state
   */
  states.documentTypes = (type, stream, state) => {
    if (type === 'word' && documentTypes.has(stream.current().toLowerCase())) {
      override = 'tag';
      return state.context.type;
    } else {
      return states.atBlock(type, stream, state);
    }
  };

  /**
   * @param {string} type
   * @param {CodeMirror.StringStream} stream
   * @param {CodeMirror.CSS.State} state
   */
  states.atBlock = (type, stream, state) => {
    switch (type) {
      case '(':
        return pushContext(state, stream, 'atBlock_parens');
      case '}':
      case ';':
        return popAndPass(type, stream, state);
      case '{':
        return popContext(state) && pushContext(state, stream, allowNested ? 'block' : 'top');
      case 'interpolation':
        return pushContext(state, stream, 'interpolation');
      case 'word': {
        const word = stream.current().toLowerCase();
        if (word === 'only' || word === 'not' || word === 'and' || word === 'or') {
          override = 'keyword';
        } else if (mediaTypes.has(word)) {
          override = 'attribute';
        } else if (mediaFeatures.has(word)) {
          override = 'property';
        } else if (mediaValueKeywords.has(word)) {
          override = 'keyword';
        } else if (propertyKeywords.has(word)) {
          override = 'property';
        } else if (nonStandardPropertyKeywords.has(word)) {
          override = highlightNonStandardPropertyKeywords ? 'string-2' : 'property';
        } else if (valueKeywords.has(word)) {
          override = 'atom';
        } else if (colorKeywords.has(word)) {
          override = 'keyword';
        } else {
          override = 'error';
        }
      }
    }
    return state.context.type;
  };

  /**
   * @param {string} type
   * @param {CodeMirror.StringStream} stream
   * @param {CodeMirror.CSS.State} state
   */
  states.atComponentBlock = (type, stream, state) => {
    switch (type) {
      case '}':
        return popAndPass(type, stream, state);
      case '{':
        return popContext(state) &&
          pushContext(state, stream, allowNested ? 'block' : 'top', false);
      case 'word':
        override = 'error';
        break;
    }
    return state.context.type;
  };

  /**
   * @param {string} type
   * @param {CodeMirror.StringStream} stream
   * @param {CodeMirror.CSS.State} state
   */
  states.atBlock_parens = (type, stream, state) => {
    switch (type) {
      case ')':
        return popContext(state);
      case '{':
      case '}':
        return popAndPass(type, stream, state, 2);
    }
    return states.atBlock(type, stream, state);
  };

  /**
   * @param {string} type
   * @param {CodeMirror.StringStream} stream
   * @param {CodeMirror.CSS.State} state
   */
  states.restricted_atBlock_before = (type, stream, state) => {
    switch (type) {
      case '{':
        return pushContext(state, stream, 'restricted_atBlock');
      case 'word':
        if (state.stateArg === '@counter-style') {
          override = 'variable';
          return 'restricted_atBlock_before';
        }
        break;
    }
    return pass(type, stream, state);
  };

  /**
   * @param {string} type
   * @param {CodeMirror.StringStream} stream
   * @param {CodeMirror.CSS.State} state
   */
  states.restricted_atBlock = (type, stream, state) => {
    switch (type) {
      case '}':
        state.stateArg = null;
        return popContext(state);
      case 'word':
        type = state.stateArg;
        override = (
          type === '@font-face' ? !fontProperties.has(stream.current().toLowerCase())
            : type === '@counter-style' && !counterDescriptors.has(stream.current().toLowerCase())
        ) ? 'error'
          : 'property';
        return 'maybeprop';
    }
    return 'restricted_atBlock';
  };

  /**
   * @param {string} type
   * @param {CodeMirror.StringStream} stream
   * @param {CodeMirror.CSS.State} state
   */
  states.keyframes = (type, stream, state) => {
    switch (type) {
      case 'word':
        override = 'variable';
        return 'keyframes';
      case '{':
        return pushContext(state, stream, 'top');
    }
    return pass(type, stream, state);
  };

  /**
   * @param {string} type
   * @param {CodeMirror.StringStream} stream
   * @param {CodeMirror.CSS.State} state
   */
  states.at = (type, stream, state) => {
    switch (type) {
      case ';':
        return popContext(state);
      case '{':
      case '}':
        return popAndPass(type, stream, state);
      case 'word':
        override = 'tag';
        break;
      case 'hash':
        override = 'builtin';
        break;
    }
    return 'at';
  };

  /**
   * @param {string} type
   * @param {CodeMirror.StringStream} stream
   * @param {CodeMirror.CSS.State} state
   */
  states.interpolation = (type, stream, state) => {
    switch (type) {
      case '}':
        return popContext(state);
      case '{':
      case ';':
        return popAndPass(type, stream, state);
      case 'word':
        override = 'variable';
        break;
      case 'variable':
      case '(':
      case ')':
        break;
      default:
        override = 'error';
    }
    return 'interpolation';
  };

  return {
    /** @namespace CodeMirror.CSS.State */
    startState: base => ({
      tokenize: null,
      state: inline ? 'block' : 'top',
      stateArg: null,
      context: new Context(inline ? 'block' : 'top', base || 0, null),
    }),

    /**
     * @param {CodeMirror.StringStream} stream
     * @param {CodeMirror.CSS.State} state
     */
    token: function (stream, state) {
      if (!state.tokenize && stream.eatSpace()) return null;
      let style = (state.tokenize || tokenBase)(stream, state);
      if (style && typeof style === 'object') {
        type = style[1];
        style = style[0];
      }
      override = style;
      if (type !== 'comment') {
        state.state = states[state.state](type, stream, state);
      }
      return override;
    },

    indent: function (state, textAfter) {
      let cx = state.context, ch = textAfter && textAfter.charAt(0);
      let indent = cx.indent;
      if (cx.type === 'prop' && (ch === '}' || ch === ')')) cx = cx.prev;
      if (cx.prev) {
        if (ch === '}' && (cx.type === 'block' || cx.type === 'top' ||
          cx.type === 'interpolation' || cx.type === 'restricted_atBlock')) {
          // Resume indentation from parent context.
          cx = cx.prev;
          indent = cx.indent;
        } else if (ch === ')' && (cx.type === 'parens' || cx.type === 'atBlock_parens') ||
          ch === '{' && (cx.type === 'at' || cx.type === 'atBlock')) {
          // Dedent relative to current context.
          indent = Math.max(0, cx.indent - indentUnit);
        }
      }
      return indent;
    },

    electricChars: '}',
    blockCommentStart: '/*',
    blockCommentEnd: '*/',
    blockCommentContinue: ' * ',
    lineComment,
    fold: 'brace',
  };
});

const keywords = {
  colorKeywords: new Set(cssData.colorKeywords),
  counterDescriptors: new Set(cssData.counterDescriptors),
  documentTypes: new Set(cssData.documentTypes),
  fontProperties: new Set(cssData.fontProperties),
  mediaFeatures: new Set(cssData.mediaFeatures),
  mediaTypes: new Set(cssData.mediaTypes),
  mediaValueKeywords: new Set(cssData.mediaValueKeywords),
  nonStandardPropertyKeywords: new Set(cssData.nonStandardPropertyKeywords),
  propertyKeywords: new Set(cssData.propertyKeywords),
  valueKeywords: new Set(cssData.valueKeywords),
};

CodeMirror.registerHelper('hintWords', 'css', [
  ...cssData.colorKeywords,
  ...cssData.documentTypes,
  ...cssData.mediaFeatures,
  ...cssData.mediaTypes,
  ...cssData.mediaValueKeywords,
  ...cssData.nonStandardPropertyKeywords,
  ...cssData.propertyKeywords,
  ...cssData.valueKeywords,
]);

/**
 * @param {CodeMirror.StringStream} stream
 * @param {CodeMirror.CSS.State} state
 */
function hookLineComment(stream, state) {
  const c = stream.string.charCodeAt(stream.pos);
  switch (c) {
    case 47/* / */:
      stream.skipToEnd();
      return ['comment', 'comment'];
    case 42/* * */:
      stream.pos++;
      state.tokenize = tokenCComment;
      return tokenCComment(stream, state);
    default:
      return ['operator', 'operator'];
  }
}

/**
 * @param {CodeMirror.StringStream} stream
 * @param {CodeMirror.CSS.State} state
 */
function tokenCComment(stream, state) {
  rxCommentTail.lastIndex = stream.pos;
  if (rxCommentTail.exec(stream.string)?.[1])
    state.tokenize = null;
  stream.pos = rxCommentTail.lastIndex;
  return ['comment', 'comment'];
}

CodeMirror.defineMIME('text/css', {
  ...keywords,
  tokenHooks: {
    /**
     * @param {CodeMirror.StringStream} stream
     * @param {CodeMirror.CSS.State} state
     */
    47/* / */: (stream, state) => {
      if (stream.string.charCodeAt(stream.pos) !== 42/* * */)
        return false;
      stream.pos++;
      state.tokenize = tokenCComment;
      return tokenCComment(stream, state);
    },
  },
  name: 'css',
});

CodeMirror.defineMIME('text/x-scss', {
  ...keywords,
  allowNested: true,
  lineComment: '//',
  tokenHooks: {
    47/* / */: hookLineComment,
    58/* : */: stream => {
      if (stickyMatch(stream, /\s*\{/y, false)) {
        return [null, null];
      }
      return false;
    },
    36/* $ */: stream => {
      stickyMatch(stream, /[\w-]+/y);
      if (stickyMatch(stream, /\s*:/y, false)) {
        return ['variable-2', 'variable-definition'];
      }
      return ['variable-2', 'variable'];
    },
    /** @param {CodeMirror.StringStream} stream */
    35/* # */: stream => {
      if (stream.string.charCodeAt(stream.pos) !== 123/* { */)
        return false;
      stream.pos++;
      return [null, 'interpolation'];
    },
  },
  name: 'css',
  helperType: 'scss',
});

CodeMirror.defineMIME('text/x-less', {
  ...keywords,
  allowNested: true,
  lineComment: '//',
  tokenHooks: {
    47/* / */: hookLineComment,
    /** @param {CodeMirror.StringStream} stream */
    64/* @ */: stream => {
      if (stream.string.charCodeAt(stream.pos) === 123/* { */) {
        stream.pos++;
        return [null, 'interpolation'];
      }
      if (stickyMatch(stream, /(?:charset|(?:-moz-)?document|font-face|import|(?:-(?:moz|ms|o|webkit)-)?keyframes|media|namespace|page|supports)\b/iy, false)) {
        return false;
      }
      stickyMatch(stream, /[\w\\-]/y);
      if (stickyMatch(stream, /\s*:/y, false)) {
        return ['variable-2', 'variable-definition'];
      }
      return ['variable-2', 'variable'];
    },
    38/* & */: function () {
      return ['atom', 'atom'];
    },
  },
  name: 'css',
  helperType: 'less',
});

CodeMirror.defineMIME('text/x-gss', {
  ...keywords,
  supportsAtComponent: true,
  tokenHooks: {
    /**
     * @param {CodeMirror.StringStream} stream
     * @param {CodeMirror.CSS.State} state
     */
    47/* / */: (stream, state) => {
      if (stream.string.charCodeAt(stream.pos) !== 42/* * */)
        return false;
      stream.pos++;
      state.tokenize = tokenCComment;
      return tokenCComment(stream, state);
    },
  },
  name: 'css',
  helperType: 'gss',
});
