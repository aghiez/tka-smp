/*
 * exam-logic.js — logika ujian murni (tanpa DOM, tanpa I/O).
 *
 * Dipakai di Frontend (window.ExamLogic) dan di Backend sebagai salinan
 * identik `Shared_ExamLogic.gs` (lingkup global Apps Script), serta di tes Node
 * lewat module.exports. Jangan memakai API khusus browser atau Node di sini.
 *
 * Bagian:
 *   1. Utilitas internal
 *   2. Pengacakan dan pemilihan (Requirement 20.1–20.5, 20.8)
 *   3. Pemetaan label tampil <-> huruf asli (Requirement 20.9, 20.10)
 *   4. Validasi nilai jawaban (Requirement 18.2)
 *   5. ID unik (Requirement 8.4)
 *   -- Bagian berikut ditambahkan oleh tugas lain:
 *   6. Penilaian (nilaiSoal, nilaiSesi, roundHalfUp2)          [tugas 7.1]
 *   7. Status soal, navigasi, waktu                              [tugas 8.1]
 *
 * Untuk menambah fungsi: tulis fungsinya di dalam IIFE sebelum blok
 * "Ekspor", lalu daftarkan namanya di objek `api`.
 */
var ExamLogic = (function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // 1. Utilitas internal
  // ---------------------------------------------------------------------------

  /** Label posisi tampil opsi, berurutan sesuai posisi (Requirement 20.9). */
  var LABEL_TAMPIL = Object.freeze(['A', 'B', 'C', 'D', 'E']);

  /** Opsi tetap Soal BS: Benar lalu Salah (Requirement 20.5). */
  var OPSI_BS = Object.freeze(['B', 'S']);

  var TIPE_SOAL = ['PG', 'PGK', 'BS'];

  var BASE36 = '0123456789abcdefghijklmnopqrstuvwxyz';
  var PANJANG_SUFIKS_ID = 6;
  var MAKS_PERCOBAAN_ACAK_ID = 50;

  /** Mengembalikan fungsi acak yang valid; default Math.random. */
  function ambilRng(rng) {
    return typeof rng === 'function' ? rng : Math.random;
  }

  /**
   * Bilangan bulat acak di [0, n). Hasil rng di luar [0, 1) dijepit agar
   * indeks selalu sah walau rng tidak patuh kontrak.
   */
  function acakIndeks(rng, n) {
    var r = Number(rng());
    if (!(r >= 0)) r = 0; // juga menangani NaN
    var i = Math.floor(r * n);
    if (i >= n) i = n - 1;
    return i;
  }

  function salinArray(arr) {
    return Array.prototype.slice.call(arr || []);
  }

  function urutkan(arr) {
    return arr.slice().sort(function (a, b) {
      return a < b ? -1 : a > b ? 1 : 0;
    });
  }

  /** Memeriksa keanggotaan pada Set, array, atau objek peta. */
  function punya(koleksi, nilai) {
    if (!koleksi) return false;
    if (typeof koleksi.has === 'function') return koleksi.has(nilai);
    if (Array.isArray(koleksi)) return koleksi.indexOf(nilai) !== -1;
    return Object.prototype.hasOwnProperty.call(koleksi, nilai);
  }

  // ---------------------------------------------------------------------------
  // 2. Pengacakan dan pemilihan
  // ---------------------------------------------------------------------------

  /**
   * Fisher–Yates. Mengembalikan array baru; input tidak diubah.
   * @param {Array} arr
   * @param {function(): number} rng sumber acak [0, 1)
   */
  function shuffle(arr, rng) {
    var r = ambilRng(rng);
    var hasil = salinArray(arr);
    for (var i = hasil.length - 1; i > 0; i--) {
      var j = acakIndeks(r, i + 1);
      var tmp = hasil[i];
      hasil[i] = hasil[j];
      hasil[j] = tmp;
    }
    return hasil;
  }

  /**
   * Memilih tepat n ID soal dari bank (Requirement 20.1–20.3).
   * acak: subset acak berpeluang sama, urutan acak; tidak: n pertama sesuai urutan bank.
   * Melempar Error bila n bukan bulat ≥ 0 atau melebihi ukuran bank
   * (pemanggil memeriksa kecukupan bank lebih dulu, Requirement 20.11).
   * @param {string[]} bank
   * @param {number} n
   * @param {boolean} acak
   * @param {function(): number} rng
   * @returns {string[]}
   */
  function pilihSoal(bank, n, acak, rng) {
    var daftar = salinArray(bank);
    if (typeof n !== 'number' || !isFinite(n) || Math.floor(n) !== n || n < 0) {
      throw new Error('Jumlah soal tidak valid: ' + n);
    }
    if (n > daftar.length) {
      throw new Error('Jumlah soal Mapel tidak mencukupi');
    }
    var sumber = acak ? shuffle(daftar, rng) : daftar;
    return sumber.slice(0, n);
  }

  /**
   * Menyusun urutan opsi satu Soal untuk satu Sesi (Requirement 20.4, 20.5, 20.8).
   * BS selalu ['B','S']. PG/PGK: permutasi huruf asli opsi terisi bila acak,
   * urutan asli bila tidak. Posisi ke-i ditampilkan dengan label LABEL_TAMPIL[i].
   * @param {{tipe: string, opsiTerisi: string[]}} soal
   * @param {boolean} acak
   * @param {function(): number} rng
   * @returns {string[]}
   */
  function susunOpsi(soal, acak, rng) {
    if (soal && soal.tipe === 'BS') return OPSI_BS.slice();
    var opsi = salinArray(soal && soal.opsiTerisi);
    return acak ? shuffle(opsi, rng) : opsi;
  }

  // ---------------------------------------------------------------------------
  // 3. Pemetaan label tampil <-> huruf asli
  // ---------------------------------------------------------------------------
  //
  // Pemetaan bersifat posisional: label 'A' = urutan[0], 'B' = urutan[1], dst.
  // Untuk BS, nilai jawaban sudah berupa 'B'/'S' dan tidak dipetakan.
  // Nilai yang tidak dapat dipetakan diganti '?' + nilai asal, sehingga pasti
  // ditolak oleh validasiJawaban. Duplikat tidak dibuang agar tetap terdeteksi.

  /**
   * Label tampil → huruf asli, diurutkan (Requirement 20.10).
   * @param {string[]} labelTampil mis. ['A','C']
   * @param {string[]} urutan huruf asli per posisi tampil, mis. ['C','A','B']
   * @returns {string[]}
   */
  function keAsli(labelTampil, urutan) {
    var u = salinArray(urutan);
    var hasil = salinArray(labelTampil).map(function (label) {
      var idx = LABEL_TAMPIL.indexOf(label);
      return idx !== -1 && idx < u.length ? u[idx] : '?' + label;
    });
    return urutkan(hasil);
  }

  /**
   * Huruf asli → label tampil, diurutkan. Invers keAsli.
   * @param {string[]} hurufAsli
   * @param {string[]} urutan
   * @returns {string[]}
   */
  function keTampil(hurufAsli, urutan) {
    var u = salinArray(urutan);
    var hasil = salinArray(hurufAsli).map(function (huruf) {
      var idx = u.indexOf(huruf);
      return idx !== -1 && idx < LABEL_TAMPIL.length ? LABEL_TAMPIL[idx] : '?' + huruf;
    });
    return urutkan(hasil);
  }

  // ---------------------------------------------------------------------------
  // 4. Validasi nilai jawaban
  // ---------------------------------------------------------------------------

  /**
   * Memeriksa nilai jawaban (dalam huruf asli) sesuai tipe (Requirement 18.2):
   * kosong selalu sah; PG tepat satu opsi tersedia; PGK satu atau lebih opsi
   * tersedia tanpa duplikat; BS tepat satu dari 'B'/'S'.
   * @param {string} tipe 'PG' | 'PGK' | 'BS'
   * @param {string[]} pilihanAsli
   * @param {string[]} opsiTersedia huruf opsi terisi Soal (diabaikan untuk BS)
   * @returns {{ok: boolean, alasan?: string}}
   */
  function validasiJawaban(tipe, pilihanAsli, opsiTersedia) {
    if (TIPE_SOAL.indexOf(tipe) === -1) {
      return { ok: false, alasan: 'Tipe soal tidak dikenal' };
    }
    if (pilihanAsli === null || pilihanAsli === undefined) return { ok: true };
    if (!Array.isArray(pilihanAsli)) {
      return { ok: false, alasan: 'Format jawaban tidak valid' };
    }
    if (pilihanAsli.length === 0) return { ok: true };

    for (var i = 0; i < pilihanAsli.length; i++) {
      if (typeof pilihanAsli[i] !== 'string') {
        return { ok: false, alasan: 'Format jawaban tidak valid' };
      }
    }

    var tersedia = tipe === 'BS' ? OPSI_BS : salinArray(opsiTersedia);

    if ((tipe === 'PG' || tipe === 'BS') && pilihanAsli.length !== 1) {
      return {
        ok: false,
        alasan: tipe === 'PG'
          ? 'Soal PG hanya menerima tepat satu jawaban'
          : 'Soal Benar/Salah hanya menerima tepat satu jawaban'
      };
    }

    var dilihat = {};
    for (var k = 0; k < pilihanAsli.length; k++) {
      var p = pilihanAsli[k];
      if (tersedia.indexOf(p) === -1) {
        return { ok: false, alasan: 'Opsi jawaban tidak tersedia: ' + p };
      }
      if (Object.prototype.hasOwnProperty.call(dilihat, p)) {
        return { ok: false, alasan: 'Opsi jawaban berulang: ' + p };
      }
      dilihat[p] = true;
    }
    return { ok: true };
  }

  // ---------------------------------------------------------------------------
  // 5. ID unik
  // ---------------------------------------------------------------------------

  function padKiri(s, panjang) {
    while (s.length < panjang) s = '0' + s;
    return s;
  }

  /**
   * ID baru = prefix + 6 karakter base36, dijamin tidak ada di existingSet
   * (Requirement 8.4). Mencoba sufiks acak dulu; bila rng terus bertabrakan,
   * beralih ke pencacah berurutan yang pasti berhenti karena existingSet hingga.
   * @param {string} prefix mis. 'S250101-'
   * @param {Set|string[]|Object} existingSet ID yang sudah ada
   * @param {function(): number} rng
   * @returns {string}
   */
  function newId(prefix, existingSet, rng) {
    var r = ambilRng(rng);
    var awal = prefix === null || prefix === undefined ? '' : String(prefix);
    var kandidat;
    for (var coba = 0; coba < MAKS_PERCOBAAN_ACAK_ID; coba++) {
      var sufiks = '';
      for (var i = 0; i < PANJANG_SUFIKS_ID; i++) {
        sufiks += BASE36.charAt(acakIndeks(r, BASE36.length));
      }
      kandidat = awal + sufiks;
      if (!punya(existingSet, kandidat)) return kandidat;
    }
    for (var n = 0; ; n++) {
      kandidat = awal + padKiri(n.toString(36), PANJANG_SUFIKS_ID);
      if (!punya(existingSet, kandidat)) return kandidat;
    }
  }

  // ---------------------------------------------------------------------------
  // 6. Penilaian
  // ---------------------------------------------------------------------------
  //
  // Status per soal: 'BENAR' | 'SALAH' | 'KOSONG'. Penanda ragu tidak pernah
  // memengaruhi nilai (Requirement 16.7). Jawaban dan kunci dibandingkan dalam
  // huruf asli, sehingga hasil tidak bergantung pada urutan opsi tampil
  // (Requirement 21.10).

  var STATUS_BENAR = 'BENAR';
  var STATUS_SALAH = 'SALAH';
  var STATUS_KOSONG = 'KOSONG';

  /**
   * Membulatkan ke dua desimal, setengah menjauhi nol (0,005 → 0,01).
   * Memakai pergeseran eksponen berbasis string agar 1.005 → 1.01 (bukan 1.00
   * seperti Math.round(x * 100) / 100). Nilai tak hingga/NaN dikembalikan apa adanya.
   * @param {number} x
   * @returns {number}
   */
  function roundHalfUp2(x) {
    var n = Number(x);
    if (!isFinite(n)) return n;
    if (n === 0) return 0;
    var tanda = n < 0 ? -1 : 1;
    var abs = Math.abs(n);
    var bagian = String(abs).split('e');
    var eksp = bagian.length > 1 ? Number(bagian[1]) : 0;
    var geser = Number(bagian[0] + 'e' + (eksp + 2));
    var bulat = Math.round(geser);
    var bagian2 = String(bulat).split('e');
    var eksp2 = bagian2.length > 1 ? Number(bagian2[1]) : 0;
    var hasil = Number(bagian2[0] + 'e' + (eksp2 - 2));
    return hasil === 0 ? 0 : tanda * hasil;
  }

  /**
   * Menormalkan pilihan menjadi array string tanpa elemen kosong dan tanpa
   * duplikat. Menerima array, string kanonik ("A,C"), null/undefined, atau
   * objek {pilihan, ragu} (ragu diabaikan).
   */
  function normalisasiPilihan(nilai) {
    if (nilai && typeof nilai === 'object' && !Array.isArray(nilai)) {
      nilai = nilai.pilihan;
    }
    var daftar;
    if (nilai === null || nilai === undefined) daftar = [];
    else if (Array.isArray(nilai)) daftar = nilai;
    else daftar = String(nilai).split(',');
    var hasil = [];
    for (var i = 0; i < daftar.length; i++) {
      var v = daftar[i];
      if (v === null || v === undefined) continue;
      v = String(v).replace(/^\s+|\s+$/g, '');
      if (v === '' || hasil.indexOf(v) !== -1) continue;
      hasil.push(v);
    }
    return hasil;
  }

  /** Bobot sebagai angka ≥ 0; nilai tidak sah dianggap 0. */
  function bobotAngka(bobot) {
    var b = Number(bobot);
    return isFinite(b) && b > 0 ? b : 0;
  }

  function himpunanSama(a, b) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (b.indexOf(a[i]) === -1) return false;
    }
    return true;
  }

  /**
   * Menilai satu Soal (Requirement 21.4, 21.5).
   * PG/BS: benar bila satu-satunya pilihan sama dengan kunci.
   * PGK: benar bila himpunan pilihan sama persis dengan himpunan kunci.
   * Tanpa pilihan → KOSONG. Selain itu SALAH dengan bobot 0.
   * @param {{tipe: string, kunci: (string[]|string), bobot: number}} soal
   * @param {(string[]|string|{pilihan: string[], ragu: boolean})} pilihanAsli
   * @returns {{status: string, bobotDiperoleh: number}}
   */
  function nilaiSoal(soal, pilihanAsli) {
    var pilihan = normalisasiPilihan(pilihanAsli);
    if (pilihan.length === 0) {
      return { status: STATUS_KOSONG, bobotDiperoleh: 0 };
    }
    var kunci = normalisasiPilihan(soal && soal.kunci);
    var benar = kunci.length > 0 && himpunanSama(pilihan, kunci);
    if (benar && soal.tipe !== 'PGK' && pilihan.length !== 1) benar = false;
    return benar
      ? { status: STATUS_BENAR, bobotDiperoleh: bobotAngka(soal.bobot) }
      : { status: STATUS_SALAH, bobotDiperoleh: 0 };
  }

  /**
   * Menilai seluruh Soal satu Sesi (Requirement 21.4–21.9).
   * skor = totalBobot > 0 ? roundHalfUp2(diperoleh / totalBobot × 100) : 0,
   * dijepit ke [0, 100].
   * @param {Array<{id?: string, idSoal?: string, tipe: string, kunci: (string[]|string), bobot: number}>} soalList
   * @param {Object<string, (string[]|string|{pilihan: string[], ragu: boolean})>} jawabanMap
   *        peta idSoal → pilihan huruf asli; soal tanpa entri dianggap kosong
   * @returns {{benar: number, salah: number, kosong: number,
   *            totalBobotDiperoleh: number, totalBobot: number, skor: number,
   *            rincian: Object<string, Array>}} rincian: idSoal → [status, bobotDiperoleh, bobotSoal]
   */
  function nilaiSesi(soalList, jawabanMap) {
    var daftar = salinArray(soalList);
    var peta = jawabanMap || {};
    var hasil = {
      benar: 0,
      salah: 0,
      kosong: 0,
      totalBobotDiperoleh: 0,
      totalBobot: 0,
      skor: 0,
      rincian: {}
    };
    for (var i = 0; i < daftar.length; i++) {
      var soal = daftar[i] || {};
      var id = soal.id !== undefined ? soal.id : soal.idSoal;
      var jawaban = Object.prototype.hasOwnProperty.call(peta, id) ? peta[id] : null;
      var n = nilaiSoal(soal, jawaban);
      var bobot = bobotAngka(soal.bobot);
      if (n.status === STATUS_BENAR) hasil.benar++;
      else if (n.status === STATUS_SALAH) hasil.salah++;
      else hasil.kosong++;
      hasil.totalBobotDiperoleh += n.bobotDiperoleh;
      hasil.totalBobot += bobot;
      hasil.rincian[id] = [n.status, n.bobotDiperoleh, bobot];
    }
    if (hasil.totalBobot > 0) {
      var skor = roundHalfUp2(hasil.totalBobotDiperoleh / hasil.totalBobot * 100);
      hasil.skor = Math.min(100, Math.max(0, skor));
    }
    return hasil;
  }

  // ---------------------------------------------------------------------------
  // 7. Status soal, navigasi, waktu
  // ---------------------------------------------------------------------------
  //
  // Baris Sesi/Mapel dibaca dengan nama kolom sheet (snake_case, mis.
  // `batas_waktu`); nama camelCase (`batasWaktu`) diterima sebagai cadangan.

  var STATUS_SOAL_RAGU = 'RAGU';
  var STATUS_SOAL_DIJAWAB = 'DIJAWAB';
  var STATUS_SOAL_BELUM = 'BELUM';

  var SESI_AKTIF = 'AKTIF';
  var SESI_SELESAI = 'SELESAI';

  /** Toleransi simpan/penutupan setelah batas waktu (Requirement 16.8, 17.8, 17.9). */
  var TOLERANSI_MS = 30 * 1000;

  var AKSI_SEBELUMNYA = 'SEBELUMNYA';
  var AKSI_BERIKUTNYA = 'BERIKUTNYA';
  var AKSI_PILIH = 'PILIH';

  /** Nilai field baris: nama snake_case lebih dulu, lalu camelCase. */
  function ambilField(row, snake, camel) {
    if (!row) return undefined;
    if (row[snake] !== undefined) return row[snake];
    return row[camel];
  }

  function salinObjek(obj) {
    var hasil = {};
    for (var k in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, k)) hasil[k] = obj[k];
    }
    return hasil;
  }

  function angkaAtauNaN(v) {
    if (v === null || v === undefined || v === '') return NaN;
    return Number(v);
  }

  /** Nilai boolean dari sel (TRUE/'TRUE'/'ya'/1). */
  function benarSel(v) {
    if (v === true) return true;
    if (v === false || v === null || v === undefined) return false;
    if (typeof v === 'number') return v !== 0;
    var s = String(v).replace(/^\s+|\s+$/g, '').toUpperCase();
    return s === 'TRUE' || s === 'YA' || s === '1' || s === 'AKTIF';
  }

  /**
   * Status_Soal (Requirement 16.4): ragu → 'RAGU'; ada pilihan → 'DIJAWAB';
   * selain itu 'BELUM'.
   * @param {string[]} pilihan
   * @param {boolean} ragu
   * @returns {'RAGU'|'DIJAWAB'|'BELUM'}
   */
  function statusSoal(pilihan, ragu) {
    if (ragu === true) return STATUS_SOAL_RAGU;
    return normalisasiPilihan(pilihan).length > 0 ? STATUS_SOAL_DIJAWAB : STATUS_SOAL_BELUM;
  }

  /**
   * Jumlah Status_Soal untuk dialog selesai (Requirement 19.1).
   * dijawab + belum + ragu = soalIds.length.
   * @param {string[]} soalIds
   * @param {Object<string, {pilihan: string[], ragu: boolean}>} stateMap
   * @returns {{dijawab: number, belum: number, ragu: number}}
   */
  function hitungStatus(soalIds, stateMap) {
    var ids = salinArray(soalIds);
    var peta = stateMap || {};
    var hasil = { dijawab: 0, belum: 0, ragu: 0 };
    for (var i = 0; i < ids.length; i++) {
      var st = Object.prototype.hasOwnProperty.call(peta, ids[i]) ? peta[ids[i]] : null;
      var s = st ? statusSoal(st.pilihan, st.ragu) : STATUS_SOAL_BELUM;
      if (s === STATUS_SOAL_RAGU) hasil.ragu++;
      else if (s === STATUS_SOAL_DIJAWAB) hasil.dijawab++;
      else hasil.belum++;
    }
    return hasil;
  }

  /**
   * Reducer navigasi Halaman_Ujian (Requirement 15.5–15.7, 15.12).
   * state: objek {nomor, ...} (field lain disalin apa adanya) atau angka nomor.
   * aksi: 'SEBELUMNYA' | 'BERIKUTNYA' | {tipe: 'PILIH', nomor} (string atau {tipe}).
   * Nomor selalu dijepit ke [1, total]; aksi tidak dikenal / nomor tidak sah
   * mengembalikan nomor semula. Tidak pernah mengubah state masukan.
   * @param {(Object|number)} state
   * @param {(string|{tipe: string, nomor?: number})} aksi
   * @param {number} total jumlah soal (≥ 1)
   * @returns {(Object|number)} bentuk sama dengan state
   */
  function navigasi(state, aksi, total) {
    var adalahAngka = typeof state === 'number';
    var k = adalahAngka ? state : Number(state && state.nomor);
    var n = Math.floor(Number(total));
    if (!(n >= 1)) n = 1;
    if (!(k >= 1) || Math.floor(k) !== k) k = 1;
    if (k > n) k = n;

    var tipe = typeof aksi === 'string' ? aksi : aksi && aksi.tipe;
    tipe = tipe ? String(tipe).toUpperCase() : '';
    var baru = k;
    if (tipe === AKSI_SEBELUMNYA) {
      baru = k >= 2 ? k - 1 : 1;
    } else if (tipe === AKSI_BERIKUTNYA) {
      baru = k < n ? k + 1 : n;
    } else if (tipe === AKSI_PILIH) {
      var t = Number(aksi && aksi.nomor);
      if (t >= 1 && t <= n && Math.floor(t) === t) baru = t;
    }

    if (adalahAngka) return baru;
    var hasil = salinObjek(state || {});
    hasil.nomor = baru;
    return hasil;
  }

  /**
   * Reducer klik opsi (Requirement 15.8, 15.9). Mengembalikan array baru
   * label tampil. PG/BS: hanya label terakhir yang diklik. PGK: toggle,
   * hasil diurutkan (himpunan opsi yang diklik ganjil kali).
   * @param {string} tipe 'PG' | 'PGK' | 'BS'
   * @param {string[]} pilihan pilihan saat ini (label tampil)
   * @param {string} label label yang diklik
   * @returns {string[]}
   */
  function pilihOpsi(tipe, pilihan, label) {
    var sekarang = normalisasiPilihan(pilihan);
    if (label === null || label === undefined || label === '') return sekarang;
    var l = String(label);
    if (tipe !== 'PGK') return [l];
    var idx = sekarang.indexOf(l);
    if (idx === -1) sekarang.push(l);
    else sekarang.splice(idx, 1);
    return urutkan(sekarang);
  }

  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }

  /**
   * Format Timer JJ:MM:DD (Requirement 17.3). Nilai negatif / tidak sah → 00:00:00;
   * pecahan dibulatkan ke bawah.
   * @param {number} detik
   * @returns {string}
   */
  function formatTimer(detik) {
    var d = Math.floor(Number(detik));
    if (!(d > 0) || !isFinite(d)) d = 0;
    var jam = Math.floor(d / 3600);
    var menit = Math.floor((d % 3600) / 60);
    var dtk = d % 60;
    return pad2(jam) + ':' + pad2(menit) + ':' + pad2(dtk);
  }

  /**
   * Sisa waktu dalam detik bulat (Requirement 17.2):
   * max(0, floor((batasWaktuMs − nowMs) / 1000)).
   * @param {number} batasWaktuMs
   * @param {number} nowMs
   * @returns {number}
   */
  function sisaDetik(batasWaktuMs, nowMs) {
    var s = Math.floor((Number(batasWaktuMs) - Number(nowMs)) / 1000);
    return s > 0 && isFinite(s) ? s : 0;
  }

  /**
   * Daftar ujian Peserta (Requirement 13.1): tepat Mapel berstatus aktif
   * (urutan sesuai mapelRows) dengan status 'BELUM' | 'AKTIF' | 'SELESAI'
   * berdasarkan Sesi milik idPeserta. Jika ada lebih dari satu Sesi untuk
   * satu Mapel, SELESAI didahulukan.
   * @param {Object[]} mapelRows baris Mapel
   * @param {Object[]} sesiRows baris Sesi
   * @param {string} idPeserta
   * @returns {Array<{kodeMapel, namaMapel, durasiMenit, jumlahSoal, status, idSesi?}>}
   */
  function buildDaftarUjian(mapelRows, sesiRows, idPeserta) {
    var sesiPerMapel = {};
    var sesi = salinArray(sesiRows);
    for (var i = 0; i < sesi.length; i++) {
      var s = sesi[i];
      if (!s || String(ambilField(s, 'id_peserta', 'idPeserta')) !== String(idPeserta)) continue;
      var st = ambilField(s, 'status', 'status');
      if (st !== SESI_AKTIF && st !== SESI_SELESAI) continue;
      var kode = String(ambilField(s, 'kode_mapel', 'kodeMapel'));
      var lama = Object.prototype.hasOwnProperty.call(sesiPerMapel, kode) ? sesiPerMapel[kode] : null;
      if (!lama || (lama.status !== SESI_SELESAI && st === SESI_SELESAI)) {
        sesiPerMapel[kode] = { status: st, idSesi: ambilField(s, 'id_sesi', 'idSesi') };
      }
    }

    var hasil = [];
    var mapel = salinArray(mapelRows);
    for (var j = 0; j < mapel.length; j++) {
      var m = mapel[j];
      if (!m || !benarSel(ambilField(m, 'status_aktif', 'statusAktif'))) continue;
      var kodeM = String(ambilField(m, 'kode_mapel', 'kodeMapel'));
      var item = {
        kodeMapel: kodeM,
        namaMapel: ambilField(m, 'nama_mapel', 'namaMapel'),
        durasiMenit: Number(ambilField(m, 'durasi_menit', 'durasiMenit')),
        jumlahSoal: Number(ambilField(m, 'jumlah_soal', 'jumlahSoal')),
        status: 'BELUM'
      };
      if (Object.prototype.hasOwnProperty.call(sesiPerMapel, kodeM)) {
        item.status = sesiPerMapel[kodeM].status;
        item.idSesi = sesiPerMapel[kodeM].idSesi;
      }
      hasil.push(item);
    }
    return hasil;
  }

  /** Sesi AKTIF yang sudah melewati batas waktu + toleransi pada `now`. */
  function kadaluwarsa(sesi, now) {
    if (!sesi || ambilField(sesi, 'status', 'status') !== SESI_AKTIF) return false;
    var batas = angkaAtauNaN(ambilField(sesi, 'batas_waktu', 'batasWaktu'));
    return isFinite(batas) && Number(now) > batas + TOLERANSI_MS;
  }

  /**
   * Penutupan otomatis Sesi kadaluwarsa (Requirement 13.9, 17.9, 17.10).
   * Sesi AKTIF dengan now > batas_waktu + 30.000 menjadi salinan berstatus
   * SELESAI dengan waktu_selesai = batas_waktu; Sesi lain tidak diubah
   * (referensi yang sama). Input tidak dimutasi; idempoten.
   * @param {Object[]} sesiRows
   * @param {number} now ms epoch
   * @returns {{sesi: Object[], ditutup: Object[]}} sesi: seluruh baris setelah
   *          penutupan (urutan sama); ditutup: baris yang baru ditutup
   */
  function tutupKadaluwarsa(sesiRows, now) {
    var rows = salinArray(sesiRows);
    var hasil = [];
    var ditutup = [];
    for (var i = 0; i < rows.length; i++) {
      var s = rows[i];
      if (kadaluwarsa(s, now)) {
        var baru = salinObjek(s);
        var batas = Number(ambilField(s, 'batas_waktu', 'batasWaktu'));
        baru.status = SESI_SELESAI;
        if (s.batas_waktu !== undefined || s.batasWaktu === undefined) baru.waktu_selesai = batas;
        else baru.waktuSelesai = batas;
        hasil.push(baru);
        ditutup.push(baru);
      } else {
        hasil.push(s);
      }
    }
    return { sesi: hasil, ditutup: ditutup };
  }

  /**
   * Apakah Sesi masih menerima jawaban/penanda ragu (Requirement 16.8, 17.8, 19.7):
   * status AKTIF dan now ≤ batas_waktu + 30.000.
   * @param {Object} sesi
   * @param {number} now ms epoch
   * @returns {boolean}
   */
  function bolehSimpan(sesi, now) {
    if (!sesi || ambilField(sesi, 'status', 'status') !== SESI_AKTIF) return false;
    var batas = angkaAtauNaN(ambilField(sesi, 'batas_waktu', 'batasWaktu'));
    var t = Number(now);
    return isFinite(batas) && isFinite(t) && t <= batas + TOLERANSI_MS;
  }

  // ---------------------------------------------------------------------------
  // Ekspor
  // ---------------------------------------------------------------------------
  var api = {
    LABEL_TAMPIL: LABEL_TAMPIL,
    OPSI_BS: OPSI_BS,
    // 2. Pengacakan dan pemilihan
    shuffle: shuffle,
    pilihSoal: pilihSoal,
    susunOpsi: susunOpsi,
    // 3. Pemetaan
    keAsli: keAsli,
    keTampil: keTampil,
    // 4. Validasi
    validasiJawaban: validasiJawaban,
    // 5. ID
    newId: newId,
    // 6. Penilaian
    roundHalfUp2: roundHalfUp2,
    nilaiSoal: nilaiSoal,
    nilaiSesi: nilaiSesi,
    // 7. Status, navigasi, waktu
    TOLERANSI_MS: TOLERANSI_MS,
    statusSoal: statusSoal,
    hitungStatus: hitungStatus,
    navigasi: navigasi,
    pilihOpsi: pilihOpsi,
    formatTimer: formatTimer,
    sisaDetik: sisaDetik,
    buildDaftarUjian: buildDaftarUjian,
    tutupKadaluwarsa: tutupKadaluwarsa,
    bolehSimpan: bolehSimpan
  };
  return api;
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ExamLogic;
}
