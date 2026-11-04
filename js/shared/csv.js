/* Parser_CSV dan Pencetak_CSV (Requirement 11).
 * Modul UMD-ringan: dipakai di browser sebagai global `CBTCsv` dan di Node
 * lewat module.exports. Fungsi murni, tanpa akses DOM atau jaringan.
 */
var CBTCsv = (function () {
  'use strict';

  var BOM = '\uFEFF';
  var FORMULA_START = { '=': true, '+': true, '-': true, '@': true };

  function isBlankRaw(s) {
    return /^[ \t]*$/.test(s);
  }

  function fail(error) {
    return { ok: false, error: error };
  }

  /**
   * Menentukan pemisah dari record header (Requirement 11.2): hitung `,` dan `;`
   * di luar kutip ganda pada record pertama yang tidak kosong.
   * Kutip dianggap membuka field hanya di awal field (setelah `,`/`;` atau awal record),
   * sama seperti mesin keadaan parser.
   */
  function detectDelimiter(text) {
    var i = 0;
    var n = text.length;
    // Lewati baris yang hanya berisi spasi/tab.
    while (i < n) {
      var j = i;
      while (j < n && (text[j] === ' ' || text[j] === '\t')) j++;
      if (j < n && (text[j] === '\r' || text[j] === '\n')) {
        if (text[j] === '\r' && text[j + 1] === '\n') j++;
        i = j + 1;
      } else {
        break;
      }
    }
    var commas = 0;
    var semis = 0;
    var inQuote = false;
    var atFieldStart = true;
    for (; i < n; i++) {
      var c = text[i];
      if (inQuote) {
        if (c === '"') {
          if (text[i + 1] === '"') {
            i++;
          } else {
            inQuote = false;
          }
        }
        continue;
      }
      if (c === '\r' || c === '\n') break;
      if (c === ',') {
        commas++;
        atFieldStart = true;
      } else if (c === ';') {
        semis++;
        atFieldStart = true;
      } else if (c === '"' && atFieldStart) {
        inQuote = true;
        atFieldStart = false;
      } else {
        atFieldStart = false;
      }
    }
    return semis > commas ? ';' : ',';
  }

  /**
   * Memecah teks menjadi record dengan mesin keadaan RFC 4180.
   * Mengembalikan { records: [{line, fields}] } atau { unclosedLine }.
   */
  function tokenize(text, delim) {
    var FIELD_START = 0;
    var UNQUOTED = 1;
    var QUOTED = 2;
    var QUOTE_IN_QUOTED = 3;

    var records = [];
    var state = FIELD_START;
    var line = 1;          // nomor baris fisik saat ini
    var recordLine = 1;    // baris awal record yang sedang dibaca
    var quoteLine = 0;     // baris tempat kutip ganda dibuka
    var fields = [];
    var field = '';
    var hadQuoted = false; // record memuat field ber-kutip
    var n = text.length;

    function endField() {
      fields.push(field);
      field = '';
    }

    function endRecord() {
      endField();
      var blank = !hadQuoted && fields.length === 1 && isBlankRaw(fields[0]);
      if (!blank) {
        records.push({ line: recordLine, fields: fields });
      }
      fields = [];
      hadQuoted = false;
      state = FIELD_START;
    }

    for (var i = 0; i < n; i++) {
      var c = text[i];

      if (state === QUOTED) {
        if (c === '"') {
          state = QUOTE_IN_QUOTED;
        } else {
          field += c;
          if (c === '\n' || (c === '\r' && text[i + 1] !== '\n')) line++;
        }
        continue;
      }

      if (state === QUOTE_IN_QUOTED && c === '"') {
        field += '"';
        state = QUOTED;
        continue;
      }

      // FIELD_START, UNQUOTED, atau QUOTE_IN_QUOTED dengan karakter selain `"`.
      if (c === delim) {
        endField();
        state = FIELD_START;
      } else if (c === '\r' || c === '\n') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        endRecord();
        line++;
        recordLine = line;
      } else if (c === '"' && state === FIELD_START) {
        state = QUOTED;
        hadQuoted = true;
        quoteLine = line;
      } else {
        // Karakter biasa. Setelah kutip penutup (tidak sesuai RFC) dibaca longgar
        // sebagai lanjutan field.
        field += c;
        state = UNQUOTED;
      }
    }

    if (state === QUOTED) {
      return { unclosedLine: quoteLine };
    }
    // Record terakhir tanpa akhir baris.
    if (state !== FIELD_START || fields.length > 0 || field !== '') {
      endRecord();
    }
    return { records: records };
  }

  /**
   * @param {string} text isi file CSV
   * @param {{requiredColumns?: string[]}} [opts]
   */
  function parseCsv(text, opts) {
    var src = text == null ? '' : String(text);
    if (src.charAt(0) === BOM) src = src.slice(1);
    var required = (opts && opts.requiredColumns) || [];

    var delim = detectDelimiter(src);
    var tok = tokenize(src, delim);

    if (tok.unclosedLine) {
      return fail({
        kind: 'UNCLOSED_QUOTE',
        line: tok.unclosedLine,
        message: 'Kutip ganda tidak tertutup, dibuka pada baris ' + tok.unclosedLine + '.'
      });
    }

    var records = tok.records;
    if (records.length === 0) {
      return fail({ kind: 'EMPTY', message: 'File CSV kosong atau tidak memiliki header.' });
    }

    var header = records[0].fields;
    // Kunci diberi awalan '#' agar nama seperti `valueOf`, `constructor`, atau
    // `__proto__` tidak bertabrakan dengan properti warisan Object.prototype.
    var trimmed = {};
    header.forEach(function (h) { trimmed['#' + h.trim()] = true; });
    var missing = [];
    var seen = {};
    required.forEach(function (col) {
      var key = String(col).trim();
      var k = '#' + key;
      if (trimmed[k] !== true && seen[k] !== true) {
        seen[k] = true;
        missing.push(key);
      }
    });
    if (missing.length > 0) {
      return fail({
        kind: 'MISSING_COLUMNS',
        missing: missing,
        message: 'Kolom wajib tidak ditemukan: ' + missing.join(', ') + '.'
      });
    }

    var expected = header.length;
    var rows = [];
    for (var r = 1; r < records.length; r++) {
      var rec = records[r];
      if (rec.fields.length !== expected) {
        return fail({
          kind: 'FIELD_COUNT',
          line: rec.line,
          found: rec.fields.length,
          expected: expected,
          message: 'Baris ' + rec.line + ': ditemukan ' + rec.fields.length +
            ' field, seharusnya ' + expected + ' kolom.'
        });
      }
      rows.push({ line: rec.line, fields: rec.fields });
    }

    return { ok: true, delimiter: delim, header: header, rows: rows };
  }

  function printField(value) {
    var s = value == null ? '' : String(value);
    if (s === '-') return s; // Requirement 11.11
    if (s.length > 0 && FORMULA_START[s.charAt(0)]) s = "'" + s; // Requirement 11.8
    if (/[",;\r\n]/.test(s)) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  function printRecord(values) {
    var out = (values || []).map(printField);
    var joined = out.join(',');
    // Record yang hanya spasi/tab (termasuk kosong) akan dilewati parser; kutip agar tetap terbaca.
    if (isBlankRaw(joined)) {
      var first = out.length > 0 ? out[0] : '';
      out[0] = '"' + first + '"';
      joined = out.join(',');
    }
    return joined;
  }

  /**
   * @param {string[]} header
   * @param {string[][]} rows
   * @returns {string} CSV diawali BOM, pemisah koma, akhir baris CRLF
   */
  function printCsv(header, rows) {
    var lines = [printRecord(header)];
    (rows || []).forEach(function (row) { lines.push(printRecord(row)); });
    return BOM + lines.join('\r\n') + '\r\n';
  }

  return {
    parseCsv: parseCsv,
    printCsv: printCsv
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CBTCsv;
}
