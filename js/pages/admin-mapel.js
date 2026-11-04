/*
 * pages/admin-mapel.js — Halaman manajemen Mapel untuk Admin (#/admin/mapel).
 * Requirement 7.2, 7.3, 7.4, 7.5, 7.7, 7.8, 7.9, 7.10, 7.12, 21.12, 21.13.
 *
 * - Daftar Mapel dari api.listMapel(): kode, nama, durasi, jumlah soal
 *   ditampilkan, status, dan jumlah Soal di bank (jumlahSoalBank, 7.2).
 *   jumlahSoal > jumlahSoalBank → badge "Belum siap diujikan" (7.10).
 *   perluHitungUlang → tombol "Hitung ulang nilai" (21.12); hasilnya
 *   menampilkan jumlah Sesi yang dinilai ulang lalu memuat ulang daftar (21.13).
 * - Form tambah/ubah: validasi CBTValidator.validateMapel sebelum kirim (7.5);
 *   error Backend (VALIDASI/DUPLIKAT/gagal jaringan) ditandai per field dan
 *   isian formulir dipertahankan; daftar tidak berubah sampai sukses (7.4, 7.12).
 *   Saat ubah, kode mapel hanya-baca (kode adalah kunci di Backend).
 * - Hapus: dialog menyebut kode, nama, dan jumlah Soal yang ikut terhapus (7.7);
 *   sukses → Mapel dihapus dari daftar (7.8); KONFLIK → pesan Backend yang
 *   menyarankan menonaktifkan Mapel (7.9).
 *
 * Tidak ada innerHTML: semua elemen dibuat lewat ctx.ui.el (teks aman).
 */
(function (root) {
  'use strict';

  var FIELD_TEKS = [
    { name: 'kodeMapel', label: 'Kode mapel', type: 'text', maxlength: 20, wajib: true,
      hint: '1–20 karakter: huruf, angka, atau tanda hubung (-).' },
    { name: 'namaMapel', label: 'Nama mapel', type: 'text', maxlength: 100, wajib: true },
    { name: 'durasiMenit', label: 'Durasi (menit)', type: 'number', min: 1, max: 600, wajib: true,
      hint: 'Bilangan bulat 1–600.' },
    { name: 'jumlahSoal', label: 'Jumlah soal ditampilkan', type: 'number', min: 1, max: 200, wajib: true,
      hint: 'Bilangan bulat 1–200.' },
    // tampilan-anbk: jenjang & jenis tampil di halaman Simulasi TKA peserta.
    { name: 'jenjang', label: 'Jenjang', type: 'text', maxlength: 50, wajib: false,
      hint: 'Contoh: SMP/MTs/Sederajat. Boleh kosong.' },
    { name: 'jenisMapel', label: 'Jenis mapel', type: 'text', maxlength: 20, wajib: false,
      hint: 'Wajib atau Pilihan. Kosong = Wajib.' }
  ];

  var FIELD_CENTANG = [
    { name: 'statusAktif', label: 'Aktif (dapat diujikan)', bawaan: true },
    { name: 'acakSoal', label: 'Acak urutan soal', bawaan: false },
    { name: 'acakOpsi', label: 'Acak urutan opsi', bawaan: false },
    { name: 'tampilSkor', label: 'Tampilkan skor ke Peserta', bawaan: false },
    // tampilan-anbk: reviu jawaban vs kunci di halaman hasil peserta.
    { name: 'tampilkanReviu', label: 'Tampilkan reviu jawaban & kunci ke Peserta setelah selesai', bawaan: false }
  ];

  function getValidator() {
    if (typeof CBTValidator !== 'undefined') return CBTValidator; // eslint-disable-line no-undef
    return root && root.CBTValidator;
  }

  /** True jika Mapel belum siap diujikan (Requirement 7.10). */
  function belumSiap(m) {
    return Number(m.jumlahSoal) > Number(m.jumlahSoalBank || 0);
  }

  var page = {
    belumSiap: belumSiap,

    render: function (container, params, ctx) {
      var ui = ctx.ui;
      var api = ctx.api;
      var el = ui.el;

      var state = { items: [], mode: null, kodeEdit: null };

      /* ---------- kerangka ---------- */

      var btnTambah = el('button', { type: 'button', class: 'btn btn-primary', 'data-aksi': 'tambah' }, 'Tambah Mapel');
      var btnBeranda = el('button', { type: 'button', class: 'btn', 'data-aksi': 'beranda',
        onclick: function () { ctx.navigate('#/admin'); } }, 'Kembali ke beranda');

      var formWrap = el('section', { class: 'card', hidden: true, 'aria-labelledby': 'mapel-form-judul' });
      var daftarWrap = el('section', { class: 'card', 'aria-label': 'Daftar Mapel' });

      container.appendChild(el('div', { class: 'container stack' }, [
        el('div', { class: 'page-header' }, [
          el('h1', { class: 'page-title', text: 'Mata Pelajaran' }),
          el('div', { class: 'page-actions' }, [btnBeranda, btnTambah])
        ]),
        formWrap,
        daftarWrap
      ]));

      /* ---------- form ---------- */

      var judulForm = el('h2', { class: 'card-title', id: 'mapel-form-judul' });
      var input = {};
      var kontrolTeks = FIELD_TEKS.map(function (f) {
        var id = 'mapel-' + f.name;
        input[f.name] = el('input', {
          type: f.type, id: id, name: f.name, maxlength: f.maxlength, min: f.min, max: f.max,
          step: f.type === 'number' ? 1 : null, inputmode: f.type === 'number' ? 'numeric' : null,
          autocomplete: 'off', required: f.wajib
        });
        return el('div', { class: 'field' }, [
          el('label', { class: 'field-label', for: id }, [f.label, f.wajib ? el('span', { class: 'required', 'aria-hidden': 'true' }, ' *') : null]),
          input[f.name],
          f.hint ? el('span', { class: 'field-hint', text: f.hint }) : null,
          el('p', { class: 'field-error', 'data-for': f.name, hidden: true })
        ]);
      });
      var kontrolCentang = FIELD_CENTANG.map(function (f) {
        var id = 'mapel-' + f.name;
        input[f.name] = el('input', { type: 'checkbox', id: id, name: f.name });
        return el('div', { class: 'field' }, [
          el('label', { for: id }, [input[f.name], ' ', f.label]),
          el('p', { class: 'field-error', 'data-for': f.name, hidden: true })
        ]);
      });

      var btnSimpan = el('button', { type: 'submit', class: 'btn btn-primary', 'data-aksi': 'simpan' }, 'Simpan');
      var btnBatal = el('button', { type: 'button', class: 'btn', 'data-aksi': 'batal' }, 'Batal');
      var form = el('form', { class: 'form', novalidate: true, 'data-form': 'mapel' }, [
        el('div', { class: 'form-row' }, kontrolTeks),
        el('fieldset', { class: 'form-row' }, [el('legend', { text: 'Pengaturan ujian' })].concat(kontrolCentang)),
        el('div', { class: 'btn-group' }, [btnSimpan, btnBatal])
      ]);
      formWrap.appendChild(el('div', { class: 'card-header' }, judulForm));
      formWrap.appendChild(el('div', { class: 'card-body' }, form));

      function bukaForm(mapel) {
        ui.bersihkanError(form);
        state.mode = mapel ? 'ubah' : 'tambah';
        state.kodeEdit = mapel ? mapel.kodeMapel : null;
        ui.setTeks(judulForm, mapel ? 'Ubah Mapel ' + mapel.kodeMapel : 'Tambah Mapel');
        FIELD_TEKS.forEach(function (f) {
          var v = mapel ? mapel[f.name] : '';
          input[f.name].value = v === null || v === undefined ? '' : String(v);
        });
        FIELD_CENTANG.forEach(function (f) {
          input[f.name].checked = mapel ? mapel[f.name] === true : f.bawaan;
        });
        input.kodeMapel.readOnly = !!mapel;
        if (mapel) input.kodeMapel.setAttribute('aria-readonly', 'true');
        else input.kodeMapel.removeAttribute('aria-readonly');
        formWrap.hidden = false;
        (mapel ? input.namaMapel : input.kodeMapel).focus();
      }

      function tutupForm() {
        ui.bersihkanError(form);
        form.reset();
        state.mode = null;
        state.kodeEdit = null;
        formWrap.hidden = true;
      }

      function bacaForm() {
        var data = {};
        FIELD_TEKS.forEach(function (f) { data[f.name] = input[f.name].value; });
        FIELD_CENTANG.forEach(function (f) { data[f.name] = input[f.name].checked; });
        if (state.mode === 'ubah') data.kodeMapel = state.kodeEdit;
        return data;
      }

      function simpan() {
        ui.bersihkanError(form);
        var hasil = getValidator().validateMapel(bacaForm());
        if (!hasil.valid) {
          ui.tandaiError(form, hasil.errors);
          ui.toast(ui.pesanError('VALIDASI').teks, 'error');
          return Promise.resolve();
        }
        var ubah = state.mode === 'ubah';
        return ui.withBusy(btnSimpan, function () {
          return ubah ? api.updateMapel(hasil.value) : api.createMapel(hasil.value);
        }).then(function (env) {
          if (!ctx.aktif()) return undefined;
          if (!env || !env.ok) {
            // Isian dipertahankan dan daftar tidak diubah (Requirement 7.4, 7.5, 7.12).
            ui.tanganiError(env && env.error ? env.error : 'ERROR_UMUM', { form: form });
            return undefined;
          }
          ui.toast(ubah ? 'Perubahan Mapel ' + hasil.value.kodeMapel + ' berhasil disimpan.'
            : 'Mapel ' + hasil.value.kodeMapel + ' berhasil ditambahkan.', 'sukses');
          tutupForm();
          return muat();
        });
      }

      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        simpan();
      });
      btnBatal.addEventListener('click', tutupForm);
      btnTambah.addEventListener('click', function () { bukaForm(null); });

      /* ---------- aksi baris ---------- */

      function hapus(mapel, btn) {
        var n = Number(mapel.jumlahSoalBank) || 0;
        return ui.konfirmasi({
          judul: 'Hapus Mapel',
          pesan: 'Hapus Mapel ' + mapel.kodeMapel + ' – ' + mapel.namaMapel + '? ' +
            (n > 0 ? n + ' Soal di bank soal Mapel ini akan ikut terhapus.' : 'Mapel ini belum memiliki Soal.') +
            ' Tindakan ini tidak dapat dibatalkan.',
          ya: 'Hapus',
          tidak: 'Batal',
          bahaya: true
        }).then(function (ya) {
          if (!ya || !ctx.aktif()) return undefined;
          return ui.withBusy(btn, function () {
            return api.deleteMapel({ kodeMapel: mapel.kodeMapel });
          }).then(function (env) {
            if (!ctx.aktif()) return;
            if (!env || !env.ok) {
              // KONFLIK memakai pesan Backend yang menyarankan menonaktifkan Mapel (7.9).
              ui.tanganiError(env && env.error ? env.error : 'ERROR_UMUM');
              return;
            }
            var terhapus = env.data && typeof env.data.soalTerhapus === 'number' ? env.data.soalTerhapus : n;
            state.items = state.items.filter(function (m) { return m.kodeMapel !== mapel.kodeMapel; });
            if (state.mode === 'ubah' && state.kodeEdit === mapel.kodeMapel) tutupForm();
            renderDaftar();
            ui.toast('Mapel ' + mapel.kodeMapel + ' dihapus beserta ' + terhapus + ' Soal.', 'sukses');
          });
        });
      }

      function hitungUlang(mapel, btn) {
        return ui.withBusy(btn, function () {
          return api.hitungUlang({ kodeMapel: mapel.kodeMapel });
        }).then(function (env) {
          if (!ctx.aktif()) return undefined;
          if (!env || !env.ok) {
            ui.tanganiError(env && env.error ? env.error : 'ERROR_UMUM');
            return undefined;
          }
          var jumlah = env.data && typeof env.data.jumlahDinilaiUlang === 'number' ? env.data.jumlahDinilaiUlang : 0;
          ui.toast('Nilai Mapel ' + mapel.kodeMapel + ' dihitung ulang: ' + jumlah + ' sesi ujian berhasil dinilai ulang.', 'sukses');
          return muat();
        });
      }

      /* ---------- daftar ---------- */

      function sel(teks, kelas) {
        return el('td', { class: kelas || null, text: teks });
      }

      function barisMapel(m) {
        var status = [
          m.statusAktif
            ? el('span', { class: 'badge badge-success', text: 'Aktif' })
            : el('span', { class: 'badge badge-muted', text: 'Nonaktif' })
        ];
        if (belumSiap(m)) {
          status.push(el('span', {
            class: 'badge badge-belum-siap', 'data-peringatan': 'belum-siap',
            title: 'Jumlah soal ditampilkan (' + m.jumlahSoal + ') melebihi jumlah Soal di bank (' + (m.jumlahSoalBank || 0) + ').'
          }, 'Belum siap diujikan'));
        }
        var btnUbah = el('button', { type: 'button', class: 'btn btn-sm', 'data-aksi': 'ubah' }, 'Ubah');
        var btnHapus = el('button', { type: 'button', class: 'btn btn-sm btn-danger', 'data-aksi': 'hapus' }, 'Hapus');
        btnUbah.addEventListener('click', function () { bukaForm(m); });
        btnHapus.addEventListener('click', function () { hapus(m, btnHapus); });
        var aksi = [btnUbah, btnHapus];
        if (m.perluHitungUlang === true) {
          var btnHitung = el('button', { type: 'button', class: 'btn btn-sm btn-primary', 'data-aksi': 'hitung-ulang' }, 'Hitung ulang nilai');
          btnHitung.addEventListener('click', function () { hitungUlang(m, btnHitung); });
          aksi.push(btnHitung);
        }
        return el('tr', { dataset: { kode: m.kodeMapel } }, [
          sel(m.kodeMapel),
          sel(m.namaMapel, 'wrap'),
          sel(String(m.durasiMenit), 'col-num'),
          sel(String(m.jumlahSoal), 'col-num'),
          sel(String(m.jumlahSoalBank || 0), 'col-num'),
          el('td', null, el('span', { class: 'mapel-status' }, status)),
          el('td', null, el('div', { class: 'table-actions' }, aksi))
        ]);
      }

      function renderDaftar() {
        ui.kosongkan(daftarWrap);
        if (state.items.length === 0) {
          daftarWrap.appendChild(el('div', { class: 'card-body' },
            el('p', { class: 'empty-state', text: 'Belum ada Mapel. Pilih "Tambah Mapel" untuk membuat Mapel baru.' })));
          return;
        }
        var kolom = ['Kode', 'Nama mapel', 'Durasi (menit)', 'Soal ditampilkan', 'Soal di bank', 'Status', 'Aksi'];
        daftarWrap.appendChild(el('div', { class: 'table-wrap' },
          el('table', { class: 'table' }, [
            el('thead', null, el('tr', null, kolom.map(function (k) {
              return el('th', { scope: 'col', text: k });
            }))),
            el('tbody', null, state.items.map(barisMapel))
          ])));
      }

      function renderGagalMuat(error) {
        ui.kosongkan(daftarWrap);
        var btnUlang = el('button', { type: 'button', class: 'btn btn-primary', 'data-aksi': 'muat-ulang' }, 'Coba lagi');
        btnUlang.addEventListener('click', function () { ui.withBusy(btnUlang, muat); });
        daftarWrap.appendChild(el('div', { class: 'card-body stack' }, [
          el('div', { class: 'alert alert-danger', role: 'alert', text: 'Gagal memuat daftar Mapel. ' + ui.pesanError(error).teks }),
          btnUlang
        ]));
      }

      function muat() {
        var sembunyikan = ui.tampilkanLoading(daftarWrap, 'Memuat daftar Mapel...');
        return Promise.resolve(api.listMapel()).then(function (env) {
          sembunyikan();
          if (!ctx.aktif()) return;
          if (!env || !env.ok) {
            renderGagalMuat(env && env.error ? env.error : 'ERROR_UMUM');
            return;
          }
          state.items = env.data && Array.isArray(env.data.items) ? env.data.items : [];
          renderDaftar();
        });
      }

      return muat();
    }
  };

  if (root) {
    var CBT = root.CBT = root.CBT || {};
    CBT.pages = CBT.pages || {};
    CBT.pages['admin/mapel'] = page;
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = page;
})(typeof window !== 'undefined' ? window : null);
