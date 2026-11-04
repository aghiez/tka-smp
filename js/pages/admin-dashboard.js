/*
 * pages/admin-dashboard.js — Beranda Admin (#/admin).
 * Requirement 2.4 (Admin diarahkan ke halaman Admin setelah login),
 * 30.8 (ringkasan pemuat Data_Contoh: ditambahkan/dilewati per jenis data),
 * 30.9 (pesan error menyebut sheet yang tidak ditemukan).
 *
 * Isi halaman:
 *   - Kerangka Admin (.layout/.topbar/.sidebar/.content) dengan tombol Keluar.
 *   - Menu ke Peserta, Mapel, Soal, Import, Laporan.
 *   - Tombol "Muat data contoh" → konfirmasi → CBT.api.muatDataContoh() →
 *     tabel ringkasan {mapel, soal, peserta} × {ditambahkan, dilewati}.
 *   - Kartu "Token Ujian" (tampilan-anbk): Token_Ujian berjalan dari
 *     api.lihatTokenUjian(), tombol "Ganti token sekarang"
 *     (api.gantiTokenUjian()), dan sakelar "Tampilkan token ke peserta"
 *     yang disimpan lewat api.simpanPengaturan() (gabungan pengaturan
 *     terakhir dari api.getPengaturan(), field lain tidak diubah).
 *
 * Registrasi: CBT.pages['admin'] (kontrak di header app.js).
 * Semua teks dimasukkan lewat ui.el (textContent), tanpa innerHTML.
 */
(function () {
  'use strict';

  var MENU = [
    { hash: '#/admin', label: 'Beranda' },
    { hash: '#/admin/peserta', label: 'Peserta', deskripsi: 'Kelola akun Peserta, reset password, dan status aktif.' },
    { hash: '#/admin/mapel', label: 'Mapel', deskripsi: 'Kelola mata pelajaran, durasi, dan pengaturan ujian.' },
    { hash: '#/admin/soal', label: 'Soal', deskripsi: 'Kelola bank soal PG, PGK, dan Benar/Salah per Mapel.' },
    { hash: '#/admin/import', label: 'Import', deskripsi: 'Impor Peserta atau Soal dari file CSV/XLSX.' },
    { hash: '#/admin/laporan', label: 'Laporan', deskripsi: 'Rekap nilai, detail jawaban, dan ekspor hasil ujian.' }
  ];

  var JENIS = [
    { kunci: 'mapel', label: 'Mapel' },
    { kunci: 'soal', label: 'Soal' },
    { kunci: 'peserta', label: 'Peserta' }
  ];

  /** Angka bulat ≥ 0 dari nilai apa pun (nilai tak valid → 0). */
  function angka(v) {
    var n = Number(v);
    return isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }

  /**
   * Menormalkan ringkasan dari Backend menjadi
   * {mapel:{ditambahkan,dilewati}, soal:{...}, peserta:{...}}.
   */
  function normalisasiRingkasan(data) {
    var d = data && typeof data === 'object' ? data : {};
    var hasil = {};
    JENIS.forEach(function (j) {
      var x = d[j.kunci] && typeof d[j.kunci] === 'object' ? d[j.kunci] : {};
      hasil[j.kunci] = { ditambahkan: angka(x.ditambahkan), dilewati: angka(x.dilewati) };
    });
    return hasil;
  }

  /**
   * Pesan error pemuat Data_Contoh. Untuk sheet yang hilang (Requirement 30.9)
   * pesan Backend "Sheet tidak ditemukan: ..." ditampilkan apa adanya bila
   * aman; selain itu memakai tabel PESAN_ERROR.
   */
  function pesanGagal(ui, error) {
    var info = ui.pesanError(error);
    var msg = error && typeof error.message === 'string' ? error.message.trim() : '';
    if (error && error.code === 'TIDAK_DITEMUKAN' && /^Sheet tidak ditemukan:/.test(msg) && ui.pesanAman(msg)) {
      return msg;
    }
    return info.teks;
  }

  function buatTabelRingkasan(ui, r) {
    var baris = JENIS.map(function (j) {
      return ui.el('tr', { dataset: { jenis: j.kunci } }, [
        ui.el('th', { scope: 'row', text: j.label }),
        ui.el('td', { 'data-kolom': 'ditambahkan', text: String(r[j.kunci].ditambahkan) }),
        ui.el('td', { 'data-kolom': 'dilewati', text: String(r[j.kunci].dilewati) })
      ]);
    });
    return ui.el('div', { class: 'table-wrap' },
      ui.el('table', { class: 'table' }, [
        ui.el('caption', { text: 'Ringkasan memuat data contoh' }),
        ui.el('thead', null, ui.el('tr', null, [
          ui.el('th', { scope: 'col', text: 'Jenis data' }),
          ui.el('th', { scope: 'col', text: 'Ditambahkan' }),
          ui.el('th', { scope: 'col', text: 'Dilewati (sudah ada)' })
        ])),
        ui.el('tbody', null, baris)
      ]));
  }

  function render(container, params, ctx) {
    var ui = ctx.ui;
    var user = ctx.user || {};

    function link(item) {
      var aktif = item.hash === '#/admin';
      return ui.el('li', null, ui.el('a', {
        href: item.hash,
        class: ['nav-link', aktif ? 'is-active' : null],
        'aria-current': aktif ? 'page' : null,
        onclick: function (ev) { ev.preventDefault(); ctx.navigate(item.hash); }
      }, item.label));
    }

    var btnKeluar = ui.el('button', {
      type: 'button', class: 'btn btn-sm', 'data-aksi': 'keluar',
      onclick: function () { ctx.logout(); }
    }, 'Keluar');

    var topbar = ui.el('header', { class: 'topbar' }, [
      ui.el('a', {
        href: '#/admin', class: 'topbar-brand',
        onclick: function (ev) { ev.preventDefault(); ctx.navigate('#/admin'); }
      }, 'CBT TKA — Admin'),
      ui.el('div', { class: 'topbar-user' }, [
        ui.el('span', { text: user.nama || 'Admin' }),
        btnKeluar
      ])
    ]);

    var sidebar = ui.el('nav', { class: 'sidebar', 'aria-label': 'Menu Admin' },
      ui.el('ul', { class: 'nav' }, MENU.map(link)));

    var kartuMenu = ui.el('div', { class: 'stats-grid', 'data-bagian': 'menu' },
      MENU.filter(function (m) { return m.hash !== '#/admin'; }).map(function (m) {
        return ui.el('a', {
          href: m.hash, class: 'stat-card', 'data-menu': m.label.toLowerCase(),
          style: { textDecoration: 'none', color: 'inherit', display: 'block' },
          onclick: function (ev) { ev.preventDefault(); ctx.navigate(m.hash); }
        }, [
          ui.el('div', { class: 'card-title', text: m.label }),
          ui.el('div', { class: 'stat-label', text: m.deskripsi })
        ]);
      }));

    var hasilEl = ui.el('div', { 'data-bagian': 'hasil-contoh', 'aria-live': 'polite' });

    var btnContoh = ui.el('button', {
      type: 'button', class: 'btn btn-secondary', 'data-aksi': 'muat-contoh'
    }, 'Muat data contoh');

    btnContoh.addEventListener('click', function () {
      ui.withBusy(btnContoh, function () {
        return ui.konfirmasi({
          judul: 'Muat data contoh',
          pesan: 'Menambahkan 2 Mapel, 10 Soal, dan 3 Peserta uji coba. ' +
            'Data yang sudah ada tidak diubah dan akan dilewati. Lanjutkan?',
          ya: 'Muat'
        }).then(function (ya) {
          if (!ya) return null;
          return Promise.resolve(ctx.api.muatDataContoh({})).then(function (env) {
            if (!ctx.aktif()) return;
            ui.kosongkan(hasilEl);
            if (env && env.ok) {
              var r = normalisasiRingkasan(env.data);
              hasilEl.appendChild(ui.el('div', { class: 'alert alert-success', role: 'status' },
                'Data contoh selesai dimuat.'));
              hasilEl.appendChild(buatTabelRingkasan(ui, r));
              ui.toast('Data contoh selesai dimuat.', 'sukses');
            } else {
              var err = env ? env.error : null;
              if (err && err.code === 'SESI_BERAKHIR') return; // ditangani app.js
              hasilEl.appendChild(ui.el('div', { class: 'alert alert-danger', role: 'alert' },
                pesanGagal(ui, err)));
            }
          });
        });
      });
    });

    /* ---------- Kartu Token Ujian (tampilan-anbk) ---------- */

    var tokenIsi = ui.el('div', { 'data-bagian': 'token-isi', 'aria-live': 'polite' });
    var pengaturanTerakhir = null;

    function formatSampai(ms) {
      var dt = typeof CBTDatetime !== 'undefined' ? CBTDatetime : null; // eslint-disable-line no-undef
      if (dt && typeof dt.formatJakarta === 'function') {
        var s = dt.formatJakarta(Number(ms));
        if (s) return s + ' WIB';
      }
      return String(ms);
    }

    function simpanTampilkanToken(centang, kotak) {
      var p = pengaturanTerakhir || {};
      var payload = {
        namaAplikasi: String(p.namaAplikasi || '').trim() || 'CBT TKA',
        subjudul: p.subjudul || '',
        urlLogo: p.urlLogo || '',
        pemilikHakCipta: p.pemilikHakCipta || '',
        intervalTokenMenit: Number(p.intervalTokenMenit) > 0 ? Number(p.intervalTokenMenit) : 15,
        tampilkanTokenKePeserta: centang
      };
      return ui.withBusy(kotak, function () {
        return Promise.resolve(ctx.api.simpanPengaturan(payload));
      }).then(function (env) {
        if (!ctx.aktif()) return;
        if (env && env.ok) {
          pengaturanTerakhir = env.data || payload;
          ui.toast(centang
            ? 'Token ujian sekarang tampil di halaman konfirmasi peserta.'
            : 'Token ujian disembunyikan dari peserta; umumkan token secara lisan.', 'sukses');
        } else {
          kotak.checked = !centang;
          ui.tanganiError(env && env.error ? env.error : 'ERROR_UMUM');
        }
      });
    }

    function muatToken() {
      ui.kosongkan(tokenIsi);
      tokenIsi.appendChild(ui.el('p', { text: 'Memuat token...' }));
      return Promise.all([
        Promise.resolve(ctx.api.lihatTokenUjian({})),
        Promise.resolve(ctx.api.getPengaturan({}))
      ]).then(function (hasil) {
        if (!ctx.aktif()) return;
        var envToken = hasil[0];
        var envAtur = hasil[1];
        ui.kosongkan(tokenIsi);
        if (!envToken || !envToken.ok || !envToken.data) {
          tokenIsi.appendChild(ui.el('div', { class: 'alert alert-danger', role: 'alert',
            text: 'Token ujian gagal dimuat. ' + ui.pesanError(envToken && envToken.error).teks }));
          return;
        }
        if (envAtur && envAtur.ok && envAtur.data) pengaturanTerakhir = envAtur.data;
        var d = envToken.data;
        var atur = pengaturanTerakhir || {};
        var kotak = ui.el('input', { type: 'checkbox', id: 'token-tampilkan',
          checked: atur.tampilkanTokenKePeserta === true });
        kotak.addEventListener('change', function () {
          simpanTampilkanToken(kotak.checked === true, kotak);
        });
        var btnGanti = ui.el('button', { type: 'button', class: 'btn btn-warning', 'data-aksi': 'ganti-token' },
          'Ganti token sekarang');
        btnGanti.addEventListener('click', function () {
          ui.konfirmasi({
            judul: 'Ganti Token Ujian',
            pesan: 'Token yang sekarang berlaku langsung berhenti diterima dan diganti token baru. Lanjutkan?',
            ya: 'Ganti token', tidak: 'Batal', bahaya: true
          }).then(function (ya) {
            if (!ya || !ctx.aktif()) return;
            ui.withBusy(btnGanti, function () {
              return Promise.resolve(ctx.api.gantiTokenUjian({}));
            }).then(function (env) {
              if (!ctx.aktif()) return;
              if (env && env.ok) {
                ui.toast('Token ujian berhasil diganti.', 'sukses');
                muatToken();
              } else {
                ui.tanganiError(env && env.error ? env.error : 'ERROR_UMUM');
              }
            });
          });
        });
        var btnSegar = ui.el('button', { type: 'button', class: 'btn', 'data-aksi': 'muat-token' }, 'Muat ulang');
        btnSegar.addEventListener('click', function () { ui.withBusy(btnSegar, muatToken); });

        tokenIsi.appendChild(ui.el('div', { class: 'stack' }, [
          ui.el('div', null, [
            ui.el('span', { class: 'token-ujian-kode', 'data-info': 'token-kode', text: String(d.token || '') })
          ]),
          ui.el('p', { class: 'field-hint', 'data-info': 'token-berlaku',
            text: 'Berlaku sampai ' + formatSampai(d.berlakuSampai) +
              '. Token berganti otomatis setiap ' + (Number(atur.intervalTokenMenit) > 0 ? Number(atur.intervalTokenMenit) : 15) +
              ' menit; token periode sebelumnya tetap diterima selama satu periode berikutnya.' }),
          ui.el('p', { text: 'Umumkan token ini kepada peserta untuk diisi pada halaman Konfirmasi Data sebelum memulai ujian.' }),
          ui.el('div', { class: 'field' }, [
            ui.el('label', { for: 'token-tampilkan' }, [kotak,
              ' Tampilkan token di halaman konfirmasi peserta (seperti Simulasi ANBK)'])
          ]),
          ui.el('div', { class: 'btn-group' }, [btnGanti, btnSegar])
        ]));
      });
    }

    var kartuToken = ui.el('section', { class: 'card', 'data-bagian': 'token-ujian' }, [
      ui.el('div', { class: 'card-header' }, ui.el('h2', { class: 'card-title', text: 'Token Ujian' })),
      ui.el('div', { class: 'card-body' }, tokenIsi)
    ]);
    muatToken();

    var kartuContoh = ui.el('section', { class: 'card', 'data-bagian': 'data-contoh' }, [
      ui.el('div', { class: 'card-header' }, ui.el('h2', { class: 'card-title', text: 'Data contoh' })),
      ui.el('div', { class: 'card-body stack' }, [
        ui.el('p', {
          text: 'Muat 2 Mapel, 10 Soal, dan 3 Peserta uji coba (siswa1–siswa3) untuk mencoba aplikasi. ' +
            'Aman dijalankan berulang: data yang sudah ada dilewati.'
        }),
        ui.el('div', { class: 'btn-group' }, btnContoh),
        hasilEl
      ])
    ]);

    var konten = ui.el('div', { class: 'content' }, [
      ui.el('div', { class: 'page-header' },
        ui.el('h1', { class: 'page-title', text: 'Beranda Admin' })),
      ui.el('p', { text: 'Selamat datang, ' + (user.nama || 'Admin') + '. Pilih menu untuk mulai mengelola ujian.' }),
      kartuMenu,
      kartuToken,
      kartuContoh
    ]);

    container.appendChild(ui.el('div', { class: 'layout' }, [topbar, sidebar, konten]));
  }

  var page = {
    render: render,
    normalisasiRingkasan: normalisasiRingkasan,
    MENU: MENU
  };

  if (typeof window !== 'undefined') {
    var CBT = window.CBT = window.CBT || {};
    CBT.pages = CBT.pages || {};
    CBT.pages['admin'] = page;
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = page;
})();
