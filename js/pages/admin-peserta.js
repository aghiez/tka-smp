/*
 * pages/admin-peserta.js — Halaman manajemen Peserta (rute #/admin/peserta).
 * Requirement 4.2–4.6, 4.8–4.10, 4.12, 4.13, 5.1–5.3, 5.5–5.7, 25.2, 25.5.
 *
 * Isi halaman:
 *   - Daftar Peserta (ID, nama, kelas, username, status) atau pesan kosong.
 *   - Pencarian dengan debounce JEDA_CARI_MS (< 1 detik) lewat
 *     CBTRekap.filterPeserta; halaman kembali ke 1 saat kata kunci berubah.
 *   - Paginasi 50 baris lewat CBTRekap.paginate + CBT.ui.paginasi.
 *   - Form tambah/ubah: validasi CBTValidator.validatePeserta sebelum kirim,
 *     error per field dari Frontend maupun Backend (VALIDASI/DUPLIKAT), isian
 *     tidak pernah dikosongkan saat gagal.
 *   - Dialog hapus memuat ID + nama; batal → tidak ada request.
 *   - Dialog reset password: password manual opsional (6–64). Password baru
 *     hanya ditampilkan di dialog hasil; saat dialog ditutup node-nya dibuang
 *     dan tidak ada salinan yang disimpan di state halaman (Requirement 5.2).
 *   - Gagal karena jaringan/batas waktu/server → pesan + tombol "Kirim ulang".
 *
 * destroy(): menghentikan timer debounce dan menutup dialog yang terbuka.
 */
(function () {
  'use strict';

  var root = typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this);
  var CBT = root.CBT = root.CBT || {};
  CBT.pages = CBT.pages || {};

  var UKURAN_HALAMAN = 50;
  var JEDA_CARI_MS = 300;
  var MAKS_KATA_KUNCI = 100;

  /** Kode error yang layak dikirim ulang (Requirement 4.13). */
  var KODE_KIRIM_ULANG = { KONEKSI_GAGAL: true, BATAS_WAKTU: true, SIBUK: true, ERROR_UMUM: true };

  function lib(nama, path) {
    if (root[nama]) return root[nama];
    if (typeof require === 'function') {
      try { return require(path); } catch (e) { /* tidak tersedia */ }
    }
    return null;
  }
  function V() { return lib('CBTValidator', '../shared/validator.js'); }
  function R() { return lib('CBTRekap', '../shared/rekap.js'); }

  function str(v) { return v === null || v === undefined ? '' : String(v); }

  /** ISO 'YYYY-MM-DD' -> 'DD/MM/YYYY' untuk tabel; kosong -> '-'. */
  function tampilTanggalLahir(iso) {
    var dt = lib('CBTDatetime');
    if (dt && typeof dt.tanggalIsoKeTampil === 'function') return dt.tanggalIsoKeTampil(str(iso));
    return str(iso) || '-';
  }

  function errorDari(env) {
    if (env && env.ok === false && env.error && typeof env.error === 'object') return env.error;
    return { code: 'ERROR_UMUM' };
  }

  function bisaKirimUlang(error) {
    return !!(error && KODE_KIRIM_ULANG[error.code] === true);
  }

  /** Instans halaman yang sedang aktif (untuk destroy). */
  var aktifSekarang = null;

  function buatHalaman(container, ctx) {
    var ui = ctx.ui;
    var api = ctx.api;
    var el = ui.el;

    var st = {
      semua: [],          // daftar Peserta dari Backend
      dimuat: false,
      kataKunci: '',
      halaman: 1,
      timerCari: null,
      dihancurkan: false,
      dialog: null        // {tutup: function(paksa)}
    };

    function aktif() {
      return !st.dihancurkan && (typeof ctx.aktif !== 'function' || ctx.aktif());
    }

    /* ---------- kerangka ---------- */

    var btnTambah = el('button', { type: 'button', class: 'btn btn-primary', 'data-aksi': 'tambah' }, 'Tambah Peserta');
    var btnBeranda = el('button', { type: 'button', class: 'btn', 'data-aksi': 'beranda' }, 'Beranda Admin');
    var areaPesan = el('div', { class: 'peserta-pesan', 'aria-live': 'polite' });
    var areaForm = el('div', { class: 'peserta-form-wadah', hidden: true });
    var inputCari = el('input', {
      type: 'search',
      name: 'cari',
      class: 'peserta-cari',
      maxlength: String(MAKS_KATA_KUNCI),
      placeholder: 'Cari ID, nama, kelas, atau username',
      'aria-label': 'Cari Peserta',
      autocomplete: 'off'
    });
    var infoJumlah = el('span', { class: 'field-hint peserta-jumlah', 'aria-live': 'polite' });
    var areaDaftar = el('div', { class: 'peserta-daftar' });
    var areaPaginasi = el('div', { class: 'peserta-paginasi' });

    var halamanEl = el('div', { class: 'container stack admin-peserta' }, [
      el('div', { class: 'page-header' }, [
        el('h1', { class: 'page-title', text: 'Manajemen Peserta' }),
        el('div', { class: 'page-actions' }, [btnBeranda, btnTambah])
      ]),
      areaPesan,
      areaForm,
      el('div', { class: 'card' }, el('div', { class: 'card-body stack' }, [
        el('div', { class: 'toolbar' }, [
          el('div', { class: 'field' }, [
            el('label', { class: 'field-label', text: 'Pencarian' }),
            inputCari
          ]),
          infoJumlah
        ]),
        areaDaftar,
        areaPaginasi
      ]))
    ]);
    // Hubungkan label pencarian ke input.
    inputCari.id = 'peserta-cari-' + Math.floor(Math.random() * 1e9);
    halamanEl.querySelector('label').setAttribute('for', inputCari.id);

    btnBeranda.addEventListener('click', function () { ctx.navigate('#/admin'); });
    btnTambah.addEventListener('click', function () { bukaForm(null); });
    inputCari.addEventListener('input', function () {
      if (st.timerCari !== null) clearTimeout(st.timerCari);
      st.timerCari = setTimeout(function () {
        st.timerCari = null;
        terapkanKataKunci(inputCari.value);
      }, JEDA_CARI_MS);
    });

    container.appendChild(halamanEl);

    /* ---------- pesan halaman ---------- */

    function bersihkanPesan() { ui.kosongkan(areaPesan); }

    /**
     * Pesan error halaman; jika `ulang` diberikan dan error layak dikirim
     * ulang, tampil tombol "Kirim ulang".
     */
    function tampilkanPesanError(teks, error, ulang) {
      bersihkanPesan();
      var anak = [el('p', { class: 'alert-teks', text: teks })];
      if (ulang && bisaKirimUlang(error)) {
        var btn = el('button', { type: 'button', class: 'btn btn-sm btn-primary', 'data-aksi': 'kirim-ulang' }, 'Kirim ulang');
        btn.addEventListener('click', function () { ulang(btn); });
        anak.push(btn);
      }
      areaPesan.appendChild(el('div', { class: 'alert alert-danger', role: 'alert' }, anak));
    }

    /* ---------- daftar ---------- */

    function terapkanKataKunci(nilai) {
      var k = str(nilai).slice(0, MAKS_KATA_KUNCI).trim();
      if (k !== st.kataKunci) {
        st.kataKunci = k;
        st.halaman = 1; // Requirement 4.4
      }
      renderDaftar();
    }

    function renderDaftar() {
      if (!aktif()) return;
      ui.kosongkan(areaDaftar);
      ui.kosongkan(areaPaginasi);
      ui.setTeks(infoJumlah, '');
      if (!st.dimuat) return;

      if (st.semua.length === 0) {
        areaDaftar.appendChild(el('p', { class: 'empty-state', 'data-kosong': 'semua', text: 'Belum ada data Peserta.' }));
        return;
      }
      var hasil = R().filterPeserta(st.semua, st.kataKunci);
      if (hasil.length === 0) {
        areaDaftar.appendChild(el('p', { class: 'empty-state', 'data-kosong': 'cari', text: 'Tidak ada hasil untuk pencarian ini.' }));
        ui.setTeks(infoJumlah, '0 dari ' + st.semua.length + ' Peserta');
        return;
      }
      var pg = R().paginate(hasil, st.halaman, UKURAN_HALAMAN);
      st.halaman = pg.page;
      ui.setTeks(infoJumlah, st.kataKunci === ''
        ? pg.total + ' Peserta'
        : pg.total + ' dari ' + st.semua.length + ' Peserta');

      var tbody = el('tbody', null, pg.items.map(barisPeserta));
      areaDaftar.appendChild(el('div', { class: 'table-wrap' }, el('table', { class: 'table' }, [
        el('thead', null, el('tr', null, [
          el('th', { scope: 'col', text: 'ID peserta' }),
          el('th', { scope: 'col', text: 'Nama lengkap' }),
          el('th', { scope: 'col', text: 'Kelas/jenjang' }),
          el('th', { scope: 'col', text: 'Username' }),
          el('th', { scope: 'col', text: 'Jenis Kelamin' }),
          el('th', { scope: 'col', text: 'Tanggal Lahir' }),
          el('th', { scope: 'col', text: 'Status' }),
          el('th', { scope: 'col', text: 'Aksi' })
        ])),
        tbody
      ])));

      if (pg.totalPages > 1) {
        areaPaginasi.appendChild(ui.paginasi({
          page: pg.page,
          totalPages: pg.totalPages,
          onChange: function (p) { st.halaman = p; renderDaftar(); }
        }));
      }
    }

    function barisPeserta(p) {
      var btnUbah = el('button', { type: 'button', class: 'btn btn-sm', 'data-aksi': 'ubah' }, 'Ubah');
      var btnReset = el('button', { type: 'button', class: 'btn btn-sm btn-warning', 'data-aksi': 'reset' }, 'Reset password');
      var btnHapus = el('button', { type: 'button', class: 'btn btn-sm btn-danger', 'data-aksi': 'hapus' }, 'Hapus');
      btnUbah.addEventListener('click', function () { bukaForm(p); });
      btnReset.addEventListener('click', function () { bukaDialogReset(p); });
      btnHapus.addEventListener('click', function () { konfirmasiHapus(p, btnHapus); });
      return el('tr', { dataset: { id: str(p.id) } }, [
        el('td', { text: str(p.id) }),
        el('td', { class: 'wrap', text: str(p.nama) }),
        el('td', { text: str(p.kelas) }),
        el('td', { text: str(p.username) }),
        el('td', { text: p.jenisKelamin === 'L' ? 'Laki-Laki' : p.jenisKelamin === 'P' ? 'Perempuan' : '-' }),
        el('td', { text: tampilTanggalLahir(p.tanggalLahir) }),
        el('td', null, el('span', {
          class: ['badge', p.statusAktif ? 'badge-success' : 'badge-muted'],
          text: p.statusAktif ? 'Aktif' : 'Nonaktif'
        })),
        el('td', null, el('div', { class: 'table-actions' }, [btnUbah, btnReset, btnHapus]))
      ]);
    }

    function muat() {
      ui.kosongkan(areaDaftar);
      ui.kosongkan(areaPaginasi);
      var sembunyikan = ui.tampilkanLoading(areaDaftar, 'Memuat daftar Peserta...');
      return Promise.resolve(api.listPeserta({})).then(function (env) {
        sembunyikan();
        if (!aktif()) return;
        if (env && env.ok) {
          var items = env.data && Array.isArray(env.data.items) ? env.data.items : [];
          st.semua = items.slice();
          st.dimuat = true;
          renderDaftar();
          return;
        }
        tampilkanGagalMuat(errorDari(env));
      }, function () {
        sembunyikan();
        if (aktif()) tampilkanGagalMuat({ code: 'KONEKSI_GAGAL' });
      });
    }

    function tampilkanGagalMuat(error) {
      if (error.code === 'SESI_BERAKHIR') return; // ditangani app.js
      ui.kosongkan(areaDaftar);
      var info = ui.pesanError(error);
      var btn = el('button', { type: 'button', class: 'btn btn-primary', 'data-aksi': 'coba-lagi' }, 'Coba lagi');
      btn.addEventListener('click', function () { ui.withBusy(btn, muat); });
      areaDaftar.appendChild(el('div', { class: 'alert alert-danger', role: 'alert' }, [
        el('p', { text: 'Gagal memuat daftar Peserta. ' + info.teks }),
        btn
      ]));
    }

    /* ---------- form tambah/ubah ---------- */

    function field(nama, labelTeks, input, hint) {
      input.id = 'peserta-f-' + nama;
      input.setAttribute('name', nama);
      return el('div', { class: 'field' }, [
        el('label', { class: 'field-label', for: input.id }, [labelTeks, ' ', el('span', { class: 'required', 'aria-hidden': 'true', text: '*' })]),
        input,
        hint ? el('span', { class: 'field-hint', text: hint }) : null,
        el('p', { class: 'field-error', 'data-for': nama, hidden: true })
      ]);
    }

    function tutupForm() {
      ui.kosongkan(areaForm);
      areaForm.hidden = true;
    }

    /** @param {object|null} p Peserta yang diubah; null = tambah. */
    function bukaForm(p) {
      var baru = !p;
      ui.kosongkan(areaForm);
      bersihkanPesan();

      var inId = el('input', { type: 'text', maxlength: '20', autocomplete: 'off', value: baru ? '' : str(p.id) });
      if (!baru) { inId.readOnly = true; inId.setAttribute('aria-readonly', 'true'); }
      var inNama = el('input', { type: 'text', maxlength: '100', autocomplete: 'off', value: baru ? '' : str(p.nama) });
      var inKelas = el('input', { type: 'text', maxlength: '30', autocomplete: 'off', value: baru ? '' : str(p.kelas) });
      var inUser = el('input', { type: 'text', maxlength: '30', autocomplete: 'off', value: baru ? '' : str(p.username) });
      var inPass = baru ? el('input', { type: 'password', maxlength: '64', autocomplete: 'new-password' }) : null;
      var inStatus = el('select', null, [
        el('option', { value: 'true', text: 'Aktif' }),
        el('option', { value: 'false', text: 'Nonaktif' })
      ]);
      inStatus.value = baru || p.statusAktif ? 'true' : 'false';
      // tampilan-anbk: jenis kelamin & tanggal lahir untuk verifikasi ANBK.
      var inJk = el('select', null, [
        el('option', { value: '', text: 'Tidak diisi' }),
        el('option', { value: 'L', text: 'Laki-Laki' }),
        el('option', { value: 'P', text: 'Perempuan' })
      ]);
      inJk.value = baru ? '' : str(p.jenisKelamin);
      var inTgl = el('input', { type: 'date', autocomplete: 'off', value: baru ? '' : str(p.tanggalLahir) });

      var areaGalat = el('div', { class: 'form-pesan', 'aria-live': 'polite' });
      var btnSimpan = el('button', { type: 'submit', class: 'btn btn-primary', 'data-aksi': 'simpan' }, 'Simpan');
      var btnBatal = el('button', { type: 'button', class: 'btn', 'data-aksi': 'batal' }, 'Batal');

      var form = el('form', { class: 'form', novalidate: true, 'data-mode': baru ? 'tambah' : 'ubah' }, [
        el('div', { class: 'form-row' }, [
          field('id', 'ID peserta', inId, baru ? '1–20 karakter: huruf, angka, atau tanda hubung.' : 'ID peserta tidak dapat diubah.'),
          field('nama', 'Nama lengkap', inNama, null)
        ]),
        el('div', { class: 'form-row' }, [
          field('kelas', 'Kelas/jenjang', inKelas, null),
          field('username', 'Username', inUser, '3–30 karakter: huruf, angka, titik, atau garis bawah.')
        ]),
        el('div', { class: 'form-row' }, [
          baru ? field('password', 'Password', inPass, '6–64 karakter.') : null,
          field('statusAktif', 'Status aktif', inStatus, null)
        ]),
        el('div', { class: 'form-row' }, [
          field('jenisKelamin', 'Jenis kelamin', inJk, 'Dipakai pada Konfirmasi Data ANBK.'),
          field('tanggalLahir', 'Tanggal lahir', inTgl, 'Peserta mengetik tanggal ini saat verifikasi ANBK.')
        ]),
        areaGalat,
        el('div', { class: 'btn-group' }, [btnSimpan, btnBatal])
      ]);

      function tampilkanGalatForm(teks, error) {
        ui.kosongkan(areaGalat);
        var anak = [el('p', { class: 'alert-teks', text: teks })];
        if (bisaKirimUlang(error)) {
          var btnUlang = el('button', { type: 'button', class: 'btn btn-sm btn-primary', 'data-aksi': 'kirim-ulang' }, 'Kirim ulang');
          btnUlang.addEventListener('click', function () { simpan(btnUlang); });
          anak.push(btnUlang);
        }
        areaGalat.appendChild(el('div', { class: 'alert alert-danger', role: 'alert' }, anak));
      }

      function simpan(tombol) {
        ui.bersihkanError(form);
        ui.kosongkan(areaGalat);
        var input = {
          id: baru ? inId.value : str(p.id),
          nama: inNama.value,
          kelas: inKelas.value,
          username: inUser.value,
          statusAktif: inStatus.value === 'true',
          jenisKelamin: inJk.value,
          tanggalLahir: inTgl.value
        };
        if (baru) input.password = inPass.value;
        var v = V().validatePeserta(input, { isNew: baru });
        if (!v.valid) {
          ui.tandaiError(form, v.errors); // Requirement 4.12, 25.2: tanpa request
          return Promise.resolve();
        }
        var payload = {
          id: v.value.id,
          nama: v.value.nama,
          kelas: v.value.kelas,
          username: v.value.username,
          statusAktif: v.value.statusAktif,
          jenisKelamin: v.value.jenisKelamin,
          tanggalLahir: v.value.tanggalLahir
        };
        if (baru) payload.password = v.value.password;

        return ui.withBusy(tombol || btnSimpan, function () {
          var req = baru ? api.createPeserta(payload) : api.updatePeserta(payload);
          return Promise.resolve(req).then(function (env) {
            if (!aktif()) return;
            if (env && env.ok) {
              var item = env.data && env.data.item ? env.data.item : payload;
              terapkanSimpan(item, baru ? null : str(p.id));
              tutupForm();
              ui.toast(baru ? 'Peserta berhasil ditambahkan.' : 'Data Peserta berhasil diperbarui.', 'sukses');
              return;
            }
            tanganiGagalSimpan(errorDari(env));
          }, function () {
            if (aktif()) tanganiGagalSimpan({ code: 'KONEKSI_GAGAL' });
          });
        });
      }

      function tanganiGagalSimpan(error) {
        if (error.code === 'SESI_BERAKHIR') return;
        // Requirement 4.6, 4.12, 25.5: alasan Backend di samping field; isian tetap.
        if (error.fields && typeof error.fields === 'object') ui.tandaiError(form, error.fields);
        var info = ui.pesanError(error);
        var awalan = bisaKirimUlang(error) ? 'Data Peserta belum tersimpan. ' : '';
        tampilkanGalatForm(awalan + info.teks, error);
      }

      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        simpan(btnSimpan);
      });
      btnBatal.addEventListener('click', tutupForm);

      areaForm.appendChild(el('div', { class: 'card' }, [
        el('div', { class: 'card-header' }, el('h2', { class: 'card-title', text: baru ? 'Tambah Peserta' : 'Ubah Peserta ' + str(p.id) })),
        el('div', { class: 'card-body' }, form)
      ]));
      areaForm.hidden = false;
      try { (baru ? inId : inNama).focus(); } catch (e) { /* abaikan */ }
    }

    /** Memperbarui daftar lokal setelah simpan berhasil. */
    function terapkanSimpan(item, idLama) {
      var baris = {
        id: str(item.id),
        nama: str(item.nama),
        kelas: str(item.kelas),
        username: str(item.username),
        statusAktif: item.statusAktif === true,
        jenisKelamin: str(item.jenisKelamin),
        tanggalLahir: str(item.tanggalLahir)
      };
      if (idLama === null) {
        st.semua.push(baris);
        // Tampilkan halaman terakhir agar Peserta baru terlihat bila tanpa filter.
        if (st.kataKunci === '') st.halaman = Math.ceil(st.semua.length / UKURAN_HALAMAN);
      } else {
        for (var i = 0; i < st.semua.length; i++) {
          if (str(st.semua[i].id) === idLama) { st.semua[i] = baris; break; }
        }
      }
      st.dimuat = true;
      renderDaftar();
    }

    /* ---------- hapus ---------- */

    function konfirmasiHapus(p, tombol) {
      bersihkanPesan();
      return ui.konfirmasi({
        judul: 'Hapus Peserta',
        pesan: 'Hapus Peserta dengan ID "' + str(p.id) + '" atas nama "' + str(p.nama) + '"? Tindakan ini tidak dapat dibatalkan.',
        ya: 'Hapus',
        tidak: 'Batal',
        bahaya: true
      }).then(function (ya) {
        if (!ya || !aktif()) return undefined; // Requirement 4.8: batal → tanpa request
        return hapus(p, tombol);
      });
    }

    function hapus(p, tombol) {
      return ui.withBusy(tombol, function () {
        return Promise.resolve(api.deletePeserta({ id: str(p.id) })).then(function (env) {
          if (!aktif()) return;
          if (env && env.ok) {
            bersihkanPesan();
            st.semua = st.semua.filter(function (x) { return str(x.id) !== str(p.id); });
            renderDaftar();
            ui.toast('Peserta ' + str(p.id) + ' berhasil dihapus.', 'sukses');
            return;
          }
          gagalHapus(p, errorDari(env));
        }, function () {
          if (aktif()) gagalHapus(p, { code: 'KONEKSI_GAGAL' });
        });
      });
    }

    function gagalHapus(p, error) {
      if (error.code === 'SESI_BERAKHIR') return;
      var info = ui.pesanError(error);
      var teks = error.code === 'KONFLIK'
        ? info.pesan // Requirement 4.10: pesan riwayat ujian + saran nonaktifkan
        : 'Peserta ' + str(p.id) + ' belum terhapus. ' + info.teks;
      tampilkanPesanError(teks, error, function (btn) { hapus(p, btn); });
    }

    /* ---------- reset password ---------- */

    function bukaDialogReset(p) {
      if (st.dialog) st.dialog.tutup(true);
      bersihkanPesan();
      var d = document;
      var fokusSemula = d.activeElement;
      var sibuk = false;
      var tertutup = false;

      var inManual = el('input', {
        type: 'text',
        id: 'peserta-reset-manual',
        name: 'passwordManual',
        maxlength: '64',
        autocomplete: 'off',
        spellcheck: 'false'
      });
      var areaGalat = el('div', { class: 'form-pesan', 'aria-live': 'polite' });
      var btnBatal = el('button', { type: 'button', class: 'btn', 'data-aksi': 'batal' }, 'Batal');
      var btnReset = el('button', { type: 'submit', class: 'btn btn-warning', 'data-aksi': 'reset' }, 'Reset password');
      var form = el('form', { class: 'form', novalidate: true }, [
        el('p', { class: 'dialog-pesan', text: 'Reset password Peserta dengan ID "' + str(p.id) + '" atas nama "' + str(p.nama) + '".' }),
        el('div', { class: 'field' }, [
          el('label', { class: 'field-label', for: inManual.id, text: 'Password baru (opsional)' }),
          inManual,
          el('span', { class: 'field-hint', text: 'Kosongkan untuk membuat password acak 8 karakter. Jika diisi, 6 sampai 64 karakter.' }),
          el('p', { class: 'field-error', 'data-for': 'passwordManual', hidden: true })
        ]),
        areaGalat,
        el('div', { class: 'dialog-aksi' }, [btnBatal, btnReset])
      ]);
      var kotak = el('div', {
        class: 'dialog dialog-reset',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': 'peserta-reset-judul'
      }, [
        el('h2', { class: 'dialog-judul', id: 'peserta-reset-judul', text: 'Reset password Peserta' }),
        form
      ]);
      var latar = el('div', { class: 'dialog-backdrop' }, kotak);

      function tutup(paksa) {
        if (tertutup || (sibuk && !paksa)) return;
        tertutup = true;
        d.removeEventListener('keydown', onKey, true);
        // Buang semua isi (termasuk password baru) sebelum dilepas dari DOM.
        ui.kosongkan(kotak);
        if (latar.parentNode) latar.parentNode.removeChild(latar);
        if (st.dialog === pegangan) st.dialog = null;
        if (!paksa && fokusSemula && typeof fokusSemula.focus === 'function' && d.body.contains(fokusSemula)) {
          try { fokusSemula.focus(); } catch (e) { /* abaikan */ }
        }
      }
      var pegangan = { tutup: tutup };

      function onKey(ev) {
        if (ev.key === 'Escape' || ev.key === 'Esc') {
          ev.preventDefault();
          tutup(false);
        }
      }

      function tampilkanGalat(teks, error) {
        ui.kosongkan(areaGalat);
        var anak = [el('p', { class: 'alert-teks', text: teks })];
        if (bisaKirimUlang(error)) {
          var btnUlang = el('button', { type: 'button', class: 'btn btn-sm btn-primary', 'data-aksi': 'kirim-ulang' }, 'Kirim ulang');
          btnUlang.addEventListener('click', function () { kirim(btnUlang); });
          anak.push(btnUlang);
        }
        areaGalat.appendChild(el('div', { class: 'alert alert-danger', role: 'alert' }, anak));
      }

      function kirim(tombol) {
        if (sibuk || tertutup) return Promise.resolve();
        ui.bersihkanError(form);
        ui.kosongkan(areaGalat);
        var manual = V().trimText(inManual.value);
        if (manual !== '') {
          var pv = V().validatePasswordPeserta(manual);
          if (!pv.valid) {
            ui.tandaiError(form, { passwordManual: pv.errors.password }); // Requirement 5.5
            return Promise.resolve();
          }
        }
        var params = { id: str(p.id) };
        if (manual !== '') params.passwordManual = manual;
        sibuk = true;
        btnBatal.disabled = true;
        return ui.withBusy(tombol || btnReset, function () {
          return Promise.resolve(api.resetPasswordPeserta(params)).then(function (env) {
            return env;
          }, function () {
            return { ok: false, error: { code: 'KONEKSI_GAGAL' } };
          });
        }).then(function (env) {
          sibuk = false;
          btnBatal.disabled = false;
          if (tertutup || !aktif()) return;
          if (env && env.ok && env.data && typeof env.data.passwordBaru === 'string' && env.data.passwordBaru !== '') {
            tampilkanHasil(env.data.passwordBaru);
            return;
          }
          var error = env && env.ok ? { code: 'ERROR_UMUM' } : errorDari(env);
          if (error.code === 'SESI_BERAKHIR') { tutup(true); return; }
          if (error.fields && typeof error.fields === 'object') ui.tandaiError(form, error.fields);
          // Requirement 5.6, 5.7: tidak ada password baru yang ditampilkan.
          tampilkanGalat('Reset password gagal. ' + ui.pesanError(error).teks, error);
        });
      }

      /** Requirement 5.2: password baru hanya hidup di node dialog ini. */
      function tampilkanHasil(passwordBaru) {
        ui.kosongkan(kotak);
        var btnTutup = el('button', { type: 'button', class: 'btn btn-primary', 'data-aksi': 'tutup' }, 'Tutup');
        btnTutup.addEventListener('click', function () { tutup(false); });
        kotak.appendChild(el('h2', { class: 'dialog-judul', id: 'peserta-reset-judul', text: 'Password berhasil direset' }));
        kotak.appendChild(el('div', { class: 'dialog-pesan stack' }, [
          el('p', { text: 'Password baru untuk Peserta "' + str(p.id) + '" (' + str(p.nama) + '):' }),
          el('p', null, el('code', { class: 'password-baru', 'data-password-baru': '1', text: passwordBaru })),
          el('div', { class: 'alert alert-warning', role: 'note', text: 'Catat password ini sekarang. Setelah dialog ditutup, password tidak dapat ditampilkan lagi.' })
        ]));
        kotak.appendChild(el('div', { class: 'dialog-aksi' }, btnTutup));
        try { btnTutup.focus(); } catch (e) { /* abaikan */ }
      }

      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        kirim(btnReset);
      });
      btnBatal.addEventListener('click', function () { tutup(false); });
      d.addEventListener('keydown', onKey, true);
      d.body.appendChild(latar);
      st.dialog = pegangan;
      try { inManual.focus(); } catch (e) { /* abaikan */ }
      return pegangan;
    }

    /* ---------- siklus hidup ---------- */

    function hancurkan() {
      st.dihancurkan = true;
      if (st.timerCari !== null) { clearTimeout(st.timerCari); st.timerCari = null; }
      if (st.dialog) st.dialog.tutup(true);
    }

    return { muat: muat, hancurkan: hancurkan, state: st };
  }

  CBT.pages['admin/peserta'] = {
    render: function (container, params, ctx) {
      if (aktifSekarang) aktifSekarang.hancurkan();
      var h = buatHalaman(container, ctx);
      aktifSekarang = h;
      return h.muat();
    },
    destroy: function () {
      if (aktifSekarang) {
        aktifSekarang.hancurkan();
        aktifSekarang = null;
      }
    },
    JEDA_CARI_MS: JEDA_CARI_MS,
    UKURAN_HALAMAN: UKURAN_HALAMAN
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = CBT.pages['admin/peserta'];
  }
})();
