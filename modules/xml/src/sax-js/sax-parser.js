import * as sax from './constants';

const buffers = [
  'comment', 'sgmlDecl', 'textNode', 'tagName', 'doctype',
  'procInstName', 'procInstBody', 'entity', 'attribName',
  'attribValue', 'cdata', 'script'
]

export default class SAXParser {
  constructor(strict, opt) {
    this._initialize(strict, opt);
  }

  end() {end(this)}
  write(...args) { return write.call(this, ...args) }
  resume() { this.error = null; return this }
  close() { return this.write(null) }
  flush() { flushBuffers(this) }

  // PRIVATE

  _initialize(strict, opt) {
    clearBuffers(this)
    this.q = this.c = ''
    this.bufferCheckPosition = sax.MAX_BUFFER_LENGTH
    this.opt = opt || {}
    this.opt.lowercase = this.opt.lowercase || this.opt.lowercasetags
    this.looseCase = this.opt.lowercase ? 'toLowerCase' : 'toUpperCase'
    this.tags = []
    this.closed = this.closedRoot = this.sawRoot = false
    this.tag = this.error = null
    this.strict = !!strict
    this.noscript = !!(strict || this.opt.noscript)
    this.state = S.BEGIN
    this.strictEntities = this.opt.strictEntities
    this.ENTITIES = this.strictEntities ? Object.create(sax.XML_ENTITIES) : Object.create(sax.ENTITIES)
    this.attribList = []

    this.testMode = opt.testMode; // FORK

    // namespaces form a prototype chain.
    // it always points at the current tag,
    // which protos to its parent tag.
    if (this.opt.xmlns) {
      this.ns = Object.create(rootNS)
    }

    // mostly just for error reporting
    this.trackPosition = this.opt.position !== false
    if (this.trackPosition) {
      this.position = this.line = this.column = 0
    }
    emit(this, 'onready')
  }
}

function checkBufferLength (parser) {
  var maxAllowed = Math.max(sax.MAX_BUFFER_LENGTH, 10)
  var maxActual = 0
  for (var i = 0, l = buffers.length; i < l; i++) {
    var len = parser[buffers[i]].length
    if (len > maxAllowed) {
      // Text/cdata nodes can get big, and since they're buffered,
      // we can get here under normal conditions.
      // Avoid issues by emitting the text node now,
      // so at least it won't get any bigger.
      switch (buffers[i]) {
        case 'textNode':
          closeText(parser)
          break

        case 'cdata':
          emitNode(parser, 'oncdata', parser.cdata)
          parser.cdata = ''
          break

        case 'script':
          emitNode(parser, 'onscript', parser.script)
          parser.script = ''
          break

        default:
          error(parser, 'Max buffer length exceeded: ' + buffers[i])
      }
    }
    maxActual = Math.max(maxActual, len)
  }
  // schedule the next check for the earliest possible buffer overrun.
  var m = sax.MAX_BUFFER_LENGTH - maxActual
  parser.bufferCheckPosition = m + parser.position
}

function clearBuffers (parser) {
  for (var i = 0, l = buffers.length; i < l; i++) {
    parser[buffers[i]] = ''
  }
}

function flushBuffers (parser) {
  closeText(parser)
  if (parser.cdata !== '') {
    emitNode(parser, 'oncdata', parser.cdata)
    parser.cdata = ''
  }
  if (parser.script !== '') {
    emitNode(parser, 'onscript', parser.script)
    parser.script = ''
  }
}

// this really needs to be replaced with character classes.
// XML allows all manner of ridiculous numbers and digits.
var CDATA = '[CDATA['
var DOCTYPE = 'DOCTYPE'
var XML_NAMESPACE = 'http://www.w3.org/XML/1998/namespace'
var XMLNS_NAMESPACE = 'http://www.w3.org/2000/xmlns/'
var rootNS = { xml: XML_NAMESPACE, xmlns: XMLNS_NAMESPACE }

// http://www.w3.org/TR/REC-xml/#NT-NameStartChar
// This implementation works on strings, a single character at a time
// as such, it cannot ever support astral-plane characters (10000-EFFFF)
// without a significant breaking change to either this  parser, or the
// JavaScript language.  Implementation of an emoji-capable xml parser
// is left as an exercise for the reader.
var nameStart = /[:_A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD]/

var nameBody = /[:_A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\u00B7\u0300-\u036F\u203F-\u2040.\d-]/

var entityStart = /[#:_A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD]/
var entityBody = /[#:_A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\u00B7\u0300-\u036F\u203F-\u2040.\d-]/

function isWhitespace (c) {
  return c === ' ' || c === '\n' || c === '\r' || c === '\t'
}

function isQuote (c) {
  return c === '"' || c === '\''
}

function isAttribEnd (c) {
  return c === '>' || isWhitespace(c)
}

function isMatch (regex, c) {
  return regex.test(c)
}

function notMatch (regex, c) {
  return !isMatch(regex, c)
}

// shorthand
const S = sax.STATE

function emit (parser, event, data) {
  parser[event] && parser[event](data)
}

function emitNode (parser, nodeType, data) {
  if (parser.textNode) closeText(parser)
  emit(parser, nodeType, data)
}

function closeText (parser) {
  parser.textNode = textopts(parser.opt, parser.textNode)
  if (parser.textNode) emit(parser, 'ontext', parser.textNode)
  parser.textNode = ''
}

function textopts (opt, text) {
  if (opt.trim) text = text.trim()
  if (opt.normalize) text = text.replace(/\s+/g, ' ')
  return text
}

function error (parser, er) {
  closeText(parser)
  if (parser.trackPosition) {
    er += '\nLine: ' + parser.line +
      '\nColumn: ' + parser.column +
      '\nChar: ' + parser.c
  }
  er = new Error(er)
  parser.error = er
  emit(parser, 'onerror', er)
  return parser
}

function end (parser) {
  if (parser.sawRoot && !parser.closedRoot) strictFail(parser, 'Unclosed root tag')
  if ((parser.state !== S.BEGIN) &&
    (parser.state !== S.BEGIN_WHITESPACE) &&
    (parser.state !== S.TEXT)) {
    error(parser, 'Unexpected end')
  }
  closeText(parser)
  parser.c = ''
  parser.closed = true
  emit(parser, 'onend')
  parser._initialize(parser.strict, parser.opt)
  return parser
}

function strictFail (parser, message) {
  if (typeof parser !== 'object' || !(parser instanceof SAXParser)) {
    throw new Error('bad call to strictFail')
  }
  if (parser.strict) {
    error(parser, message)
  }
}

function newTag (parser) {
  if (!parser.strict) parser.tagName = parser.tagName[parser.looseCase]()
  var parent = parser.tags[parser.tags.length - 1] || parser
  var tag = parser.tag = { name: parser.tagName, attributes: {} }

  // will be overridden if tag contails an xmlns="foo" or xmlns:foo="bar"
  if (parser.opt.xmlns) {
    tag.ns = parent.ns
  }
  parser.attribList.length = 0
  emitNode(parser, 'onopentagstart', tag)
}

function qname (name, attribute) {
  var i = name.indexOf(':')
  var qualName = i < 0 ? [ '', name ] : name.split(':')
  var prefix = qualName[0]
  var local = qualName[1]

  // <x "xmlns"="http://foo">
  if (attribute && name === 'xmlns') {
    prefix = 'xmlns'
    local = ''
  }

  return { prefix: prefix, local: local }
}

function attrib (parser) {
  if (!parser.strict) {
    parser.attribName = parser.attribName[parser.looseCase]()
  }

  if (parser.attribList.indexOf(parser.attribName) !== -1 ||
    parser.tag.attributes.hasOwnProperty(parser.attribName)) {
    parser.attribName = parser.attribValue = ''
    return
  }

  if (parser.opt.xmlns) {
    var qn = qname(parser.attribName, true)
    var prefix = qn.prefix
    var local = qn.local

    if (prefix === 'xmlns') {
      // namespace binding attribute. push the binding into scope
      if (local === 'xml' && parser.attribValue !== XML_NAMESPACE) {
        strictFail(parser,
          'xml: prefix must be bound to ' + XML_NAMESPACE + '\n' +
          'Actual: ' + parser.attribValue)
      } else if (local === 'xmlns' && parser.attribValue !== XMLNS_NAMESPACE) {
        strictFail(parser,
          'xmlns: prefix must be bound to ' + XMLNS_NAMESPACE + '\n' +
          'Actual: ' + parser.attribValue)
      } else {
        var tag = parser.tag
        var parent = parser.tags[parser.tags.length - 1] || parser
        if (tag.ns === parent.ns) {
          tag.ns = Object.create(parent.ns)
        }
        tag.ns[local] = parser.attribValue
      }
    }

    // defer onattribute events until all attributes have been seen
    // so any new bindings can take effect. preserve attribute order
    // so deferred events can be emitted in document order
    parser.attribList.push([parser.attribName, parser.attribValue])
  } else {
    // in non-xmlns mode, we can emit the event right away
    parser.tag.attributes[parser.attribName] = parser.attribValue
    emitNode(parser, 'onattribute', {
      name: parser.attribName,
      value: parser.attribValue
    })
  }

  parser.attribName = parser.attribValue = ''
}

function openTag (parser, selfClosing) {
  if (parser.opt.xmlns) {
    // emit namespace binding events
    var tag = parser.tag

    // add namespace info to tag
    var qn = qname(parser.tagName)
    tag.prefix = qn.prefix
    tag.local = qn.local
    tag.uri = tag.ns[qn.prefix] || ''

    if (tag.prefix && !tag.uri) {
      strictFail(parser, 'Unbound namespace prefix: ' +
        JSON.stringify(parser.tagName))
      tag.uri = qn.prefix
    }

    var parent = parser.tags[parser.tags.length - 1] || parser
    if (tag.ns && parent.ns !== tag.ns) {
      Object.keys(tag.ns).forEach(function (p) {
        emitNode(parser, 'onopennamespace', {
          prefix: p,
          uri: tag.ns[p]
        })
      })
    }

    // handle deferred onattribute events
    // Note: do not apply default ns to attributes:
    //   http://www.w3.org/TR/REC-xml-names/#defaulting
    for (var i = 0, l = parser.attribList.length; i < l; i++) {
      var nv = parser.attribList[i]
      var name = nv[0]
      var value = nv[1]
      var qualName = qname(name, true)
      var prefix = qualName.prefix
      var local = qualName.local
      var uri = prefix === '' ? '' : (tag.ns[prefix] || '')
      var a = {
        name: name,
        value: value,
        prefix: prefix,
        local: local,
        uri: uri
      }

      // if there's any attributes with an undefined namespace,
      // then fail on them now.
      if (prefix && prefix !== 'xmlns' && !uri) {
        strictFail(parser, 'Unbound namespace prefix: ' +
          JSON.stringify(prefix))
        a.uri = prefix
      }
      parser.tag.attributes[name] = a
      emitNode(parser, 'onattribute', a)
    }
    parser.attribList.length = 0
  }

  parser.tag.isSelfClosing = !!selfClosing

  // process the tag
  parser.sawRoot = true
  parser.tags.push(parser.tag)
  emitNode(parser, 'onopentag', parser.tag)
  if (!selfClosing) {
    // special case for <script> in non-strict mode.
    if (!parser.noscript && parser.tagName.toLowerCase() === 'script') {
      parser.state = S.SCRIPT
    } else {
      parser.state = S.TEXT
    }
    parser.tag = null
    parser.tagName = ''
  }
  parser.attribName = parser.attribValue = ''
  parser.attribList.length = 0
}

function closeTag (parser) {
  if (!parser.tagName) {
    strictFail(parser, 'Weird empty close tag.')
    parser.textNode += '</>'
    parser.state = S.TEXT
    return
  }

  if (parser.script) {
    if (parser.tagName !== 'script') {
      parser.script += '</' + parser.tagName + '>'
      parser.tagName = ''
      parser.state = S.SCRIPT
      return
    }
    emitNode(parser, 'onscript', parser.script)
    parser.script = ''
  }

  // first make sure that the closing tag actually exists.
  // <a><b></c></b></a> will close everything, otherwise.
  var t = parser.tags.length
  var tagName = parser.tagName
  if (!parser.strict) {
    tagName = tagName[parser.looseCase]()
  }
  var closeTo = tagName
  while (t--) {
    var close = parser.tags[t]
    if (close.name !== closeTo) {
      // fail the first time in strict mode
      strictFail(parser, 'Unexpected close tag')
    } else {
      break
    }
  }

  // didn't find it.  we already failed for strict, so just abort.
  if (t < 0) {
    strictFail(parser, 'Unmatched closing tag: ' + parser.tagName)
    parser.textNode += '</' + parser.tagName + '>'
    parser.state = S.TEXT
    return
  }
  parser.tagName = tagName
  var s = parser.tags.length
  while (s-- > t) {
    var tag = parser.tag = parser.tags.pop()
    parser.tagName = parser.tag.name
    emitNode(parser, 'onclosetag', parser.tagName)

    var x = {}
    for (var i in tag.ns) {
      x[i] = tag.ns[i]
    }

    var parent = parser.tags[parser.tags.length - 1] || parser
    if (parser.opt.xmlns && tag.ns !== parent.ns) {
      // remove namespace bindings introduced by tag
      Object.keys(tag.ns).forEach(function (p) {
        var n = tag.ns[p]
        emitNode(parser, 'onclosenamespace', { prefix: p, uri: n })
      })
    }
  }
  if (t === 0) parser.closedRoot = true
  parser.tagName = parser.attribValue = parser.attribName = ''
  parser.attribList.length = 0
  parser.state = S.TEXT
}

function parseEntity (parser) {
  var entity = parser.entity
  var entityLC = entity.toLowerCase()
  var num
  var numStr = ''

  if (parser.ENTITIES[entity]) {
    return parser.ENTITIES[entity]
  }
  if (parser.ENTITIES[entityLC]) {
    return parser.ENTITIES[entityLC]
  }
  entity = entityLC
  if (entity.charAt(0) === '#') {
    if (entity.charAt(1) === 'x') {
      entity = entity.slice(2)
      num = parseInt(entity, 16)
      numStr = num.toString(16)
    } else {
      entity = entity.slice(1)
      num = parseInt(entity, 10)
      numStr = num.toString(10)
    }
  }
  entity = entity.replace(/^0+/, '')
  if (isNaN(num) || numStr.toLowerCase() !== entity) {
    strictFail(parser, 'Invalid character entity')
    return '&' + parser.entity + ';'
  }

  return String.fromCodePoint(num)
}

function beginWhiteSpace (parser, c) {
  if (c === '<') {
    parser.state = S.OPEN_WAKA
    parser.startTagPosition = parser.position
  } else if (!isWhitespace(c)) {
    // have to process this as a text node.
    // weird, but happens.
    strictFail(parser, 'Non-whitespace before first tag.')
    parser.textNode = c
    parser.state = S.TEXT
  }
}

function charAt (chunk, i) {
  var result = ''
  if (i < chunk.length) {
    result = chunk.charAt(i)
  }
  return result
}

function write (chunk) {
  var parser = this
  if (this.error) {
    if (this.testMode) {
      this.error = null;
    } else {
      throw this.error
    }
  }
  if (parser.closed) {
    return error(parser,
      'Cannot write after close. Assign an onready handler.')
  }
  if (chunk === null) {
    return end(parser)
  }
  if (typeof chunk === 'object') {
    chunk = chunk.toString()
  }
  var i = 0
  var c = ''
  while (true) {
    c = charAt(chunk, i++)
    parser.c = c

    if (!c) {
      break
    }

    if (parser.trackPosition) {
      parser.position++
      if (c === '\n') {
        parser.line++
        parser.column = 0
      } else {
        parser.column++
      }
    }

    switch (parser.state) {
      case S.BEGIN:
        parser.state = S.BEGIN_WHITESPACE
        if (c === '\uFEFF') {
          continue
        }
        beginWhiteSpace(parser, c)
        continue

      case S.BEGIN_WHITESPACE:
        beginWhiteSpace(parser, c)
        continue

      case S.TEXT:
        if (parser.sawRoot && !parser.closedRoot) {
          var starti = i - 1
          while (c && c !== '<' && c !== '&') {
            c = charAt(chunk, i++)
            if (c && parser.trackPosition) {
              parser.position++
              if (c === '\n') {
                parser.line++
                parser.column = 0
              } else {
                parser.column++
              }
            }
          }
          parser.textNode += chunk.substring(starti, i - 1)
        }
        if (c === '<' && !(parser.sawRoot && parser.closedRoot && !parser.strict)) {
          parser.state = S.OPEN_WAKA
          parser.startTagPosition = parser.position
        } else {
          if (!isWhitespace(c) && (!parser.sawRoot || parser.closedRoot)) {
            strictFail(parser, 'Text data outside of root node.')
          }
          if (c === '&') {
            parser.state = S.TEXT_ENTITY
          } else {
            parser.textNode += c
          }
        }
        continue

      case S.SCRIPT:
        // only non-strict
        if (c === '<') {
          parser.state = S.SCRIPT_ENDING
        } else {
          parser.script += c
        }
        continue

      case S.SCRIPT_ENDING:
        if (c === '/') {
          parser.state = S.CLOSE_TAG
        } else {
          parser.script += '<' + c
          parser.state = S.SCRIPT
        }
        continue

      case S.OPEN_WAKA:
        // either a /, ?, !, or text is coming next.
        if (c === '!') {
          parser.state = S.SGML_DECL
          parser.sgmlDecl = ''
        } else if (isWhitespace(c)) {
          // wait for it...
        } else if (isMatch(nameStart, c)) {
          parser.state = S.OPEN_TAG
          parser.tagName = c
        } else if (c === '/') {
          parser.state = S.CLOSE_TAG
          parser.tagName = ''
        } else if (c === '?') {
          parser.state = S.PROC_INST
          parser.procInstName = parser.procInstBody = ''
        } else {
          strictFail(parser, 'Unencoded <')
          // if there was some whitespace, then add that in.
          if (parser.startTagPosition + 1 < parser.position) {
            var pad = parser.position - parser.startTagPosition
            c = new Array(pad).join(' ') + c
          }
          parser.textNode += '<' + c
          parser.state = S.TEXT
        }
        continue

      case S.SGML_DECL:
        if ((parser.sgmlDecl + c).toUpperCase() === CDATA) {
          emitNode(parser, 'onopencdata')
          parser.state = S.CDATA
          parser.sgmlDecl = ''
          parser.cdata = ''
        } else if (parser.sgmlDecl + c === '--') {
          parser.state = S.COMMENT
          parser.comment = ''
          parser.sgmlDecl = ''
        } else if ((parser.sgmlDecl + c).toUpperCase() === DOCTYPE) {
          parser.state = S.DOCTYPE
          if (parser.doctype || parser.sawRoot) {
            strictFail(parser,
              'Inappropriately located doctype declaration')
          }
          parser.doctype = ''
          parser.sgmlDecl = ''
        } else if (c === '>') {
          emitNode(parser, 'onsgmldeclaration', parser.sgmlDecl)
          parser.sgmlDecl = ''
          parser.state = S.TEXT
        } else if (isQuote(c)) {
          parser.state = S.SGML_DECL_QUOTED
          parser.sgmlDecl += c
        } else {
          parser.sgmlDecl += c
        }
        continue

      case S.SGML_DECL_QUOTED:
        if (c === parser.q) {
          parser.state = S.SGML_DECL
          parser.q = ''
        }
        parser.sgmlDecl += c
        continue

      case S.DOCTYPE:
        if (c === '>') {
          parser.state = S.TEXT
          emitNode(parser, 'ondoctype', parser.doctype)
          parser.doctype = true // just remember that we saw it.
        } else {
          parser.doctype += c
          if (c === '[') {
            parser.state = S.DOCTYPE_DTD
          } else if (isQuote(c)) {
            parser.state = S.DOCTYPE_QUOTED
            parser.q = c
          }
        }
        continue

      case S.DOCTYPE_QUOTED:
        parser.doctype += c
        if (c === parser.q) {
          parser.q = ''
          parser.state = S.DOCTYPE
        }
        continue

      case S.DOCTYPE_DTD:
        parser.doctype += c
        if (c === ']') {
          parser.state = S.DOCTYPE
        } else if (isQuote(c)) {
          parser.state = S.DOCTYPE_DTD_QUOTED
          parser.q = c
        }
        continue

      case S.DOCTYPE_DTD_QUOTED:
        parser.doctype += c
        if (c === parser.q) {
          parser.state = S.DOCTYPE_DTD
          parser.q = ''
        }
        continue

      case S.COMMENT:
        if (c === '-') {
          parser.state = S.COMMENT_ENDING
        } else {
          parser.comment += c
        }
        continue

      case S.COMMENT_ENDING:
        if (c === '-') {
          parser.state = S.COMMENT_ENDED
          parser.comment = textopts(parser.opt, parser.comment)
          if (parser.comment) {
            emitNode(parser, 'oncomment', parser.comment)
          }
          parser.comment = ''
        } else {
          parser.comment += '-' + c
          parser.state = S.COMMENT
        }
        continue

      case S.COMMENT_ENDED:
        if (c !== '>') {
          strictFail(parser, 'Malformed comment')
          // allow <!-- blah -- bloo --> in non-strict mode,
          // which is a comment of " blah -- bloo "
          parser.comment += '--' + c
          parser.state = S.COMMENT
        } else {
          parser.state = S.TEXT
        }
        continue

      case S.CDATA:
        if (c === ']') {
          parser.state = S.CDATA_ENDING
        } else {
          parser.cdata += c
        }
        continue

      case S.CDATA_ENDING:
        if (c === ']') {
          parser.state = S.CDATA_ENDING_2
        } else {
          parser.cdata += ']' + c
          parser.state = S.CDATA
        }
        continue

      case S.CDATA_ENDING_2:
        if (c === '>') {
          if (parser.cdata) {
            emitNode(parser, 'oncdata', parser.cdata)
          }
          emitNode(parser, 'onclosecdata')
          parser.cdata = ''
          parser.state = S.TEXT
        } else if (c === ']') {
          parser.cdata += ']'
        } else {
          parser.cdata += ']]' + c
          parser.state = S.CDATA
        }
        continue

      case S.PROC_INST:
        if (c === '?') {
          parser.state = S.PROC_INST_ENDING
        } else if (isWhitespace(c)) {
          parser.state = S.PROC_INST_BODY
        } else {
          parser.procInstName += c
        }
        continue

      case S.PROC_INST_BODY:
        if (!parser.procInstBody && isWhitespace(c)) {
          continue
        } else if (c === '?') {
          parser.state = S.PROC_INST_ENDING
        } else {
          parser.procInstBody += c
        }
        continue

      case S.PROC_INST_ENDING:
        if (c === '>') {
          emitNode(parser, 'onprocessinginstruction', {
            name: parser.procInstName,
            body: parser.procInstBody
          })
          parser.procInstName = parser.procInstBody = ''
          parser.state = S.TEXT
        } else {
          parser.procInstBody += '?' + c
          parser.state = S.PROC_INST_BODY
        }
        continue

      case S.OPEN_TAG:
        if (isMatch(nameBody, c)) {
          parser.tagName += c
        } else {
          newTag(parser)
          if (c === '>') {
            openTag(parser)
          } else if (c === '/') {
            parser.state = S.OPEN_TAG_SLASH
          } else {
            if (!isWhitespace(c)) {
              strictFail(parser, 'Invalid character in tag name')
            }
            parser.state = S.ATTRIB
          }
        }
        continue

      case S.OPEN_TAG_SLASH:
        if (c === '>') {
          openTag(parser, true)
          closeTag(parser)
        } else {
          strictFail(parser, 'Forward-slash in opening tag not followed by >')
          parser.state = S.ATTRIB
        }
        continue

      case S.ATTRIB:
        // haven't read the attribute name yet.
        if (isWhitespace(c)) {
          continue
        } else if (c === '>') {
          openTag(parser)
        } else if (c === '/') {
          parser.state = S.OPEN_TAG_SLASH
        } else if (isMatch(nameStart, c)) {
          parser.attribName = c
          parser.attribValue = ''
          parser.state = S.ATTRIB_NAME
        } else {
          strictFail(parser, 'Invalid attribute name')
        }
        continue

      case S.ATTRIB_NAME:
        if (c === '=') {
          parser.state = S.ATTRIB_VALUE
        } else if (c === '>') {
          strictFail(parser, 'Attribute without value')
          parser.attribValue = parser.attribName
          attrib(parser)
          openTag(parser)
        } else if (isWhitespace(c)) {
          parser.state = S.ATTRIB_NAME_SAW_WHITE
        } else if (isMatch(nameBody, c)) {
          parser.attribName += c
        } else {
          strictFail(parser, 'Invalid attribute name')
        }
        continue

      case S.ATTRIB_NAME_SAW_WHITE:
        if (c === '=') {
          parser.state = S.ATTRIB_VALUE
        } else if (isWhitespace(c)) {
          continue
        } else {
          strictFail(parser, 'Attribute without value')
          parser.tag.attributes[parser.attribName] = ''
          parser.attribValue = ''
          emitNode(parser, 'onattribute', {
            name: parser.attribName,
            value: ''
          })
          parser.attribName = ''
          if (c === '>') {
            openTag(parser)
          } else if (isMatch(nameStart, c)) {
            parser.attribName = c
            parser.state = S.ATTRIB_NAME
          } else {
            strictFail(parser, 'Invalid attribute name')
            parser.state = S.ATTRIB
          }
        }
        continue

      case S.ATTRIB_VALUE:
        if (isWhitespace(c)) {
          continue
        } else if (isQuote(c)) {
          parser.q = c
          parser.state = S.ATTRIB_VALUE_QUOTED
        } else {
          strictFail(parser, 'Unquoted attribute value')
          parser.state = S.ATTRIB_VALUE_UNQUOTED
          parser.attribValue = c
        }
        continue

      case S.ATTRIB_VALUE_QUOTED:
        if (c !== parser.q) {
          if (c === '&') {
            parser.state = S.ATTRIB_VALUE_ENTITY_Q
          } else {
            parser.attribValue += c
          }
          continue
        }
        attrib(parser)
        parser.q = ''
        parser.state = S.ATTRIB_VALUE_CLOSED
        continue

      case S.ATTRIB_VALUE_CLOSED:
        if (isWhitespace(c)) {
          parser.state = S.ATTRIB
        } else if (c === '>') {
          openTag(parser)
        } else if (c === '/') {
          parser.state = S.OPEN_TAG_SLASH
        } else if (isMatch(nameStart, c)) {
          strictFail(parser, 'No whitespace between attributes')
          parser.attribName = c
          parser.attribValue = ''
          parser.state = S.ATTRIB_NAME
        } else {
          strictFail(parser, 'Invalid attribute name')
        }
        continue

      case S.ATTRIB_VALUE_UNQUOTED:
        if (!isAttribEnd(c)) {
          if (c === '&') {
            parser.state = S.ATTRIB_VALUE_ENTITY_U
          } else {
            parser.attribValue += c
          }
          continue
        }
        attrib(parser)
        if (c === '>') {
          openTag(parser)
        } else {
          parser.state = S.ATTRIB
        }
        continue

      case S.CLOSE_TAG:
        if (!parser.tagName) {
          if (isWhitespace(c)) {
            continue
          } else if (notMatch(nameStart, c)) {
            if (parser.script) {
              parser.script += '</' + c
              parser.state = S.SCRIPT
            } else {
              strictFail(parser, 'Invalid tagname in closing tag.')
            }
          } else {
            parser.tagName = c
          }
        } else if (c === '>') {
          closeTag(parser)
        } else if (isMatch(nameBody, c)) {
          parser.tagName += c
        } else if (parser.script) {
          parser.script += '</' + parser.tagName
          parser.tagName = ''
          parser.state = S.SCRIPT
        } else {
          if (!isWhitespace(c)) {
            strictFail(parser, 'Invalid tagname in closing tag')
          }
          parser.state = S.CLOSE_TAG_SAW_WHITE
        }
        continue

      case S.CLOSE_TAG_SAW_WHITE:
        if (isWhitespace(c)) {
          continue
        }
        if (c === '>') {
          closeTag(parser)
        } else {
          strictFail(parser, 'Invalid characters in closing tag')
        }
        continue

      case S.TEXT_ENTITY:
      case S.ATTRIB_VALUE_ENTITY_Q:
      case S.ATTRIB_VALUE_ENTITY_U:
        var returnState
        var buffer
        switch (parser.state) {
          case S.TEXT_ENTITY:
            returnState = S.TEXT
            buffer = 'textNode'
            break

          case S.ATTRIB_VALUE_ENTITY_Q:
            returnState = S.ATTRIB_VALUE_QUOTED
            buffer = 'attribValue'
            break

          case S.ATTRIB_VALUE_ENTITY_U:
            returnState = S.ATTRIB_VALUE_UNQUOTED
            buffer = 'attribValue'
            break
        }

        if (c === ';') {
          parser[buffer] += parseEntity(parser)
          parser.entity = ''
          parser.state = returnState
        } else if (isMatch(parser.entity.length ? entityBody : entityStart, c)) {
          parser.entity += c
        } else {
          strictFail(parser, 'Invalid character in entity name')
          parser[buffer] += '&' + parser.entity + c
          parser.entity = ''
          parser.state = returnState
        }

        continue

      default:
        throw new Error(parser, 'Unknown state: ' + parser.state)
    }
  } // while

  if (parser.position >= parser.bufferCheckPosition) {
    checkBufferLength(parser)
  }
  return parser
}
