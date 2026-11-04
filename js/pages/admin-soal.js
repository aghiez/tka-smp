/*
 * pages/admin-soal.js — Halaman manajemen Soal untuk Admin (#/admin/soal).
 * Requirement 8.2–8.6, 8.12–8.15, 9.8, 9.10, 10.1–10.10.
 *
 * - Pilih Mapel (api.listMapel) → daftar Soal Mapel itu (api.listSoal) sesuai
 *   urutan sheet: nomor mulai 1, cuplikan 100 karakter (CBTMarkup.cuplikan),
 *   tipe, bobot. Tanpa Soal → pesan kosong menggantikan daftar (8.2, 8.3).
 * - Form tambah/ubah per tipe: PG (radio kunci), PGK (centang kunci), BS (opsi
 *   tetap "Benar"/"Salah", kunci B/S). Validasi CBTValidator.validateSoal
 *   sebelum kirim; error ditandai per field dan isian dipertahankan (8.4, 8.5,
 *   8.12). Gagal → pesan "operasi gagal" dan daftar tidak berubah.
 * - Toolbar bantu format dan simbol memakai CBTMarkup.insertMarkup pada kolom
 *   teks yang terakhir aktif (teks soal, opsi, atau pembahasan) (9.8).
 * - Pratinjau tanpa request ke Backend: dibangun dari isian form saat itu,
 *   dirender dengan CBTMarkup.renderHtml memakai struktur kelas yang sama
 *   dengan Halaman_Ujian (.ujian-soal, .soal-teks, .soal-gambar, .opsi-list),
 *   penanda kunci, pembahasan atau keterangan kosong, klik opsi diabaikan,
 *   gambar gagal → penanda, teks kosong → pratinjau tidak dibuka (10.1–10.10).
 *   Menutup pratinjau menampilkan kembali form yang sama (nilai tidak disentuh).
 * - Hapus: dialog konfirmasi; KONFLIK → pesan Soal tidak dapat dihapus selama
 *   ujian Mapel berlangsung (8.6, 8.13).
 *
 * Satu-satunya pemakaian innerHTML adalah keluaran CBTMarkup.renderHtml, yang
 * meng-escape seluruh teks masukan dan hanya menghasilkan tag daftar putih.
 * Elemen lain dibuat lewat ctx.ui.el (teks aman).
 */
(function (root) {
  'use strict';

  var HURUF = ['A', 'B', 'C', 'D', 'E'];
  var TIPE = [
    { kode: 'PG', label: 'PG — Pilihan ganda (satu jawaban)' },
    { kode: 'PGK', label: 'PGK — Pilihan ganda kompleks (lebih dari satu jawaban)' },
    { kode: 'BS', label: 'BS — Benar/Salah' }
  ];
  var LABEL_TIPE = { PG: 'PG', PGK: 'PGK', BS: 'BS' };
  var OPSI_BS = [{ kunci: 'B', teks: 'Benar' }, { kunci: 'S', teks: 'Salah' }];

  var TOMBOL_FORMAT = [
    { kind: 'b', label: 'B', judul: 'Tebal' },
    { kind: 'u', label: 'U', judul: 'Garis bawah' },
    { kind: 'i', label: 'I', judul: 'Miring' },
    { kind: 'sup', label: 'x\u00B2', judul: 'Pangkat' },
    { kind: 'sub', label: 'x\u2082', judul: 'Indeks bawah' },
    { kind: 'akar', label: '\u221Ax', judul: 'Akar kuadrat' },
    { kind: 'frac', label: 'a/b', judul: 'Pecahan' }
  ];
  var TOMBOL_SIMBOL = [
    { kode: 'kali', judul: 'Kali' },
    { kode: 'bagi', judul: 'Bagi' },
    { kode: 'pm', judul: 'Plus-minus' },
    { kode: 'le', judul: 'Kurang dari sama dengan' },
    { kode: 'ge', judul: 'Lebih dari sama dengan' },
    { kode: 'ne', judul: 'Tidak sama dengan' },
    { kode: 'derajat', judul: 'Derajat' },
    { kode: 'pi', judul: 'Pi' },
    { kode: 'akar', judul: 'Simbol akar' },
    { kode: 'inf', judul: 'Tak hingga' },
    { kode: 'kira', judul: 'Kira-kira sama dengan' }
  ];

  var BATAS_GAMBAR_MS = 10000;
  var PESAN_GAMBAR_GAGAL = 'Gambar tidak dapat dimuat';
  var PESAN_KONFLIK_HAPUS = 'Soal tidak dapat dihapus selama ujian Mapel ini sedang berlangsung. Coba lagi setelah semua sesi ujian Mapel ini selesai.';

  function ambilGlobal(nama) {
    /* eslint-disable no-undef */
    if (nama === 'CBTValidator' && typeof CBTValidator !== 'undefined') return CBTValidator;
    if (nama === 'CBTMarkup' && typeof CBTMarkup !== 'undefined') return CBTMarkup;
    /* eslint-enable no-undef */
    return root ? root[nama] : undefined;
  }

  /** Mengisi node dengan HTML hasil Perender_Soal (aman: teks di-escape). */
  function isiMarkup(node, teks) {
    node.innerHTML = ambilGlobal('CBTMarkup').renderHtml(teks === null || teks === undefined ? '' : String(teks));
    return node;
  }

  function trim(v) {
    return v === null || v === undefined ? '' : String(v).trim();
  }

  // Pembersih timer pratinjau milik render terakhir (dipanggil destroy()).
  var bersihkanAktif = null;

  /**
   * Membangun elemen pratinjau Soal dari data form (tanpa request, Requirement 10.1).
   * Struktur kelas sama dengan Halaman_Ujian sehingga ujian.css berlaku untuk keduanya.
   * @param {object} ui CBT.ui
   * @param {object} data {tipe, teks, urlGambar, opsi:{A..E}, kunci:[], pembahasan}
   * @param {{nomor?:number, timers?:Array}} [opsi]
   * @returns {HTMLElement}
   */
  function buatPratinjau(ui, data, opsi) {
    var el = ui.el;
    var o = opsi || {};
    var timers = o.timers || [];
    var tipe = data.tipe;
    var kunci = Array.isArray(data.kunci) ? data.kunci : [];

    var soal = el('article', { class: 'ujian-soal', 'data-tipe': tipe });
    soal.appendChild(el('div', { class: 'soal-header' },
      el('h3', { class: 'soal-nomor', text: 'Soal No. ' + (o.nomor || 1) })));
    soal.appendChild(isiMarkup(el('div', { class: 'soal-teks' }), data.teks));

    var url = trim(data.urlGambar);
    if (url !== '') {
      var wadahGambar = el('div', { class: 'soal-gambar' });
      var img = el('img', { src: url, alt: 'Gambar soal', referrerpolicy: 'no-referrer' });
      var timer = null;
      var gagal = function () {
        if (timer !== null) { clearTimeout(timer); timer = null; }
        if (wadahGambar.getAttribute('data-status') === 'gagal') return;
        wadahGambar.setAttribute('data-status', 'gagal');
        ui.kosongkan(wadahGambar);
        wadahGambar.appendChild(el('p', { class: 'gambar-gagal', role: 'note', text: PESAN_GAMBAR_GAGAL }));
      };
      img.addEventListener('error', gagal);
      img.addEventListener('load', function () {
        if (timer !== null) { clearTimeout(timer); timer = null; }
        wadahGambar.setAttribute('data-status', 'termuat');
      });
      timer = setTimeout(function () {
        timer = null;
        if (!img.complete || !img.naturalWidth) gagal();
      }, BATAS_GAMBAR_MS);
      timers.push(function () { if (timer !== null) { clearTimeout(timer); timer = null; } });
      wadahGambar.appendChild(img);
      soal.appendChild(wadahGambar);
    }

    if (tipe === 'PGK') {
      soal.appendChild(el('p', { class: 'soal-petunjuk', text: 'Pilih lebih dari satu jawaban' }));
    }

    var daftar;
    if (tipe === 'BS') {
      daftar = OPSI_BS.map(function (x) { return { label: x.kunci, teks: x.teks, huruf: null, kunci: kunci.indexOf(x.kunci) >= 0 }; });
    } else {
      daftar = [];
      HURUF.forEach(function (L) {
        var t = data.opsi && data.opsi[L] !== undefined ? String(data.opsi[L]) : '';
        if (trim(t) === '') return;
        daftar.push({ label: L, teks: t, huruf: L, kunci: kunci.indexOf(L) >= 0 });
      });
    }

    var jenisInput = tipe === 'PGK' ? 'checkbox' : 'radio';
    var namaGrup = 'pratinjau-opsi-' + Math.random().toString(36).slice(2, 8);
    var ul = el('ul', { class: 'opsi-list', role: tipe === 'PGK' ? 'group' : 'radiogroup', 'aria-label': 'Opsi jawaban' });
    daftar.forEach(function (d) {
      var isi = el('span', { class: 'opsi-teks' });
      if (d.huruf) isiMarkup(isi, d.teks);
      else ui.setTeks(isi, d.teks);
      ul.appendChild(el('li', { class: d.kunci ? 'opsi opsi-kunci' : 'opsi', 'data-opsi': d.label, 'data-kunci': d.kunci ? '1' : null },
        el('label', { class: 'opsi-label' }, [
          el('input', { type: jenisInput, name: namaGrup, value: d.label, tabindex: '-1', 'aria-readonly': 'true' }),
          d.huruf ? el('span', { class: 'opsi-huruf', text: d.huruf + '.' }) : null,
          isi,
          d.kunci ? el('span', { class: 'badge badge-success kunci-tanda', text: 'Kunci jawaban' }) : null
        ])));
    });
    // Klik opsi diabaikan: input tidak pernah berubah status (Requirement 10.6).
    ul.addEventListener('click', function (ev) { ev.preventDefault(); }, true);
    ul.addEventListener('keydown', function (ev) {
      if (ev.key === ' ' || ev.key === 'Enter' || /^Arrow/.test(ev.key || '')) ev.preventDefault();
    }, true);
    soal.appendChild(ul);

    var bahas = el('section', { class: 'soal-pembahasan', 'aria-label': 'Pembahasan' },
      el('h4', { class: 'soal-pembahasan-judul', text: 'Pembahasan' }));
    if (trim(data.pembahasan) === '') {
      bahas.appendChild(el('p', { class: 'text-muted', 'data-pembahasan': 'kosong', text: 'Pembahasan tidak diisi.' }));
    } else {
      bahas.appendChild(isiMarkup(el('div', { class: 'soal-pembahasan-isi' }), data.pembahasan));
    }
    soal.appendChild(bahas);
    return soal;
  }

  var page = {
    buatPratinjau: buatPratinjau,

    destroy: function () {
      if (bersihkanAktif) bersihkanAktif();
      bersihkanAktif = null;
    },

    render: function (container, params, ctx) {
      var ui = ctx.ui;
      var api = ctx.api;
      var el = ui.el;
      var markup = ambilGlobal('CBTMarkup');

      var state = {
        mapel: [], kodeMapel: '', items: [],
        mode: null, edit: null, fieldAktif: null, muatKe: 0, timers: []
      };

      function hentikanTimer() {
        state.timers.forEach(function (f) { f(); });
        state.timers = [];
      }
      bersihkanAktif = hentikanTimer;

      /* ---------- kerangka ---------- */

      var btnBeranda = el('button', { type: 'button', class: 'btn', 'data-aksi': 'beranda',
        onclick: function () { ctx.navigate('#/admin'); } }, 'Kembali ke beranda');
      var btnTambah = el('button', { type: 'button', class: 'btn btn-primary', 'data-aksi': 'tambah', disabled: true }, 'Tambah Soal');
      var pilihMapel = el('select', { id: 'soal-pilih-mapel', name: 'pilihMapel', 'data-aksi': 'pilih-mapel', disabled: true });

      var formWrap = el('section', { class: 'card', hidden: true, 'aria-labelledby': 'soal-form-judul' });
      var daftarWrap = el('section', { class: 'card', 'aria-label': 'Daftar Soal' });

      container.appendChild(el('div', { class: 'container stack' }, [
        el('div', { class: 'page-header' }, [
          el('h1', { class: 'page-title', text: 'Bank Soal' }),
          el('div', { class: 'page-actions' }, [btnBeranda, btnTambah])
        ]),
        el('div', { class: 'card' }, el('div', { class: 'card-body toolbar' },
          el('div', { class: 'field' }, [
            el('label', { class: 'field-label', for: 'soal-pilih-mapel', text: 'Mata pelajaran' }),
            pilihMapel
          ]))),
        formWrap,
        daftarWrap
      ]));

      /* ---------- form ---------- */

      var judulForm = el('h2', { class: 'card-title', id: 'soal-form-judul' });
      var input = {};

      function pesanErr(nama) {
        return el('p', { class: 'field-error', 'data-for': nama, hidden: true });
      }
      function label(forId, teks, wajib) {
        return el('label', { class: 'field-label', for: forId },
          [teks, wajib ? el('span', { class: 'required', 'aria-hidden': 'true' }, ' *') : null]);
      }
      function areaMarkup(nama, id, baris) {
        return el('textarea', { id: id, name: nama, rows: baris, 'data-markup': '1', spellcheck: 'false' });
      }

      input.tipe = el('select', { id: 'soal-tipe', name: 'tipe', 'data-aksi': 'tipe' },
        TIPE.map(function (t) { return el('option', { value: t.kode, text: t.label }); }));

      // Toolbar bantu format dan simbol (Requirement 9.8).
      var toolbar = el('div', { class: 'btn-group markup-toolbar', role: 'toolbar', 'aria-label': 'Bantu format dan simbol' },
        TOMBOL_FORMAT.map(function (t) {
          return el('button', { type: 'button', class: 'btn btn-sm', 'data-aksi': 'format', 'data-kind': t.kind,
            title: t.judul, 'aria-label': t.judul }, t.label);
        }).concat(TOMBOL_SIMBOL.map(function (s) {
          return el('button', { type: 'button', class: 'btn btn-sm', 'data-aksi': 'format', 'data-kind': 'sym:' + s.kode,
            title: s.judul, 'aria-label': s.judul }, markup.TABEL_SIMBOL[s.kode]);
        })));
      var bantuan = el('p', { class: 'markup-help' }, [
        'Pilih kolom teks lalu tekan tombol. Notasi: ',
        el('code', { text: '[b]tebal[/b]' }), ' ', el('code', { text: '[u]garis bawah[/u]' }), ' ',
        el('code', { text: '[i]miring[/i]' }), ' ', el('code', { text: 'x[sup]2[/sup]' }), ' ',
        el('code', { text: 'H[sub]2[/sub]O' }), ' ', el('code', { text: '[akar]x[/akar]' }), ' ',
        el('code', { text: '[frac]1|2[/frac]' }), ' ', el('code', { text: '{{kali}}' }), '. Enter = baris baru.'
      ]);

      input.teks = areaMarkup('teks', 'soal-teks', 5);
      input.urlGambar = el('input', { type: 'url', id: 'soal-urlGambar', name: 'urlGambar', autocomplete: 'off',
        inputmode: 'url', placeholder: 'https://...' });

      var opsiRows = HURUF.map(function (L) {
        input['opsi' + L] = areaMarkup('opsi' + L, 'soal-opsi' + L, 2);
        return el('div', { class: 'field', 'data-opsi-baris': L }, [
          label('soal-opsi' + L, 'Opsi ' + L),
          input['opsi' + L],
          pesanErr('opsi' + L)
        ]);
      });
      var opsiWrap = el('fieldset', { class: 'stack', 'data-field': 'opsi', 'data-bagian': 'opsi' },
        [el('legend', { text: 'Opsi jawaban (kosongkan opsi yang tidak dipakai)' })].concat(opsiRows, [pesanErr('opsi')]));
      var bsInfo = el('div', { class: 'field', 'data-bagian': 'opsi-bs', hidden: true }, [
        el('span', { class: 'field-label', text: 'Opsi jawaban' }),
        el('p', { class: 'field-hint', text: 'Soal Benar/Salah selalu memakai dua opsi tetap: "Benar" dan "Salah".' })
      ]);

      var kunciPilihan = HURUF.map(function (L) {
        return el('input', { type: 'radio', name: 'kunciPilihan', value: L, id: 'soal-kunci-' + L });
      });
      var kunciPilihanWrap = el('div', { class: 'btn-group', 'data-bagian': 'kunci-pilihan' }, kunciPilihan.map(function (inp, i) {
        return el('label', { for: inp.id }, [inp, ' ' + HURUF[i]]);
      }));
      var kunciBS = OPSI_BS.map(function (x) {
        return el('input', { type: 'radio', name: 'kunciBS', value: x.kunci, id: 'soal-kunci-bs-' + x.kunci });
      });
      var kunciBSWrap = el('div', { class: 'btn-group', 'data-bagian': 'kunci-bs', hidden: true }, kunciBS.map(function (inp, i) {
        return el('label', { for: inp.id }, [inp, ' ' + OPSI_BS[i].teks]);
      }));
      var kunciHint = el('span', { class: 'field-hint' });
      var kunciWrap = el('fieldset', { class: 'field', 'data-field': 'kunci' }, [
        el('legend', null, ['Kunci jawaban', el('span', { class: 'required', 'aria-hidden': 'true' }, ' *')]),
        kunciPilihanWrap, kunciBSWrap, kunciHint, pesanErr('kunci')
      ]);

      input.pembahasan = areaMarkup('pembahasan', 'soal-pembahasan', 3);
      input.bobot = el('input', { type: 'number', id: 'soal-bobot', name: 'bobot', min: 0, max: 100, step: 'any',
        inputmode: 'decimal', autocomplete: 'off' });

      var btnSimpan = el('button', { type: 'submit', class: 'btn btn-primary', 'data-aksi': 'simpan' }, 'Simpan');
      var btnPratinjau = el('button', { type: 'button', class: 'btn', 'data-aksi': 'pratinjau' }, 'Pratinjau');
      var btnBatal = el('button', { type: 'button', class: 'btn', 'data-aksi': 'batal' }, 'Batal');

      var form = el('form', { class: 'form stack', novalidate: true, 'data-form': 'soal' }, [
        el('div', { class: 'field' }, [label('soal-tipe', 'Tipe soal', true), input.tipe, pesanErr('tipe')]),
        el('div', { class: 'field' }, [toolbar, bantuan]),
        el('div', { class: 'field' }, [label('soal-teks', 'Teks soal', true), input.teks,
          el('span', { class: 'field-hint', text: 'Paling banyak 5.000 karakter.' }), pesanErr('teks')]),
        el('div', { class: 'field' }, [label('soal-urlGambar', 'URL gambar (opsional)'), input.urlGambar,
          el('span', { class: 'field-hint', text: 'Harus diawali https://, paling banyak 2.000 karakter.' }), pesanErr('urlGambar')]),
        opsiWrap,
        bsInfo,
        kunciWrap,
        el('div', { class: 'field' }, [label('soal-pembahasan', 'Pembahasan (opsional)'), input.pembahasan, pesanErr('pembahasan')]),
        el('div', { class: 'field' }, [label('soal-bobot', 'Bobot nilai', true), input.bobot,
          el('span', { class: 'field-hint', text: 'Angka lebih dari 0 dan paling besar 100.' }), pesanErr('bobot')]),
        el('div', { class: 'btn-group' }, [btnSimpan, btnPratinjau, btnBatal])
      ]);

      var pratinjauWrap = el('section', { class: 'stack', hidden: true, 'data-bagian': 'pratinjau', 'aria-labelledby': 'soal-pratinjau-judul' });

      formWrap.appendChild(el('div', { class: 'card-header' }, judulForm));
      formWrap.appendChild(el('div', { class: 'card-body' }, [form, pratinjauWrap]));

      function tipeSekarang() {
        return input.tipe.value;
      }

      /** Menyesuaikan form dengan Tipe_Soal tanpa membuang isian lain. */
      function terapkanTipe() {
        var tipe = tipeSekarang();
        var bs = tipe === 'BS';
        opsiWrap.hidden = bs;
        bsInfo.hidden = !bs;
        kunciPilihanWrap.hidden = bs;
        kunciBSWrap.hidden = !bs;
        var jenis = tipe === 'PGK' ? 'checkbox' : 'radio';
        var adaTercentang = false;
        kunciPilihan.forEach(function (inp) {
          var dicentang = inp.checked;
          if (inp.type !== jenis) inp.type = jenis;
          // Radio hanya boleh satu pilihan: pertahankan centang pertama.
          if (jenis === 'radio') {
            inp.checked = dicentang && !adaTercentang;
            if (dicentang) adaTercentang = true;
          }
        });
        ui.setTeks(kunciHint, bs ? 'Pilih Benar atau Salah.'
          : tipe === 'PGK' ? 'Pilih dua atau lebih huruf opsi yang benar.' : 'Pilih tepat satu huruf opsi yang benar.');
        if (bs && state.fieldAktif && state.fieldAktif.name && state.fieldAktif.name.indexOf('opsi') === 0) {
          state.fieldAktif = null;
        }
      }
      input.tipe.addEventListener('change', terapkanTipe);

      /** Membaca isian form tanpa mengubahnya (dipakai simpan dan pratinjau). */
      function bacaForm() {
        var tipe = tipeSekarang();
        var opsi = {};
        HURUF.forEach(function (L) { opsi[L] = input['opsi' + L].value; });
        var kunci = [];
        if (tipe === 'BS') {
          kunciBS.forEach(function (inp) { if (inp.checked) kunci.push(inp.value); });
        } else {
          kunciPilihan.forEach(function (inp) { if (inp.checked) kunci.push(inp.value); });
        }
        var data = {
          kodeMapel: state.edit ? state.edit.kodeMapel : state.kodeMapel,
          tipe: tipe,
          teks: input.teks.value,
          urlGambar: input.urlGambar.value,
          opsi: opsi,
          kunci: kunci,
          pembahasan: input.pembahasan.value,
          bobot: input.bobot.value
        };
        if (state.edit) data.idSoal = state.edit.idSoal;
        return data;
      }

      function isiForm(soal) {
        var s = soal || {};
        input.tipe.value = LABEL_TIPE[s.tipe] ? s.tipe : 'PG';
        input.teks.value = s.teks || '';
        input.urlGambar.value = s.urlGambar || '';
        HURUF.forEach(function (L) {
          input['opsi' + L].value = s.tipe !== 'BS' && s.opsi && s.opsi[L] ? String(s.opsi[L]) : '';
        });
        var kunci = Array.isArray(s.kunci) ? s.kunci : [];
        kunciPilihan.forEach(function (inp) { inp.type = s.tipe === 'PGK' ? 'checkbox' : 'radio'; });
        kunciPilihan.forEach(function (inp) { inp.checked = s.tipe !== 'BS' && kunci.indexOf(inp.value) >= 0; });
        kunciBS.forEach(function (inp) { inp.checked = s.tipe === 'BS' && kunci.indexOf(inp.value) >= 0; });
        input.pembahasan.value = s.pembahasan || '';
        input.bobot.value = s.bobot === null || s.bobot === undefined ? '1' : String(s.bobot);
        terapkanTipe();
      }

      function nomorSoal() {
        if (state.edit) {
          for (var i = 0; i < state.items.length; i++) {
            if (state.items[i].idSoal === state.edit.idSoal) return i + 1;
          }
        }
        return state.items.length + 1;
      }

      function bukaForm(soal) {
        tutupPratinjau(false);
        ui.bersihkanError(form);
        state.mode = soal ? 'ubah' : 'tambah';
        state.edit = soal || null;
        state.fieldAktif = null;
        ui.setTeks(judulForm, soal ? 'Ubah Soal No. ' + nomorSoal() : 'Tambah Soal');
        isiForm(soal);
        formWrap.hidden = false;
        input.teks.focus();
      }

      function tutupForm() {
        tutupPratinjau(false);
        ui.bersihkanError(form);
        form.reset();
        state.mode = null;
        state.edit = null;
        state.fieldAktif = null;
        formWrap.hidden = true;
      }

      /* ---------- toolbar format ---------- */

      form.addEventListener('focusin', function (ev) {
        var t = ev.target;
        if (t && t.getAttribute && t.getAttribute('data-markup') === '1') state.fieldAktif = t;
      });

      function terapkanFormat(kind) {
        var f = state.fieldAktif;
        if (!f || f.closest('[hidden]')) f = input.teks;
        var mulai = typeof f.selectionStart === 'number' ? f.selectionStart : f.value.length;
        var akhir = typeof f.selectionEnd === 'number' ? f.selectionEnd : mulai;
        var r = markup.insertMarkup(f.value, mulai, akhir, kind);
        f.value = r.value;
        f.focus();
        if (typeof f.setSelectionRange === 'function') f.setSelectionRange(r.selStart, r.selEnd);
        state.fieldAktif = f;
      }

      toolbar.addEventListener('mousedown', function (ev) {
        // Pertahankan fokus dan seleksi kolom teks saat tombol ditekan.
        if (ev.target && ev.target.closest && ev.target.closest('[data-aksi="format"]')) ev.preventDefault();
      });
      toolbar.addEventListener('click', function (ev) {
        var btn = ev.target && ev.target.closest ? ev.target.closest('[data-aksi="format"]') : null;
        if (btn) terapkanFormat(btn.getAttribute('data-kind'));
      });

      /* ---------- pratinjau ---------- */

      function bukaPratinjau() {
        ui.bersihkanError(form);
        var data = bacaForm();
        if (trim(data.teks) === '') {
          // Requirement 10.10: pratinjau tidak dibuka, isian tetap utuh.
          ui.tandaiError(form, { teks: ['Teks soal wajib diisi sebelum pratinjau.'] });
          ui.toast('Teks soal wajib diisi sebelum pratinjau.', 'error');
          return false;
        }
        hentikanTimer();
        ui.kosongkan(pratinjauWrap);
        var btnTutup = el('button', { type: 'button', class: 'btn btn-primary', 'data-aksi': 'tutup-pratinjau' }, 'Tutup pratinjau');
        btnTutup.addEventListener('click', function () { tutupPratinjau(true); });
        var judul = el('h3', { class: 'card-title', id: 'soal-pratinjau-judul', tabindex: '-1', text: 'Pratinjau Soal (belum disimpan)' });
        pratinjauWrap.appendChild(el('div', { class: 'page-header' }, [judul, el('div', { class: 'page-actions' }, btnTutup)]));
        pratinjauWrap.appendChild(el('div', { class: 'soal-preview' },
          buatPratinjau(ui, data, { nomor: nomorSoal(), timers: state.timers })));
        form.hidden = true;
        pratinjauWrap.hidden = false;
        judul.focus();
        return true;
      }

      function tutupPratinjau(fokus) {
        hentikanTimer();
        if (pratinjauWrap.hidden && !form.hidden) return;
        ui.kosongkan(pratinjauWrap);
        pratinjauWrap.hidden = true;
        form.hidden = false;
        if (fokus) btnPratinjau.focus();
      }

      btnPratinjau.addEventListener('click', bukaPratinjau);

      /* ---------- simpan ---------- */

      function simpan() {
        ui.bersihkanError(form);
        var hasil = ambilGlobal('CBTValidator').validateSoal(bacaForm());
        if (!hasil.valid) {
          ui.tandaiError(form, hasil.errors);
          ui.toast(ui.pesanError('VALIDASI').teks, 'error');
          return Promise.resolve();
        }
        var ubah = state.mode === 'ubah';
        var nilai = hasil.value;
        if (ubah) nilai.idSoal = state.edit.idSoal;
        return ui.withBusy(btnSimpan, function () {
          return ubah ? api.updateSoal(nilai) : api.createSoal(nilai);
        }).then(function (env) {
          if (!ctx.aktif()) return undefined;
          if (!env || !env.ok) {
            // Isian dipertahankan dan daftar tidak diubah (Requirement 8.10, 8.12).
            var info = ui.tanganiError(env && env.error ? env.error : 'ERROR_UMUM', { form: form, toast: false });
            ui.toast((ubah ? 'Penyimpanan perubahan Soal gagal. ' : 'Penyimpanan Soal gagal. ') + info.teks, 'error');
            return undefined;
          }
          ui.toast(ubah ? 'Perubahan Soal berhasil disimpan.' : 'Soal berhasil ditambahkan.', 'sukses');
          if (env.data && env.data.perluHitungUlang === true) {
            ui.toast('Kunci jawaban berubah. Buka halaman Mata Pelajaran lalu pilih "Hitung ulang nilai" untuk Mapel ini.', 'peringatan');
          }
          tutupForm();
          return muatSoal();
        });
      }

      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        simpan();
      });
      btnBatal.addEventListener('click', tutupForm);
      btnTambah.addEventListener('click', function () { bukaForm(null); });

      /* ---------- hapus ---------- */

      function hapus(soal, nomor, btn) {
        return ui.konfirmasi({
          judul: 'Hapus Soal',
          pesan: 'Hapus Soal No. ' + nomor + ' (' + soal.tipe + '): "' + markup.cuplikan(soal.teks, 100) +
            '"? Tindakan ini tidak dapat dibatalkan.',
          ya: 'Hapus',
          tidak: 'Batal',
          bahaya: true
        }).then(function (ya) {
          if (!ya || !ctx.aktif()) return undefined;
          return ui.withBusy(btn, function () {
            return api.deleteSoal({ idSoal: soal.idSoal });
          }).then(function (env) {
            if (!ctx.aktif()) return;
            if (!env || !env.ok) {
              var err = env && env.error ? env.error : 'ERROR_UMUM';
              if (err && err.code === 'KONFLIK') {
                ui.toast(PESAN_KONFLIK_HAPUS, 'error'); // Requirement 8.13
              } else {
                ui.toast('Penghapusan Soal gagal. ' + ui.pesanError(err).teks, 'error'); // Requirement 8.12
              }
              return;
            }
            state.items = state.items.filter(function (s) { return s.idSoal !== soal.idSoal; });
            if (state.edit && state.edit.idSoal === soal.idSoal) tutupForm();
            renderDaftar();
            ui.toast('Soal No. ' + nomor + ' dihapus.', 'sukses');
          });
        });
      }

      /* ---------- daftar ---------- */

      function barisSoal(s, i) {
        var nomor = i + 1;
        var btnUbah = el('button', { type: 'button', class: 'btn btn-sm', 'data-aksi': 'ubah' }, 'Ubah');
        var btnHapus = el('button', { type: 'button', class: 'btn btn-sm btn-danger', 'data-aksi': 'hapus' }, 'Hapus');
        btnUbah.addEventListener('click', function () { bukaForm(s); });
        btnHapus.addEventListener('click', function () { hapus(s, nomor, btnHapus); });
        return el('tr', { dataset: { id: s.idSoal } }, [
          el('td', { class: 'col-num', text: String(nomor) }),
          el('td', { class: 'wrap', text: markup.cuplikan(s.teks, 100) }),
          el('td', { text: String(s.tipe) }),
          el('td', { class: 'col-num', text: String(s.bobot) }),
          el('td', null, el('div', { class: 'table-actions' }, [btnUbah, btnHapus]))
        ]);
      }

      function namaMapel(kode) {
        for (var i = 0; i < state.mapel.length; i++) {
          if (state.mapel[i].kodeMapel === kode) return state.mapel[i].namaMapel;
        }
        return kode;
      }

      function renderDaftar() {
        ui.kosongkan(daftarWrap);
        if (state.items.length === 0) {
          daftarWrap.appendChild(el('div', { class: 'card-body' },
            el('p', { class: 'empty-state', text: 'Belum ada Soal untuk Mapel ' + namaMapel(state.kodeMapel) +
              '. Pilih "Tambah Soal" untuk membuat Soal baru.' })));
          return;
        }
        var kolom = ['No.', 'Cuplikan soal', 'Tipe', 'Bobot', 'Aksi'];
        daftarWrap.appendChild(el('div', { class: 'table-wrap' },
          el('table', { class: 'table' }, [
            el('thead', null, el('tr', null, kolom.map(function (k) { return el('th', { scope: 'col', text: k }); }))),
            el('tbody', null, state.items.map(barisSoal))
          ])));
      }

      function renderGagal(teks, error, ulang) {
        ui.kosongkan(daftarWrap);
        var btnUlang = el('button', { type: 'button', class: 'btn btn-primary', 'data-aksi': 'muat-ulang' }, 'Coba lagi');
        btnUlang.addEventListener('click', function () { ui.withBusy(btnUlang, ulang); });
        daftarWrap.appendChild(el('div', { class: 'card-body stack' }, [
          el('div', { class: 'alert alert-danger', role: 'alert', text: teks + ' ' + ui.pesanError(error).teks }),
          btnUlang
        ]));
      }

      function muatSoal() {
        var ke = ++state.muatKe;
        var kode = state.kodeMapel;
        btnTambah.disabled = true;
        ui.kosongkan(daftarWrap);
        var sembunyikan = ui.tampilkanLoading(daftarWrap, 'Memuat daftar Soal...');
        return Promise.resolve(api.listSoal({ kodeMapel: kode })).then(function (env) {
          sembunyikan();
          if (!ctx.aktif() || ke !== state.muatKe) return;
          if (!env || !env.ok) {
            renderGagal('Gagal memuat daftar Soal.', env && env.error ? env.error : 'ERROR_UMUM', muatSoal);
            return;
          }
          state.items = env.data && Array.isArray(env.data.items) ? env.data.items : [];
          btnTambah.disabled = false;
          renderDaftar();
        });
      }

      pilihMapel.addEventListener('change', function () {
        state.kodeMapel = pilihMapel.value;
        tutupForm();
        muatSoal();
      });

      function muatMapel() {
        var sembunyikan = ui.tampilkanLoading(daftarWrap, 'Memuat daftar Mapel...');
        return Promise.resolve(api.listMapel()).then(function (env) {
          sembunyikan();
          if (!ctx.aktif()) return undefined;
          if (!env || !env.ok) {
            renderGagal('Gagal memuat daftar Mapel.', env && env.error ? env.error : 'ERROR_UMUM', muatMapel);
            return undefined;
          }
          state.mapel = env.data && Array.isArray(env.data.items) ? env.data.items : [];
          ui.kosongkan(pilihMapel);
          ui.kosongkan(daftarWrap);
          if (state.mapel.length === 0) {
            pilihMapel.disabled = true;
            daftarWrap.appendChild(el('div', { class: 'card-body' },
              el('p', { class: 'empty-state', text: 'Belum ada Mapel. Tambahkan Mapel terlebih dahulu di halaman Mata Pelajaran.' })));
            return undefined;
          }
          state.mapel.forEach(function (m) {
            pilihMapel.appendChild(el('option', { value: m.kodeMapel, text: m.kodeMapel + ' – ' + m.namaMapel }));
          });
          var awal = params && params.kodeMapel && state.mapel.some(function (m) { return m.kodeMapel === params.kodeMapel; })
            ? params.kodeMapel : state.mapel[0].kodeMapel;
          pilihMapel.value = awal;
          pilihMapel.disabled = false;
          state.kodeMapel = awal;
          return muatSoal();
        });
      }

      return muatMapel();
    }
  };

  if (root) {
    var CBT = root.CBT = root.CBT || {};
    CBT.pages = CBT.pages || {};
    CBT.pages['admin/soal'] = page;
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = page;
})(typeof window !== 'undefined' ? window : null);
