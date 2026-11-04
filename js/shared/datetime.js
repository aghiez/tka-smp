/* Format tanggal zona Asia/Jakarta (Requirement 23.11, 24.11, 27.4).
 * Modul UMD-ringan: dipakai di browser sebagai global `CBTDatetime` dan di Node
 * lewat module.exports. Fungsi murni.
 *
 * Asia/Jakarta = UTC+7 tetap tanpa DST, jadi konversi cukup dengan menambah
 * 7 jam lalu membaca komponen UTC. Hasil tidak bergantung pada zona waktu
 * perangkat maupun dukungan Intl.
 */
var CBTDatetime = (function () {
  'use strict';

  var OFFSET_MS = 7 * 60 * 60 * 1000;

  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function pad4(n) {
    var s = String(n);
    while (s.length < 4) s = '0' + s;
    return s;
  }

  /** Mengembalikan Date yang komponen UTC-nya = waktu dinding Jakarta, atau null. */
  function jakartaDate(ms) {
    if (typeof ms !== 'number' || !isFinite(ms)) return null;
    var d = new Date(ms + OFFSET_MS);
    return isNaN(d.getTime()) ? null : d;
  }

  /**
   * `DD/MM/YYYY HH:mm`, jam 24, zona Asia/Jakarta (Requirement 27.4).
   * Masukan bukan angka valid → string kosong.
   * @param {number} ms epoch milidetik
   * @returns {string}
   */
  function formatJakarta(ms) {
    var d = jakartaDate(ms);
    if (!d) return '';
    return pad2(d.getUTCDate()) + '/' + pad2(d.getUTCMonth() + 1) + '/' +
      pad4(d.getUTCFullYear()) + ' ' +
      pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes());
  }

  /**
   * `YYYYMMDD` tanggal Asia/Jakarta, untuk nama file ekspor
   * (Requirement 23.11, 24.11). Masukan bukan angka valid → string kosong.
   * @param {number} ms epoch milidetik
   * @returns {string}
   */
  function ymdJakarta(ms) {
    var d = jakartaDate(ms);
    if (!d) return '';
    return pad4(d.getUTCFullYear()) + pad2(d.getUTCMonth() + 1) + pad2(d.getUTCDate());
  }

  /**
   * `DD/MM/YYYY, HH.mm`, jam 24, zona Asia/Jakarta, untuk Waktu Tes di
   * Halaman_Konfirmasi_Tes (Requirement 14.4). Masukan tidak valid → ''.
   * @param {number} ms epoch milidetik
   * @returns {string}
   */
  function formatWaktuTes(ms) {
    var d = jakartaDate(ms);
    if (!d) return '';
    return pad2(d.getUTCDate()) + '/' + pad2(d.getUTCMonth() + 1) + '/' +
      pad4(d.getUTCFullYear()) + ', ' +
      pad2(d.getUTCHours()) + '.' + pad2(d.getUTCMinutes());
  }

  /**
   * Tahun kalender Asia/Jakarta, untuk pita copyright (Requirement 6.10).
   * Masukan tidak valid → NaN.
   * @param {number} ms epoch milidetik
   * @returns {number}
   */
  function tahunJakarta(ms) {
    var d = jakartaDate(ms);
    return d ? d.getUTCFullYear() : NaN;
  }

  /**
   * Tanggal ISO `YYYY-MM-DD` → `DD/MM/YYYY` (Requirement 4.3). Kosong atau
   * bukan tanggal kalender yang sah → '-'.
   * @param {string} iso
   * @returns {string}
   */
  function tanggalIsoKeTampil(iso) {
    if (typeof iso !== 'string') return '-';
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
    if (!m) return '-';
    var y = Number(m[1]), mo = Number(m[2]), dd = Number(m[3]);
    var d = new Date(Date.UTC(y, mo - 1, dd));
    if (d.getUTCFullYear() !== y || d.getUTCMonth() !== mo - 1 || d.getUTCDate() !== dd) return '-';
    return m[3] + '/' + m[2] + '/' + m[1];
  }

  return {
    OFFSET_MS: OFFSET_MS,
    formatJakarta: formatJakarta,
    ymdJakarta: ymdJakarta,
    formatWaktuTes: formatWaktuTes,
    tahunJakarta: tahunJakarta,
    tanggalIsoKeTampil: tanggalIsoKeTampil
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = CBTDatetime;
