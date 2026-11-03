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
  var TIPE_SOAL = ['PG', 'PGK', 'BS'];
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
    tipe: 'Tipe soal',
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
    bobot: 'Bobot nilai'
  };

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
  function checkText(c, field, raw, min, max, required) {
    var s = trimText(raw);
    var n = charLength(s);
    if (n === 0) {
      if (required) c.add(field, label(field) + ' wajib diisi.');
      return s;
    }
    if (n < min || n > max) {
      if (min === max) {
        c.add(field, label(field) + ' harus ' + format(min) + ' karakter.');
      } else if (min <= 1) {
        c.add(field, label(field) + ' paling banyak ' + format(max) + ' karakter.');
      } else {
        c.add(field, label(field) + ' harus ' + format(min) + ' sampai ' + format(max) + ' karakter.');
      }
    }
    return s;
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
   * Requirement 4.1, 4.5, 4.12, 25.6.
   * input: {id, nama, kelas, username, password?, statusAktif?}
   * opts.isNew: password wajib (6–64) saat tambah; saat ubah password diabaikan.
   */
  function validatePeserta(input, opts) {
    var o = input || {};
    var isNew = !!(opts && opts.isNew);
    var c = new Collector();
    var value = {
      id: checkPattern(c, 'id', o.id, 1, 20, RE_ID, 'huruf, angka, atau tanda hubung (-)'),
      nama: checkText(c, 'nama', o.nama, 1, 100, true),
      kelas: checkText(c, 'kelas', o.kelas, 1, 30, true),
      username: checkPattern(c, 'username', o.username, 3, 30, RE_USERNAME, 'huruf, angka, titik (.), atau garis bawah (_)'),
      statusAktif: checkBool(c, 'statusAktif', o.statusAktif, true)
    };
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
   * Requirement 7.1, 7.5.
   * input: {kodeMapel, namaMapel, durasiMenit, jumlahSoal, statusAktif,
   *         acakSoal, acakOpsi, tampilSkor}
   * Boolean kosong memakai bawaan: statusAktif=true, lainnya false.
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
      tampilSkor: checkBool(c, 'tampilSkor', o.tampilSkor, false)
    };
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
   * Requirement 8.5, 8.7–8.11, 9.11, 25.7.
   * input: {idSoal?, kodeMapel, tipe, teks, urlGambar?, opsi:{A..E},
   *         kunci: string[] | "A,C", pembahasan?, bobot}
   * value.opsi selalu berisi A–E (kosong = ''); BS dipaksa Benar/Salah.
   * value.kunci berupa array huruf terurut jika valid.
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
    else if (TIPE_SOAL.indexOf(tipe) < 0) c.add('tipe', 'Tipe soal harus PG, PGK, atau BS.');

    value.teks = checkText(c, 'teks', o.teks, 1, 5000, true);

    var url = trimText(o.urlGambar);
    value.urlGambar = url;
    if (url !== '' && (url.indexOf('https://') !== 0 || charLength(url) > 2000)) {
      c.add('urlGambar', 'Format URL gambar tidak valid: harus diawali "https://" dan paling banyak 2.000 karakter.');
    }

    value.pembahasan = checkText(c, 'pembahasan', o.pembahasan, 0, 5000, false);
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

    var terisi = [];
    LETTERS.forEach(function (L) {
      var s = checkText(c, 'opsi' + L, opsiIn[L], 1, 1000, false);
      opsi[L] = s;
      if (s !== '') terisi.push(L);
    });
    value.opsi = opsi;
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
      existingIds: toLookup(c.existingIds),
      existingUsernames: toLookup(c.existingUsernames),
      kodeMapel: toLookup(c.kodeMapelSet),
      seenIds: {},
      seenUsernames: {}
    };
  }

  /**
   * Requirement 6.3, 6.4. values: {id_peserta, nama_lengkap, kelas, username,
   * password, status_aktif}. Hasil: {valid, value, alasan: string[]}.
   * value.statusAktif: true untuk "1"/"aktif", false untuk "0"/"nonaktif".
   * line dipakai untuk pesan duplikat di dalam file.
   */
  function validateImportPesertaRow(values, ctx, line) {
    var v = values || {};
    var x = prepImportCtx(ctx);
    var r = validatePeserta({
      id: v.id_peserta,
      nama: v.nama_lengkap,
      kelas: v.kelas,
      username: v.username,
      password: v.password,
      statusAktif: true
    }, { isNew: true });
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
   * Requirement 12.4, 12.5. values: {kode_mapel, tipe, teks_soal, url_gambar,
   * opsi_a..opsi_e, kunci, pembahasan, bobot}. Tipe dan kunci dibandingkan
   * setelah trim dan huruf besar; kunci PGK dipisah koma; opsi BS dipaksa
   * Benar/Salah. kode_mapel harus terdaftar di ctx.kodeMapelSet (tanpa beda
   * huruf besar-kecil); value.kodeMapel memakai penulisan yang terdaftar.
   */
  function validateImportSoalRow(values, ctx) {
    var v = values || {};
    var x = prepImportCtx(ctx);
    var r = validateSoal({
      kodeMapel: v.kode_mapel,
      tipe: v.tipe,
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
   *        kodeMapelSet? (Soal; array atau Set)}
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
