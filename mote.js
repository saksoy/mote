var mote = ((typeof module !== 'undefined') && module.exports) || {};

(function(exports) {

/**
 * Utilities
 */

function stringify(obj) {
  return obj ? ('' + obj) : '';
}

var isArray = Array.isArray || function(obj) {
  return Object.prototype.toString.call(obj) == '[object Array]';
};

var escapeChars = {
  '&': '&amp;',
  '"': '&quot;',
  '<': '&lt;',
  '>': '&gt;'
}

function escapeHTML(str) {
  return str.replace(/[&"<>]/g, function(str) {
    return escapeChars[str];
  });
}

// Credit to Simon Willison and Colin Snover:
// http://simonwillison.net/2006/Jan/20/escape/
function RE(str) {
  return str.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
}

function e(str) {
  return JSON.stringify(str);
}

/**
 * Scanner
 */

function Scanner(str) {
  this.raw = str;
  this.str = str;
  this.pos = 0;
}

Scanner.prototype.eos = function() {
  return !this.str;
};

Scanner.prototype.startOfLine = function() {
  return (!this.pos || (this.raw.charAt(this.pos-1) === '\n'));
};

Scanner.prototype.scan = function(re) {
  var match = this.str.match(re);
  if (!match || (match.index > 0)) return null;
  this.str = this.str.substring(match[0].length);
  this.pos += match[0].length;
  return match[0];
};

Scanner.prototype.scanUntil = function(re) {
  var match
    , pos = this.str.search(re);

  switch (pos) {
    case -1 :
      match = this.str;
      this.pos += this.str.length;
      this.str = ''
      break;
    case 0  :
      match = null;
      break;
    default :
      match = this.str.substring(0, pos);
      this.str = this.str.substring(pos);
      this.pos += pos;
  }
  return match;
};

/**
 * Parser
 */

function parse(template) {
  var p = new Parser();
  return p.parse(template);
}

function Parser(otag, ctag) {
  this.tokens = [];
  this.tokenCollector = this.tokens;
  this.sections = [];
  this.otag = otag || '{{';
  this.ctag = ctag || '}}';
  this.compileRegexen();
}

Parser.prototype.compileRegexen = function() {
  this.re.opentag = new RegExp('(?:([ \\t]*))?' + RE(this.otag));
  this.re.closetag = new RegExp('[\\}!=]?' + RE(this.ctag));
};

Parser.prototype.re = {
  newline: /\r?\n/,
  whitespace: /[ \t]*/,
  trailing: /[ \t]*(?:\r?\n|$)/,
  tagtype: /\{|&|#|\^|\/|>|=|!/,
  allowed: /[\w\$\.]+/,
  linebeginnings: /(^|\n)([^\r\n])/g
};

Parser.prototype.standalone = function(type) {
  return type && type !== '{' && type !== '&';
};

Parser.prototype.addIndentationTo = function(str, indent) {
  return str.replace(this.re.linebeginnings, '$1' + indent + '$2');
};

Parser.prototype.parse = function(str, options) {
  options = options || {};
  if (options.indent) str = this.addIndentationTo(str, options.indent)
  if (options.otag && options.ctag) {
    this.otag = options.otag;
    this.ctag = options.ctag;
    this.compileRegexen();
  }

  this.addLineStart();
  this.scanner = new Scanner(str);
  while (!this.scanner.eos()) this.scanTags();
  return this.tokens;
};

Parser.prototype.scanTags = function() {
  var otag, padding, type, content, startOfLine, start, end
    , standAlone = false;

  this.scanText();

  startOfLine = this.scanner.startOfLine();
  if (startOfLine && !this.scanner.eos()) this.addLineStart();
  start = this.scanner.pos;

  // Match the opening tag.
  if (!(otag = this.scanner.scan(this.re.opentag))) return;

  // Handle leading whitespace
  padding = this.re.whitespace.exec(otag);
  padding = padding && padding[0];
  start += padding.length;

  // Get the tag's type.
  type = this.scanner.scan(this.re.tagtype);
  type = type && type[0];

  // Skip whitespace.
  this.scanner.scan(this.re.whitespace);

  // Get the tag's inner content.
  if (type === '!' || type === '=') {
    content = this.scanner.scanUntil(this.re.closetag);
  } else {
    content = this.scanner.scan(this.re.allowed);
    if (content.indexOf('.') > 0) content = e(content.split('.'));
    else content = e(content);
  }

  // Skip whitespace again.
  this.scanner.scan(this.re.whitespace);

  // Closing tag.
  if (!this.scanner.scan(this.re.closetag)) {
    throw new Error('Unclosed tag');
  }

  // Strip leading and trailing whitespace if necessary.
  if (startOfLine && this.standalone(type) &&
      (this.scanner.scan(this.re.trailing) !== null)) {
      standAlone = true;
  }

  if (!standAlone) {
    this.addText(padding);
    padding = '';
  }

  end = this.scanner.pos;

  this.addTag(type, content, padding, start, end);
};

Parser.prototype.scanText = function(str) {
  var text = this.scanner.scanUntil(this.re.opentag);
  this.addText(text);
};

Parser.prototype.addLineStart = function() {
  this.tokenCollector.push({type: 'sol'});
};

Parser.prototype.addText = function(text) {
  var i, len, lines;

  if (!text) return;

  lines = text.match(/(.*)(\r?\n)?/g);
  lines.pop();

  for (i = 0, len = lines.length; i < len; i++) {
    this.text(lines[i]);
    if (i < len - 1) this.addLineStart();
  }

};

Parser.prototype.addTag = function(type, content, padding, start, end) {
  switch (type) {
    case '=':
      this.setDelimiters(content);
      break;
    case '!':
      break;
    case '#':
      this.openSection(content, {invert: false, start: end});
      break;
    case '^':
      this.openSection(content, {invert: true, start: end});
      break;
    case '/':
      this.closeSection(content, {end: start});
      break;
    case '>':
      this.partial(content, padding);
      break;
    case '{':
    case '&':
      this.variable(content, {escape: false});
      break;
    default :
      this.variable(content, {escape: true});
      break;
  }
};

Parser.prototype.setDelimiters = function(content) {
  var tags = content.split(/\s+/);
  this.otag = tags[0];
  this.ctag = tags[1];
  this.compileRegexen();
};

Parser.prototype.openSection = function(content, options) {
  var section = {
    type: options.invert ? 'invertedSection' : 'section',
    key: content,
    tokens: [],
    raw: options.start
  };
  this.tokenCollector.push(section);
  this.sections.push(section);
  this.tokenCollector = section.tokens;
};

Parser.prototype.closeSection = function(content, options) {
  var section, last;

  if (this.sections.length === 0) {
    throw new Error('Unopened section: ' + content);
  }

  section = this.sections.pop();
  if (section.key !== content) {
    throw new Error('Unclosed section: ' + section.key);
  }

  section.raw = this.scanner.raw.substring(section.raw, options.end);
  section.otag = this.otag;
  section.ctag = this.ctag;

  last = this.sections.length - 1;

  this.tokenCollector =
    this.sections.length ? this.sections[last].tokens : this.tokens;
};

Parser.prototype.partial = function(content, padding) {
  this.tokenCollector.push({
    type: 'partial',
    key: content,
    indent: padding
  });
};

Parser.prototype.variable = function(content, options) {
  this.tokenCollector.push({
    type: 'variable',
    key: content,
    escape: options.escape
  });
};

Parser.prototype.text = function(text) {
  var last = this.tokenCollector.length - 1;
  if ((last >= 0) && (this.tokenCollector[last].type === 'text')) {
    this.tokenCollector[last].value += text;
  } else {
    this.tokenCollector.push({
      type: 'text',
      value: text
    });
  }
};

/**
 * Compiler
 */

function Compiler() {
  this.index = 1;
  this.sections = {};
}

Compiler.prototype.compile = function(template) {
  var source, tokens = parse(template);

  source = '  return ""' + this.compileTokens(tokens) + ';';
  source = '  var w = writer;' + this.compileSections() + source;

  return new Function('context, writer', source);
};

Compiler.prototype.compileTokens = function(tokens) {
  var i = 0
    , len = tokens.length
    , out = '';

  for (; i < len; i++) out += this.compileToken(tokens[i]);
  return out;
};

Compiler.prototype.compileSections = function() {
  var id
    , out = '';

  for (id in this.sections) {
    out += 'function section' + id + '(context, writer) {'
         + '  var w = writer;'
         + '  return ""'
         + this.sections[id]
         + ';}';
  }
  return out;
};

Compiler.prototype.compileToken = function(token) {
  return this['compile_' + token.type](token);
};

Compiler.prototype.compile_text = function(token) {
  return '  + ' + e(token.value) + '';
};

Compiler.prototype.compile_sol = function(token) {
  return '  + w.sol()';
};

Compiler.prototype.compile_variable = function(token) {
  return '  + w.variable('
    + 'context.lookup(' + token.key + ')'
    + ', context'
    + ', ' + token.escape
    + ')';
};

Compiler.prototype.compile_partial = function(token) {
  return '  + w.partial(' + token.key
    + ', context'
    + ', {indent: ' + e(token.indent) + '}'
    + ')';
};

Compiler.prototype.compile_section = function(token) {
  var index = this.index++;
  this.sections[index] = this.compileTokens(token.tokens);
  return '  + w.section(context.lookup(' + token.key + ')'
    + ', context'
    + ', section' + index + ')';
};

Compiler.prototype.compile_invertedSection = function(token) {
  var index = this.index++;
  this.sections[index] = this.compileTokens(token.tokens);
  return '  + w.invertedSection(context.lookup(' + token.key + ')'
    + ', context'
    + ', section' + index + ')';
};

/**
 * Writer
 */

function Writer(options) {
  this.indent = options && options.indent;
}

Writer.prototype.sol = function() {
  return this.indent || '';
};

Writer.prototype.variable = function(value, context, escape) {
  if (typeof value === 'function') value = value.call(context.root);
  return escape ? escapeHTML(stringify(value)) : stringify(value);
};

Writer.prototype.partial = function(value, context, options) {
  return loadTemplate(value)(context, options);
};

Writer.prototype.section = function(value, context, fn) {
  if (isArray(value)) {
    var out = '';
    for (var i = 0, len = value.length; i < len; i++) {
      out += fn(context.push(value[i]), this);
    }
    return out;
  } else if (typeof value === 'function') {
    return value.call(context.root, context, this, fn);
  } else if (value) {
    return fn(context.push(value), this);
  }
  return '';
};

Writer.prototype.invertedSection = function(value, context, fn) {
  if (!value || (isArray(value) && value.length === 0)) {
    return fn(context, this);
  }
  return '';
};

/**
 * Context
 */

function Context(obj, tail, root) {
  this.head = obj;
  this.tail = tail;
  this.root = root || obj;
}

Context.wrap = function(obj) {
  if (obj instanceof Context) return obj;
  else return new Context(obj);
};

Context.prototype.push = function(obj) {
  return new Context(obj, this, this.root);
};

Context.prototype.lookup = function(key) {
  var i, value, getter
    , node = this;

  getter = isArray(key) ? 'getPath' : 'get';

  while (node) {
    value = this[getter](node.head, key);
    if (value) return value;
    node = node.tail;
  }
  return undefined;
}

Context.prototype.get = function(obj, key) {
  return (key === '.') ? obj : obj[key];
};

Context.prototype.getPath = function(obj, key) {
  var i, len , value = obj;

  for (i = 0, len = key.length; i < len; i++) {
    if (!value) return undefined;
    value = value[key[i]];
  }

  return value;
}

/**
 * mote
 */

var cache = {};

function clearCache() {
  cache = {};
}

function noop() {
  return '';
}

function loadTemplate(name) {
  return cache[name] || noop;
}

function compile(template) {
  var c = new Compiler();
  var fn = c.compile(template);
  return function(view, options) {
    return fn(Context.wrap(view), new Writer(options));
  };
}

function compilePartial(name, template) {
  cache[name] = compile(template);
  return cache[name];
}

exports.clearCache     = clearCache;
exports.loadTemplate   = loadTemplate;
exports.compile        = compile;
exports.compilePartial = compilePartial;

})(mote);