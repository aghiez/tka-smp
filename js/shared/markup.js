/*
 * Markup_Soal: Parser_Markup dan Pencetak_Markup.
 * Logika murni; berjalan di browser dan Node tanpa build.
 *
 * Notasi: [b] [u] [i] [sup] [sub] [akar] (tidak peka huruf), [frac]n|d[/frac],
 * baris baru = "\n", simbol = {{kode}}.
 * Escape: \\ \[ \] \{ \} \|  (backslash diikuti karakter lain tetap literal).
 *
 * AST:
 *   { t: 'text', v }            v tidak kosong, tanpa "\n"
 *   { t: 'br' }
 *   { t: 'sym', k }             k kunci TABEL_SIMBOL
 *   { t: 'b'|'u'|'i'|'sup'|'sub'|'akar', c: Node[] }
 *   { t: 'frac', n: Node[], d: Node[] }
 */
var CBTMarkup = (function () {
  'use strict';

  var TABEL_SIMBOL = {
    akar: '\u221A',    // √
    kali: '\u00D7',    // ×
    bagi: '\u00F7',    // ÷
    pm: '\u00B1',      // ±
    le: '\u2264',      // ≤
    ge: '\u2265',      // ≥
    ne: '\u2260',      // ≠
    derajat: '\u00B0', // °
    pi: '\u03C0',      // π
    inf: '\u221E',     // ∞
    kira: '\u2248'     // ≈
  };

  var TAG_ELEMEN = ['b', 'u', 'i', 'sup', 'sub', 'akar'];
  var TAG_RE = /^\[(\/?)(b|u|i|sup|sub|akar|frac)\]/i;
  var SYM_RE = /^\{\{([A-Za-z]+)\}\}/;
  var ESCAPABLE = '\\[]{}|';

  function hasOwn(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  }

  function isSimbol(k) {
    return typeof k === 'string' && hasOwn(TABEL_SIMBOL, k);
  }

  function isElemenTag(t) {
    return TAG_ELEMEN.indexOf(t) !== -1;
  }

  function normalizeEol(s) {
    return s.replace(/\r\n?/g, '\n');
  }

  // ---------------------------------------------------------------------
  // Tokenizer
  // Token: { k: 'TEXT', v } | { k: 'BR' } | { k: 'SEP' } | { k: 'SYM', v }
  //        | { k: 'OPEN', tag, raw } | { k: 'CLOSE', tag, raw }
  // ---------------------------------------------------------------------
  function tokenize(s) {
    var tokens = [];
    var buf = '';
    var i = 0;
    var n = s.length;

    function flush() {
      if (buf) {
        tokens.push({ k: 'TEXT', v: buf });
        buf = '';
      }
    }

    while (i < n) {
      var ch = s.charAt(i);
      if (ch === '\\') {
        var nx = s.charAt(i + 1);
        if (nx && ESCAPABLE.indexOf(nx) !== -1) {
          buf += nx;
          i += 2;
        } else {
          buf += ch;
          i += 1;
        }
      } else if (ch === '\n') {
        flush();
        tokens.push({ k: 'BR' });
        i += 1;
      } else if (ch === '|') {
        flush();
        tokens.push({ k: 'SEP' });
        i += 1;
      } else if (ch === '[') {
        var mt = TAG_RE.exec(s.slice(i, i + 8));
        if (mt) {
          flush();
          tokens.push({ k: mt[1] ? 'CLOSE' : 'OPEN', tag: mt[2].toLowerCase(), raw: mt[0] });
          i += mt[0].length;
        } else {
          buf += ch;
          i += 1;
        }
      } else if (ch === '{') {
        var ms = SYM_RE.exec(s.slice(i, i + 16));
        if (ms && isSimbol(ms[1])) {
          flush();
          tokens.push({ k: 'SYM', v: ms[1] });
          i += ms[0].length;
        } else {
          buf += ch;
          i += 1;
        }
      } else {
        buf += ch;
        i += 1;
      }
    }
    flush();
    return tokens;
  }

  // ---------------------------------------------------------------------
  // Pencocokan dengan stack. Mengembalikan array pair: pair[open] = close,
  // pair[close] = open; token tak berpasangan bernilai -1.
  // ---------------------------------------------------------------------
  function matchTags(tokens) {
    var pair = new Array(tokens.length);
    var stack = [];
    var i, j;
    for (i = 0; i < tokens.length; i++) {
      pair[i] = -1;
      var tk = tokens[i];
      if (tk.k === 'OPEN') {
        stack.push(i);
      } else if (tk.k === 'CLOSE') {
        for (j = stack.length - 1; j >= 0; j--) {
          if (tokens[stack[j]].tag === tk.tag) break;
        }
        if (j >= 0) {
          var o = stack[j];
          stack.length = j; // opener di atasnya menjadi literal
          pair[o] = i;
          pair[i] = o;
        }
      }
    }
    return pair;
  }

  // Indeks SEP yang langsung berada di tingkat (from, to) dengan melompati pasangan bersarang.
  function directSeps(tokens, pair, from, to) {
    var seps = [];
    var i = from;
    while (i < to) {
      var tk = tokens[i];
      if (tk.k === 'OPEN' && pair[i] !== -1) {
        i = pair[i] + 1;
        continue;
      }
      if (tk.k === 'SEP') seps.push(i);
      i += 1;
    }
    return seps;
  }

  function build(tokens, pair, from, to, out) {
    var i = from;
    while (i < to) {
      var tk = tokens[i];
      switch (tk.k) {
        case 'TEXT':
          out.push({ t: 'text', v: tk.v });
          i += 1;
          break;
        case 'BR':
          out.push({ t: 'br' });
          i += 1;
          break;
        case 'SYM':
          out.push({ t: 'sym', k: tk.v });
          i += 1;
          break;
        case 'SEP':
          out.push({ t: 'text', v: '|' });
          i += 1;
          break;
        case 'CLOSE':
          // CLOSE yang berpasangan selalu dilompati oleh OPEN-nya.
          out.push({ t: 'text', v: tk.raw });
          i += 1;
          break;
        case 'OPEN': {
          var close = pair[i];
          if (close === -1) {
            out.push({ t: 'text', v: tk.raw });
            i += 1;
            break;
          }
          if (tk.tag === 'frac') {
            var seps = directSeps(tokens, pair, i + 1, close);
            if (seps.length === 1) {
              out.push({
                t: 'frac',
                n: build(tokens, pair, i + 1, seps[0], []),
                d: build(tokens, pair, seps[0] + 1, close, [])
              });
            } else {
              out.push({ t: 'text', v: tk.raw });
              build(tokens, pair, i + 1, close, out);
              out.push({ t: 'text', v: tokens[close].raw });
            }
          } else {
            out.push({ t: tk.tag, c: build(tokens, pair, i + 1, close, []) });
          }
          i = close + 1;
          break;
        }
        default:
          i += 1;
      }
    }
    return out;
  }

  /**
   * Parser_Markup: teks -> Doc kanonik. Total: tidak pernah melempar untuk input string.
   * @param {string} text
   * @returns {Array} Doc
   */
  function parseMarkup(text) {
    var s = text === null || text === undefined ? '' : String(text);
    if (!s) return [];
    s = normalizeEol(s);
    var tokens = tokenize(s);
    var pair = matchTags(tokens);
    return normalize(build(tokens, pair, 0, tokens.length, []));
  }

  // ---------------------------------------------------------------------
  // normalize: bentuk kanonik (tanpa text kosong, tanpa text bersebelahan,
  // "\n" di dalam text dipecah menjadi br, sym tak dikenal menjadi text).
  // ---------------------------------------------------------------------
  function normalize(doc) {
    var out = [];
    var list = Array.isArray(doc) ? doc : [];

    function pushText(v) {
      if (!v) return;
      var last = out[out.length - 1];
      if (last && last.t === 'text') {
        last.v += v;
      } else {
        out.push({ t: 'text', v: v });
      }
    }

    for (var i = 0; i < list.length; i++) {
      var node = list[i];
      if (!node || typeof node !== 'object') continue;
      switch (node.t) {
        case 'text': {
          var v = node.v === null || node.v === undefined ? '' : String(node.v);
          var parts = normalizeEol(v).split('\n');
          for (var p = 0; p < parts.length; p++) {
            if (p > 0) out.push({ t: 'br' });
            pushText(parts[p]);
          }
          break;
        }
        case 'br':
          out.push({ t: 'br' });
          break;
        case 'sym':
          if (isSimbol(node.k)) {
            out.push({ t: 'sym', k: node.k });
          } else {
            pushText('{{' + String(node.k) + '}}');
          }
          break;
        case 'frac':
          out.push({ t: 'frac', n: normalize(node.n), d: normalize(node.d) });
          break;
        default:
          if (isElemenTag(node.t)) {
            out.push({ t: node.t, c: normalize(node.c) });
          }
      }
    }
    return out;
  }

  // ---------------------------------------------------------------------
  // Pencetak_Markup
  // ---------------------------------------------------------------------
  function escapeText(v) {
    return v.replace(/[\\\[\]{}|]/g, function (c) { return '\\' + c; });
  }

  function printNodes(list) {
    var s = '';
    for (var i = 0; i < list.length; i++) {
      var node = list[i];
      if (!node || typeof node !== 'object') continue;
      switch (node.t) {
        case 'text':
          s += escapeText(String(node.v === null || node.v === undefined ? '' : node.v));
          break;
        case 'br':
          s += '\n';
          break;
        case 'sym':
          s += isSimbol(node.k) ? '{{' + node.k + '}}' : escapeText('{{' + String(node.k) + '}}');
          break;
        case 'frac':
          s += '[frac]' + printNodes(node.n || []) + '|' + printNodes(node.d || []) + '[/frac]';
          break;
        default:
          if (isElemenTag(node.t)) {
            s += '[' + node.t + ']' + printNodes(node.c || []) + '[/' + node.t + ']';
          }
      }
    }
    return s;
  }

  /**
   * Pencetak_Markup: Doc -> teks Markup_Soal.
   * parseMarkup(printMarkup(doc)) setara dengan normalize(doc).
   * @param {Array} doc
   * @returns {string}
   */
  function printMarkup(doc) {
    return printNodes(Array.isArray(doc) ? doc : []);
  }

  // ---------------------------------------------------------------------
  // Perender_Soal: Doc -> string HTML aman (tanpa DOM).
  // Hanya tag daftar putih: strong, u, em, sup, sub, br, span.m-*.
  // ---------------------------------------------------------------------
  var HTML_ENTITAS = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  /**
   * Meng-escape & < > " ' menjadi entitas HTML.
   * @param {*} s
   * @returns {string}
   */
  function escapeHtml(s) {
    var v = s === null || s === undefined ? '' : String(s);
    return v.replace(/[&<>"']/g, function (c) { return HTML_ENTITAS[c]; });
  }

  var TAG_HTML = { b: 'strong', u: 'u', i: 'em', sup: 'sup', sub: 'sub' };

  function renderNodes(list) {
    var s = '';
    for (var i = 0; i < list.length; i++) {
      var node = list[i];
      if (!node || typeof node !== 'object') continue;
      switch (node.t) {
        case 'text':
          s += escapeHtml(node.v);
          break;
        case 'br':
          s += '<br>';
          break;
        case 'sym':
          s += isSimbol(node.k) ? TABEL_SIMBOL[node.k] : escapeHtml('{{' + String(node.k) + '}}');
          break;
        case 'akar':
          s += '<span class="m-akar">' + TABEL_SIMBOL.akar + '<span class="m-radikan">' +
            renderNodes(node.c || []) + '</span></span>';
          break;
        case 'frac':
          s += '<span class="m-frac"><span class="m-num">' + renderNodes(node.n || []) +
            '</span><span class="m-den">' + renderNodes(node.d || []) + '</span></span>';
          break;
        default:
          if (hasOwn(TAG_HTML, node.t)) {
            var tag = TAG_HTML[node.t];
            s += '<' + tag + '>' + renderNodes(node.c || []) + '</' + tag + '>';
          }
      }
    }
    return s;
  }

  /**
   * Perender_Soal: Doc (atau teks Markup_Soal) -> string HTML aman untuk innerHTML.
   * @param {Array|string} doc
   * @returns {string}
   */
  function renderHtml(doc) {
    if (typeof doc === 'string') doc = parseMarkup(doc);
    return renderNodes(Array.isArray(doc) ? doc : []);
  }

  // ---------------------------------------------------------------------
  // Bantu format form Soal (murni).
  // kind: 'b'|'u'|'i'|'sup'|'sub'|'akar'|'frac' atau 'sym:<kode>' (kode di TABEL_SIMBOL).
  // ---------------------------------------------------------------------
  function clampInt(x, lo, hi, dflt) {
    var n = typeof x === 'number' && isFinite(x) ? Math.floor(x) : dflt;
    if (n < lo) n = lo;
    if (n > hi) n = hi;
    return n;
  }

  /**
   * Menyisipkan atau mengapit notasi Markup_Soal pada posisi seleksi.
   * @param {string} value isi kolom teks
   * @param {number} selStart
   * @param {number} selEnd
   * @param {string} kind
   * @returns {{value:string, selStart:number, selEnd:number}}
   */
  function insertMarkup(value, selStart, selEnd, kind) {
    var v = value === null || value === undefined ? '' : String(value);
    var s = clampInt(selStart, 0, v.length, v.length);
    var e = clampInt(selEnd, 0, v.length, s);
    if (e < s) { var tmp = s; s = e; e = tmp; }
    var k = String(kind === null || kind === undefined ? '' : kind);
    var before = v.slice(0, s);
    var sel = v.slice(s, e);
    var after = v.slice(e);

    if (k.indexOf('sym:') === 0) {
      var kode = k.slice(4);
      if (!isSimbol(kode)) return { value: v, selStart: s, selEnd: e };
      var ins = '{{' + kode + '}}';
      var pos = s + ins.length;
      return { value: before + ins + after, selStart: pos, selEnd: pos };
    }

    var tag = k.toLowerCase();
    var buka, tutup;
    if (tag === 'frac') {
      buka = '[frac]';
      tutup = '|[/frac]';
    } else if (isElemenTag(tag)) {
      buka = '[' + tag + ']';
      tutup = '[/' + tag + ']';
    } else {
      return { value: v, selStart: s, selEnd: e };
    }
    return {
      value: before + buka + sel + tutup + after,
      selStart: s + buka.length,
      selEnd: s + buka.length + sel.length
    };
  }

  /**
   * Cuplikan daftar Soal: teks utuh jika panjang <= max, selain itu max karakter pertama + "...".
   * @param {string} teks
   * @param {number} [max=100]
   * @returns {string}
   */
  function cuplikan(teks, max) {
    var v = teks === null || teks === undefined ? '' : String(teks);
    var m = typeof max === 'number' && isFinite(max) && max >= 0 ? Math.floor(max) : 100;
    return v.length <= m ? v : v.slice(0, m) + '...';
  }

  return {
    TABEL_SIMBOL: TABEL_SIMBOL,
    TAG_ELEMEN: TAG_ELEMEN.slice(),
    parseMarkup: parseMarkup,
    normalize: normalize,
    printMarkup: printMarkup,
    escapeHtml: escapeHtml,
    renderHtml: renderHtml,
    insertMarkup: insertMarkup,
    cuplikan: cuplikan
  };
})();
if (typeof module !== 'undefined' && module.exports) { module.exports = CBTMarkup; }
