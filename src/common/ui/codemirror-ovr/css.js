/**
 * Modernized CSS mode from CodeMirror 5 modified by tophf for Stylus:
 * https://github.com/openstyles/stylus/blob/v2.4.18/src/cm/css.js
 * CodeMirror, copyright (c) by Marijn Haverbeke and others
 * Distributed under an MIT license: https://codemirror.net/5/LICENSE
 * Modded by Stylus Team: switched to charCodeAt, Set, unicode in ids, keywords from csslint-mod
 */
/* eslint-disable no-shadow,one-var,one-var-declaration-per-line,prefer-const */
import CodeMirror from 'codemirror';
import * as cssData from './css-data';

// import {kLineComment, rxUniBody} from './util';
/* eslint-disable no-misleading-character-class */
const kLineComment = 'lineComment';
/** https://drafts.csswg.org/css-syntax-3/#non-ascii-ident-code-point
 * The leading character was already checked */
const rxUniBody = /[-\\\w\u00B7\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u037D\u037F-\u1FFF\u200C\u200D\u203F\u2040\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\u{10000}-\u{10FFFF}]*/yu;

const kAllowNested = 'allowNested';
const kAtom = 'atom';
const kBlock = 'block';
const kComment = 'comment';
const kError = 'error';
const kHash = 'hash';
const kInterpolation = 'interpolation';
const kKeyframes = 'keyframes';
const kKeyword = 'keyword';
const kMaybeProp = 'maybeprop';
const kProperty = 'property';
const kRestrictedAtBlock = 'restricted_atBlock';
const kRestrictedAtBlockBefore = 'restricted_atBlock_before';
const kTokenHooks = 'tokenHooks';
const kVariable = 'variable';
const kVariable2 = 'variable-2';
const kVariableDefinition = 'variable-definition';
const kWord = 'word';
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
const rxColon = /(?:\s+|\/\*(?:[^*]+|\*(?!\/))*(?:\*\/|$))*:/y;
const rxDashLetter = /[-a-z\\]+/yi;
const rxHexColor = /#[\da-f]{3}(?:[\da-f](?:[\da-f]{2}(?:[\da-f]{2})?)?)?/yi;
const rxImportant = /\s*\w*/y;
const rxNumberDigit = /\d*(?:\.\d*)?(?:e[-+]\d+)?(?:\w+|%)?/y;
const rxNumberDot = /\d+(?:e[-+]\d+)?(?:\w+|%)?/y;
const rxSpace = /\s+/y;
const rxSpaceAndQuote = /(\s*)(['"]?)/y;
const rxSpaceColon = /\s*:(?:\s|$)/y;
const rxSpaceRParenEOL = /\s*(?=\)|$)/y;
const rxStringDoubleQ = /\s*(?:[^\\"]+|\\(?:[0-9a-fA-F]{1,6}\s?|.|$))*/y;
const rxStringSingleQ = /\s*(?:[^\\']+|\\(?:[0-9a-fA-F]{1,6}\s?|.|$))*/y;
const rxUnquotedUrl = /\s*(?:[^()\s\\'"]+|\\(?:[0-9a-fA-F]{1,6}\s?|.|$))*\s*/y;
const rxUnquotedBadUrl = /(?:[^)\\]|\\(?:[^)]|$))+/y;
const rxVar = /[-\w]+(\s*:|)/y;
const states = {};
/**
 * @param {CodeMirror.StringStream} stream
 * @param {RegExp} rx - must be sticky
 * @param {boolean} [consume]
 * @return {boolean}
 */
const stickyMatch = (stream, rx, consume = true) =>
  ((rx.lastIndex = stream.pos), rx.test(stream.string)) &&
  (!consume || (stream.pos = rx.lastIndex));

let rxAtRules;
let tokenStringDouble, tokenStringSingle, tokenUrl, tokenUrlEnd, tokenBadUrl;

// TODO: patch `eatWhile` and `match` + use WeakMap for converted non-sticky regexps
CodeMirror.StringStream.prototype.eatSpace = function () {
  rxSpace.lastIndex = this.pos;
  return rxSpace.test(this.string) && !!(this.pos = rxSpace.lastIndex);
};

CodeMirror.defineMode('css', (config, parserConfig) => {
  if (!parserConfig.propertyKeywords)
    parserConfig = CodeMirror.resolveMode('text/css');
  const {
    inline,
    [kTokenHooks]: tokenHooks,
  } = parserConfig;
  const {indentUnit} = config,
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
    allowNested = parserConfig[kAllowNested],
    lineComment = parserConfig[kLineComment],
    supportsAtComponent = parserConfig.supportsAtComponent === true,
    highlightNonStandardPropertyKeywords = config.highlightNonStandardPropertyKeywords !== false;

  let type, override;

  // Tokenizers

  /**
   * @param {CodeMirror.StringStream} stream
   * @param {CM.CSSState} state
   * @param {string} str
   * @param {number} pos
   */
  function tokenBase(stream, state, str, pos) {
    let res = type = null;
    let rx, rxPos;
    const c = str.codePointAt(pos);
    const hook = tokenHooks.get(c);
    stream.pos = ++pos;
    if (hook && (res = hook(stream, state, str, pos)) !== false)
      return res;
    if (c === 64/* @ */) {
      rxDashLetter.lastIndex = pos;
      if (rxDashLetter.test(str)) {
        type = stream.pos = rxDashLetter.lastIndex;
        type = str.slice(pos - 1, type).toLowerCase();
        res = 'def';
      }
    } else if (c === 61/* = */) {
      type = 'compare';
    } else if (c === 126/* ~ */ || c === 124/* | */ || c === 42/* * */ || c === 36/* $ */) {
      if (str.charCodeAt(pos) === 61/* = */) {
        type = 'compare';
        stream.pos++;
      }
    } else if (
      c === 34/* " */ ? res = tokenStringDouble ??= tokenString.bind(rxStringDoubleQ, c)
        : c === 39/* ' */ && (res = tokenStringSingle ??= tokenString.bind(rxStringSingleQ, c))) {
      state.tokenize = res;
      return res(stream, state, str, pos);
    } else if (c === 35/* # */) {
      rxPos = rxUniBody;
      res = kAtom;
      type = kHash;
    } else if (c === 33/* ! */) {
      rxPos = rxImportant;
      res = kKeyword;
      type = 'important';
    } else if ((rx =
      c >= 48 && c <= 57 /* 0-9 */ ? rxNumberDigit :
      c === 46/* . */ ? (rx = str.charCodeAt(pos)) >= 48 && rx <= 57/* 0-9 */ && rxNumberDot :
      (c === 43/* + */ || c === 45/* - */) && (
        (rx = str.charCodeAt(pos)) === 46/* . */ ? rxNumberDot
          : rx >= 48 && rx <= 57/* 0-9 */ && rxNumberDigit
      )) && (rx.lastIndex = pos, rxPos = rx.test(str))) {
      res = 'number';
      type = 'unit';
    } else if (c === 45/* - */ && str.charCodeAt(pos) === 45 && str.charCodeAt(pos + 1) !== 45 &&
      (rxUniBody.lastIndex = pos + 1, rxUniBody.test(str))
    ) {
      res = kVariable2;
      type = stream.pos = rxUniBody.lastIndex;
      type = str.charCodeAt(type) === 58/* : */ || (rxColon.lastIndex = type, rxColon.test(str))
        ? kVariableDefinition
        : kVariable;
    } else if (c === 47/* / */ && (
      (rx = str.charCodeAt(pos)) === 42/* * */ ? tokenCComment(stream, state, str, pos + 1)
        : lineComment != null && rx === 47/* / */ && (stream.pos = str.length)
    )) {
      type = res = kComment;
    } else if (c === 44/* , */ || c === 43/* + */ || c === 62/* > */ || c === 47/* / */) {
      type = 'select-op';
    } else if (c === 46/* . */) {
      // A class name can't start with "-" and a digit, so this token ".-<digit>" is invalid
      if ((str.charCodeAt(pos) !== 45/* - */ ||
          (rx = str.charCodeAt(pos + 1)) < 48 || rx > 57/* 0-9 */)
      && ((rx = rxUniBody).lastIndex = pos, rxPos = rx.test(str))) {
        res = type = 'qualifier';
      }
    } else if (c === 58/* : */ || c === 59/* ; */ || c === 123/* { */ || c === 125/* } */
    || c === 91/* [ */ || c === 93/* ] */ || c === 40/* ( */ || c === 41/* ) */) {
      type = str[pos - 1];
    } else if (c === 45/* - */ || c === 92/* \ */ || c >= 48 && c <= 57 /* 0-9 */ || c === 95/* _ */
    || c >= 65 && c <= 90/* A-Z */ || c >= 97 && c <= 122/* a-z */
    // https://drafts.csswg.org/css-syntax-3/#non-ascii-ident-code-point
    || c === 0x00B7 || c >= 0x00C0 && c <= 0x1FFF && c !== 0x00D7 && c !== 0x00F7 && c !== 0x037E
    || c === 0x200C || c === 0x200D || c === 0x203F || c === 0x2040
    || c >= 0x2070 && c <= 0x218F || c >= 0x2C00 && c <= 0x2FEF || c >= 0x3001 && c <= 0xD7FF
    || c >= 0xF900 && c <= 0xFDCF || c >= 0xFDF0 && c <= 0xFFFD || c >= 0x10000) {
      rxUniBody.lastIndex = pos;
      res = rxUniBody.test(str) ? stream.pos = rxUniBody.lastIndex : pos;
      if (str.charCodeAt(res) === 40/* ( */) {
        res -= pos - 1;
        if ((
          res === 6 ? /*domain*/c === 100 || c === 68 || /*regexp*/c === 114 || c === 82
          : (res === 3 /*url*/ || res === 10 /*url-prefix*/) && (c === 117 || c === 85)
        ) && documentTypes.has(str.slice(pos - 1, pos + res - 1).toLowerCase()))
          state.tokenize = tokenParenthesized;
        res = 'variable callee';
        type = kVariable;
      } else if (c === 45/* - */) {
        res = type = 'meta';
      } else {
        res = kProperty;
        type = kWord;
      }
    }
    if (rxPos === true || rxPos && (rxPos.lastIndex = pos, rx = rxPos).test(str))
      stream.pos = rx.lastIndex;
    return res;
  }

  /**
   * @this {RegExp}
   * @param {number} quote - bound param
   * @param {CodeMirror.StringStream} stream
   * @param {CM.CSSState} state
   * @param {string} str
   * @param {number} pos
   */
  function tokenString(quote, stream, state, str, pos) {
    state.space = false;
    this.lastIndex = pos;
    type = !this.test(str) || this === rxUnquotedBadUrl ? kError : 'string';
    stream.pos = pos = this.lastIndex;
    let tokenize;
    const next = str.charCodeAt(pos);
    if (next === quote) {
      if (quote !== 41/* ) */)
        stream.pos = ++pos;
    } else if (next >= 0 /* not NaN */) {
      if (quote === 41) {
        tokenize = tokenBadUrl ??= tokenString.bind(rxUnquotedBadUrl, 41/* ) */);
      } else {
        type = kError;
      }
    } else if (quote === 41) {
      // non-escaped linebreak, the string is done, let's skip spaces
      state.space = true;
      tokenize = tokenUrlEnd ??= tokenString.bind(rxSpaceRParenEOL, 41/* ) */);
    } else if (str.charCodeAt(pos - 1) !== 92/* \ */) {
      type = kError;
    } else {
      return type;
    }
    state.tokenize = tokenize;
    return type;
  }

  /**
   * @param {CodeMirror.StringStream} stream
   * @param {CM.CSSState} state
   * @param {string} str
   * @param {number} pos
   */
  function tokenParenthesized(stream, state, str, pos) {
    const spaceSkipped = state.space;
    if (!spaceSkipped) stream.pos = ++pos; // '('
    let c = str.charCodeAt(pos);
    let res = null;
    type = spaceSkipped ? res : '(';
    if (spaceSkipped)
      state.space = false;
    if (c === 34/*"*/ || c === 39/*'*/) {
      state.tokenize = null;
      if (spaceSkipped) res = tokenBase(stream, state, str, pos);
    } else if (!spaceSkipped && c !== 41/*)*/ && (
      (c = (rxSpaceAndQuote.lastIndex = pos, rxSpaceAndQuote.exec(str)))[1] ||
      !c[2] && pos + c[0].length === str.length
    )) {
      state.space = true;
    } else {
      state.tokenize = tokenUrl ??= tokenString.bind(rxUnquotedUrl, 41/* ) */);
    }
    return res;
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
   * @param {CM.CSSState} state
   * @param {boolean} [indent=true]
   */
  function pushContext(state, stream, type, indent) {
    state.context = new Context(type, stream.indentation() + (indent === false ? 0 : indentUnit),
      state.context);
    return type;
  }

  /** @param {CM.CSSState} state */
  function popContext(state) {
    if (state.context.prev) {
      state.context = state.context.prev;
    }
    return state.context.type;
  }

  /**
   * @param {string} type
   * @param {CodeMirror.StringStream} stream
   * @param {CM.CSSState} state
   */
  function pass(type, stream, state) {
    return states[state.context.type](type, stream, state);
  }

  /**
   * @param {string} type
   * @param {CodeMirror.StringStream} stream
   * @param {CM.CSSState} state
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
      override = kAtom;
    } else if (colorKeywords.has(word)) {
      override = kKeyword;
    } else {
      override = kVariable;
    }
  }

  /**
   * @param {string} type
   * @param {CodeMirror.StringStream} stream
   * @param {CM.CSSState} state
   */
  states.top = (type, stream, state) => {
    switch (type) {
      case '{':
        return pushContext(state, stream, kBlock);
      case '}':
        return state.context.prev ? popContext(state) : state.context.type;
      case kHash:
        override = 'builtin';
        break;
      case kWord:
        override = 'tag';
        break;
      case kVariableDefinition:
        return kMaybeProp;
      case kInterpolation:
        return pushContext(state, stream, kInterpolation);
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
        return kRestrictedAtBlockBefore;
      case '@keyframes':
      case '@-moz-keyframes':
      case '@-ms-keyframes':
      case '@-o-keyframes':
      case '@-webkit-keyframes':
        return kKeyframes;
      default:
        if (type && type.charCodeAt(0) === 64/* @ */)
          return pushContext(state, stream, 'at');
    }
    return state.context.type;
  };

  /**
   * @param {string} type
   * @param {CodeMirror.StringStream} stream
   * @param {CM.CSSState} state
   */
  states[kBlock] = (type, stream, state) => {
    switch (type) {
      case kWord:
        type = stream.current().toLowerCase();
        if (propertyKeywords.has(type)) {
          override = kProperty;
          type = kMaybeProp;
        } else if (nonStandardPropertyKeywords.has(type)) {
          override = highlightNonStandardPropertyKeywords ? 'string-2' : kProperty;
          type = kMaybeProp;
        } else if (allowNested) {
          rxSpaceColon.lastIndex = stream.pos;
          override = rxSpaceColon.test(stream.string) ? kProperty : 'tag';
          type = kBlock;
        } else {
          override += ' ' + kError;
          type = kMaybeProp;
        }
        return type;
      case 'meta':
        return kBlock;
      case kHash:
      case 'qualifier':
        if (!allowNested) {
          override = kError;
          return kBlock;
        }
        // fallthrough to default
      default:
        return states.top(type, stream, state);
    }
  };

  /**
   * @param {string} type
   * @param {CodeMirror.StringStream} stream
   * @param {CM.CSSState} state
   */
  states[kMaybeProp] = (type, stream, state) =>
    type === ':'
      ? pushContext(state, stream, 'prop')
      : pass(type, stream, state);

  /**
   * @param {string} type
   * @param {CodeMirror.StringStream} stream
   * @param {CM.CSSState} state
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
      case kHash:
        rxHexColor.lastIndex = stream.start;
        if (!rxHexColor.exec(stream.string))
          override += ' ' + kError;
        break;
      case kWord:
        wordAsValue(stream);
        break;
      case kInterpolation:
        return pushContext(state, stream, kInterpolation);
    }
    return 'prop';
  };

  /**
   * @param {string} type
   * @param {CodeMirror.StringStream} stream
   * @param {CM.CSSState} state
   */
  states.propBlock = (type, stream, state) => {
    switch (type) {
      case '}':
        return popContext(state);
      case kWord:
        override = kProperty;
        return kMaybeProp;
    }
    return state.context.type;
  };

  /**
   * @param {string} type
   * @param {CodeMirror.StringStream} stream
   * @param {CM.CSSState} state
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
      case kInterpolation:
        return pushContext(state, stream, kInterpolation);
      case kWord:
        wordAsValue(stream);
        break;
    }
    return 'parens';
  };

  /**
   * @param {string} type
   * @param {CodeMirror.StringStream} stream
   * @param {CM.CSSState} state
   */
  states.pseudo = (type, stream, state) => {
    switch (type) {
      case 'meta':
        return 'pseudo';
      case kWord:
        override = 'variable-3';
        return state.context.type;
    }
    return pass(type, stream, state);
  };

  /**
   * @param {string} type
   * @param {CodeMirror.StringStream} stream
   * @param {CM.CSSState} state
   */
  states.documentTypes = (type, stream, state) => {
    if (type === kWord && documentTypes.has(stream.current().toLowerCase())) {
      override = 'tag';
      return state.context.type;
    } else {
      return states.atBlock(type, stream, state);
    }
  };

  /**
   * @param {string} type
   * @param {CodeMirror.StringStream} stream
   * @param {CM.CSSState} state
   */
  states.atBlock = (type, stream, state) => {
    switch (type) {
      case '(':
        return pushContext(state, stream, 'atBlock_parens');
      case '}':
      case ';':
        return popAndPass(type, stream, state);
      case '{':
        return popContext(state) && pushContext(state, stream, allowNested ? kBlock : 'top');
      case kInterpolation:
        return pushContext(state, stream, kInterpolation);
      case kWord: {
        const word = stream.current().toLowerCase();
        if (word === 'only' || word === 'not' || word === 'and' || word === 'or') {
          override = kKeyword;
        } else if (mediaTypes.has(word)) {
          override = 'attribute';
        } else if (mediaFeatures.has(word)) {
          override = kProperty;
        } else if (mediaValueKeywords.has(word)) {
          override = kKeyword;
        } else if (propertyKeywords.has(word)) {
          override = kProperty;
        } else if (nonStandardPropertyKeywords.has(word)) {
          override = highlightNonStandardPropertyKeywords ? 'string-2' : kProperty;
        } else if (valueKeywords.has(word)) {
          override = kAtom;
        } else if (colorKeywords.has(word)) {
          override = kKeyword;
        } else {
          override = kError;
        }
      }
    }
    return state.context.type;
  };

  /**
   * @param {string} type
   * @param {CodeMirror.StringStream} stream
   * @param {CM.CSSState} state
   */
  states.atComponentBlock = (type, stream, state) => {
    switch (type) {
      case '}':
        return popAndPass(type, stream, state);
      case '{':
        return popContext(state) &&
          pushContext(state, stream, allowNested ? kBlock : 'top', false);
      case kWord:
        override = kError;
        break;
    }
    return state.context.type;
  };

  /**
   * @param {string} type
   * @param {CodeMirror.StringStream} stream
   * @param {CM.CSSState} state
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
   * @param {CM.CSSState} state
   */
  states[kRestrictedAtBlockBefore] = (type, stream, state) => {
    switch (type) {
      case '{':
        return pushContext(state, stream, kRestrictedAtBlock);
      case kWord:
        if (state.stateArg === '@counter-style') {
          override = kVariable;
          return kRestrictedAtBlockBefore;
        }
        break;
    }
    return pass(type, stream, state);
  };

  /**
   * @param {string} type
   * @param {CodeMirror.StringStream} stream
   * @param {CM.CSSState} state
   */
  states[kRestrictedAtBlock] = (type, stream, state) => {
    switch (type) {
      case '}':
        state.stateArg = null;
        return popContext(state);
      case kWord:
        type = state.stateArg;
        override = (
          type === '@font-face' ? !fontProperties.has(stream.current().toLowerCase())
            : type === '@counter-style' && !counterDescriptors.has(stream.current().toLowerCase())
        ) ? kError
          : kProperty;
        return kMaybeProp;
    }
    return kRestrictedAtBlock;
  };

  /**
   * @param {string} type
   * @param {CodeMirror.StringStream} stream
   * @param {CM.CSSState} state
   */
  states.keyframes = (type, stream, state) => {
    switch (type) {
      case kWord:
        override = kVariable;
        return kKeyframes;
      case '{':
        return pushContext(state, stream, 'top');
    }
    return pass(type, stream, state);
  };

  /**
   * @param {string} type
   * @param {CodeMirror.StringStream} stream
   * @param {CM.CSSState} state
   */
  states.at = (type, stream, state) => {
    switch (type) {
      case ';':
        return popContext(state);
      case '{':
      case '}':
        return popAndPass(type, stream, state);
      case kWord:
        override = 'tag';
        break;
      case kHash:
        override = 'builtin';
        break;
    }
    return 'at';
  };

  /**
   * @param {string} type
   * @param {CodeMirror.StringStream} stream
   * @param {CM.CSSState} state
   */
  states.interpolation = (type, stream, state) => {
    switch (type) {
      case '}':
        return popContext(state);
      case '{':
      case ';':
        return popAndPass(type, stream, state);
      case kWord:
        override = kVariable;
        break;
      case kVariable:
      case '(':
      case ')':
        break;
      default:
        override = kError;
    }
    return kInterpolation;
  };

  return {
    /** @return {CM.CSSState} */
    startState: base => ({
      tokenize: null,
      space: false,
      state: inline ? kBlock : 'top',
      stateArg: null,
      context: new Context(inline ? kBlock : 'top', base || 0, null),
    }),

    /**
     * @param {CodeMirror.StringStream} stream
     * @param {CM.CSSState} state
     */
    token(stream, state) {
      const {tokenize} = state;
      const str = stream.string;
      const trim = !tokenize || state.space;
      let {pos} = stream;
      let res;
      if (trim
      && ((res = str.charCodeAt(pos)) === 9 || res === 32)
      && (rxSpace.lastIndex = pos, rxSpace.test(str))
      && (pos = stream.pos = rxSpace.lastIndex)) {
        override = null;
      } else {
        res = (tokenize || tokenBase)(stream, state, str, pos);
        if (Array.isArray(res)) {
          type = res[1];
          res = res[0];
        }
        override = res;
        if (type !== kComment) {
          state.state = states[state.state](type, stream, state);
        }
      }
      return override;
    },

    indent(state, textAfter) {
      let cx = state.context, ch = textAfter && textAfter.charAt(0);
      let indent = cx.indent;
      if (cx.type === 'prop' && (ch === '}' || ch === ')')) cx = cx.prev;
      if (cx.prev) {
        if (ch === '}' && (cx.type === kBlock || cx.type === 'top' ||
          cx.type === kInterpolation || cx.type === kRestrictedAtBlock)) {
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
    [kLineComment]: lineComment,
    fold: 'brace',
  };
});

CodeMirror.registerHelper('hintWords', 'css', [
  ...cssData.atRules,
  ...cssData.colorKeywords,
  ...cssData.counterDescriptors,
  ...cssData.documentTypes,
  ...cssData.fontProperties,
  ...cssData.mediaFeatures,
  ...cssData.mediaTypes,
  ...cssData.mediaValueKeywords,
  ...cssData.nonStandardPropertyKeywords,
  ...cssData.propertyKeywords,
  ...cssData.pseudos,
  ...cssData.valueKeywords,
]);

/**
 * @param {CodeMirror.StringStream} stream
 * @param {CM.CSSState} state
 * @param {string} str
 * @param {number} pos
 */
function tokenCComment(stream, state, str, pos) {
  const i = str.indexOf('*/', pos);
  state.tokenize = i < 0 ? tokenCComment : null;
  stream.pos = i < 0 ? str.length : i + 2;
  return [kComment, kComment];
}

CodeMirror.defineMIME('text/css', {
  ...keywords,
  [kAllowNested]: true,
  [kTokenHooks]: new Map(),
  name: 'css',
});

CodeMirror.defineMIME('text/x-scss', {
  ...keywords,
  [kAllowNested]: true,
  [kLineComment]: '//',
  [kTokenHooks]: new Map([
    [58/* : */, stream => {
      if (stickyMatch(stream, /\s*\{/y, false)) {
        return [null, null];
      }
      return false;
    }],
    [36/* $ */, stream => {
      stickyMatch(stream, /[\w-]+/y);
      if (stickyMatch(stream, /\s*:/y, false)) {
        return [kVariable2, kVariableDefinition];
      }
      return [kVariable2, kVariable];
    }],
    /** @param {CodeMirror.StringStream} stream */
    [35/* # */, stream => {
      if (stream.string.charCodeAt(stream.pos) !== 123/* { */)
        return false;
      stream.pos++;
      return [null, kInterpolation];
    }],
  ]),
  name: 'css',
  helperType: 'scss',
});

CodeMirror.defineMIME('text/x-less', {
  ...keywords,
  [kAllowNested]: true,
  [kLineComment]: '//',
  [kTokenHooks]: new Map([
    /** @param {CodeMirror.StringStream} stream */
    [64/* @ */, (stream, state, str, pos) => {
      if (str.charCodeAt(pos) === 123/* { */) {
        stream.pos = ++pos;
        return [null, kInterpolation];
      }
      rxAtRules ??= new RegExp(
        String.raw`(?:-(?:moz|ms|o|webkit)-)?(?:${cssData.atRules.join('|')})(?![-\w\\])`, 'iy');
      rxAtRules.lastIndex = pos;
      let m;
      if (rxAtRules.test(stream) || !(rxVar.lastIndex = pos, m = rxVar.exec(str)))
        return false;
      stream.pos = rxVar.lastIndex - m[1].length;
      return m[1]
        ? [kVariable2, kVariableDefinition]
        : [kVariable2, kVariable];
    }],
    [38/* & */, () => [kAtom, kAtom]],
  ]),
  name: 'css',
  helperType: 'less',
});

CodeMirror.defineMIME('text/x-gss', {
  ...keywords,
  [kTokenHooks]: new Map(),
  supportsAtComponent: true,
  name: 'css',
  helperType: 'gss',
});
