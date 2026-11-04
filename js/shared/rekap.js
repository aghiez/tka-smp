/* Model tampilan rekap nilai, ringkasan, pencarian/paginasi Peserta, dan nama
 * file ekspor (Requirement 4.3, 4.4, 23.1–23.6, 23.11, 24.11).
 * Modul UMD-ringan: dipakai di browser sebagai global `CBTRekap` dan di Node
 * lewat module.exports. Fungsi murni. Bergantung pada `CBTDatetime`
 * (frontend/js/shared/datetime.js), yang harus dimuat lebih dulu di browser.
 *
 * Bentuk data masukan (data mentah dari Backend `rekapMapel`/`rekapPeserta`):
 *   Peserta : { id, nama, kelas, ... }            (PesertaView)
 *   Mapel   : { kodeMapel, namaMapel, statusAktif? }
 *   Sesi    : { idSesi, status: 'AKTIF'|'SELESAI', waktuMulai, waktuSelesai }
 *   Hasil   : { benar, salah, kosong, skor }
 * Nama kolom sheet (snake_case, mis. `id_sesi`, `jumlah_benar`) juga diterima.
 * Peta (`sesiByPeserta`, `sesiByMapel`, `hasilBySesi`) boleh berupa objek
 * biasa atau `Map`.
 */
var CBTRekap = (function () {
  'use strict';

  /* global CBTDatetime, require */
  var DT = (typeof CBTDatetime !== 'undefined' && CBTDatetime) ? CBTDatetime :
    (typeof require === 'function' ? require('./datetime.js') : null);

  var KOSONG = '-';
  var STATUS_BELUM = 'belum mulai';
  var STATUS_AKTIF = 'sedang mengerjakan';
  var STATUS_SELESAI = 'selesai';
  var UKURAN_HALAMAN = 50;

  var HEADER_MAPEL = ['ID Peserta', 'Nama', 'Kelas', 'Status', 'Waktu Mulai',
    'Waktu Selesai', 'Benar', 'Salah', 'Kosong', 'Skor'];
  var HEADER_PESERTA = ['Kode Mapel', 'Nama Mapel', 'Status', 'Skor'];

  /* ---------- utilitas ---------- */

  function hasOwn(o, k) {
    return Object.prototype.hasOwnProperty.call(o, k);
  }

  /** Ambil field pertama yang terdefinisi dari daftar nama alternatif. */
  function pick(obj, names) {
    if (!obj) return undefined;
    for (var i = 0; i < names.length; i++) {
      var v = obj[names[i]];
      if (v !== undefined && v !== null) return v;
    }
    return undefined;
  }

  /** Ambil nilai dari Map atau objek biasa; tidak ada → null. */
  function lookup(map, key) {
    if (!map || key === undefined || key === null) return null;
    if (typeof map.get === 'function' && typeof map.has === 'function') {
      return map.has(key) ? map.get(key) : null;
    }
    var k = String(key);
    return hasOwn(map, k) ? map[k] : null;
  }

  function str(v) {
    return v === undefined || v === null ? '' : String(v);
  }

  /** Urutan menaik `localeCompare` numerik; seri dipecah perbandingan kode unit. */
  function compareId(a, b) {
    var x = str(a);
    var y = str(b);
    var c = x.localeCompare(y, undefined, { numeric: true });
    if (c !== 0) return c < 0 ? -1 : 1;
    return x < y ? -1 : (x > y ? 1 : 0);
  }

  function toNumber(v) {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (typeof v === 'string' && v.trim() !== '') {
      var n = Number(v);
      return isFinite(n) ? n : null;
    }
    return null;
  }

  function toMs(v) {
    if (v instanceof Date) return v.getTime();
    return toNumber(v);
  }

  /** Pembulatan setengah ke atas dua desimal (sama dengan Penilai). */
  function roundHalfUp2(x) {
    var r = Number(Math.round(Number(x + 'e2')) + 'e-2');
    return isFinite(r) ? r : Math.round(x * 100) / 100;
  }

  /** Angka dua desimal, atau "-" bila tidak ada. */
  function fmtSkor(v) {
    var n = toNumber(v);
    return n === null ? KOSONG : roundHalfUp2(n).toFixed(2);
  }

  /** Bilangan apa adanya, atau "-" bila tidak ada. */
  function fmtJumlah(v) {
    var n = toNumber(v);
    return n === null ? KOSONG : String(n);
  }

  /** `DD/MM/YYYY HH:mm` Asia/Jakarta, atau "-" bila tidak ada/tidak valid. */
  function fmtWaktu(v) {
    var ms = toMs(v);
    if (ms === null || !DT) return KOSONG;
    var s = DT.formatJakarta(ms);
    return s === '' ? KOSONG : s;
  }

  function statusDariSesi(sesi) {
    if (!sesi) return STATUS_BELUM;
    var s = str(pick(sesi, ['status'])).toUpperCase();
    if (s === 'SELESAI') return STATUS_SELESAI;
    if (s === 'AKTIF') return STATUS_AKTIF;
    return STATUS_BELUM;
  }

  function hasilUntuk(sesi, hasilBySesi) {
    if (!sesi) return null;
    return lookup(hasilBySesi, pick(sesi, ['idSesi', 'id_sesi'])) || null;
  }

  /* ---------- ringkasan ---------- */

  /**
   * Ringkasan dari baris rekap per Mapel yang sedang ditampilkan
   * (Requirement 23.3, 23.4, 23.6). Hanya baris berstatus "selesai" yang
   * dihitung; statistik skor dari baris "selesai" yang skornya ada.
   * @param {Array<{status:string, skor:string}>} rows
   * @returns {{jumlahSelesai:number, rataRata:string, tertinggi:string, terendah:string}}
   */
  function hitungRingkasan(rows) {
    var jumlah = 0;
    var skor = [];
    (rows || []).forEach(function (r) {
      if (!r || r.status !== STATUS_SELESAI) return;
      jumlah++;
      var n = r.skor === KOSONG ? null : toNumber(r.skor);
      if (n !== null) skor.push(n);
    });
    if (skor.length === 0) {
      return { jumlahSelesai: jumlah, rataRata: KOSONG, tertinggi: KOSONG, terendah: KOSONG };
    }
    // Jumlahkan dalam satuan seperseratus (bilangan bulat) agar rata-rata
    // tidak terkena galat penjumlahan float, lalu bulatkan setengah ke atas.
    var total = 0;
    var max = skor[0];
    var min = skor[0];
    skor.forEach(function (n) {
      total += Math.round(n * 100);
      if (n > max) max = n;
      if (n < min) min = n;
    });
    var cnt = skor.length;
    var rata = Math.floor((2 * total + cnt) / (2 * cnt)) / 100;
    return {
      jumlahSelesai: jumlah,
      rataRata: fmtSkor(rata),
      tertinggi: fmtSkor(max),
      terendah: fmtSkor(min)
    };
  }

  /* ---------- rekap ---------- */

  /**
   * Rekap per Mapel (Requirement 23.1, 23.2, 23.6): satu baris per Peserta
   * yang lolos filter kelas (sama persis), urut ID peserta menaik.
   * @param {Array} peserta daftar Peserta
   * @param {Object|Map} sesiByPeserta idPeserta → Sesi Mapel ini
   * @param {Object|Map} hasilBySesi idSesi → Hasil
   * @param {string|null} filterKelas null/undefined/'' = Semua
   * @returns {{jenis:'mapel', rows:Array, ringkasan:Object}}
   */
  function buildRekapMapel(peserta, sesiByPeserta, hasilBySesi, filterKelas) {
    var semua = filterKelas === null || filterKelas === undefined || filterKelas === '';
    var rows = [];
    (peserta || []).forEach(function (p) {
      if (!p) return;
      var kelas = str(pick(p, ['kelas']));
      if (!semua && kelas !== String(filterKelas)) return;
      var id = str(pick(p, ['id', 'idPeserta', 'id_pengguna', 'id_peserta']));
      var sesi = lookup(sesiByPeserta, id);
      var hasil = hasilUntuk(sesi, hasilBySesi);
      rows.push({
        idPeserta: id,
        nama: str(pick(p, ['nama', 'namaLengkap', 'nama_lengkap'])),
        kelas: kelas,
        status: statusDariSesi(sesi),
        mulai: sesi ? fmtWaktu(pick(sesi, ['waktuMulai', 'waktu_mulai'])) : KOSONG,
        selesai: hasil ? fmtWaktu(pick(sesi, ['waktuSelesai', 'waktu_selesai'])) : KOSONG,
        benar: hasil ? fmtJumlah(pick(hasil, ['benar', 'jumlahBenar', 'jumlah_benar'])) : KOSONG,
        salah: hasil ? fmtJumlah(pick(hasil, ['salah', 'jumlahSalah', 'jumlah_salah'])) : KOSONG,
        kosong: hasil ? fmtJumlah(pick(hasil, ['kosong', 'jumlahKosong', 'jumlah_kosong'])) : KOSONG,
        skor: hasil ? fmtSkor(pick(hasil, ['skor'])) : KOSONG
      });
    });
    rows.sort(function (a, b) { return compareId(a.idPeserta, b.idPeserta); });
    return { jenis: 'mapel', rows: rows, ringkasan: hitungRingkasan(rows) };
  }

  /**
   * Rekap per Peserta (Requirement 23.5): satu baris per Mapel aktif, urut
   * kode mapel menaik. Mapel dengan `statusAktif === false` dilewati.
   * @param {Array} mapelAktif daftar Mapel
   * @param {Object|Map} sesiByMapel kodeMapel → Sesi Peserta ini
   * @param {Object|Map} hasilBySesi idSesi → Hasil
   * @returns {{jenis:'peserta', rows:Array<{kodeMapel,namaMapel,status,skor}>}}
   */
  function buildRekapPeserta(mapelAktif, sesiByMapel, hasilBySesi) {
    var rows = [];
    (mapelAktif || []).forEach(function (m) {
      if (!m) return;
      var aktif = pick(m, ['statusAktif', 'status_aktif']);
      if (aktif === false) return;
      var kode = str(pick(m, ['kodeMapel', 'kode_mapel']));
      var sesi = lookup(sesiByMapel, kode);
      var hasil = hasilUntuk(sesi, hasilBySesi);
      rows.push({
        kodeMapel: kode,
        namaMapel: str(pick(m, ['namaMapel', 'nama_mapel'])),
        status: statusDariSesi(sesi),
        skor: hasil ? fmtSkor(pick(hasil, ['skor'])) : KOSONG
      });
    });
    rows.sort(function (a, b) { return compareId(a.kodeMapel, b.kodeMapel); });
    return { jenis: 'peserta', rows: rows };
  }

  /**
   * Tabel string siap tampil yang sama untuk layar, CSV, dan XLSX
   * (Requirement 23.7, 23.8). Tanpa baris → hanya header (Requirement 23.9).
   * @param {{jenis:'mapel'|'peserta', rows:Array}} rekap
   * @returns {{header:string[], rows:string[][]}}
   */
  function rekapToTable(rekap) {
    var jenis = rekap && rekap.jenis;
    var rows = (rekap && rekap.rows) || [];
    if (jenis === 'mapel') {
      return {
        header: HEADER_MAPEL.slice(),
        rows: rows.map(function (r) {
          return [r.idPeserta, r.nama, r.kelas, r.status, r.mulai, r.selesai,
            r.benar, r.salah, r.kosong, r.skor].map(str);
        })
      };
    }
    if (jenis === 'peserta') {
      return {
        header: HEADER_PESERTA.slice(),
        rows: rows.map(function (r) {
          return [r.kodeMapel, r.namaMapel, r.status, r.skor].map(str);
        })
      };
    }
    throw new Error('Jenis rekap tidak dikenal: ' + str(jenis));
  }

  /* ---------- pencarian dan paginasi Peserta ---------- */

  /**
   * Peserta yang ID, nama, kelas, atau username-nya memuat kata kunci
   * (di-trim, tanpa beda huruf), urutan asli dipertahankan. Kata kunci
   * kosong → seluruh daftar (Requirement 4.3).
   * @param {Array} list
   * @param {string} keyword
   * @returns {Array}
   */
  function filterPeserta(list, keyword) {
    var arr = (list || []).slice();
    var k = str(keyword).trim().toLowerCase();
    if (k === '') return arr;
    return arr.filter(function (p) {
      if (!p) return false;
      var fields = [
        pick(p, ['id', 'idPeserta', 'id_pengguna']),
        pick(p, ['nama', 'namaLengkap', 'nama_lengkap']),
        pick(p, ['kelas']),
        pick(p, ['username'])
      ];
      for (var i = 0; i < fields.length; i++) {
        if (str(fields[i]).toLowerCase().indexOf(k) !== -1) return true;
      }
      return false;
    });
  }

  /**
   * Paginasi (Requirement 4.4). Halaman 1-based, dijepit ke [1, totalPages];
   * totalPages = max(1, ceil(n/size)).
   * @param {Array} list
   * @param {number} page
   * @param {number} [size=50]
   * @returns {{items:Array, page:number, totalPages:number, total:number}}
   */
  function paginate(list, page, size) {
    var arr = list || [];
    var s = Math.floor(Number(size));
    if (!isFinite(s) || s < 1) s = UKURAN_HALAMAN;
    var totalPages = Math.max(1, Math.ceil(arr.length / s));
    var p = Math.floor(Number(page));
    if (!isFinite(p) || p < 1) p = 1;
    if (p > totalPages) p = totalPages;
    var start = (p - 1) * s;
    return {
      items: arr.slice(start, start + s),
      page: p,
      totalPages: totalPages,
      total: arr.length
    };
  }

  /* ---------- nama file ekspor ---------- */

  /**
   * Nama file ekspor dengan tanggal Asia/Jakarta dari `ms`:
   *   'rekap'  → `rekap_{kode mapel|ID peserta}_{YYYYMMDD}.{csv|xlsx}` (Req 23.11)
   *   'detail' → `detail_{ID peserta}_{kode mapel}_{YYYYMMDD}.csv`     (Req 24.11)
   * @param {'rekap'|'detail'} jenis
   * @param {string|string[]} ids
   * @param {number} ms
   * @param {string} [ext] default 'csv'
   * @returns {string}
   */
  function namaFileEkspor(jenis, ids, ms, ext) {
    var list = Array.isArray(ids) ? ids.map(str) : [str(ids)];
    var e = ext === undefined || ext === null || ext === '' ? 'csv' : String(ext).replace(/^\./, '').toLowerCase();
    var tgl = DT ? DT.ymdJakarta(ms) : '';
    if (tgl === '') throw new Error('Waktu ekspor tidak valid');
    if (jenis === 'rekap') {
      if (e !== 'csv' && e !== 'xlsx') throw new Error('Ekstensi rekap harus csv atau xlsx');
      if (list.length < 1 || list[0] === '') throw new Error('ID rekap wajib diisi');
      return 'rekap_' + list[0] + '_' + tgl + '.' + e;
    }
    if (jenis === 'detail') {
      if (e !== 'csv') throw new Error('Ekstensi detail harus csv');
      if (list.length < 2 || list[0] === '' || list[1] === '') {
        throw new Error('ID peserta dan kode mapel wajib diisi');
      }
      return 'detail_' + list[0] + '_' + list[1] + '_' + tgl + '.' + e;
    }
    throw new Error('Jenis ekspor tidak dikenal: ' + str(jenis));
  }

  return {
    KOSONG: KOSONG,
    STATUS_BELUM: STATUS_BELUM,
    STATUS_AKTIF: STATUS_AKTIF,
    STATUS_SELESAI: STATUS_SELESAI,
    UKURAN_HALAMAN: UKURAN_HALAMAN,
    HEADER_MAPEL: HEADER_MAPEL.slice(),
    HEADER_PESERTA: HEADER_PESERTA.slice(),
    compareId: compareId,
    hitungRingkasan: hitungRingkasan,
    buildRekapMapel: buildRekapMapel,
    buildRekapPeserta: buildRekapPeserta,
    rekapToTable: rekapToTable,
    filterPeserta: filterPeserta,
    paginate: paginate,
    namaFileEkspor: namaFileEkspor
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = CBTRekap;
