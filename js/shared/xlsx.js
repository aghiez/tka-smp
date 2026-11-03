// Penulis XLSX minimal (tanpa pustaka eksternal).
// buildXlsx(sheetName, header, rows) -> Uint8Array berisi file .xlsx utuh
// (ZIP metode STORE + CRC32 + OOXML minimal). Seluruh byte dibangun lebih dulu
// sehingga kegagalan tidak pernah menghasilkan unduhan sebagian (Req 23.10).
var CBTXlsx = (function () {
  'use strict';

  // ---------- CRC32 (tabel) ----------
  var CRC_TABLE = (function () {
    var table = new Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) {
      crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  // ---------- UTF-8 ----------
  // Encoder manual agar tidak bergantung pada TextEncoder. Surrogate tunggal
  // diganti U+FFFD (seharusnya sudah dibuang oleh sanitizeXmlText).
  function utf8(str) {
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var cp = str.charCodeAt(i);
      if (cp >= 0xD800 && cp <= 0xDBFF && i + 1 < str.length) {
        var lo = str.charCodeAt(i + 1);
        if (lo >= 0xDC00 && lo <= 0xDFFF) {
          cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00);
          i++;
        } else {
          cp = 0xFFFD;
        }
      } else if (cp >= 0xD800 && cp <= 0xDFFF) {
        cp = 0xFFFD;
      }
      if (cp < 0x80) {
        out.push(cp);
      } else if (cp < 0x800) {
        out.push(0xC0 | (cp >> 6), 0x80 | (cp & 0x3F));
      } else if (cp < 0x10000) {
        out.push(0xE0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3F), 0x80 | (cp & 0x3F));
      } else {
        out.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3F),
          0x80 | ((cp >> 6) & 0x3F), 0x80 | (cp & 0x3F));
      }
    }
    return new Uint8Array(out);
  }

  // ---------- XML ----------
  // Membuang karakter yang tidak valid di XML 1.0:
  // valid = #x9 | #xA | #xD | [#x20-#xD7FF] | [#xE000-#xFFFD] | [#x10000-#x10FFFF]
  function sanitizeXmlText(str) {
    var out = '';
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c >= 0xD800 && c <= 0xDBFF) {
        var lo = i + 1 < str.length ? str.charCodeAt(i + 1) : 0;
        if (lo >= 0xDC00 && lo <= 0xDFFF) {
          out += str.charAt(i) + str.charAt(i + 1);
          i++;
        }
        continue; // high surrogate tunggal dibuang
      }
      if (c >= 0xDC00 && c <= 0xDFFF) continue; // low surrogate tunggal
      if (c === 0x9 || c === 0xA || c === 0xD ||
          (c >= 0x20 && c <= 0xD7FF) || (c >= 0xE000 && c <= 0xFFFD)) {
        out += str.charAt(i);
      }
    }
    return out;
  }

  function escapeXml(str) {
    return sanitizeXmlText(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  // Nama sheet Excel: maks 31 karakter, tanpa : \ / ? * [ ], tidak kosong,
  // tidak diawali/diakhiri apostrof.
  function sanitizeSheetName(name) {
    var s = sanitizeXmlText(name == null ? '' : String(name))
      .replace(/[:\\\/?*\[\]\r\n\t]/g, ' ')
      .replace(/^'+|'+$/g, '')
      .trim();
    if (s.length > 31) s = s.slice(0, 31);
    return s || 'Sheet1';
  }

  // 0 -> A, 25 -> Z, 26 -> AA
  function columnName(index) {
    var name = '';
    var n = index + 1;
    while (n > 0) {
      var r = (n - 1) % 26;
      name = String.fromCharCode(65 + r) + name;
      n = Math.floor((n - 1) / 26);
    }
    return name;
  }

  function cellXml(value, ref, style) {
    var s = style ? ' s="' + style + '"' : '';
    if (typeof value === 'number' && isFinite(value)) {
      return '<c r="' + ref + '"' + s + '><v>' + String(value) + '</v></c>';
    }
    var text = value == null ? '' : String(value);
    return '<c r="' + ref + '"' + s + ' t="inlineStr"><is><t xml:space="preserve">' +
      escapeXml(text) + '</t></is></c>';
  }

  function rowXml(cells, rowNumber, style) {
    var parts = ['<row r="' + rowNumber + '">'];
    for (var i = 0; i < cells.length; i++) {
      parts.push(cellXml(cells[i], columnName(i) + rowNumber, style));
    }
    parts.push('</row>');
    return parts.join('');
  }

  var XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

  function sheetXml(header, rows) {
    var parts = [XML_DECL,
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
      '<sheetData>'];
    parts.push(rowXml(header, 1, 1));
    for (var r = 0; r < rows.length; r++) {
      parts.push(rowXml(rows[r] || [], r + 2, 0));
    }
    parts.push('</sheetData></worksheet>');
    return parts.join('');
  }

  var CONTENT_TYPES = XML_DECL +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    '</Types>';

  var ROOT_RELS = XML_DECL +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>';

  var WORKBOOK_RELS = XML_DECL +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '</Relationships>';

  // Style 0 = normal, style 1 = tebal (font 1).
  var STYLES = XML_DECL +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="2">' +
    '<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>' +
    '<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>' +
    '</fonts>' +
    '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="2">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';

  function workbookXml(sheetName) {
    return XML_DECL +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets><sheet name="' + escapeXml(sanitizeSheetName(sheetName)) +
      '" sheetId="1" r:id="rId1"/></sheets></workbook>';
  }

  // ---------- ZIP (STORE) ----------
  // Waktu DOS tetap 1980-01-01 00:00 agar keluaran deterministik.
  var DOS_TIME = 0;
  var DOS_DATE = (0 << 9) | (1 << 5) | 1;
  var FLAG_UTF8 = 0x0800;

  function writeU16(buf, pos, v) { buf[pos] = v & 0xFF; buf[pos + 1] = (v >>> 8) & 0xFF; }
  function writeU32(buf, pos, v) {
    buf[pos] = v & 0xFF; buf[pos + 1] = (v >>> 8) & 0xFF;
    buf[pos + 2] = (v >>> 16) & 0xFF; buf[pos + 3] = (v >>> 24) & 0xFF;
  }

  // files: [{ name: string, data: Uint8Array }]
  function zipStore(files) {
    var entries = [];
    var localSize = 0;
    var centralSize = 0;
    for (var i = 0; i < files.length; i++) {
      var nameBytes = utf8(files[i].name);
      var data = files[i].data;
      entries.push({ name: nameBytes, data: data, crc: crc32(data), offset: localSize });
      localSize += 30 + nameBytes.length + data.length;
      centralSize += 46 + nameBytes.length;
    }
    var total = localSize + centralSize + 22;
    var out = new Uint8Array(total);
    var p = 0;
    var e, j;

    for (j = 0; j < entries.length; j++) {
      e = entries[j];
      writeU32(out, p, 0x04034B50);
      writeU16(out, p + 4, 20);          // versi minimum
      writeU16(out, p + 6, FLAG_UTF8);
      writeU16(out, p + 8, 0);           // metode STORE
      writeU16(out, p + 10, DOS_TIME);
      writeU16(out, p + 12, DOS_DATE);
      writeU32(out, p + 14, e.crc);
      writeU32(out, p + 18, e.data.length);
      writeU32(out, p + 22, e.data.length);
      writeU16(out, p + 26, e.name.length);
      writeU16(out, p + 28, 0);          // panjang extra
      p += 30;
      out.set(e.name, p); p += e.name.length;
      out.set(e.data, p); p += e.data.length;
    }

    var centralStart = p;
    for (j = 0; j < entries.length; j++) {
      e = entries[j];
      writeU32(out, p, 0x02014B50);
      writeU16(out, p + 4, 20);          // dibuat oleh
      writeU16(out, p + 6, 20);          // versi minimum
      writeU16(out, p + 8, FLAG_UTF8);
      writeU16(out, p + 10, 0);
      writeU16(out, p + 12, DOS_TIME);
      writeU16(out, p + 14, DOS_DATE);
      writeU32(out, p + 16, e.crc);
      writeU32(out, p + 20, e.data.length);
      writeU32(out, p + 24, e.data.length);
      writeU16(out, p + 28, e.name.length);
      writeU16(out, p + 30, 0);          // extra
      writeU16(out, p + 32, 0);          // komentar
      writeU16(out, p + 34, 0);          // nomor disk
      writeU16(out, p + 36, 0);          // atribut internal
      writeU32(out, p + 38, 0);          // atribut eksternal
      writeU32(out, p + 42, e.offset);
      p += 46;
      out.set(e.name, p); p += e.name.length;
    }

    writeU32(out, p, 0x06054B50);
    writeU16(out, p + 4, 0);
    writeU16(out, p + 6, 0);
    writeU16(out, p + 8, entries.length);
    writeU16(out, p + 10, entries.length);
    writeU32(out, p + 12, p - centralStart);
    writeU32(out, p + 16, centralStart);
    writeU16(out, p + 20, 0);
    return out;
  }

  /**
   * @param {string} sheetName
   * @param {string[]} header
   * @param {(string|number)[][]} rows
   * @returns {Uint8Array} file .xlsx utuh
   */
  function buildXlsx(sheetName, header, rows) {
    if (!Array.isArray(header)) throw new TypeError('header harus berupa array');
    if (rows == null) rows = [];
    if (!Array.isArray(rows)) throw new TypeError('rows harus berupa array');
    return zipStore([
      { name: '[Content_Types].xml', data: utf8(CONTENT_TYPES) },
      { name: '_rels/.rels', data: utf8(ROOT_RELS) },
      { name: 'xl/workbook.xml', data: utf8(workbookXml(sheetName)) },
      { name: 'xl/_rels/workbook.xml.rels', data: utf8(WORKBOOK_RELS) },
      { name: 'xl/styles.xml', data: utf8(STYLES) },
      { name: 'xl/worksheets/sheet1.xml', data: utf8(sheetXml(header, rows)) }
    ]);
  }

  return {
    buildXlsx: buildXlsx,
    // diekspos untuk pengujian
    crc32: crc32,
    utf8: utf8,
    sanitizeXmlText: sanitizeXmlText,
    escapeXml: escapeXml,
    sanitizeSheetName: sanitizeSheetName,
    columnName: columnName,
    zipStore: zipStore
  };
})();
if (typeof module !== 'undefined' && module.exports) { module.exports = CBTXlsx; }
