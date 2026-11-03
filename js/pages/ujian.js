/*
 * pages/ujian.js — Halaman_Ujian Peserta (#/ujian/:idSesi).
 * Requirement 8.15, 15.1, 15.3–15.14, 16.1, 16.3–16.6, 20.9 (tugas 22.3).
 *
 * Isi tugas 22.3:
 * - Paket dimuat dari CBT.ujianHandoff.ambil(idSesi) (titipan mulaiUjian /
 *   lanjut dari peserta-pilih.js / peserta-konfirmasi.js) atau, bila kosong,
 *   api.lanjutUjian({idSesi, deviceId}). Jawaban dan penanda ragu dipulihkan
 *   dari paket (16.6). UJIAN_SELESAI / WAKTU_HABIS → #/hasil/:idSesi.
 * - Satu Soal per tampilan: teks via CBTMarkup.renderHtml, gambar
 *   referrerpolicy="no-referrer" dengan batas 10 detik → "Gambar tidak dapat
 *   dimuat" (8.15, 15.14), opsi sesuai urutan Sesi dengan label A.. menurut
 *   posisi (BS: "Benar"/"Salah" tanpa huruf) (15.1, 20.9). PG/BS radio,
 *   PGK checkbox + petunjuk "Pilih lebih dari satu jawaban"; perubahan
 *   dihitung oleh ExamLogic.pilihOpsi (15.8, 15.9).
 * - Panel_Nomor: warna dari ExamLogic.statusSoal + penanda nomor aktif +
 *   keterangan (15.3, 15.4); pilih nomor → tampil soal dan panel geser
 *   ditutup (15.5, 15.11).
 * - Navigasi via ExamLogic.navigasi: "Sebelumnya" nonaktif di nomor 1,
 *   "Berikutnya" menjadi "Selesai" di nomor terakhir (15.6, 15.7, 15.12, 15.13).
 * - Tombol "Ragu-ragu" (aria-pressed) (16.1, 16.3–16.5).
 * - Ukuran huruf kecil/sedang/besar (14/16/20 px), awal sedang, disimpan per
 *   Sesi di sessionStorage['cbt_fs_<idSesi>'] (15.10).
 *
 *
 * Isi tugas 22.4 (Requirement 17.2–17.7, 17.11–17.13):
 * - Timer: deadline = now() + sisaDetik*1000 (now = performance.now);
 *   interval 250 ms menghitung tampil = hitungTampil(deadline, now()) dan
 *   menulis ExamLogic.formatTimer(tampil). 0 < tampil ≤ 300 → .is-kritis.
 * - Sinkronisasi api.sisaWaktu({idSesi}) tiap 60 detik (batas 15 detik;
 *   gagal/terlambat → Timer lanjut dari nilai terakhir, coba lagi di jadwal
 *   berikutnya). state.setSisaDetik(n) dipanggil dari setiap respons berhasil
 *   yang berisi sisaDetik (22.5 memakainya untuk respons simpanJawaban).
 * - Pemberitahuan "waktu hampir habis" (div.ujian-pemberitahuan
 *   [data-jenis=hampir-habis], dapat ditutup) satu kali per pemuatan saat
 *   tampil masuk 1..300.
 * - tampil = 0 → kunciInput('WAKTU_HABIS'), pemberitahuan
 *   [data-jenis=waktu-habis], state.flush() (batas 15 detik), lalu
 *   api.kumpulkan({idSesi}) dengan batas 15 detik; gagal → ulang tiap 5 detik
 *   maksimal 5 kali. UJIAN_SELESAI / WAKTU_HABIS dianggap berhasil. Berhasil
 *   → CBT.hasilHandoff[idSesi] = HasilPeserta (bila ada), ke #/hasil/:idSesi.
 *   Semua gagal → [data-jenis=kumpul-gagal] "Jawaban yang sudah tersimpan
 *   akan dinilai otomatis oleh Backend."
 * - Sumber waktu dapat disuntik lewat ctx.waktu = {now, setInterval,
 *   clearInterval, setTimeout, clearTimeout} (sebagian boleh); bawaan
 *   performance.now dan timer global (untuk tes fake timers, tugas 22.9).
 *
 * Isi tugas 22.5 (Requirement 14.6, 14.7, 16.2, 18.1, 18.4–18.7, 18.9–18.13):
 * - AnswerQueue (shared/answer-queue.js, global AnswerQueue) per Sesi dengan
 *   storage localStorage (ctx.localStorage menimpa; null = tidak tersedia),
 *   jam {now: Date.now, setTimeout/clearTimeout dari ctx.waktu}, dan pengirim
 *   api.simpanJawaban({idSesi, deviceId, items}, {timeoutMs: 15000}).
 * - Saat paket dimuat: mergeJawaban(jawaban Backend, antrean lokal) sebelum
 *   soal tampil; antrean tidak kosong → langsung dikirim. state.flush =
 *   antrean.flush, dipasang sebelum Timer mulai.
 * - pilihJawaban → antrean.put (jawaban + ragu dalam satu entri).
 * - Indikator .simpan-indikator[data-state] mengikuti antrean.state():
 *   "Menyimpan..." / "Tersimpan" / "Belum tersimpan".
 * - Event `online` → antrean.notifyOnline(); sinkronisasi sisaWaktu berhasil
 *   → antrean.notifyRequestOk(); `beforeunload` mencegah tutup halaman hanya
 *   bila antrean tidak kosong.
 * - Respons simpanJawaban: sisaDetik → state.setSisaDetik; item ditolak →
 *   pemberitahuan [data-jenis=ditolak] berisi nomor soal dan alasan;
 *   PERANGKAT_LAIN → [data-jenis=perangkat-lain] + tombol "Lanjutkan di
 *   perangkat ini" (api.lanjutUjian mengambil alih perangkat aktif, jawaban
 *   digabung ulang, antrean dikirim); WAKTU_HABIS / UJIAN_SELESAI → kunci
 *   input, ke #/hasil/:idSesi (kecuali pengumpulan otomatis sedang berjalan).
 * - localStorage tidak tersedia/penuh → antrean di memori dan pemberitahuan
 *   [data-jenis=penyimpanan-lokal] sekali per pemuatan.
 *
 * Isi tugas 22.6 (Requirement 19.1–19.3, 19.6, 19.8–19.10):
 * - Tombol "Selesai" → dialog .dialog.ujian-dialog-selesai (di dalam
 *   .ujian-layout) berisi jumlah dijawab/belum/ragu (ExamLogic.hitungStatus),
 *   peringatan .dialog-peringatan bila belum/ragu > 0, tombol Batal dan
 *   "Ya, selesai". Batal / Escape → dialog ditutup tanpa perubahan.
 * - Konfirmasi → input dan kedua tombol nonaktif + indikator .dialog-status →
 *   state.flush sampai antrean kosong (ulang maks. 3 kali, jeda 2 detik) →
 *   api.kumpulkan (batas 15 detik, ulang maks. 3 kali) → #/hasil/:idSesi.
 *   UJIAN_SELESAI / WAKTU_HABIS dianggap berhasil.
 * - Gagal → .dialog-galat + tombol "Coba lagi"; Timer tetap berjalan,
 *   antrean dipertahankan, input dibuka kembali.
 * - Waktu habis saat dialog terbuka → dialog ditutup, pengumpulan otomatis
 *   berjalan. Waktu habis saat proses manual → permintaan yang sedang berjalan
 *   ditunggu, lalu pengumpulan otomatis mengambil alih (tidak ada dua
 *   permintaan bersamaan).
 *
 * Struktur kelas soal sama dengan pratinjau Admin (admin-soal.js
 * buatPratinjau): .ujian-soal > .soal-header .soal-nomor, .soal-teks,
 * .soal-gambar (.gambar-gagal), .soal-petunjuk, .opsi-list > .opsi >
 * .opsi-label > input + .opsi-huruf + .opsi-teks.
 * Kerangka halaman mengikuti kontrak kelas di header css/ujian.css:
 *   .ujian-layout[data-fs=kecil|sedang|besar](.is-terkunci)
 *     header.ujian-header  (.ujian-brand, .ujian-info > .ujian-mapel +
 *                           .ujian-peserta, .ujian-timer, .ujian-panel-toggle
 *                           > .ujian-nomor-aktif)
 *     div.ujian-main       (bukan <main>: wadah #app sudah <main>)
 *       section.ujian-konten > article.ujian-soal (soal-header berisi
 *                           .soal-nomor + .fs-switch > .fs-btn[data-fs])
 *       aside.ujian-panel#panel-nomor(.is-open) (.ujian-panel-close,
 *                           .nomor-grid > .nomor-btn.status-*(.is-aktif),
 *                           ul.nomor-legend > .legend-item > .legend-swatch)
 *     div.ujian-panel-backdrop(.is-open)
 *     footer.ujian-footer  (.ujian-btn-prev, .ujian-btn-ragu[aria-pressed],
 *                           .simpan-indikator[data-state], .ujian-btn-next |
 *                           .ujian-btn-selesai pada Soal terakhir)
 *
 * TITIK SAMBUNG UNTUK TUGAS BERIKUTNYA (semua di dalam render()):
 * - `state`                     : objek state pusat (sesi, soal, jawaban,
 *                                 nomor, terkunci, dom, pembersih[]).
 * - `pilihJawaban(id, p, ragu)` : satu-satunya jalur perubahan jawaban/ragu.
 *                                 Memanggil antrean.put (22.5).
 * - `state.dom.timer`           : elemen Timer di header (tugas 22.4).
 * - `state.setSisaDetik(n)`     : perbarui deadline Timer dari respons
 *                                 Backend (sisaWaktu, simpanJawaban).
 * - `state.flush()`             : → Promise; dipanggil sebelum pengumpulan
 *                                 otomatis. = antrean.flush (22.5).
 * - `state.antrean`             : instansi AnswerQueue (22.5).
 * - `state.mulaiPengumpulanOtomatis()` : kunci + kumpulkan (waktu habis).
 * - `bukaDialogSelesai()`       : dipicu tombol "Selesai". [22.6]
 * - `kunciInput(alasan)` / `bukaKunciInput()` : menonaktifkan / memulihkan
 *                                 opsi, Ragu-ragu, dan Selesai. [22.4–22.6]
 * - `state.dom.indikator`       : indikator status simpan (22.5).
 * - `state.pembersih`           : daftar fungsi yang dipanggil destroy()
 *                                 (interval Timer, listener online/beforeunload).
 *
 * Satu-satunya pemakaian innerHTML adalah keluaran CBTMarkup.renderHtml, yang
 * meng-escape teks masukan dan hanya menghasilkan tag daftar putih.
 */
(function (root) {
  'use strict';

  var LABEL_TAMPIL = ['A', 'B', 'C', 'D', 'E'];
  var OPSI_BS = [{ nilai: 'B', teks: 'Benar' }, { nilai: 'S', teks: 'Salah' }];

  var BATAS_GAMBAR_MS = 10000;
  var PESAN_GAMBAR_GAGAL = 'Gambar tidak dapat dimuat';
  var PETUNJUK_PGK = 'Pilih lebih dari satu jawaban';

  /** Ukuran huruf soal/opsi dalam piksel (Requirement 15.10). */
  var UKURAN_HURUF = { kecil: 14, sedang: 16, besar: 20 };
  var URUTAN_UKURAN = [
    { kode: 'kecil', label: 'A-', judul: 'Huruf kecil (14 piksel)' },
    { kode: 'sedang', label: 'A', judul: 'Huruf sedang (16 piksel)' },
    { kode: 'besar', label: 'A+', judul: 'Huruf besar (20 piksel)' }
  ];
  var UKURAN_AWAL = 'sedang';
  var PREFIX_KUNCI_UKURAN = 'cbt_fs_';

  /** Status_Soal → kelas CSS dan teks keterangan (Requirement 15.3, 15.4). */
  var INFO_STATUS = {
    BELUM: { kelas: 'status-belum', teks: 'Belum dijawab' },
    DIJAWAB: { kelas: 'status-dijawab', teks: 'Sudah dijawab' },
    RAGU: { kelas: 'status-ragu', teks: 'Ragu-ragu' }
  };

  var ID_PANEL = 'panel-nomor';

  /** Timer dan pengumpulan otomatis (Requirement 17.4–17.6, 17.11–17.13). */
  var TICK_MS = 250;
  var SINKRON_MS = 60000;
  var BATAS_PERMINTAAN_MS = 15000;
  var BATAS_FLUSH_MS = 15000;
  var JEDA_ULANG_KUMPUL_MS = 5000;
  var MAKS_ULANG_KUMPUL = 5;
  var AMBANG_KRITIS_DETIK = 300;
  var PESAN_HAMPIR_HABIS = 'Waktu ujian hampir habis. Sisa waktu kurang dari 5 menit.';
  var PESAN_WAKTU_HABIS = 'Waktu ujian telah habis. Jawaban Anda sedang dikumpulkan...';
  var PESAN_KUMPUL_GAGAL = 'Pengumpulan ujian belum berhasil. Jawaban yang sudah tersimpan akan dinilai otomatis oleh Backend.';

  /** Simpan otomatis (Requirement 14.7, 18.5, 18.11, 18.13). */
  var TEKS_INDIKATOR = {
    MENYIMPAN: 'Menyimpan...',
    TERSIMPAN: 'Tersimpan',
    BELUM_TERSIMPAN: 'Belum tersimpan'
  };
  var PESAN_PERANGKAT_LAIN = 'Ujian sedang dibuka di perangkat lain. Jawaban terbaru di perangkat ini belum tersimpan.';
  var LABEL_LANJUT_DI_SINI = 'Lanjutkan di perangkat ini';
  var PESAN_PENYIMPANAN_LOKAL = 'Penyimpanan lokal browser tidak tersedia. Jawaban tetap dikirim ke server, tetapi tidak dapat dipulihkan jika halaman dimuat ulang sebelum tersimpan.';
  var PESAN_DITOLAK_AWAL = 'Jawaban tidak dapat disimpan';

  /** Dialog selesai (Requirement 19.1–19.3, 19.6, 19.8–19.10). */
  var MAKS_ULANG_SELESAI = 3;          // percobaan ulang flush dan kumpulkan masing-masing
  var JEDA_ULANG_SELESAI_MS = 2000;
  var JUDUL_SELESAI = 'Selesai Ujian';
  var PESAN_KONFIRMASI_SELESAI = 'Apakah Anda yakin ingin mengakhiri ujian? Jawaban tidak dapat diubah setelah ujian selesai.';
  var LABEL_YA_SELESAI = 'Ya, selesai';
  var LABEL_ULANG_SELESAI = 'Coba lagi';
  var TEKS_MENGIRIM_JAWABAN = 'Mengirim jawaban...';
  var TEKS_MENGUMPULKAN = 'Mengumpulkan ujian...';
  var PESAN_SELESAI_GAGAL = 'Pengumpulan ujian gagal. Jawaban Anda tetap tersimpan di perangkat ini. Periksa koneksi internet, lalu pilih "Coba lagi".';

  /**
   * Peringatan dialog selesai bila masih ada Soal belum dijawab atau ragu-ragu
   * (Requirement 19.2).
   * @param {{belum:number, ragu:number}} r hasil ExamLogic.hitungStatus
   * @returns {string} '' bila keduanya 0
   */
  function pesanPeringatanSelesai(r) {
    var belum = Math.max(0, Math.floor(Number(r && r.belum)) || 0);
    var ragu = Math.max(0, Math.floor(Number(r && r.ragu)) || 0);
    if (belum === 0 && ragu === 0) return '';
    return 'Masih ada ' + belum + ' soal belum dijawab dan ' + ragu + ' soal ragu-ragu.';
  }

  /**
   * Teks pesan untuk item yang ditolak Backend (Requirement 18.11).
   * @param {Array<{idSoal:string, alasan?:string}>} ditolak
   * @param {function(string):(number|null)} nomorDari idSoal → nomor tampil
   * @returns {string} '' bila tidak ada item
   */
  function pesanDitolak(ditolak, nomorDari) {
    var daftar = Array.isArray(ditolak) ? ditolak.filter(isObj) : [];
    if (daftar.length === 0) return '';
    var bagian = daftar.map(function (d) {
      var no = typeof nomorDari === 'function' ? nomorDari(str(d.idSoal)) : null;
      var label = no ? 'soal nomor ' + no : 'soal ' + str(d.idSoal);
      var alasan = str(d.alasan).trim();
      return label + (alasan ? ' (' + alasan + ')' : '');
    });
    return PESAN_DITOLAK_AWAL + ': ' + bagian.join('; ') + '.';
  }

  function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function isObj(x) { return x !== null && typeof x === 'object'; }
  function str(v) { return v === null || v === undefined ? '' : String(v); }

  function ambilGlobal(nama) {
    /* eslint-disable no-undef */
    if (nama === 'ExamLogic' && typeof ExamLogic !== 'undefined') return ExamLogic;
    if (nama === 'CBTMarkup' && typeof CBTMarkup !== 'undefined') return CBTMarkup;
    if (nama === 'AnswerQueue' && typeof AnswerQueue !== 'undefined') return AnswerQueue;
    /* eslint-enable no-undef */
    return root ? root[nama] : undefined;
  }

  /* ---------------------------------------------------------------------
   * Helper murni (diekspor untuk tes)
   * ------------------------------------------------------------------- */

  function kunciUkuran(idSesi) { return PREFIX_KUNCI_UKURAN + str(idSesi); }

  /** Ukuran huruf tersimpan untuk Sesi; tidak ada / tidak sah → 'sedang'. */
  function bacaUkuranHuruf(storage, idSesi) {
    var v = null;
    try { v = storage ? storage.getItem(kunciUkuran(idSesi)) : null; } catch (e) { v = null; }
    return typeof v === 'string' && hasOwn(UKURAN_HURUF, v) ? v : UKURAN_AWAL;
  }

  /** Menyimpan ukuran huruf Sesi. @returns {boolean} berhasil disimpan */
  function simpanUkuranHuruf(storage, idSesi, ukuran) {
    if (!hasOwn(UKURAN_HURUF, ukuran) || !storage) return false;
    try { storage.setItem(kunciUkuran(idSesi), ukuran); return true; } catch (e) { return false; }
  }

  /**
   * Daftar opsi tampil satu Soal (Requirement 15.1, 15.8, 20.9).
   * PG/PGK: urutan sesuai paket (urutan opsi Sesi), maksimal 5; nilai dan
   * huruf = label posisi A, B, C, ... BS: selalu Benar (B) lalu Salah (S),
   * tanpa huruf.
   * @param {{tipe:string, opsi:Array<{label?:string, teks?:string}>}} soal
   * @returns {Array<{nilai:string, huruf:(string|null), teks:string}>}
   */
  function daftarOpsiTampil(soal) {
    var tipe = str(soal && soal.tipe).toUpperCase();
    var opsi = soal && Array.isArray(soal.opsi) ? soal.opsi : [];
    if (tipe === 'BS') {
      return OPSI_BS.map(function (b) {
        var cocok = null;
        for (var i = 0; i < opsi.length; i++) {
          if (isObj(opsi[i]) && str(opsi[i].label) === b.nilai && str(opsi[i].teks) !== '') { cocok = opsi[i]; break; }
        }
        return { nilai: b.nilai, huruf: null, teks: cocok ? str(cocok.teks) : b.teks };
      });
    }
    return opsi.slice(0, LABEL_TAMPIL.length).map(function (o, i) {
      return { nilai: LABEL_TAMPIL[i], huruf: LABEL_TAMPIL[i], teks: str(isObj(o) ? o.teks : o) };
    });
  }

  /**
   * Menormalkan pilihan (label tampil) terhadap opsi Soal: hanya nilai opsi
   * yang ada, tanpa duplikat, urut sesuai posisi tampil; PG/BS paling banyak
   * satu nilai.
   * @param {*} pilihan
   * @param {{tipe:string, opsi:Array<{nilai:string}>}} soal soal ternormalisasi
   * @returns {string[]}
   */
  function bersihkanPilihan(pilihan, soal) {
    var daftar = Array.isArray(pilihan) ? pilihan : [];
    var nilaiOpsi = (soal && Array.isArray(soal.opsi) ? soal.opsi : []).map(function (o) { return o.nilai; });
    var hasil = nilaiOpsi.filter(function (n) { return daftar.map(str).indexOf(n) !== -1; });
    if (soal && soal.tipe !== 'PGK' && hasil.length > 1) {
      var pertama = null;
      for (var i = 0; i < daftar.length && pertama === null; i++) {
        if (nilaiOpsi.indexOf(str(daftar[i])) !== -1) pertama = str(daftar[i]);
      }
      hasil = [pertama];
    }
    return hasil;
  }

  /**
   * Menormalkan PaketUjian (design.md §2) untuk Halaman_Ujian.
   * Soal diurutkan menurut `no`, dinomori ulang 1..n; setiap Soal punya entri
   * jawaban {pilihan, ragu} (Requirement 15.1, 16.6).
   * @param {object} paket
   * @param {string} [idSesi] cadangan bila paket.sesi.idSesi kosong
   * @returns {{sesi:object, soal:Array, jawaban:Object<string,{pilihan:string[], ragu:boolean}>}}
   */
  function normalisasiPaket(paket, idSesi) {
    var p = isObj(paket) ? paket : {};
    var s = isObj(p.sesi) ? p.sesi : {};
    var sisa = Math.floor(Number(s.sisaDetik));
    var sesi = {
      idSesi: str(s.idSesi) || str(idSesi),
      kodeMapel: str(s.kodeMapel),
      namaMapel: str(s.namaMapel),
      namaPeserta: str(s.namaPeserta),
      kelas: str(s.kelas),
      status: str(s.status) || 'AKTIF',
      sisaDetik: isFinite(sisa) && sisa > 0 ? sisa : 0,
      jumlahSoal: 0
    };
    var mentah = Array.isArray(p.soal) ? p.soal.filter(isObj) : [];
    var terindeks = mentah.map(function (x, i) { return { x: x, i: i, no: Number(x.no) }; });
    terindeks.sort(function (a, b) {
      var an = isFinite(a.no), bn = isFinite(b.no);
      if (an && bn && a.no !== b.no) return a.no - b.no;
      if (an !== bn) return an ? -1 : 1;
      return a.i - b.i;
    });
    var dilihat = {};
    var soal = [];
    terindeks.forEach(function (t) {
      var id = str(t.x.idSoal);
      if (id === '' || hasOwn(dilihat, id)) return;
      dilihat[id] = true;
      var tipe = str(t.x.tipe).toUpperCase();
      soal.push({
        no: soal.length + 1,
        idSoal: id,
        tipe: tipe,
        teks: str(t.x.teks),
        urlGambar: str(t.x.urlGambar).trim(),
        opsi: daftarOpsiTampil({ tipe: tipe, opsi: t.x.opsi })
      });
    });
    sesi.jumlahSoal = soal.length;
    var sumber = isObj(p.jawaban) ? p.jawaban : {};
    var jawaban = {};
    soal.forEach(function (sl) {
      var j = hasOwn(sumber, sl.idSoal) && isObj(sumber[sl.idSoal]) ? sumber[sl.idSoal] : null;
      jawaban[sl.idSoal] = {
        pilihan: bersihkanPilihan(j ? j.pilihan : [], sl),
        ragu: !!j && j.ragu === true
      };
    });
    return { sesi: sesi, soal: soal, jawaban: jawaban };
  }

  /**
   * Kelas CSS + teks Status_Soal satu entri jawaban (Requirement 15.3, 16.4).
   * @returns {{kode:string, kelas:string, teks:string}}
   */
  function infoStatus(entri) {
    var EL = ambilGlobal('ExamLogic');
    var kode = EL.statusSoal(entri ? entri.pilihan : [], entri ? entri.ragu === true : false);
    var info = INFO_STATUS[kode] || INFO_STATUS.BELUM;
    return { kode: kode, kelas: info.kelas, teks: info.teks };
  }

  /**
   * Detik yang ditampilkan Timer: max(0, ceil((deadline − now)/1000)).
   * @param {number} deadline ms (jam monoton)
   * @param {number} now ms (jam monoton)
   * @returns {number}
   */
  function hitungTampil(deadline, now) {
    var d = Math.ceil((Number(deadline) - Number(now)) / 1000);
    return isFinite(d) && d > 0 ? d : 0;
  }

  /** Timer berwarna merah: 0 < detik ≤ 300 (Requirement 17.4). */
  function timerKritis(detik) {
    return detik > 0 && detik <= AMBANG_KRITIS_DETIK;
  }

  /**
   * Sumber waktu: ctx.waktu (boleh sebagian) atau bawaan performance.now dan
   * timer global.
   */
  function sumberWaktu(ctx) {
    var w = ctx && isObj(ctx.waktu) ? ctx.waktu : {};
    var g = root || {};
    var bawaanNow = function () {
      var perf = g.performance;
      return perf && typeof perf.now === 'function' ? perf.now() : Date.now();
    };
    function pilih(nama, cadangan) {
      if (typeof w[nama] === 'function') return w[nama];
      return function () { return cadangan.apply(g, arguments); };
    }
    return {
      now: typeof w.now === 'function' ? w.now : bawaanNow,
      setInterval: pilih('setInterval', function (f, ms) { return setInterval(f, ms); }),
      clearInterval: pilih('clearInterval', function (id) { return clearInterval(id); }),
      setTimeout: pilih('setTimeout', function (f, ms) { return setTimeout(f, ms); }),
      clearTimeout: pilih('clearTimeout', function (id) { return clearTimeout(id); })
    };
  }

  /* ---------------------------------------------------------------------
   * Halaman
   * ------------------------------------------------------------------- */

  // Instansi render terakhir; dibersihkan oleh destroy() / render berikutnya.
  var instansi = null;

  function hentikanInstansi() {
    var i = instansi;
    instansi = null;
    if (i) i.bersihkan();
  }

  function isiMarkup(node, teks) {
    node.innerHTML = ambilGlobal('CBTMarkup').renderHtml(str(teks));
    return node;
  }

  function handoff() {
    var CBT = root && root.CBT;
    return CBT && CBT.ujianHandoff && typeof CBT.ujianHandoff.ambil === 'function' ? CBT.ujianHandoff : null;
  }

  function sesiStorage(ctx) {
    if (ctx && ctx.sessionStorage !== undefined) return ctx.sessionStorage;
    try { return root ? root.sessionStorage : null; } catch (e) { return null; }
  }

  /** localStorage untuk AnswerQueue; ctx.localStorage (boleh null) menimpa. */
  function lokalStorage(ctx) {
    if (ctx && ctx.localStorage !== undefined) return ctx.localStorage;
    try { return root ? root.localStorage : null; } catch (e) { return null; }
  }

  var page = {
    // Helper murni untuk tes.
    TEKS_INDIKATOR: TEKS_INDIKATOR,
    PESAN_PERANGKAT_LAIN: PESAN_PERANGKAT_LAIN,
    LABEL_LANJUT_DI_SINI: LABEL_LANJUT_DI_SINI,
    PESAN_PENYIMPANAN_LOKAL: PESAN_PENYIMPANAN_LOKAL,
    pesanDitolak: pesanDitolak,
    pesanPeringatanSelesai: pesanPeringatanSelesai,
    MAKS_ULANG_SELESAI: MAKS_ULANG_SELESAI,
    JEDA_ULANG_SELESAI_MS: JEDA_ULANG_SELESAI_MS,
    LABEL_YA_SELESAI: LABEL_YA_SELESAI,
    LABEL_ULANG_SELESAI: LABEL_ULANG_SELESAI,
    TEKS_MENGIRIM_JAWABAN: TEKS_MENGIRIM_JAWABAN,
    TEKS_MENGUMPULKAN: TEKS_MENGUMPULKAN,
    PESAN_SELESAI_GAGAL: PESAN_SELESAI_GAGAL,
    UKURAN_HURUF: UKURAN_HURUF,
    BATAS_GAMBAR_MS: BATAS_GAMBAR_MS,
    PESAN_GAMBAR_GAGAL: PESAN_GAMBAR_GAGAL,
    PETUNJUK_PGK: PETUNJUK_PGK,
    kunciUkuran: kunciUkuran,
    bacaUkuranHuruf: bacaUkuranHuruf,
    simpanUkuranHuruf: simpanUkuranHuruf,
    daftarOpsiTampil: daftarOpsiTampil,
    bersihkanPilihan: bersihkanPilihan,
    normalisasiPaket: normalisasiPaket,
    infoStatus: infoStatus,
    hitungTampil: hitungTampil,
    timerKritis: timerKritis,
    TICK_MS: TICK_MS,
    SINKRON_MS: SINKRON_MS,
    BATAS_PERMINTAAN_MS: BATAS_PERMINTAAN_MS,
    BATAS_FLUSH_MS: BATAS_FLUSH_MS,
    JEDA_ULANG_KUMPUL_MS: JEDA_ULANG_KUMPUL_MS,
    MAKS_ULANG_KUMPUL: MAKS_ULANG_KUMPUL,
    PESAN_HAMPIR_HABIS: PESAN_HAMPIR_HABIS,
    PESAN_WAKTU_HABIS: PESAN_WAKTU_HABIS,
    PESAN_KUMPUL_GAGAL: PESAN_KUMPUL_GAGAL,

    destroy: function () {
      hentikanInstansi();
    },

    render: function (container, params, ctx) {
      hentikanInstansi();

      var ui = ctx.ui;
      var api = ctx.api;
      var el = ui.el;
      var EL = ambilGlobal('ExamLogic');
      var doc = container.ownerDocument || document;
      var idSesi = str(params && params.idSesi);
      var storage = sesiStorage(ctx);

      /** State pusat Halaman_Ujian. */
      var state = {
        idSesi: idSesi,
        sesi: null,
        soal: [],
        jawaban: {},          // idSoal → {pilihan: label tampil[], ragu}
        nomor: 1,
        ukuran: bacaUkuranHuruf(storage, idSesi),
        sisaDetikAwal: 0,     // sisa waktu saat paket diterima, dikoreksi umur titipan
        terkunci: false,
        alasanKunci: '',
        panelTerbuka: false,
        hancur: false,
        hentikanGambar: null, // pembersih timer gambar soal aktif
        pembersih: [],        // fungsi tambahan untuk destroy() (tugas 22.4/22.5)
        dom: {},
        // Timer (tugas 22.4)
        deadline: 0,          // ms pada jam waktu.now()
        tampil: null,         // detik terakhir yang ditampilkan
        peringatanTampil: false,
        waktuHabis: false,
        mengumpulkan: false,
        percobaanKumpul: 0,   // jumlah permintaan kumpulkan yang sudah dikirim
        prosesManual: false,  // pengumpulan dari dialog selesai sedang berjalan (22.6)
        setSisaDetik: null,   // diisi di bawah
        mulaiPengumpulanOtomatis: null,
        // Simpan otomatis (tugas 22.5)
        antrean: null,        // instansi AnswerQueue (null bila modul tidak dimuat)
        peringatanLokal: false,
        perangkatLain: false, // simpanJawaban terakhir ditolak PERANGKAT_LAIN
        /** Mengirim seluruh antrean; diganti antrean.flush saat paket dimuat. @returns {Promise} */
        flush: function () { return Promise.resolve(); }
      };
      var waktu = sumberWaktu(ctx);

      var diri = {
        state: state,
        bersihkan: function () {
          if (state.hancur) return;
          state.hancur = true;
          if (state.hentikanGambar) { state.hentikanGambar(); state.hentikanGambar = null; }
          doc.removeEventListener('keydown', onKeydown);
          var daftar = state.pembersih.splice(0);
          daftar.forEach(function (f) { try { f(); } catch (e) { /* abaikan */ } });
        }
      };
      instansi = diri;

      function masihAktif() {
        return !state.hancur && (typeof ctx.aktif !== 'function' || ctx.aktif());
      }

      /* ---------- akses state ---------- */

      function soalAktif() { return state.soal[state.nomor - 1] || null; }

      function cariSoal(idSoal) {
        for (var i = 0; i < state.soal.length; i++) if (state.soal[i].idSoal === idSoal) return state.soal[i];
        return null;
      }

      function entri(idSoal) {
        return hasOwn(state.jawaban, idSoal) ? state.jawaban[idSoal] : { pilihan: [], ragu: false };
      }

      /* ---------- jawaban & ragu ---------- */

      /**
       * Satu-satunya jalur perubahan jawaban/penanda ragu (Requirement 15.8,
       * 15.9, 16.1, 16.3–16.5). Tampilan diperbarui langsung tanpa menunggu
       * Backend.
       * @returns {boolean} false bila input terkunci atau idSoal tidak dikenal
       */
      function pilihJawaban(idSoal, pilihan, ragu) {
        var soal = cariSoal(idSoal);
        if (state.terkunci || !soal) return false;
        var baru = { pilihan: bersihkanPilihan(pilihan, soal), ragu: ragu === true };
        state.jawaban[idSoal] = baru;
        perbaruiTampilanJawaban(idSoal);
        // Simpan otomatis: antrean lokal (≤ 100 ms, sinkron) lalu batch ke Backend
        // (Requirement 16.2, 18.1, 18.4, 18.13).
        if (state.antrean) {
          var r = state.antrean.put(idSoal, { pilihan: baru.pilihan.slice(), ragu: baru.ragu });
          if (!r.persisted) peringatkanPenyimpananLokal();
        }
        return true;
      }

      function klikOpsi(nilai) {
        var s = soalAktif();
        if (!s) return;
        if (state.terkunci) { sinkronOpsi(); return; }
        var e = entri(s.idSoal);
        pilihJawaban(s.idSoal, EL.pilihOpsi(s.tipe, e.pilihan, nilai), e.ragu);
      }

      function toggleRagu() {
        var s = soalAktif();
        if (!s || state.terkunci) return;
        var e = entri(s.idSoal);
        pilihJawaban(s.idSoal, e.pilihan, !e.ragu);
      }

      /* ---------- kunci input ---------- */

      function terapkanKunci() {
        var d = state.dom;
        if (!d.layout) return;
        d.layout.classList.toggle('is-terkunci', state.terkunci);
        Array.prototype.forEach.call(d.wadahSoal.querySelectorAll('input'), function (inp) {
          inp.disabled = state.terkunci;
        });
        d.btnRagu.disabled = state.terkunci;
        if (d.btnNext.getAttribute('data-aksi') === 'selesai') d.btnNext.disabled = state.terkunci;
      }

      /** Menonaktifkan opsi, Ragu-ragu, dan Selesai (waktu habis, pengumpulan). */
      function kunciInput(alasan) {
        state.terkunci = true;
        state.alasanKunci = str(alasan);
        terapkanKunci();
      }

      function bukaKunciInput() {
        state.terkunci = false;
        state.alasanKunci = '';
        terapkanKunci();
      }

      /* ---------- pemberitahuan ---------- */

      /**
       * Menampilkan pemberitahuan di bawah header; jenis yang sama diganti.
       * @param {string} jenis hampir-habis | waktu-habis | kumpul-gagal
       * @param {string} teks
       * @param {{kelas?:string, bisaDitutup?:boolean, aksi?:HTMLElement}} [opsi]
       */
      function tampilkanPemberitahuan(jenis, teks, opsi) {
        var o = opsi || {};
        var wadah = state.dom.pemberitahuan;
        if (!wadah) return null;
        tutupPemberitahuan(jenis);
        var node = el('div', {
          class: 'alert ' + (o.kelas || 'alert-warning') + ' ujian-pemberitahuan',
          role: 'alert', 'data-jenis': jenis
        }, [
          el('span', { class: 'ujian-pemberitahuan-teks', text: teks }),
          o.aksi || null,
          o.bisaDitutup ? el('button', {
            type: 'button', class: 'btn ujian-pemberitahuan-tutup', 'aria-label': 'Tutup pemberitahuan',
            onclick: function () { tutupPemberitahuan(jenis); }
          }, '\u00d7') : null
        ]);
        wadah.appendChild(node);
        return node;
      }

      function tutupPemberitahuan(jenis) {
        var wadah = state.dom.pemberitahuan;
        if (!wadah) return;
        Array.prototype.forEach.call(wadah.querySelectorAll('.ujian-pemberitahuan'), function (n) {
          if (n.getAttribute('data-jenis') === jenis) wadah.removeChild(n);
        });
      }

      /* ---------- Timer (Requirement 17.3–17.7, 17.11, 17.12) ---------- */

      var idTick = null;
      var idSinkron = null;
      var idUlangKumpul = null;
      var sinkronBerjalan = false;

      /** Batas waktu tiap permintaan: hasil null bila lewat `ms`. */
      function denganBatas(janji, ms) {
        return new Promise(function (resolve) {
          var selesai = false;
          var id = waktu.setTimeout(function () {
            if (selesai) return;
            selesai = true;
            resolve(null);
          }, ms);
          Promise.resolve(janji).then(function (v) {
            if (selesai) return;
            selesai = true;
            waktu.clearTimeout(id);
            resolve(v);
          }, function () {
            if (selesai) return;
            selesai = true;
            waktu.clearTimeout(id);
            resolve(null);
          });
        });
      }

      function panggilApi(nama, params) {
        try {
          if (!api || typeof api[nama] !== 'function') return Promise.resolve(null);
          return Promise.resolve(api[nama](params, { timeoutMs: BATAS_PERMINTAAN_MS }));
        } catch (e) {
          return Promise.resolve(null);
        }
      }

      /** Mengganti sisa waktu dengan nilai Backend (Requirement 17.7). */
      function setSisaDetik(detik) {
        var n = Math.floor(Number(detik));
        if (!isFinite(n) || state.hancur || state.waktuHabis) return false;
        state.deadline = waktu.now() + Math.max(0, n) * 1000;
        tick();
        return true;
      }

      function tick() {
        if (state.hancur || !state.dom.timer) return;
        var detik = hitungTampil(state.deadline, waktu.now());
        if (detik !== state.tampil) {
          state.tampil = detik;
          ui.setTeks(state.dom.timer, EL.formatTimer(detik));
          state.dom.timer.classList.toggle('is-kritis', timerKritis(detik));
        }
        // Sekali per pemuatan (Requirement 17.5).
        if (timerKritis(detik) && !state.peringatanTampil) {
          state.peringatanTampil = true;
          tampilkanPemberitahuan('hampir-habis', PESAN_HAMPIR_HABIS, { bisaDitutup: true });
        }
        if (detik === 0) mulaiPengumpulanOtomatis();
      }

      /** Sinkronisasi sisa waktu; gagal → Timer tetap berjalan (17.12). */
      function sinkron() {
        if (sinkronBerjalan || state.waktuHabis || !masihAktif()) return;
        sinkronBerjalan = true;
        denganBatas(panggilApi('sisaWaktu', { idSesi: idSesi }), BATAS_PERMINTAAN_MS).then(function (env) {
          sinkronBerjalan = false;
          if (!masihAktif() || state.waktuHabis || !env) return;
          // Request lain berhasil → kirim ulang antrean yang gagal (Requirement 18.7).
          // Saat perangkat lain aktif, kirim ulang menunggu tombol ambil alih.
          if (env.ok && state.antrean && !state.perangkatLain) state.antrean.notifyRequestOk();
          if (env.ok && isObj(env.data)) {
            if (str(env.data.status) === 'SELESAI') setSisaDetik(0);
            else setSisaDetik(env.data.sisaDetik);
          } else if (env.error && (env.error.code === 'UJIAN_SELESAI' || env.error.code === 'WAKTU_HABIS')) {
            setSisaDetik(0);
          }
        });
      }

      function hentikanSinkron() {
        if (idSinkron !== null) { waktu.clearInterval(idSinkron); idSinkron = null; }
      }

      function hentikanTimer() {
        if (idTick !== null) { waktu.clearInterval(idTick); idTick = null; }
        hentikanSinkron();
        if (idUlangKumpul !== null) { waktu.clearTimeout(idUlangKumpul); idUlangKumpul = null; }
      }

      function mulaiTimer(detikAwal) {
        hentikanTimer();
        state.deadline = waktu.now() + Math.max(0, Math.floor(Number(detikAwal)) || 0) * 1000;
        state.tampil = null;
        idTick = waktu.setInterval(tick, TICK_MS);
        idSinkron = waktu.setInterval(sinkron, SINKRON_MS);
        tick();
      }

      /* ---------- pengumpulan otomatis (Requirement 17.6, 17.13) ---------- */

      function kumpulBerhasil(hasil) {
        hentikanTimer();
        state.prosesManual = false;
        tutupDialogSelesai(false);
        if (!masihAktif()) return;
        if (isObj(hasil) && root) {
          var CBT = root.CBT = root.CBT || {};
          CBT.hasilHandoff = isObj(CBT.hasilHandoff) ? CBT.hasilHandoff : {};
          CBT.hasilHandoff[idSesi] = hasil;
        }
        ctx.navigate('#/hasil/' + encodeURIComponent(idSesi));
      }

      function kumpulGagalTotal() {
        state.mengumpulkan = false;
        tutupPemberitahuan('waktu-habis');
        var btn = el('button', {
          type: 'button', class: 'btn', 'data-aksi': 'kembali',
          onclick: function () { ctx.navigate('#/peserta'); }
        }, 'Kembali ke daftar ujian');
        tampilkanPemberitahuan('kumpul-gagal', PESAN_KUMPUL_GAGAL, { kelas: 'alert-danger', aksi: btn });
      }

      function cobaKumpul() {
        idUlangKumpul = null;
        if (!masihAktif()) return;
        state.percobaanKumpul++;
        denganBatas(panggilApi('kumpulkan', { idSesi: idSesi }), BATAS_PERMINTAAN_MS).then(function (env) {
          if (!masihAktif()) return;
          if (env && env.ok) { kumpulBerhasil(env.data); return; }
          var code = env && env.error ? env.error.code : '';
          // Sesi sudah SELESAI di Backend → dianggap berhasil.
          if (code === 'UJIAN_SELESAI' || code === 'WAKTU_HABIS') { kumpulBerhasil(null); return; }
          if (state.percobaanKumpul <= MAKS_ULANG_KUMPUL) {
            idUlangKumpul = waktu.setTimeout(cobaKumpul, JEDA_ULANG_KUMPUL_MS);
          } else {
            kumpulGagalTotal();
          }
        });
      }

      /** Waktu habis: kunci, beri tahu, flush, lalu kumpulkan tanpa dialog. */
      function mulaiPengumpulanOtomatis() {
        if (state.waktuHabis || state.hancur) return;
        state.waktuHabis = true;
        state.mengumpulkan = true;
        state.percobaanKumpul = 0;
        hentikanSinkron();
        kunciInput('WAKTU_HABIS');
        tutupPanel();
        tutupDialogSelesai(false);
        tutupPemberitahuan('hampir-habis');
        tampilkanPemberitahuan('waktu-habis', PESAN_WAKTU_HABIS, { kelas: 'alert-danger' });
        // Pengumpulan dari dialog selesai sedang menunggu respons: alur manual
        // menyerahkan ke jalankanOtomatis() setelah permintaannya selesai, agar
        // tidak ada dua permintaan yang berjalan bersamaan.
        if (state.prosesManual) return;
        jalankanOtomatis();
      }

      /** flush (batas 15 detik) lalu kumpulkan dengan ulang tiap 5 detik. */
      function jalankanOtomatis() {
        state.percobaanKumpul = 0;
        var f;
        try { f = typeof state.flush === 'function' ? state.flush() : null; } catch (e) { f = null; }
        denganBatas(f, BATAS_FLUSH_MS).then(function () {
          if (masihAktif()) cobaKumpul();
        });
      }

      state.setSisaDetik = setSisaDetik;
      state.mulaiPengumpulanOtomatis = mulaiPengumpulanOtomatis;
      state.pembersih.push(hentikanTimer);

      /* ---------- simpan otomatis (Requirement 14.6, 14.7, 16.2, 18.1–18.13) ---------- */

      /** Indikator: tepat satu dari MENYIMPAN | TERSIMPAN | BELUM_TERSIMPAN (18.5). */
      function perbaruiIndikator(kode) {
        var n = state.dom.indikator;
        if (!n || !hasOwn(TEKS_INDIKATOR, kode)) return;
        n.setAttribute('data-state', kode);
        ui.setTeks(n, TEKS_INDIKATOR[kode]);
      }

      /** Peringatan localStorage tidak tersedia/penuh, sekali per pemuatan (18.13). */
      function peringatkanPenyimpananLokal() {
        if (state.peringatanLokal) return;
        state.peringatanLokal = true;
        tampilkanPemberitahuan('penyimpanan-lokal', PESAN_PENYIMPANAN_LOKAL, { bisaDitutup: true });
      }

      function nomorSoal(idSoal) {
        var s = cariSoal(idSoal);
        return s ? s.no : null;
      }

      /**
       * Jawaban Backend digabung dengan antrean lokal; entri antrean menimpa
       * (Requirement 18.9). Hanya Soal pada paket yang diperbarui.
       */
      function terapkanJawabanGabungan(dariBackend) {
        var AQ = ambilGlobal('AnswerQueue');
        var lokal = state.antrean ? state.antrean.entries() : {};
        var gabung = AQ && typeof AQ.mergeJawaban === 'function'
          ? AQ.mergeJawaban(dariBackend, lokal)
          : dariBackend;
        state.soal.forEach(function (s) {
          var j = isObj(gabung) && hasOwn(gabung, s.idSoal) && isObj(gabung[s.idSoal]) ? gabung[s.idSoal] : null;
          state.jawaban[s.idSoal] = {
            pilihan: bersihkanPilihan(j ? j.pilihan : [], s),
            ragu: !!j && j.ragu === true
          };
        });
      }

      /** WAKTU_HABIS / UJIAN_SELESAI dari Backend: kunci input lalu ke hasil. */
      function sesiBerakhir(code) {
        if (state.hancur) return;
        // Pengumpulan otomatis yang sedang berjalan menangani navigasi sendiri.
        if (state.mengumpulkan) return;
        state.waktuHabis = true;
        hentikanTimer();
        kunciInput(code);
        tutupPanel();
        if (state.antrean) state.antrean.dispose();
        if (masihAktif()) ctx.navigate('#/hasil/' + encodeURIComponent(idSesi));
      }

      /** Mengambil alih perangkat aktif lewat lanjutUjian (Requirement 14.6, 14.7). */
      function ambilAlihPerangkat() {
        var janji;
        try {
          janji = api && typeof api.lanjutUjian === 'function'
            ? Promise.resolve(api.lanjutUjian({ idSesi: idSesi, deviceId: ctx.deviceId }))
            : Promise.resolve(null);
        } catch (e) {
          janji = Promise.resolve(null);
        }
        return janji.then(null, function () { return null; }).then(function (env) {
          if (!masihAktif()) return;
          if (env && env.ok && isObj(env.data)) {
            state.perangkatLain = false;
            tutupPemberitahuan('perangkat-lain');
            var data = normalisasiPaket(env.data, idSesi);
            terapkanJawabanGabungan(data.jawaban);
            tampilkanSoal();
            // Jawaban yang tertahan dikirim ulang sebagai perangkat aktif.
            if (state.antrean && !state.antrean.isEmpty()) state.antrean.flush();
            setSisaDetik(data.sesi.sisaDetik);
            return;
          }
          var error = env && env.error ? env.error : { code: 'KONEKSI_GAGAL' };
          if (error.code === 'UJIAN_SELESAI' || error.code === 'WAKTU_HABIS') { sesiBerakhir(error.code); return; }
          ui.toast(ui.pesanError(error).teks, 'error');
        });
      }

      function tampilkanPerangkatLain() {
        var btn = el('button', {
          type: 'button', class: 'btn btn-primary', 'data-aksi': 'lanjutkan-di-sini'
        }, LABEL_LANJUT_DI_SINI);
        btn.addEventListener('click', function () { ui.withBusy(btn, ambilAlihPerangkat); });
        tampilkanPemberitahuan('perangkat-lain', PESAN_PERANGKAT_LAIN, { kelas: 'alert-danger', aksi: btn });
      }

      /** Hasil setiap batch simpanJawaban (AnswerQueue onResult). */
      function onHasilSimpan(hasil) {
        if (!masihAktif() || !isObj(hasil)) return;
        if (hasil.ok) {
          state.perangkatLain = false;
          tutupPemberitahuan('perangkat-lain');
          if (typeof hasil.sisaDetik === 'number') setSisaDetik(hasil.sisaDetik);
          var teks = pesanDitolak(hasil.ditolak, nomorSoal);
          if (teks) tampilkanPemberitahuan('ditolak', teks, { kelas: 'alert-danger', bisaDitutup: true });
          return;
        }
        var code = hasil.error ? str(hasil.error.code) : '';
        if (code === 'PERANGKAT_LAIN') { state.perangkatLain = true; tampilkanPerangkatLain(); }
        else if (code === 'WAKTU_HABIS' || code === 'UJIAN_SELESAI') sesiBerakhir(code);
      }

      /** Mengirim satu batch; Lapisan_API tidak pernah melempar (batas 15 detik). */
      function kirimBatch(items) {
        return panggilApi('simpanJawaban', { idSesi: idSesi, deviceId: ctx.deviceId, items: items });
      }

      /**
       * Membuat AnswerQueue Sesi ini, menggabungkan antreannya dengan jawaban
       * Backend, dan mengganti state.flush. Dipanggil sebelum halaman dibangun.
       */
      function siapkanAntrean(jawabanBackend) {
        var AQ = ambilGlobal('AnswerQueue');
        if (state.antrean) { state.antrean.dispose(); state.antrean = null; }
        if (AQ && typeof AQ.AnswerQueue === 'function') {
          var jam = {
            // Waktu perubahan (t) memakai jam dinding agar tetap urut setelah muat ulang.
            now: function () { return Date.now(); },
            setTimeout: waktu.setTimeout,
            clearTimeout: waktu.clearTimeout
          };
          state.antrean = new AQ.AnswerQueue(idSesi, lokalStorage(ctx), jam, kirimBatch, {
            onState: perbaruiIndikator,
            onResult: onHasilSimpan
          });
          var q = state.antrean;
          state.flush = function () { return q.flush(); };
          state.pembersih.push(function () { q.dispose(); });
        }
        terapkanJawabanGabungan(jawabanBackend);
      }

      /** Indikator awal, peringatan storage, listener online/beforeunload. */
      function pasangSimpanOtomatis() {
        var q = state.antrean;
        if (!q) return;
        perbaruiIndikator(q.state());
        if (!q.storageAvailable()) peringatkanPenyimpananLokal();
        if (root && typeof root.addEventListener === 'function') {
          var onOnline = function () { if (!state.hancur && !state.perangkatLain) q.notifyOnline(); };
          // Dialog bawaan browser hanya bila antrean tidak kosong (Requirement 18.10).
          var onBeforeUnload = function (ev) {
            if (state.hancur || q.isEmpty()) return undefined;
            ev.preventDefault();
            ev.returnValue = '';
            return '';
          };
          root.addEventListener('online', onOnline);
          root.addEventListener('beforeunload', onBeforeUnload);
          state.pembersih.push(function () {
            root.removeEventListener('online', onOnline);
            root.removeEventListener('beforeunload', onBeforeUnload);
          });
        }
        // Entri antrean dari pemuatan sebelumnya dikirim ulang (Requirement 18.9).
        if (!q.isEmpty()) q.flush();
      }

      /* ---------- dialog selesai ---------- */

      /*
       * Dialog sendiri (bukan ui.konfirmasi) karena harus tetap terbuka selama
       * proses, menonaktifkan tombolnya, menampilkan indikator dan pesan gagal
       * dengan tombol ulang, serta dapat ditutup oleh pengumpulan otomatis.
       * Kelas CSS sama dengan ui.konfirmasi (.dialog-backdrop, .dialog, ...).
       */
      var dialog = null;        // {latar, kotak, btnYa, btnBatal, status, galat, onKey, fokusSemula}
      var idUlangSelesai = null;

      function jedaSelesai() {
        return new Promise(function (resolve) {
          idUlangSelesai = waktu.setTimeout(function () { idUlangSelesai = null; resolve(); }, JEDA_ULANG_SELESAI_MS);
        });
      }

      function tutupDialogSelesai(kembalikanFokus) {
        var dl = dialog;
        if (!dl) return;
        dialog = null;
        doc.removeEventListener('keydown', dl.onKey, true);
        if (dl.latar.parentNode) dl.latar.parentNode.removeChild(dl.latar);
        if (kembalikanFokus && dl.fokusSemula && typeof dl.fokusSemula.focus === 'function') {
          try { dl.fokusSemula.focus(); } catch (e) { /* elemen sudah hilang */ }
        }
      }

      /** teks null → tidak sibuk; selain itu tombol nonaktif + indikator (19.8). */
      function aturSibukDialog(teks) {
        if (!dialog) return;
        var sibuk = teks !== null;
        dialog.btnYa.disabled = sibuk;
        dialog.btnBatal.disabled = sibuk;
        dialog.btnYa.classList.toggle('is-busy', sibuk);
        dialog.kotak.setAttribute('aria-busy', sibuk ? 'true' : 'false');
        ui.setTeks(dialog.status, sibuk ? teks : '');
        dialog.status.hidden = !sibuk;
      }

      /** Pengumpulan gagal: pesan + tombol ulang; Timer dan antrean tetap (19.10). */
      function tampilkanGagalSelesai() {
        state.prosesManual = false;
        state.mengumpulkan = false;
        bukaKunciInput();
        if (!dialog) return;
        aturSibukDialog(null);
        ui.setTeks(dialog.btnYa, LABEL_ULANG_SELESAI);
        dialog.btnYa.setAttribute('data-aksi', 'ulang-selesai');
        ui.setTeks(dialog.galat, PESAN_SELESAI_GAGAL);
        dialog.galat.hidden = false;
        if (typeof dialog.btnYa.focus === 'function') dialog.btnYa.focus();
      }

      /**
       * Mengirim antrean sampai kosong; 1 + MAKS_ULANG_SELESAI percobaan (19.3, 19.9).
       * @returns {Promise<'ok'|'gagal'|'otomatis'|'batal'>}
       */
      function kirimAntreanSelesai(ke) {
        var f;
        try { f = typeof state.flush === 'function' ? state.flush() : null; } catch (e) { f = null; }
        return denganBatas(f, BATAS_FLUSH_MS).then(function (hasil) {
          if (!masihAktif()) return 'batal';
          if (state.waktuHabis) return 'otomatis';
          var kosong = !state.antrean || state.antrean.isEmpty();
          var code = isObj(hasil) && isObj(hasil.error) ? str(hasil.error.code) : '';
          // Sesi sudah berakhir di Backend: kumpulkan mengembalikan Hasil yang ada.
          if (kosong || code === 'UJIAN_SELESAI' || code === 'WAKTU_HABIS') return 'ok';
          if (code === 'PERANGKAT_LAIN' || ke > MAKS_ULANG_SELESAI) return 'gagal';
          return jedaSelesai().then(function () {
            if (!masihAktif()) return 'batal';
            if (state.waktuHabis) return 'otomatis';
            return kirimAntreanSelesai(ke + 1);
          });
        });
      }

      /**
       * Permintaan kumpulkan; 1 + MAKS_ULANG_SELESAI percobaan (19.9).
       * @returns {Promise<'selesai'|'gagal'|'otomatis'|'batal'>}
       */
      function kumpulSelesai(ke) {
        return denganBatas(panggilApi('kumpulkan', { idSesi: idSesi }), BATAS_PERMINTAAN_MS).then(function (env) {
          if (!masihAktif()) return 'batal';
          if (env && env.ok) { kumpulBerhasil(env.data); return 'selesai'; }
          var code = env && env.error ? str(env.error.code) : '';
          if (code === 'UJIAN_SELESAI' || code === 'WAKTU_HABIS') { kumpulBerhasil(null); return 'selesai'; }
          if (state.waktuHabis) return 'otomatis';
          if (ke > MAKS_ULANG_SELESAI) return 'gagal';
          return jedaSelesai().then(function () {
            if (!masihAktif()) return 'batal';
            if (state.waktuHabis) return 'otomatis';
            return kumpulSelesai(ke + 1);
          });
        });
      }

      /** Konfirmasi (atau "Coba lagi"): flush → kumpulkan → halaman hasil. */
      function konfirmasiSelesai() {
        if (!dialog || state.prosesManual || state.waktuHabis || state.hancur) return;
        state.prosesManual = true;
        state.mengumpulkan = true;
        kunciInput('SELESAI');
        dialog.galat.hidden = true;
        aturSibukDialog(TEKS_MENGIRIM_JAWABAN);
        kirimAntreanSelesai(1).then(function (r) {
          if (r !== 'ok') return r;
          aturSibukDialog(TEKS_MENGUMPULKAN);
          return kumpulSelesai(1);
        }).then(function (r) {
          if (r === 'gagal') tampilkanGagalSelesai();
          else if (r === 'otomatis') {
            // Waktu habis selama proses: pengumpulan otomatis mengambil alih.
            state.prosesManual = false;
            if (masihAktif()) jalankanOtomatis();
          }
        });
      }

      function batalSelesai() {
        if (state.prosesManual) return;
        tutupDialogSelesai(true);
      }

      /** Dialog konfirmasi selesai (Requirement 19.1, 19.2, 19.6). */
      function bukaDialogSelesai() {
        if (state.terkunci || state.waktuHabis || dialog || !state.dom.layout) return;
        tutupPanel();
        var r = EL.hitungStatus(state.soal.map(function (s) { return s.idSoal; }), state.jawaban);
        var peringatan = pesanPeringatanSelesai(r);
        var item = function (kode, teks, n) {
          return el('li', { class: 'dialog-ringkasan-item', 'data-status': kode }, [
            teks + ': ', el('strong', { class: 'dialog-ringkasan-jumlah', text: String(n) })
          ]);
        };
        var dl = { fokusSemula: doc.activeElement };
        dl.btnBatal = el('button', {
          type: 'button', class: 'btn', 'data-aksi': 'batal-selesai', onclick: batalSelesai
        }, 'Batal');
        dl.btnYa = el('button', {
          type: 'button', class: 'btn btn-danger', 'data-aksi': 'konfirmasi-selesai', onclick: konfirmasiSelesai
        }, LABEL_YA_SELESAI);
        dl.status = el('p', { class: 'dialog-status', role: 'status', 'aria-live': 'polite', hidden: true });
        dl.galat = el('div', { class: 'alert alert-danger dialog-galat', role: 'alert', hidden: true });
        dl.kotak = el('div', {
          class: 'dialog ujian-dialog-selesai', role: 'alertdialog', 'aria-modal': 'true',
          'aria-labelledby': 'ujian-selesai-judul', 'aria-describedby': 'ujian-selesai-pesan'
        }, [
          el('h2', { class: 'dialog-judul', id: 'ujian-selesai-judul', text: JUDUL_SELESAI }),
          el('p', { class: 'dialog-pesan', id: 'ujian-selesai-pesan', text: PESAN_KONFIRMASI_SELESAI }),
          el('ul', { class: 'dialog-ringkasan', 'aria-label': 'Ringkasan jawaban (' + state.soal.length + ' soal)' }, [
            item('DIJAWAB', INFO_STATUS.DIJAWAB.teks, r.dijawab),
            item('BELUM', INFO_STATUS.BELUM.teks, r.belum),
            item('RAGU', INFO_STATUS.RAGU.teks, r.ragu)
          ]),
          peringatan ? el('div', { class: 'alert alert-warning dialog-peringatan', role: 'note', text: peringatan }) : null,
          dl.status,
          dl.galat,
          el('div', { class: 'dialog-aksi' }, [dl.btnBatal, dl.btnYa])
        ]);
        dl.latar = el('div', { class: 'dialog-backdrop' }, dl.kotak);
        dl.onKey = function (ev) {
          if (ev.key === 'Escape' || ev.key === 'Esc') {
            ev.preventDefault();
            ev.stopPropagation();
            batalSelesai();
          } else if (ev.key === 'Tab') {
            // Fokus tetap di dalam dialog.
            var aktif = doc.activeElement;
            if (ev.shiftKey && aktif === dl.btnBatal) { ev.preventDefault(); dl.btnYa.focus(); }
            else if (!ev.shiftKey && aktif === dl.btnYa) { ev.preventDefault(); dl.btnBatal.focus(); }
          }
        };
        dialog = dl;
        doc.addEventListener('keydown', dl.onKey, true);
        state.dom.layout.appendChild(dl.latar);
        // Mengakhiri ujian tidak dapat dibatalkan: fokus awal di tombol Batal.
        dl.btnBatal.focus();
      }

      state.pembersih.push(function () {
        tutupDialogSelesai(false);
        if (idUlangSelesai !== null) { waktu.clearTimeout(idUlangSelesai); idUlangSelesai = null; }
      });

      /* ---------- ukuran huruf ---------- */

      function setUkuran(kode) {
        if (!hasOwn(UKURAN_HURUF, kode)) return;
        state.ukuran = kode;
        var d = state.dom;
        if (d.layout) {
          d.layout.setAttribute('data-fs', kode);
          d.layout.style.setProperty('--fs-soal', UKURAN_HURUF[kode] + 'px');
          Array.prototype.forEach.call(d.layout.querySelectorAll('.fs-btn'), function (b) {
            var aktif = b.getAttribute('data-fs') === kode;
            b.setAttribute('aria-pressed', aktif ? 'true' : 'false');
            b.classList.toggle('is-aktif', aktif);
          });
        }
        simpanUkuranHuruf(storage, idSesi, kode);
      }

      /* ---------- panel geser ---------- */

      function bukaPanel() {
        var d = state.dom;
        state.panelTerbuka = true;
        d.panel.classList.add('is-open');
        d.backdrop.classList.add('is-open');
        d.toggle.setAttribute('aria-expanded', 'true');
        var aktif = d.nomorBtn[state.nomor - 1];
        if (aktif && typeof aktif.focus === 'function') aktif.focus();
      }

      function tutupPanel() {
        var d = state.dom;
        if (!d.panel) return;
        var tadinya = state.panelTerbuka;
        state.panelTerbuka = false;
        d.panel.classList.remove('is-open');
        d.backdrop.classList.remove('is-open');
        d.toggle.setAttribute('aria-expanded', 'false');
        return tadinya;
      }

      function onKeydown(ev) {
        if (ev.key === 'Escape' && state.panelTerbuka) {
          tutupPanel();
          if (state.dom.toggle && typeof state.dom.toggle.focus === 'function') state.dom.toggle.focus();
        }
      }

      /* ---------- navigasi ---------- */

      function pindah(aksi) {
        var baru = EL.navigasi(state.nomor, aksi, state.soal.length);
        if (baru !== state.nomor) {
          state.nomor = baru;
          tampilkanSoal();
        }
      }

      function pilihNomor(n) {
        pindah({ tipe: 'PILIH', nomor: n });
        tutupPanel();
      }

      function klikNext() {
        if (state.dom.btnNext.getAttribute('data-aksi') === 'selesai') bukaDialogSelesai();
        else pindah('BERIKUTNYA');
      }

      /* ---------- render bagian ---------- */

      function perbaruiPanel() {
        state.dom.nomorBtn.forEach(function (b, i) {
          var s = state.soal[i];
          var info = infoStatus(entri(s.idSoal));
          var aktif = i + 1 === state.nomor;
          b.className = 'nomor-btn ' + info.kelas + (aktif ? ' is-aktif' : '');
          b.setAttribute('data-status', info.kode);
          b.setAttribute('aria-label', 'Soal ' + (i + 1) + ', ' + info.teks.toLowerCase() + (aktif ? ', sedang dibuka' : ''));
          if (aktif) b.setAttribute('aria-current', 'true');
          else b.removeAttribute('aria-current');
        });
        ui.setTeks(state.dom.nomorAktif, state.nomor + '/' + state.soal.length);
      }

      function perbaruiRagu() {
        var s = soalAktif();
        var ragu = !!s && entri(s.idSoal).ragu;
        var b = state.dom.btnRagu;
        b.setAttribute('aria-pressed', ragu ? 'true' : 'false');
        b.classList.toggle('is-aktif', ragu);
      }

      function sinkronOpsi() {
        var s = soalAktif();
        if (!s) return;
        var pilihan = entri(s.idSoal).pilihan;
        Array.prototype.forEach.call(state.dom.wadahSoal.querySelectorAll('.opsi'), function (li) {
          var terpilih = pilihan.indexOf(li.getAttribute('data-opsi')) !== -1;
          var inp = li.querySelector('input');
          if (inp) inp.checked = terpilih;
          li.classList.toggle('is-terpilih', terpilih);
        });
      }

      function perbaruiTampilanJawaban(idSoal) {
        var s = soalAktif();
        if (s && s.idSoal === idSoal) {
          sinkronOpsi();
          perbaruiRagu();
        }
        perbaruiPanel();
      }

      function perbaruiNavigasi() {
        var d = state.dom;
        var terakhir = state.nomor >= state.soal.length;
        d.btnPrev.disabled = state.nomor <= 1;
        // Soal terakhir: "Berikutnya" diganti "Selesai" (Requirement 15.13).
        d.btnNext.setAttribute('data-aksi', terakhir ? 'selesai' : 'berikutnya');
        d.btnNext.textContent = terakhir ? 'Selesai' : 'Berikutnya';
        d.btnNext.className = terakhir ? 'btn btn-danger ujian-btn-selesai' : 'btn btn-primary ujian-btn-next';
        d.btnNext.disabled = terakhir && state.terkunci;
      }

      function buatGambar(url) {
        var wadah = el('div', { class: 'soal-gambar' });
        var img = el('img', { src: url, alt: 'Gambar soal', referrerpolicy: 'no-referrer' });
        var timer = null;
        var hentikan = function () { if (timer !== null) { clearTimeout(timer); timer = null; } };
        var gagal = function () {
          hentikan();
          if (wadah.getAttribute('data-status') === 'gagal') return;
          wadah.setAttribute('data-status', 'gagal');
          ui.kosongkan(wadah);
          wadah.appendChild(el('p', { class: 'gambar-gagal', role: 'note', text: PESAN_GAMBAR_GAGAL }));
        };
        img.addEventListener('error', gagal);
        img.addEventListener('load', function () {
          hentikan();
          if (wadah.getAttribute('data-status') !== 'gagal') wadah.setAttribute('data-status', 'termuat');
        });
        timer = setTimeout(function () {
          timer = null;
          if (!img.complete || !img.naturalWidth) gagal();
        }, BATAS_GAMBAR_MS);
        state.hentikanGambar = hentikan;
        wadah.appendChild(img);
        return wadah;
      }

      function buatSoalEl(s) {
        var e = entri(s.idSoal);
        var art = el('article', { class: 'ujian-soal', 'data-tipe': s.tipe, 'data-id-soal': s.idSoal });
        art.appendChild(el('div', { class: 'soal-header' }, [
          el('h2', { class: 'soal-nomor', text: 'Soal No. ' + s.no }),
          buatPengaturUkuran()
        ]));
        art.appendChild(isiMarkup(el('div', { class: 'soal-teks' }), s.teks));
        if (s.urlGambar !== '') art.appendChild(buatGambar(s.urlGambar));
        if (s.tipe === 'PGK') art.appendChild(el('p', { class: 'soal-petunjuk', text: PETUNJUK_PGK }));

        var jenis = s.tipe === 'PGK' ? 'checkbox' : 'radio';
        var ul = el('ul', {
          class: 'opsi-list',
          role: s.tipe === 'PGK' ? 'group' : 'radiogroup',
          'aria-label': 'Opsi jawaban soal nomor ' + s.no
        });
        s.opsi.forEach(function (o) {
          var terpilih = e.pilihan.indexOf(o.nilai) !== -1;
          var isi = el('span', { class: 'opsi-teks' });
          if (o.huruf) isiMarkup(isi, o.teks);
          else ui.setTeks(isi, o.teks);
          var input = el('input', {
            type: jenis, name: 'jawaban-soal', value: o.nilai,
            checked: terpilih, disabled: state.terkunci
          });
          input.addEventListener('change', function () { klikOpsi(o.nilai); });
          ul.appendChild(el('li', { class: terpilih ? 'opsi is-terpilih' : 'opsi', 'data-opsi': o.nilai },
            el('label', { class: 'opsi-label' }, [
              input,
              o.huruf ? el('span', { class: 'opsi-huruf', text: o.huruf + '.' }) : null,
              isi
            ])));
        });
        art.appendChild(ul);
        return art;
      }

      /** Menampilkan Soal bernomor state.nomor (Requirement 15.1, 15.5–15.7). */
      function tampilkanSoal() {
        var d = state.dom;
        var s = soalAktif();
        if (state.hentikanGambar) { state.hentikanGambar(); state.hentikanGambar = null; }
        ui.kosongkan(d.wadahSoal);
        if (s) d.wadahSoal.appendChild(buatSoalEl(s));
        perbaruiNavigasi();
        perbaruiRagu();
        perbaruiPanel();
        terapkanKunci();
      }

      /** Pengatur ukuran huruf A- / A / A+ (Requirement 15.10). */
      function buatPengaturUkuran() {
        return el('div', { class: 'fs-switch', role: 'group', 'aria-label': 'Ukuran huruf' }, [
          el('span', { class: 'fs-label', text: 'Ukuran huruf:' }),
          URUTAN_UKURAN.map(function (u) {
            var aktif = u.kode === state.ukuran;
            return el('button', {
              type: 'button', class: aktif ? 'fs-btn is-aktif' : 'fs-btn', 'data-fs': u.kode,
              'aria-label': u.judul, title: u.judul, 'aria-pressed': aktif ? 'true' : 'false',
              onclick: function () { setUkuran(u.kode); }
            }, u.label);
          })
        ]);
      }

      function bangunLegend() {
        var item = function (kelas, teks) {
          return el('li', { class: 'legend-item' }, [
            el('span', { class: 'legend-swatch ' + kelas, 'aria-hidden': 'true' }),
            teks
          ]);
        };
        return el('ul', { class: 'nomor-legend', 'aria-label': 'Keterangan warna nomor soal' }, [
          item(INFO_STATUS.BELUM.kelas, INFO_STATUS.BELUM.teks),
          item(INFO_STATUS.DIJAWAB.kelas, INFO_STATUS.DIJAWAB.teks),
          item(INFO_STATUS.RAGU.kelas, INFO_STATUS.RAGU.teks),
          item('is-aktif', 'Sedang dibuka')
        ]);
      }

      function bangunHalaman() {
        var d = state.dom;
        var sesi = state.sesi;
        var namaPeserta = sesi.namaPeserta || (ctx.user && ctx.user.nama) || '';

        d.timer = el('span', {
          class: 'ujian-timer', role: 'timer', 'aria-label': 'Sisa waktu',
          text: EL.formatTimer(state.sisaDetikAwal)
        });
        d.nomorAktif = el('span', { class: 'ujian-nomor-aktif' });
        d.toggle = el('button', {
          type: 'button', class: 'btn ujian-panel-toggle',
          'aria-expanded': 'false', 'aria-controls': ID_PANEL, onclick: bukaPanel
        }, ['Nomor Soal ', d.nomorAktif]);
        var header = el('header', { class: 'ujian-header' }, [
          el('span', { class: 'ujian-brand', text: 'CBT TKA' }),
          el('div', { class: 'ujian-info' }, [
            el('span', { class: 'ujian-mapel', text: sesi.namaMapel }),
            el('span', { class: 'ujian-peserta', text: namaPeserta })
          ]),
          d.timer,
          d.toggle
        ]);

        d.wadahSoal = el('section', { class: 'ujian-konten', 'aria-label': 'Soal' });

        d.nomorBtn = state.soal.map(function (s, i) {
          return el('button', {
            type: 'button', class: 'nomor-btn status-belum', 'data-nomor': String(i + 1),
            onclick: function () { pilihNomor(i + 1); }
          }, String(i + 1));
        });
        d.panel = el('aside', { class: 'ujian-panel', id: ID_PANEL, 'aria-label': 'Panel nomor soal' }, [
          el('div', { class: 'ujian-panel-header' }, [
            el('h2', { class: 'ujian-panel-judul', text: 'Nomor Soal' }),
            el('button', {
              type: 'button', class: 'btn ujian-panel-close',
              'aria-label': 'Tutup panel nomor soal', onclick: tutupPanel
            }, '\u00d7')
          ]),
          el('div', { class: 'nomor-grid', role: 'group', 'aria-label': 'Nomor soal' }, d.nomorBtn),
          bangunLegend()
        ]);
        d.backdrop = el('div', { class: 'ujian-panel-backdrop', 'aria-hidden': 'true', onclick: tutupPanel });

        d.btnPrev = el('button', {
          type: 'button', class: 'btn ujian-btn-prev', 'data-aksi': 'sebelumnya',
          onclick: function () { pindah('SEBELUMNYA'); }
        }, 'Sebelumnya');
        d.btnRagu = el('button', {
          type: 'button', class: 'btn ujian-btn-ragu', 'aria-pressed': 'false', onclick: toggleRagu
        }, 'Ragu-ragu');
        d.indikator = el('span', { class: 'simpan-indikator', role: 'status', 'aria-live': 'polite' });
        d.btnNext = el('button', {
          type: 'button', class: 'btn btn-primary ujian-btn-next', 'data-aksi': 'berikutnya', onclick: klikNext
        }, 'Berikutnya');
        var footer = el('footer', { class: 'ujian-footer' }, [d.btnPrev, d.btnRagu, d.indikator, d.btnNext]);

        d.pemberitahuan = el('div', { class: 'ujian-pemberitahuan-wadah', 'aria-live': 'assertive' });

        d.layout = el('div', { class: 'ujian-layout', 'data-fs': state.ukuran }, [
          header,
          d.pemberitahuan,
          el('div', { class: 'ujian-main' }, [d.wadahSoal, d.panel]),
          d.backdrop,
          footer
        ]);
        d.layout.style.setProperty('--fs-soal', UKURAN_HURUF[state.ukuran] + 'px');

        ui.kosongkan(container);
        container.appendChild(d.layout);
        doc.addEventListener('keydown', onKeydown);
        tampilkanSoal();
      }

      /* ---------- muat paket ---------- */

      function tampilkanGagalMuat(error) {
        var info = ui.pesanError(error || 'KONEKSI_GAGAL');
        var btnUlang = el('button', { type: 'button', class: 'btn btn-primary', 'data-aksi': 'coba-lagi' }, 'Coba lagi');
        btnUlang.addEventListener('click', function () { ui.withBusy(btnUlang, muat); });
        var btnKembali = el('button', {
          type: 'button', class: 'btn', 'data-aksi': 'kembali',
          onclick: function () { ctx.navigate('#/peserta'); }
        }, 'Kembali ke daftar ujian');
        ui.kosongkan(container);
        container.appendChild(el('div', { class: 'container' },
          el('div', { class: 'card' },
            el('div', { class: 'card-body stack' }, [
              el('h1', { class: 'card-title', text: 'Ujian gagal dimuat' }),
              el('div', { class: 'alert alert-danger', role: 'alert', text: info.teks }),
              el('div', { class: 'page-actions' }, [btnUlang, btnKembali])
            ]))));
      }

      function ambilPaket() {
        var h = handoff();
        var titip = null;
        try { titip = h ? h.ambil(idSesi) : null; } catch (e) { titip = null; }
        if (titip && isObj(titip.paket)) {
          var diterima = Number(titip.diterima);
          var umur = isFinite(diterima) ? Math.max(0, Date.now() - diterima) : 0;
          return Promise.resolve({ paket: titip.paket, umurMs: umur });
        }
        return Promise.resolve(api.lanjutUjian({ idSesi: idSesi, deviceId: ctx.deviceId })).then(function (env) {
          if (env && env.ok && isObj(env.data)) return { paket: env.data, umurMs: 0 };
          return { error: env && env.error ? env.error : { code: 'KONEKSI_GAGAL' } };
        }, function () {
          return { error: { code: 'KONEKSI_GAGAL' } };
        });
      }

      function muat() {
        return ambilPaket().then(function (r) {
          if (!masihAktif()) return;
          if (r.error) {
            var code = r.error.code;
            if (code === 'UJIAN_SELESAI' || code === 'WAKTU_HABIS') {
              ctx.navigate('#/hasil/' + encodeURIComponent(idSesi));
              return;
            }
            tampilkanGagalMuat(r.error);
            return;
          }
          var data = normalisasiPaket(r.paket, idSesi);
          if (data.soal.length === 0) {
            tampilkanGagalMuat({ code: 'ERROR_UMUM' });
            return;
          }
          state.sesi = data.sesi;
          state.soal = data.soal;
          state.jawaban = {};
          state.nomor = 1;
          state.sisaDetikAwal = Math.max(0, data.sesi.sisaDetik - Math.floor(r.umurMs / 1000));
          // Antrean lokal menimpa jawaban Backend sebelum soal ditampilkan (18.9).
          siapkanAntrean(data.jawaban);
          bangunHalaman();
          // Simpan otomatis dipasang SEBELUM mulaiTimer: sisa 0 langsung memanggil
          // state.flush lewat pengumpulan otomatis.
          pasangSimpanOtomatis();
          mulaiTimer(state.sisaDetikAwal);
        });
      }

      ui.kosongkan(container);
      ui.tampilkanLoading(container, 'Memuat soal ujian...');
      return muat();
    }
  };

  if (root) {
    var CBT = root.CBT = root.CBT || {};
    CBT.pages = CBT.pages || {};
    CBT.pages.ujian = page;
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = page;
})(typeof window !== 'undefined' ? window : null);
