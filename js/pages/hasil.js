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
 * - tampilan-anbk: setelah ringkasan, tabel reviu per soal dimuat dari
 *   api.reviuHasil({idSesi}) (Requirement 31.1): No, Jawaban Anda,
 *   Kunci Jawaban, Status. Backend hanya mengizinkan bila Mapel
 *   mengaktifkan tampilkan_reviu; error apa pun (termasuk
 *   REVIU_TIDAK_TERSEDIA) membuat tabel tidak ditampilkan tanpa
 *   mengganggu ringkasan hasil.
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

      var judul = el('h1', { class: 'anbk-hasil-judul', text: 'Reviu Hasil Simulasi' });
      var mapelPill = el('span', { class: 'anbk-hasil-mapel', 'data-info': 'mapel', hidden: true });
      var isi = el('div', { class: 'anbk-hasil-isi', 'aria-live': 'polite', 'aria-label': 'Hasil ujian' });
      var btnKembali = el('button', { type: 'button', class: 'btn anbk-btn-keluar', 'data-aksi': 'kembali',
        onclick: function () { ctx.navigate('#/peserta'); } }, 'Keluar');

      // Tampilan ANBK "Reviu Hasil Simulasi": kepala biru, kartu putih dengan
      // ikon grafik, pil nama Mapel, dan tombol merah "Keluar".
      container.appendChild(el('div', { class: 'anbk-hasil-page' }, [
        el('header', { class: 'anbk-topbar' }, [
          el('div', { class: 'anbk-brand' }, [
            el('span', { class: 'anbk-logo', 'aria-hidden': 'true', text: '\uD83C\uDF93' }),
            el('span', { class: 'anbk-brand-teks' }, [
              el('span', { class: 'anbk-brand-nama', text: 'PUSMENDIK' }),
              el('span', { class: 'anbk-brand-sub', text: 'APLIKASI ANBK - Simulasi TKA' })
            ])
          ]),
          el('div', { class: 'anbk-topbar-kanan' }, [
            el('span', { text: (ctx.user && ctx.user.nama) || '' }),
            el('span', { class: 'anbk-user-ikon', 'aria-hidden': 'true', text: '\uD83D\uDC64' })
          ])
        ]),
        el('div', { class: 'anbk-hasil-bungkus' },
          el('section', { class: 'anbk-hasil-kartu' }, [
            el('span', { class: 'anbk-hasil-ikon', 'aria-hidden': 'true', text: '\uD83D\uDCC8' }),
            judul,
            mapelPill,
            isi,
            el('div', { class: 'anbk-hasil-aksi' }, [btnKembali])
          ]))
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
        if (nama) { ui.setTeks(mapelPill, '\uD83D\uDCD8 ' + nama); mapelPill.hidden = false; }
        if (h.tampilSkor === true) {
          var b = toNumber(h.benar), s = toNumber(h.salah), k = toNumber(h.kosong);
          var total = (b !== null && s !== null && k !== null) ? String(b + s + k) : '-';
          isi.appendChild(el('div', { class: 'stack', 'data-hasil': 'skor' }, [
            el('p', { class: 'hasil-skor' }, [
              el('span', { class: 'stat-label', text: 'Skor' }), ' ',
              el('strong', { 'data-stat': 'skor', text: formatSkor(h.skor) })
            ]),
            el('div', { class: 'stat-grid' }, [
              statistik('Benar', formatJumlah(h.benar), 'benar'),
              statistik('Salah', formatJumlah(h.salah), 'salah'),
              statistik('Kosong', formatJumlah(h.kosong), 'kosong')
            ]),
            el('div', { class: 'anbk-hasil-total' }, [
              el('span', { class: 'anbk-hasil-total-ikon', 'aria-hidden': 'true', text: '\u2630' }),
              el('span', { class: 'anbk-hasil-total-teks' }, [
                el('strong', { text: 'Total Soal' }),
                el('small', { 'data-stat': 'total', text: total + ' Pertanyaan' })
              ])
            ])
          ]));
        } else {
          isi.appendChild(el('div', { 'data-hasil': 'pesan' },
            el('p', { class: 'hasil-pesan', text: PESAN_SELESAI })));
        }
      }

      /**
       * Tabel reviu ANBK: jawaban peserta vs kunci per soal. Dimuat
       * terpisah agar kegagalan reviu tidak menggagalkan ringkasan.
       */
      function muatReviu() {
        if (typeof api.reviuHasil !== 'function') return;
        var wadah = el('div', { 'data-bagian': 'reviu' });
        isi.appendChild(wadah);
        Promise.resolve(api.reviuHasil({ idSesi: idSesi })).then(function (env) {
          if (!ctx.aktif()) return;
          if (!env || !env.ok || !env.data || !Array.isArray(env.data.items)) return;
          var statusTeks = { BENAR: '\u2713 Benar', SALAH: '\u2717 Salah', KOSONG: 'Kosong' };
          var baris = env.data.items.map(function (it) {
            var st = String(it.status || 'KOSONG').toUpperCase();
            return el('tr', { class: 'status-' + st.toLowerCase() }, [
              el('td', { text: String(it.no) }),
              el('td', { text: String(it.jawaban || '-') }),
              el('td', { text: String(it.kunci || '-') }),
              el('td', { class: 'anbk-reviu-status', text: statusTeks[st] || st })
            ]);
          });
          wadah.appendChild(el('div', { class: 'anbk-reviu-wrap' },
            el('table', { class: 'anbk-reviu-tabel', 'data-reviu': 'tabel' }, [
              el('thead', null, el('tr', null, [
                el('th', { scope: 'col', text: 'No.' }),
                el('th', { scope: 'col', text: 'Jawaban Anda' }),
                el('th', { scope: 'col', text: 'Kunci Jawaban' }),
                el('th', { scope: 'col', text: 'Status' })
              ])),
              el('tbody', null, baris)
            ])));
        }, function () { /* reviu opsional: abaikan kegagalan jaringan */ });
      }

      function renderGagal(error) {
        ui.kosongkan(isi);
        var btnUlang = el('button', { type: 'button', class: 'btn btn-primary', 'data-aksi': 'muat-ulang' }, 'Muat ulang');
        btnUlang.addEventListener('click', function () { ui.withBusy(btnUlang, muat); });
        isi.appendChild(el('div', { class: 'stack' }, [
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
            muatReviu();
          }, function () {
            sembunyikan();
            if (ctx.aktif()) renderGagal('KONEKSI_GAGAL');
          });
      }

      var handoff = ambilHandoff(idSesi);
      if (handoff && (handoff.idSesi === undefined || String(handoff.idSesi) === idSesi)) {
        renderHasil(handoff);
        muatReviu();
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
