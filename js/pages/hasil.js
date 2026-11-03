/*
 * pages/hasil.js — Halaman hasil ujian Peserta (#/hasil/:idSesi).
 * Requirement 22.1, 22.2, 22.4, 22.6, 22.7.
 *
 * - Data dari api.lihatHasil({idSesi}) → HasilPeserta
 *   {idSesi, namaMapel, tampilSkor, skor?, benar?, salah?, kosong?}.
 *   Backend sudah membuang angka bila tampilSkor=false dan membaca pengaturan
 *   tampil skor saat permintaan diterima (22.3, 22.7).
 * - Serah terima opsional dari Halaman_Ujian: bila CBT.hasilHandoff[idSesi]
 *   berisi HasilPeserta hasil kumpulkan(), data itu dipakai sekali (lalu
 *   dihapus) tanpa memanggil Backend lagi. Muat ulang selalu memanggil Backend.
 * - tampilSkor → skor dua desimal + jumlah benar/salah/kosong (22.1);
 *   selain itu hanya "Ujian telah selesai. Terima kasih." (22.2).
 * - Tombol "Kembali ke pemilihan Mapel" → #/peserta (22.4).
 * - Gagal muat → pesan "Hasil gagal dimuat" + tombol "Muat ulang" (22.6).
 *
 * Tidak ada innerHTML: semua elemen dibuat lewat ctx.ui.el (teks aman).
 */
(function (root) {
  'use strict';

  var PESAN_SELESAI = 'Ujian telah selesai. Terima kasih.';

  function toNumber(v) {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (typeof v === 'string' && v.trim() !== '') {
      var n = Number(v);
      return isFinite(n) ? n : null;
    }
    return null;
  }

  /** Skor dua desimal, pembulatan setengah ke atas (sama dengan rekap.js); "-" bila tidak ada. */
  function formatSkor(v) {
    var n = toNumber(v);
    if (n === null) return '-';
    var r = Number(Math.round(Number(n + 'e2')) + 'e-2');
    if (!isFinite(r)) r = Math.round(n * 100) / 100;
    return r.toFixed(2);
  }

  function formatJumlah(v) {
    var n = toNumber(v);
    return n === null ? '-' : String(n);
  }

  /** Ambil lalu hapus HasilPeserta serah terima dari Halaman_Ujian (bila ada). */
  function ambilHandoff(idSesi) {
    var CBT = root && root.CBT;
    var peta = CBT && CBT.hasilHandoff;
    if (!peta || typeof peta !== 'object' || !Object.prototype.hasOwnProperty.call(peta, idSesi)) return null;
    var data = peta[idSesi];
    delete peta[idSesi];
    return data && typeof data === 'object' ? data : null;
  }

  var page = {
    formatSkor: formatSkor,
    PESAN_SELESAI: PESAN_SELESAI,

    render: function (container, params, ctx) {
      var ui = ctx.ui;
      var api = ctx.api;
      var el = ui.el;
      var idSesi = params && params.idSesi ? String(params.idSesi) : '';

      var judul = el('h1', { class: 'page-title', text: 'Hasil Ujian' });
      var isi = el('section', { class: 'card', 'aria-live': 'polite', 'aria-label': 'Hasil ujian' });
      var btnKembali = el('button', { type: 'button', class: 'btn btn-primary', 'data-aksi': 'kembali',
        onclick: function () { ctx.navigate('#/peserta'); } }, 'Kembali ke pemilihan Mapel');

      container.appendChild(el('div', { class: 'container stack' }, [
        el('div', { class: 'page-header' }, [judul]),
        isi,
        el('div', { class: 'btn-group' }, [btnKembali])
      ]));

      function statistik(label, nilai, kunci) {
        return el('div', { class: 'stat', 'data-stat': kunci }, [
          el('span', { class: 'stat-label', text: label }),
          el('span', { class: 'stat-value', text: nilai })
        ]);
      }

      function renderHasil(h) {
        ui.kosongkan(isi);
        var nama = h.namaMapel ? String(h.namaMapel) : '';
        ui.setTeks(judul, nama ? 'Hasil Ujian ' + nama : 'Hasil Ujian');
        if (h.tampilSkor === true) {
          isi.appendChild(el('div', { class: 'card-body stack', 'data-hasil': 'skor' }, [
            el('p', { class: 'hasil-skor' }, [
              el('span', { class: 'stat-label', text: 'Skor' }), ' ',
              el('strong', { 'data-stat': 'skor', text: formatSkor(h.skor) })
            ]),
            el('div', { class: 'stat-grid' }, [
              statistik('Benar', formatJumlah(h.benar), 'benar'),
              statistik('Salah', formatJumlah(h.salah), 'salah'),
              statistik('Kosong', formatJumlah(h.kosong), 'kosong')
            ])
          ]));
        } else {
          isi.appendChild(el('div', { class: 'card-body', 'data-hasil': 'pesan' },
            el('p', { class: 'hasil-pesan', text: PESAN_SELESAI })));
        }
      }

      function renderGagal(error) {
        ui.kosongkan(isi);
        var btnUlang = el('button', { type: 'button', class: 'btn btn-primary', 'data-aksi': 'muat-ulang' }, 'Muat ulang');
        btnUlang.addEventListener('click', function () { ui.withBusy(btnUlang, muat); });
        isi.appendChild(el('div', { class: 'card-body stack' }, [
          el('div', { class: 'alert alert-danger', role: 'alert',
            text: 'Hasil gagal dimuat. ' + ui.pesanError(error).teks }),
          btnUlang
        ]));
      }

      function muat() {
        var sembunyikan = ui.tampilkanLoading(isi, 'Memuat hasil ujian...');
        return Promise.resolve()
          .then(function () { return api.lihatHasil({ idSesi: idSesi }); })
          .then(function (env) {
            sembunyikan();
            if (!ctx.aktif()) return;
            if (!env || !env.ok || !env.data) {
              renderGagal(env && env.error ? env.error : 'ERROR_UMUM');
              return;
            }
            renderHasil(env.data);
          }, function () {
            sembunyikan();
            if (ctx.aktif()) renderGagal('KONEKSI_GAGAL');
          });
      }

      var handoff = ambilHandoff(idSesi);
      if (handoff && (handoff.idSesi === undefined || String(handoff.idSesi) === idSesi)) {
        renderHasil(handoff);
        return Promise.resolve();
      }
      return muat();
    }
  };

  if (root) {
    var CBT = root.CBT = root.CBT || {};
    CBT.pages = CBT.pages || {};
    CBT.pages['hasil'] = page;
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = page;
})(typeof window !== 'undefined' ? window : null);
