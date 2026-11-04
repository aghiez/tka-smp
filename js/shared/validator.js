/*
 * CBTValidator — aturan validasi bersama Frontend dan Backend.
 *
 * Berkas ini adalah sumber kebenaran. Salinan identik byte per byte ada di
 * backend/Shared_Validator.gs (dicek oleh tes shared-sync). Jangan memakai
 * API browser atau Apps Script di sini: semua fungsi murni.
 *
 * Fungsi validasi mengembalikan { valid, value, errors }:
 *   valid  : true jika tidak ada error
 *   value  : nilai ternormalisasi (teks sudah di-trim, angka sudah Number,
 *            boolean sudah boolean)
 *   errors : { [field]: string[] } berisi pesan berbahasa Indonesia
 *
 * Trim hanya membuang spasi, tab, dan baris baru (CR/LF) di awal dan akhir
 * (Requirement 25.8). Panjang teks dihitung dalam karakter (code point).
 * Password juga di-trim, sama di semua jalur (buat, login, ganti, reset),
 * sehingga hasilnya konsisten.
 */
var CBTValidator = (function () {
  'use strict';

  // ---------------------------------------------------------------------
  // Konstanta
  // ---------------------------------------------------------------------

  var LETTERS = ['A', 'B', 'C', 'D', 'E'];
  var TIPE_SOAL = ['PG', 'PGK', 'BS', 'BSM'];
  var JENIS_MAPEL = { wajib: 'Wajib', pilihan: 'Pilihan' };
  var BOOL_SEL = { 'true': true, 'false': false, 'ya': true, 'tidak': false, '1': true, '0': false };
  var MAKS_IMG = 10;
  var OPSI_BS = { A: 'Benar', B: 'Salah' };

  var RE_ID = /^[A-Za-z0-9-]+$/;
  var RE_USERNAME = /^[A-Za-z0-9._]+$/;
  var RE_NUMBER = /^[+-]?(\d+(\.\d+)?|\.\d+)$/;
  var RE_TRIM = /^[ \t\r\n]+|[ \t\r\n]+$/g;

  var MSG_ANGKA = 'nilai harus berupa angka';

  /** Label field untuk pesan yang dapat dibaca Pengguna. */
  var LABEL = {
    username: 'Username',
    password: 'Password',
    passwordBaru: 'Password baru',
    id: 'ID peserta',
    nama: 'Nama lengkap',
    kelas: 'Kelas/jenjang',
    statusAktif: 'Status aktif',
    kodeMapel: 'Kode mapel',
    namaMapel: 'Nama mapel',
    durasiMenit: 'Durasi ujian',
    jumlahSoal: 'Jumlah soal ditampilkan',
    acakSoal: 'Acak urutan soal',
    acakOpsi: 'Acak urutan opsi',
    tampilSkor: 'Tampil skor',
    jenjang: 'Jenjang',
    jenisMapel: 'Jenis mapel',
    tampilkanReviu: 'Penanda reviu',
    jenisKelamin: 'Jenis kelamin',
    tipe: 'Tipe soal',
    stimulus: 'Stimulus',
    teks: 'Teks soal',
    urlGambar: 'URL gambar',
    opsi: 'Opsi jawaban',
    opsiA: 'Opsi A',
    opsiB: 'Opsi B',
    opsiC: 'Opsi C',
    opsiD: 'Opsi D',
    opsiE: 'Opsi E',
    kunci: 'Kunci jawaban',
    pembahasan: 'Pembahasan',
    bobot: 'Bobot nilai',
    tanggalLahir: 'Tanggal lahir',
    token: 'Token',
    namaAplikasi: 'Nama aplikasi',
    subjudul: 'Subjudul',
    urlLogo: 'URL logo',
    pemilikHakCipta: 'Nama pemilik hak cipta',
    intervalTokenMenit: 'Interval token',
    tampilkanTokenKePeserta: 'Tampilkan token ke peserta'
  };

  var RE_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
  var RE_DMY = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
  var RE_TOKEN_UJIAN = /^[A-Za-z0-9]{6}$/;
  var TANGGAL_MIN = '1900-01-01';
  var JAM_JAKARTA_MS = 7 * 3600000;

  // ---------------------------------------------------------------------
  // Utilitas dasar
  // ---------------------------------------------------------------------

  function label(field) {
    return LABEL[field] || field;
  }

  /** Membuang spasi/tab/baris baru di awal dan akhir. Non-string → ''. */
  function trimText(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number' || typeof v === 'boolean') v = String(v);
    if (typeof v !== 'string') return '';
    return v.replace(RE_TRIM, '');
  }

  /** Salinan dangkal objek dengan semua nilai string di-trim (Requirement 25.8). */
  function trimFields(obj) {
    var out = {};
    if (!obj || typeof obj !== 'object') return out;
    Object.keys(obj).forEach(function (k) {
      var v = obj[k];
      out[k] = typeof v === 'string' ? v.replace(RE_TRIM, '') : v;
    });
    return out;
  }

  /** Panjang teks dalam code point (pasangan surrogate dihitung satu). */
  function charLength(s) {
    var n = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
        var d = s.charCodeAt(i + 1);
        if (d >= 0xdc00 && d <= 0xdfff) i++;
      }
      n++;
    }
    return n;
  }

  /** true jika v adalah angka desimal valid (number berhingga atau teks angka). */
  function isNumberLike(v) {
    if (typeof v === 'number') return isFinite(v);
    if (typeof v !== 'string') return false;
    return RE_NUMBER.test(v.replace(RE_TRIM, ''));
  }

  function isBlank(v) {
    return v === null || v === undefined || trimText(v) === '';
  }

  function format(n) {
    // 5000 → "5.000" (pemisah ribuan gaya Indonesia)
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }

  function Collector() {
    this.errors = {};
  }
  Collector.prototype.add = function (field, msg) {
    if (!this.errors[field]) this.errors[field] = [];
    this.errors[field].push(msg);
  };
  Collector.prototype.result = function (value) {
    return { valid: Object.keys(this.errors).length === 0, value: value, errors: this.errors };
  };

  // ---------------------------------------------------------------------
  // Pemeriksa field
  // ---------------------------------------------------------------------

  /** Teks wajib dengan panjang min–max. Mengembalikan nilai ter-trim. */
  function checkText(c, field, raw, min, max, required, lbl) {
    var nm = lbl || label(field);
    var s = trimText(raw);
    var n = charLength(s);
    if (n === 0) {
      if (required) c.add(field, nm + ' wajib diisi.');
      return s;
    }
    if (n < min || n > max) {
      if (min === max) {
        c.add(field, nm + ' harus ' + format(min) + ' karakter.');
      } else if (min <= 1) {
        c.add(field, nm + ' paling banyak ' + format(max) + ' karakter.');
      } else {
        c.add(field, nm + ' harus ' + format(min) + ' sampai ' + format(max) + ' karakter.');
      }
    }
    return s;
  }

  /** Requirement 28.5: teks memuat paling banyak 10 Gambar_Markup. */
  function checkImg(c, field, s, lbl) {
    if (jumlahImg(s) > MAKS_IMG) {
      c.add(field, (lbl || label(field)) + ' memuat lebih dari ' + MAKS_IMG + ' gambar.');
    }
  }

  /** Teks wajib 1–max yang hanya boleh memuat karakter sesuai pola. */
  function checkPattern(c, field, raw, min, max, re, charsDesc) {
    var s = trimText(raw);
    if (s === '') {
      c.add(field, label(field) + ' wajib diisi.');
      return s;
    }
    var n = charLength(s);
    if (n < min || n > max) {
      c.add(field, label(field) + ' harus ' + format(min) + ' sampai ' + format(max) + ' karakter.');
    }
    if (!re.test(s)) {
      c.add(field, label(field) + ' hanya boleh berisi ' + charsDesc + '.');
    }
    return s;
  }

  /**
   * Angka wajib. opts: {integer, min, max, minExclusive}.
   * Mengembalikan Number jika berupa angka, atau nilai ter-trim jika bukan.
   */
  function checkNumber(c, field, raw, opts) {
    if (isBlank(raw)) {
      c.add(field, label(field) + ' wajib diisi.');
      return typeof raw === 'string' ? '' : raw;
    }
    if (!isNumberLike(raw)) {
      c.add(field, label(field) + ': ' + MSG_ANGKA + '.');
      return typeof raw === 'string' ? trimText(raw) : raw;
    }
    var n = typeof raw === 'number' ? raw : Number(trimText(raw));
    if (opts.integer && Math.floor(n) !== n) {
      c.add(field, label(field) + ' harus bilangan bulat ' + format(opts.min) + ' sampai ' + format(opts.max) + '.');
      return n;
    }
    var tooLow = opts.minExclusive ? n <= opts.min : n < opts.min;
    if (tooLow || n > opts.max) {
      if (opts.minExclusive) {
        c.add(field, label(field) + ' harus lebih besar dari ' + format(opts.min) + ' dan paling besar ' + format(opts.max) + '.');
      } else {
        c.add(field, label(field) + ' harus antara ' + format(opts.min) + ' dan ' + format(opts.max) + '.');
      }
    }
    return n;
  }

  /**
   * Boolean dengan nilai bawaan jika kosong. Menerima true/false, 1/0,
   * "true"/"false", "1"/"0", "aktif"/"nonaktif", "ya"/"tidak" (tanpa beda huruf).
   */
  function checkBool(c, field, raw, dflt) {
    if (raw === true || raw === false) return raw;
    if (raw === 1) return true;
    if (raw === 0) return false;
    if (isBlank(raw)) return dflt;
    var s = trimText(raw).toLowerCase();
    if (s === 'true' || s === '1' || s === 'aktif' || s === 'ya') return true;
    if (s === 'false' || s === '0' || s === 'nonaktif' || s === 'tidak') return false;
    c.add(field, label(field) + ' harus bernilai ya/aktif atau tidak/nonaktif.');
    return typeof raw === 'string' ? trimText(raw) : raw;
  }

  // ---------------------------------------------------------------------
  // Login dan password
  // ---------------------------------------------------------------------

  /** Requirement 2.11: wajib (setelah trim), username ≤ 50, password ≤ 100. */
  function validateLogin(input) {
    var o = input || {};
    var c = new Collector();
    var value = {
      username: checkText(c, 'username', o.username, 1, 50, true),
      password: checkText(c, 'password', o.password, 1, 100, true)
    };
    return c.result(value);
  }

  /**
   * Requirement 3.10: 8–64 karakter, minimal satu huruf ASCII dan satu angka,
   * tidak sama dengan password lama. Semua pelanggaran dilaporkan.
   */
  function validatePasswordBaru(baru, lama) {
    var c = new Collector();
    var f = 'passwordBaru';
    var s = trimText(baru);
    var n = charLength(s);
    if (n === 0) c.add(f, label(f) + ' wajib diisi.');
    if (n < 8 || n > 64) c.add(f, label(f) + ' harus 8 sampai 64 karakter.');
    if (!/[A-Za-z]/.test(s)) c.add(f, label(f) + ' harus memuat minimal satu huruf (A–Z atau a–z).');
    if (!/[0-9]/.test(s)) c.add(f, label(f) + ' harus memuat minimal satu angka (0–9).');
    if (lama !== undefined && lama !== null && n > 0 && s === trimText(lama)) {
      c.add(f, label(f) + ' tidak boleh sama dengan password lama.');
    }
    return c.result(s);
  }

  /** Requirement 5.3, 5.5: password Peserta 6–64 karakter. */
  function validatePasswordPeserta(p) {
    var c = new Collector();
    var s = trimText(p);
    if (s === '') {
      c.add('password', 'Password wajib diisi.');
    } else if (charLength(s) < 6 || charLength(s) > 64) {
      c.add('password', 'Password harus 6 sampai 64 karakter.');
    }
    return c.result(s);
  }

  // ---------------------------------------------------------------------
  // Peserta
  // ---------------------------------------------------------------------

  /**
   * Requirement 4.1, 4.4, 4.5, 4.12, 25.6 (cbt-tka); 4.1, 4.4, 4.5 (tampilan-anbk).
   * input: {id, nama, kelas, username, password?, statusAktif?,
   *         jenisKelamin?, tanggalLahir?}
   * opts.isNew: password wajib (6–64) saat tambah; saat ubah password diabaikan.
   * opts.now  : waktu acuan (ms) untuk batas atas tanggal lahir; bawaan Date.now().
   * jenisKelamin: '', 'L', atau 'P' (setelah trim). tanggalLahir: '' atau
   * 'YYYY-MM-DD' kalender benar antara 1900-01-01 dan hari ini (Asia/Jakarta).
   */
  function validatePeserta(input, opts) {
    var o = input || {};
    var isNew = !!(opts && opts.isNew);
    var now = opts && typeof opts.now === 'number' && isFinite(opts.now) ? opts.now : Date.now();
    var c = new Collector();
    var value = {
      id: checkPattern(c, 'id', o.id, 1, 20, RE_ID, 'huruf, angka, atau tanda hubung (-)'),
      nama: checkText(c, 'nama', o.nama, 1, 100, true),
      kelas: checkText(c, 'kelas', o.kelas, 1, 30, true),
      username: checkPattern(c, 'username', o.username, 3, 30, RE_USERNAME, 'huruf, angka, titik (.), atau garis bawah (_)'),
      statusAktif: checkBool(c, 'statusAktif', o.statusAktif, true),
      jenisKelamin: trimText(o.jenisKelamin),
      tanggalLahir: trimText(o.tanggalLahir)
    };
    var jk = value.jenisKelamin;
    if (jk !== '' && jk !== 'L' && jk !== 'P') {
      c.add('jenisKelamin', 'Jenis kelamin tidak valid: pilih Laki-Laki (L), Perempuan (P), atau kosongkan.');
    }
    var tgl = value.tanggalLahir;
    if (tgl !== '') {
      var iso = RE_ISO.test(tgl) ? parseTanggal(tgl) : null;
      if (iso === null || !validTanggalLahir(iso, tanggalHariIniJakarta(now))) {
        c.add('tanggalLahir', 'Tanggal lahir tidak valid: harus tanggal yang benar antara 01/01/1900 dan hari ini.');
      } else {
        value.tanggalLahir = iso;
      }
    }
    if (isNew) {
      var p = validatePasswordPeserta(o.password);
      value.password = p.value;
      if (!p.valid) c.errors.password = p.errors.password;
    }
    return c.result(value);
  }

  // ---------------------------------------------------------------------
  // Mapel
  // ---------------------------------------------------------------------

  /**
   * Requirement 3.1, 3.4, 3.6, 30.1, 30.4: Penanda_Reviu. undefined/null/''
   * → false; true/false; teks sel boolean TRUE/FALSE/ya/tidak/1/0 (tanpa beda
   * huruf, setelah trim) → boolean; lainnya error.
   */
  function checkPenandaReviu(c, raw) {
    if (raw === true || raw === false) return raw;
    if (raw === undefined || raw === null) return false;
    if (typeof raw === 'string') {
      var s = trimText(raw).toLowerCase();
      if (s === '') return false;
      if (BOOL_SEL.hasOwnProperty(s)) return BOOL_SEL[s];
    }
    c.add('tampilkanReviu', 'Penanda reviu tidak valid.');
    return typeof raw === 'string' ? trimText(raw) : raw;
  }

  /**
   * Requirement 7.1, 7.5 (cbt-tka); 3.1, 3.4, 3.6, 30.1, 30.4 (tampilan-anbk).
   * input: {kodeMapel, namaMapel, durasiMenit, jumlahSoal, statusAktif,
   *         acakSoal, acakOpsi, tampilSkor, jenjang?, jenisMapel?,
   *         tampilkanReviu?}
   * Boolean kosong memakai bawaan: statusAktif=true, lainnya false.
   * jenjang 0–50 karakter; jenisMapel kosong → 'Wajib', 'Wajib'/'Pilihan'
   * tanpa beda huruf → bentuk kanonik.
   */
  function validateMapel(input) {
    var o = input || {};
    var c = new Collector();
    var value = {
      kodeMapel: checkPattern(c, 'kodeMapel', o.kodeMapel, 1, 20, RE_ID, 'huruf, angka, atau tanda hubung (-)'),
      namaMapel: checkText(c, 'namaMapel', o.namaMapel, 1, 100, true),
      durasiMenit: checkNumber(c, 'durasiMenit', o.durasiMenit, { integer: true, min: 1, max: 600 }),
      jumlahSoal: checkNumber(c, 'jumlahSoal', o.jumlahSoal, { integer: true, min: 1, max: 200 }),
      statusAktif: checkBool(c, 'statusAktif', o.statusAktif, true),
      acakSoal: checkBool(c, 'acakSoal', o.acakSoal, false),
      acakOpsi: checkBool(c, 'acakOpsi', o.acakOpsi, false),
      tampilSkor: checkBool(c, 'tampilSkor', o.tampilSkor, false),
      jenjang: checkText(c, 'jenjang', o.jenjang, 0, 50, false),
      jenisMapel: trimText(o.jenisMapel),
      tampilkanReviu: checkPenandaReviu(c, o.tampilkanReviu)
    };
    var jm = value.jenisMapel.toLowerCase();
    if (jm === '') value.jenisMapel = 'Wajib';
    else if (JENIS_MAPEL.hasOwnProperty(jm)) value.jenisMapel = JENIS_MAPEL[jm];
    else c.add('jenisMapel', 'Jenis mapel harus Wajib atau Pilihan.');
    return c.result(value);
  }

  // ---------------------------------------------------------------------
  // Soal
  // ---------------------------------------------------------------------

  /** Kunci dari array atau teks dipisah koma → daftar huruf ter-trim huruf besar. */
  function parseKunci(raw) {
    var parts;
    if (Array.isArray(raw)) parts = raw;
    else if (isBlank(raw)) parts = [];
    else parts = trimText(raw).split(',');
    var out = [];
    parts.forEach(function (p) {
      var s = trimText(p).toUpperCase();
      if (s !== '') out.push(s);
    });
    return out;
  }

  /**
   * Requirement 8.5, 8.7–8.11, 9.11, 25.7 (cbt-tka); 5.1, 5.3, 25.1, 25.2,
   * 25.4, 28.5 (tampilan-anbk).
   * input: {idSoal?, kodeMapel, tipe, stimulus?, teks, urlGambar?,
   *         opsi:{A..E}, kunci: string[] | "A,C" | "B,S,B", pembahasan?, bobot}
   * value.opsi selalu berisi A–E (kosong = ''); BS dipaksa Benar/Salah.
   * value.kunci berupa array huruf terurut jika valid; untuk BSM berupa
   * array posisional B/S (satu per Pernyataan, urutan opsi A..).
   * stimulus 0–10.000 karakter. stimulus, teks, opsi, dan pembahasan
   * masing-masing memuat paling banyak 10 Gambar_Markup.
   */
  function validateSoal(input) {
    var o = input || {};
    var c = new Collector();
    var value = {};
    if (o.idSoal !== undefined) value.idSoal = trimText(o.idSoal);

    value.kodeMapel = checkPattern(c, 'kodeMapel', o.kodeMapel, 1, 20, RE_ID, 'huruf, angka, atau tanda hubung (-)');

    var tipe = trimText(o.tipe).toUpperCase();
    value.tipe = tipe;
    if (tipe === '') c.add('tipe', 'Tipe soal wajib diisi.');
    else if (TIPE_SOAL.indexOf(tipe) < 0) c.add('tipe', 'Tipe soal harus PG, PGK, BS, atau BSM.');

    value.stimulus = checkText(c, 'stimulus', o.stimulus, 0, 10000, false);
    checkImg(c, 'stimulus', value.stimulus);

    value.teks = checkText(c, 'teks', o.teks, 1, 5000, true);
    checkImg(c, 'teks', value.teks);

    var url = trimText(o.urlGambar);
    value.urlGambar = url;
    if (url !== '' && (url.indexOf('https://') !== 0 || charLength(url) > 2000)) {
      c.add('urlGambar', 'Format URL gambar tidak valid: harus diawali "https://" dan paling banyak 2.000 karakter.');
    }

    value.pembahasan = checkText(c, 'pembahasan', o.pembahasan, 0, 5000, false);
    checkImg(c, 'pembahasan', value.pembahasan);
    value.bobot = checkNumber(c, 'bobot', o.bobot, { min: 0, max: 100, minExclusive: true });

    var kunci = parseKunci(o.kunci);
    var opsiIn = o.opsi && typeof o.opsi === 'object' ? o.opsi : {};
    var opsi = {};

    if (tipe === 'BS') {
      LETTERS.forEach(function (L) { opsi[L] = OPSI_BS[L] || ''; });
      value.opsi = opsi;
      value.kunci = kunci;
      if (kunci.length === 0) c.add('kunci', 'Kunci jawaban wajib diisi.');
      else if (kunci.length !== 1 || (kunci[0] !== 'B' && kunci[0] !== 'S')) {
        c.add('kunci', 'Kunci jawaban soal Benar/Salah harus B (Benar) atau S (Salah).');
      }
      return c.result(value);
    }

    var bsm = tipe === 'BSM';
    var terisi = [];
    LETTERS.forEach(function (L, i) {
      var lbl = bsm ? 'Pernyataan ' + (i + 1) : undefined;
      var s = checkText(c, 'opsi' + L, opsiIn[L], 1, 1000, false, lbl);
      checkImg(c, 'opsi' + L, s, lbl);
      opsi[L] = s;
      if (s !== '') terisi.push(L);
    });
    value.opsi = opsi;

    if (bsm) {
      // Requirement 25.2, 25.4: Pernyataan berurutan dari A, 2–5 terisi;
      // Kunci_BSM posisional B/S sejumlah Pernyataan terisi.
      var berurutan = true;
      for (var i = 0; i < terisi.length; i++) {
        if (terisi[i] !== LETTERS[i]) berurutan = false;
      }
      if (!berurutan) c.add('opsi', 'Pernyataan harus diisi berurutan mulai Pernyataan 1.');
      if (terisi.length < 2) c.add('opsi', 'Soal BSM harus memiliki 2 sampai 5 Pernyataan terisi.');
      var kunciBsm = parseKunciBsm(o.kunci);
      value.kunci = kunciBsm;
      if (kunciBsm.length === 0) {
        c.add('kunci', 'Kunci jawaban wajib diisi.');
      } else {
        if (kunciBsm.length !== terisi.length) {
          c.add('kunci', 'Kunci jawaban soal BSM harus berisi ' + terisi.length + ' nilai, satu untuk setiap Pernyataan terisi.');
        }
        var salahNilai = kunciBsm.some(function (k) { return k !== 'B' && k !== 'S'; });
        if (salahNilai) c.add('kunci', 'Kunci jawaban soal BSM hanya boleh berisi B (Benar) atau S (Salah).');
      }
      return c.result(value);
    }

    value.kunci = kunci;

    if (tipe === 'PG') {
      if (terisi.length < 2) c.add('opsi', 'Soal PG harus memiliki 2 sampai 5 opsi terisi.');
      if (kunci.length === 0) c.add('kunci', 'Kunci jawaban wajib diisi.');
      else if (kunci.length !== 1) c.add('kunci', 'Kunci jawaban soal PG harus tepat satu huruf.');
      else if (terisi.indexOf(kunci[0]) < 0) c.add('kunci', 'Kunci jawaban harus huruf dari opsi yang terisi.');
    } else if (tipe === 'PGK') {
      if (terisi.length < 3) c.add('opsi', 'Soal PGK harus memiliki 3 sampai 5 opsi terisi.');
      if (kunci.length === 0) {
        c.add('kunci', 'Kunci jawaban wajib diisi.');
      } else {
        if (kunci.length < 2) c.add('kunci', 'Kunci jawaban soal PGK harus memuat minimal 2 huruf.');
        var seen = {};
        var dup = false;
        var luar = false;
        kunci.forEach(function (k) {
          if (seen[k]) dup = true;
          seen[k] = true;
          if (terisi.indexOf(k) < 0) luar = true;
        });
        if (dup) c.add('kunci', 'Kunci jawaban tidak boleh memuat huruf yang sama lebih dari sekali.');
        if (luar) c.add('kunci', 'Kunci jawaban harus huruf dari opsi yang terisi.');
      }
    }

    var res = c.result(value);
    if (res.valid) value.kunci = kunci.slice().sort();
    return res;
  }

  // ---------------------------------------------------------------------
  // Tanggal, jenis kelamin, nama, gambar, dan Kunci_BSM (tampilan-anbk)
  // ---------------------------------------------------------------------

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function pad4(n) {
    var s = String(n);
    while (s.length < 4) s = '0' + s;
    return s;
  }

  function isKabisat(y) {
    return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  }

  function hariDalamBulan(y, m) {
    if (m === 2) return isKabisat(y) ? 29 : 28;
    return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
  }

  /** Tripel angka → 'YYYY-MM-DD' jika tanggal kalender Gregorian benar, selain itu null. */
  function isoDariTripel(y, m, d) {
    if (m < 1 || m > 12) return null;
    if (d < 1 || d > hariDalamBulan(y, m)) return null;
    return pad4(y) + '-' + pad2(m) + '-' + pad2(d);
  }

  /**
   * Requirement 4.4, 23.3: 'YYYY-MM-DD' atau 'DD/MM/YYYY' (spasi tepi
   * dibuang) → 'YYYY-MM-DD' jika tanggal kalender benar; selain itu null.
   */
  function parseTanggal(v) {
    var s = trimText(v);
    var m = RE_ISO.exec(s);
    if (m) return isoDariTripel(Number(m[1]), Number(m[2]), Number(m[3]));
    m = RE_DMY.exec(s);
    if (m) return isoDariTripel(Number(m[3]), Number(m[2]), Number(m[1]));
    return null;
  }

  /** Tanggal hari ini 'YYYY-MM-DD' di Asia/Jakarta (UTC+7 tanpa DST). */
  function tanggalHariIniJakarta(nowMs) {
    var ms = typeof nowMs === 'number' && isFinite(nowMs) ? nowMs : Date.now();
    var d = new Date(ms + JAM_JAKARTA_MS);
    return pad4(d.getUTCFullYear()) + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  }

  /** Requirement 4.1, 4.4: '1900-01-01' ≤ iso ≤ todayIso (perbandingan string ISO). */
  function validTanggalLahir(iso, todayIso) {
    if (typeof iso !== 'string' || typeof todayIso !== 'string') return false;
    return iso >= TANGGAL_MIN && iso <= todayIso;
  }

  /**
   * Requirement 4.5, 23.2: '', 'L', 'P', 'laki-laki', 'perempuan' (tanpa beda
   * huruf, setelah trim) → ''/'L'/'P'; selain itu null.
   */
  function normalisasiJenisKelamin(v) {
    var s = trimText(v).toLowerCase();
    if (s === '') return '';
    if (s === 'l' || s === 'laki-laki') return 'L';
    if (s === 'p' || s === 'perempuan') return 'P';
    return null;
  }

  /** Requirement 12.5: trim, rangkaian whitespace → satu spasi, huruf kecil. */
  function normalisasiNama(s) {
    if (s === null || s === undefined) return '';
    if (typeof s !== 'string') s = String(s);
    return s.replace(/\s+/g, ' ').replace(/^ | $/g, '').toLowerCase();
  }

  /** Requirement 12.5: nama cocok jika bentuk ternormalisasi sama dan tidak kosong. */
  function cocokNama(a, b) {
    var x = normalisasiNama(a);
    return x !== '' && x === normalisasiNama(b);
  }

  /**
   * Requirement 28.5: jumlah kemunculan "[img]" (tanpa beda huruf) di teks
   * mentah. Batas atas jumlah Gambar_Markup tanpa bergantung pada markup.js.
   */
  function jumlahImg(teks) {
    if (typeof teks !== 'string' || teks === '') return 0;
    var m = teks.match(/\[img\]/gi);
    return m ? m.length : 0;
  }

  /**
   * Requirement 25.3, 25.4: Kunci_BSM dari array atau teks dipisah koma →
   * daftar posisional ter-trim huruf besar, tanpa pengurutan atau buang
   * duplikat. Bagian kosong dipertahankan agar jumlah yang salah terdeteksi.
   */
  function parseKunciBsm(raw) {
    var parts;
    if (Array.isArray(raw)) parts = raw;
    else if (isBlank(raw)) parts = [];
    else parts = trimText(raw).split(',');
    return parts.map(function (p) { return trimText(p).toUpperCase(); });
  }

  // ---------------------------------------------------------------------
  // Verifikasi Peserta dan Pengaturan_Aplikasi (tampilan-anbk)
  // ---------------------------------------------------------------------

  /**
   * Requirement 12.4, 13.4. input: {nama, tanggalLahir, token}.
   * opts.punyaTanggalLahir: tanggal lahir wajib diisi (ISO valid); selain
   * itu boleh kosong, tetapi jika diisi harus valid.
   * value: {nama (ter-trim), tanggalLahir ('' atau 'YYYY-MM-DD'), token
   * (ter-trim, huruf besar)}.
   */
  function validateVerifikasi(input, opts) {
    var o = input || {};
    var wajibTanggal = !!(opts && opts.punyaTanggalLahir);
    var c = new Collector();

    var nama = trimText(o.nama);
    if (nama === '') c.add('nama', 'Nama Peserta wajib diisi.');

    var tglRaw = trimText(o.tanggalLahir);
    var tgl = '';
    if (tglRaw === '') {
      if (wajibTanggal) c.add('tanggalLahir', 'Tanggal lahir wajib diisi.');
    } else {
      tgl = parseTanggal(tglRaw);
      if (tgl === null) {
        c.add('tanggalLahir', 'Tanggal lahir tidak valid.');
        tgl = tglRaw;
      }
    }

    var token = trimText(o.token);
    if (token === '') c.add('token', 'Token wajib diisi.');
    else if (!RE_TOKEN_UJIAN.test(token)) c.add('token', 'Token harus 6 karakter huruf atau angka.');

    return c.result({ nama: nama, tanggalLahir: tgl, token: token.toUpperCase() });
  }

  /**
   * Requirement 12.4: tiga kotak Hari, Bulan, Tahun → 'YYYY-MM-DD'.
   * Semua kosong → value ''. Sebagian kosong, bukan angka, atau bukan
   * tanggal kalender → error field tanggalLahir.
   */
  function validateTanggalDariKotak(hari, bulan, tahun) {
    var c = new Collector();
    var h = trimText(hari);
    var b = trimText(bulan);
    var t = trimText(tahun);
    if (h === '' && b === '' && t === '') return c.result('');
    var iso = null;
    if (/^\d{1,2}$/.test(h) && /^\d{1,2}$/.test(b) && /^\d{4}$/.test(t)) {
      iso = isoDariTripel(Number(t), Number(b), Number(h));
    }
    if (iso === null) {
      c.add('tanggalLahir', 'Tanggal lahir tidak valid.');
      return c.result('');
    }
    return c.result(iso);
  }

  /**
   * Requirement 1.5, 1.6, 9.7, 10.5. input: {namaAplikasi, subjudul,
   * urlLogo, pemilikHakCipta, intervalTokenMenit, tampilkanTokenKePeserta}.
   * namaAplikasi 1–60, subjudul 0–100, urlLogo kosong atau "https://" ≤ 2.000,
   * pemilikHakCipta 0–100, intervalTokenMenit bilangan bulat 5–120,
   * tampilkanTokenKePeserta boolean (true/false).
   */
  function validatePengaturan(input) {
    var o = input || {};
    var c = new Collector();
    var value = {
      namaAplikasi: checkText(c, 'namaAplikasi', o.namaAplikasi, 1, 60, true),
      subjudul: checkText(c, 'subjudul', o.subjudul, 0, 100, false),
      urlLogo: trimText(o.urlLogo),
      pemilikHakCipta: checkText(c, 'pemilikHakCipta', o.pemilikHakCipta, 0, 100, false),
      intervalTokenMenit: checkNumber(c, 'intervalTokenMenit', o.intervalTokenMenit, { integer: true, min: 5, max: 120 }),
      tampilkanTokenKePeserta: o.tampilkanTokenKePeserta
    };
    var url = value.urlLogo;
    if (url !== '' && (url.indexOf('https://') !== 0 || charLength(url) > 2000)) {
      c.add('urlLogo', 'Format URL logo tidak valid: harus diawali "https://" dan paling banyak 2.000 karakter.');
    }
    if (value.tampilkanTokenKePeserta !== true && value.tampilkanTokenKePeserta !== false) {
      c.add('tampilkanTokenKePeserta', label('tampilkanTokenKePeserta') + ' harus bernilai ya atau tidak.');
    }
    return c.result(value);
  }

  // ---------------------------------------------------------------------
  // Keunikan dan pembaruan
  // ---------------------------------------------------------------------

  function keyOf(v) {
    return trimText(v).toLowerCase();
  }

  /**
   * Requirement 4.6, 7.4: mencari field kandidat yang nilainya sudah dipakai
   * baris lain (dibandingkan setelah trim, tanpa beda huruf besar-kecil).
   *
   * fields: daftar nama field (sama di kandidat dan baris), atau objek
   *         {field, column?, label?} jika nama kolom baris berbeda.
   * opts.exclude(row) → true: baris itu dilewati (mis. baris kandidat sendiri
   *         saat ubah).
   * Hasil: value = daftar field duplikat (urutan sesuai `fields`);
   *        errors[field] = ["<Label> sudah dipakai."]. Nilai kosong tidak
   *        pernah dianggap duplikat.
   */
  function findDuplicates(candidate, existingRows, fields, opts) {
    var cand = candidate || {};
    var rows = existingRows || [];
    var exclude = opts && typeof opts.exclude === 'function' ? opts.exclude : null;
    var c = new Collector();
    var dups = [];
    (fields || []).forEach(function (f) {
      var spec = typeof f === 'string' ? { field: f } : f;
      var column = spec.column || spec.field;
      var k = keyOf(cand[spec.field]);
      if (k === '') return;
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        if (!row || (exclude && exclude(row))) continue;
        if (keyOf(row[column]) === k) {
          dups.push(spec.field);
          c.add(spec.field, (spec.label || label(spec.field)) + ' sudah dipakai.');
          return;
        }
      }
    });
    return c.result(dups);
  }

  /**
   * Requirement 4.7, 8.5: menyalin field masukan ke salinan baris, kecuali
   * field terlindungi (mis. id_pengguna, password_hash, salt; id_soal,
   * kode_mapel). Baris asli tidak diubah.
   */
  function applyUpdate(row, input, protectedFields) {
    var out = {};
    var base = row || {};
    Object.keys(base).forEach(function (k) { out[k] = base[k]; });
    var prot = protectedFields || [];
    var src = input || {};
    Object.keys(src).forEach(function (k) {
      if (prot.indexOf(k) >= 0) return;
      out[k] = src[k];
    });
    return { valid: true, value: out, errors: {} };
  }

  // ---------------------------------------------------------------------
  // Validasi baris import (Peserta/Soal)
  // ---------------------------------------------------------------------

  var STATUS_IMPORT = { '1': true, 'aktif': true, '0': false, 'nonaktif': false };

  /**
   * Koleksi kunci (array, Set, atau objek {kunci: x}) → peta kunci huruf
   * kecil ter-trim ke nilai aslinya ter-trim. Kunci diberi awalan '#' agar
   * aman dari nama properti bawaan objek.
   */
  function toLookup(coll) {
    var out = {};
    function put(v) {
      var s = trimText(v);
      if (s !== '' && !out.hasOwnProperty('#' + s.toLowerCase())) out['#' + s.toLowerCase()] = s;
    }
    if (!coll) return out;
    if (Array.isArray(coll)) coll.forEach(put);
    else if (typeof coll.forEach === 'function') coll.forEach(function (v) { put(v); });
    else if (typeof coll === 'object') Object.keys(coll).forEach(put);
    return out;
  }

  function flattenErrors(errors) {
    var out = [];
    Object.keys(errors).forEach(function (k) {
      errors[k].forEach(function (m) { out.push(m); });
    });
    return out;
  }

  /**
   * Menandai duplikat field terhadap data yang ada dan terhadap baris
   * sebelumnya di file. seen: {'#kunci': nomor baris pertama} (diubah).
   */
  function checkImportDup(alasan, field, s, line, existing, seen) {
    if (s === '') return;
    var k = '#' + s.toLowerCase();
    if (existing.hasOwnProperty(k)) alasan.push(label(field) + ' sudah dipakai.');
    if (seen.hasOwnProperty(k)) alasan.push(label(field) + ' sama dengan baris ' + seen[k] + ' di file.');
    else seen[k] = line;
  }

  /** Menyiapkan konteks internal; aman dipanggil ulang pada konteks yang sudah siap. */
  function prepImportCtx(ctx) {
    var c = ctx || {};
    if (c._prepared) return c;
    return {
      _prepared: true,
      now: typeof c.now === 'number' && isFinite(c.now) ? c.now : Date.now(),
      existingIds: toLookup(c.existingIds),
      existingUsernames: toLookup(c.existingUsernames),
      kodeMapel: toLookup(c.kodeMapelSet),
      seenIds: {},
      seenUsernames: {}
    };
  }

  /**
   * Requirement 6.3, 6.4 (cbt-tka); 23.2–23.4 (tampilan-anbk).
   * values: {id_peserta, nama_lengkap, kelas, username, password,
   * status_aktif, jenis_kelamin?, tanggal_lahir?}. Kolom yang tidak ada
   * dianggap kosong. Hasil: {valid, value, alasan: string[]}.
   * value.statusAktif: true untuk "1"/"aktif", false untuk "0"/"nonaktif".
   * value.jenisKelamin: '', 'L', atau 'P' ("Laki-laki"/"Perempuan" dinormalkan).
   * value.tanggalLahir: '' atau 'YYYY-MM-DD' (masukan YYYY-MM-DD atau
   * DD/MM/YYYY); rentang diukur terhadap ctx.now (bawaan Date.now()).
   * line dipakai untuk pesan duplikat di dalam file.
   */
  function validateImportPesertaRow(values, ctx, line) {
    var v = values || {};
    var x = prepImportCtx(ctx);
    var jk = normalisasiJenisKelamin(v.jenis_kelamin);
    var tgl = parseTanggal(v.tanggal_lahir);
    var r = validatePeserta({
      id: v.id_peserta,
      nama: v.nama_lengkap,
      kelas: v.kelas,
      username: v.username,
      password: v.password,
      statusAktif: true,
      // Nilai yang tidak dapat dinormalkan diteruskan apa adanya agar
      // validatePeserta menolaknya dengan pesan yang sama dengan form.
      jenisKelamin: jk === null ? v.jenis_kelamin : jk,
      tanggalLahir: tgl === null ? v.tanggal_lahir : tgl
    }, { isNew: true, now: x.now });
    var alasan = flattenErrors(r.errors);

    var st = trimText(v.status_aktif).toLowerCase();
    var value = r.value;
    if (st === '') {
      alasan.push(label('statusAktif') + ' wajib diisi.');
    } else if (!STATUS_IMPORT.hasOwnProperty(st)) {
      alasan.push(label('statusAktif') + ' harus bernilai 1, 0, aktif, atau nonaktif.');
    }
    value.statusAktif = STATUS_IMPORT.hasOwnProperty(st) ? STATUS_IMPORT[st] : trimText(v.status_aktif);

    checkImportDup(alasan, 'id', value.id, line, x.existingIds, x.seenIds);
    checkImportDup(alasan, 'username', value.username, line, x.existingUsernames, x.seenUsernames);

    return { valid: alasan.length === 0, value: value, alasan: alasan };
  }

  /**
   * Requirement 12.4, 12.5 (cbt-tka); 23.6, 23.7, 33.1–33.3 (tampilan-anbk).
   * values: {kode_mapel, tipe, stimulus?, teks_soal, url_gambar,
   * opsi_a..opsi_e, kunci, pembahasan, bobot}. Kolom stimulus yang tidak ada
   * dianggap kosong. Tipe dan kunci dibandingkan setelah trim dan huruf
   * besar; kunci PGK dipisah koma; kunci BSM diteruskan mentah dan dibaca
   * posisional (value.kunci array B/S); opsi BS dipaksa Benar/Salah.
   * kode_mapel harus terdaftar di ctx.kodeMapelSet (tanpa beda huruf
   * besar-kecil); value.kodeMapel memakai penulisan yang terdaftar.
   */
  function validateImportSoalRow(values, ctx) {
    var v = values || {};
    var x = prepImportCtx(ctx);
    var r = validateSoal({
      kodeMapel: v.kode_mapel,
      tipe: v.tipe,
      stimulus: v.stimulus,
      teks: v.teks_soal,
      urlGambar: v.url_gambar,
      opsi: { A: v.opsi_a, B: v.opsi_b, C: v.opsi_c, D: v.opsi_d, E: v.opsi_e },
      kunci: v.kunci,
      pembahasan: v.pembahasan,
      bobot: v.bobot
    });
    var alasan = flattenErrors(r.errors);
    var value = r.value;
    if (value.kodeMapel !== '') {
      var k = '#' + value.kodeMapel.toLowerCase();
      if (x.kodeMapel.hasOwnProperty(k)) value.kodeMapel = x.kodeMapel[k];
      else alasan.push('Kode mapel "' + value.kodeMapel + '" tidak terdaftar.');
    }
    return { valid: alasan.length === 0, value: value, alasan: alasan };
  }

  /**
   * Requirement 6.3, 12.4: memvalidasi seluruh baris import sekaligus.
   * rows: {line, values}[]
   * ctx : {jenis: 'peserta' | 'soal',
   *        existingIds?, existingUsernames? (Peserta; array atau Set),
   *        kodeMapelSet? (Soal; array atau Set),
   *        now? (Peserta; ms acuan batas tanggal lahir, bawaan Date.now())}
   * Duplikat di dalam file ditandai pada setiap baris setelah kemunculan
   * pertama. Hasil: [{line, valid, value, alasan: string[]}] sesuai urutan.
   */
  function validateImportRows(rows, ctx) {
    var c = ctx || {};
    var jenis = trimText(c.jenis).toLowerCase();
    if (jenis !== 'peserta' && jenis !== 'soal') {
      throw new Error('ctx.jenis harus "peserta" atau "soal".');
    }
    var x = prepImportCtx(c);
    return (rows || []).map(function (row, i) {
      var rw = row || {};
      var line = rw.line !== undefined && rw.line !== null ? rw.line : i + 2;
      var r = jenis === 'peserta'
        ? validateImportPesertaRow(rw.values, x, line)
        : validateImportSoalRow(rw.values, x);
      return { line: line, valid: r.valid, value: r.value, alasan: r.alasan };
    });
  }

  /**
   * Requirement 6.5, 12.6: ringkasan hasil validateImportRows.
   * berhasil + gagal = jumlah baris; errors memuat tepat baris gagal.
   */
  function summarizeImport(results) {
    var out = { berhasil: 0, gagal: 0, errors: [] };
    (results || []).forEach(function (r) {
      if (r.valid) {
        out.berhasil++;
      } else {
        out.gagal++;
        out.errors.push({ line: r.line, alasan: r.alasan.slice() });
      }
    });
    return out;
  }

  return {
    LABEL: LABEL,
    LETTERS: LETTERS,
    TIPE_SOAL: TIPE_SOAL,
    MSG_ANGKA: MSG_ANGKA,
    trimText: trimText,
    trimFields: trimFields,
    charLength: charLength,
    isNumberLike: isNumberLike,
    parseKunci: parseKunci,
    parseKunciBsm: parseKunciBsm,
    parseTanggal: parseTanggal,
    tanggalHariIniJakarta: tanggalHariIniJakarta,
    validTanggalLahir: validTanggalLahir,
    normalisasiJenisKelamin: normalisasiJenisKelamin,
    normalisasiNama: normalisasiNama,
    cocokNama: cocokNama,
    jumlahImg: jumlahImg,
    validateVerifikasi: validateVerifikasi,
    validateTanggalDariKotak: validateTanggalDariKotak,
    validatePengaturan: validatePengaturan,
    validateLogin: validateLogin,
    validatePasswordBaru: validatePasswordBaru,
    validatePasswordPeserta: validatePasswordPeserta,
    validatePeserta: validatePeserta,
    validateMapel: validateMapel,
    validateSoal: validateSoal,
    findDuplicates: findDuplicates,
    applyUpdate: applyUpdate,
    validateImportPesertaRow: validateImportPesertaRow,
    validateImportSoalRow: validateImportSoalRow,
    validateImportRows: validateImportRows,
    summarizeImport: summarizeImport
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CBTValidator;
}
