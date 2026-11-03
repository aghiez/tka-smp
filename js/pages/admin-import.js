/*
 * pages/admin-import.js — Halaman import CSV Peserta dan Soal (#/admin/import).
 * Requirement 6.1, 6.2, 6.5, 6.7, 6.8, 6.9, 6.10, 12.1, 12.3, 12.6, 12.7,
 * 12.8, 12.9.
 *
 * Alur per tab (Peserta / Soal):
 *   1. Unduh Template_CSV dari templates/ (6.1, 12.1).
 *   2. Pilih file. Ditolak tanpa pratinjau dan tanpa request bila bukan .csv,
 *      > 1 MB, > 2.000 baris data, kolom wajib hilang, tidak ada baris data,
 *      atau Parser_CSV mengembalikan error (6.7, 6.8, 12.7, 12.8).
 *   3. Pratinjau per baris: nomor baris, nilai kolom (password tersamar),
 *      status valid/tidak valid, dan seluruh alasan, lewat
 *      CBTValidator.validateImportRows dengan data pembanding dari
 *      api.getUserKeys (Peserta) atau api.listMapel (Soal) (6.2, 12.3).
 *   4. Tombol konfirmasi (data-aksi="konfirmasi") nonaktif bila tidak ada
 *      baris valid (6.9, 12.8). Konfirmasi mengirim seluruh baris; Backend
 *      memvalidasi ulang dan mengembalikan ringkasan {berhasil, gagal, errors}
 *      yang ditampilkan (6.5, 12.6).
 *   5. Gagal → pesan "import gagal", pratinjau dipertahankan, tombol
 *      konfirmasi tetap aktif untuk mencoba lagi (6.10, 12.9).
 *
 * Helper murni (periksaFile, periksaParse, keBarisImport, samarkan) diekspor
 * di objek halaman untuk pengujian. Tidak ada innerHTML.
 */
(function (root) {
  'use strict';

  var MAKS_UKURAN_BYTE = 1024 * 1024; // 1 MB
  var MAKS_BARIS = 2000;
  var MAKS_TAMPIL_SEL = 80;
  var SAMARAN = '\u2022\u2022\u2022\u2022\u2022\u2022';

  var JENIS = {
    peserta: {
      kunci: 'peserta',
      label: 'Peserta',
      kolom: ['id_peserta', 'nama_lengkap', 'kelas', 'username', 'password', 'status_aktif'],
      rahasia: { password: true },
      template: 'templates/template_peserta.csv',
      namaTemplate: 'template_peserta.csv',
      aksiApi: 'importPeserta',
      satuan: 'Peserta'
    },
    soal: {
      kunci: 'soal',
      label: 'Soal',
      kolom: ['kode_mapel', 'tipe', 'teks_soal', 'url_gambar', 'opsi_a', 'opsi_b', 'opsi_c',
        'opsi_d', 'opsi_e', 'kunci', 'pembahasan', 'bobot'],
      rahasia: {},
      template: 'templates/template_soal.csv',
      namaTemplate: 'template_soal.csv',
      aksiApi: 'importSoal',
      satuan: 'Soal'
    }
  };

  function lib(nama) {
    if (nama === 'CBTValidator' && typeof CBTValidator !== 'undefined') return CBTValidator; // eslint-disable-line no-undef
    if (nama === 'CBTCsv' && typeof CBTCsv !== 'undefined') return CBTCsv; // eslint-disable-line no-undef
    return root ? root[nama] : null;
  }

  function angka(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }

  function ukuranTeks(byte) {
    if (byte >= MAKS_UKURAN_BYTE) return (byte / MAKS_UKURAN_BYTE).toFixed(2).replace('.', ',') + ' MB';
    return Math.ceil(byte / 1024) + ' KB';
  }

  /**
   * Pemeriksaan file sebelum dibaca (Requirement 6.7, 12.7).
   * @param {{name:string, size:number}} file
   * @returns {null|{batas:'file'|'ekstensi'|'ukuran', pesan:string}} null jika lolos
   */
  function periksaFile(file) {
    if (!file) return { batas: 'file', pesan: 'Pilih file CSV terlebih dahulu.' };
    var nama = String(file.name || '');
    if (!/\.csv$/i.test(nama)) {
      return { batas: 'ekstensi', pesan: 'File "' + nama + '" ditolak: file harus berekstensi .csv.' };
    }
    var size = Number(file.size) || 0;
    if (size > MAKS_UKURAN_BYTE) {
      return { batas: 'ukuran', pesan: 'File ditolak: ukuran ' + ukuranTeks(size) + ' melebihi batas maksimal 1 MB.' };
    }
    return null;
  }

  /**
   * Memeriksa hasil parseCsv (Requirement 6.8, 6.7, 12.7, 12.8).
   * @returns {{ok:true, rows:Array}|{ok:false, batas:string, pesan:string}}
   */
  function periksaParse(parsed) {
    if (!parsed || parsed.ok !== true) {
      var e = (parsed && parsed.error) || {};
      if (e.kind === 'MISSING_COLUMNS') {
        return { ok: false, batas: 'kolom', pesan: 'File ditolak: kolom wajib tidak ditemukan: ' + (e.missing || []).join(', ') + '.' };
      }
      if (e.kind === 'EMPTY') {
        return { ok: false, batas: 'kosong', pesan: 'File ditolak: file kosong atau tidak memiliki baris header.' };
      }
      return { ok: false, batas: 'format', pesan: 'File ditolak: ' + (e.message || 'format CSV tidak dapat dibaca.') };
    }
    var n = parsed.rows.length;
    if (n === 0) {
      return { ok: false, batas: 'kosong', pesan: 'File ditolak: file tidak berisi data setelah baris header.' };
    }
    if (n > MAKS_BARIS) {
      return { ok: false, batas: 'baris', pesan: 'File ditolak: berisi ' + angka(n) +
        ' baris data, melebihi batas maksimal ' + angka(MAKS_BARIS) + ' baris data.' };
    }
    return { ok: true, rows: parsed.rows };
  }

  /**
   * Hasil parseCsv → [{line, values}] dengan values hanya berisi kolom wajib,
   * dipetakan berdasarkan nama header (ter-trim, kemunculan pertama).
   */
  function keBarisImport(parsed, kolom) {
    var idx = {};
    (parsed.header || []).forEach(function (h, i) {
      var k = '#' + String(h).trim();
      if (!Object.prototype.hasOwnProperty.call(idx, k)) idx[k] = i;
    });
    return (parsed.rows || []).map(function (r) {
      var values = {};
      kolom.forEach(function (c) {
        var i = idx['#' + c];
        values[c] = i === undefined ? '' : String(r.fields[i] === undefined ? '' : r.fields[i]);
      });
      return { line: r.line, values: values };
    });
  }

  /** Password ditampilkan tersamar dengan panjang tetap (Requirement 6.2). */
  function samarkan(v) {
    return v === null || v === undefined || String(v) === '' ? '' : SAMARAN;
  }

  function potong(s) {
    var t = String(s === null || s === undefined ? '' : s);
    return t.length > MAKS_TAMPIL_SEL ? t.slice(0, MAKS_TAMPIL_SEL - 1) + '\u2026' : t;
  }

  /** Membaca File sebagai teks UTF-8. */
  function bacaTeks(file) {
    if (file && typeof file.text === 'function') return Promise.resolve(file.text());
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result || '')); };
      r.onerror = function () { reject(r.error || new Error('Gagal membaca file')); };
      r.readAsText(file, 'utf-8');
    });
  }

  var page = {
    JENIS: JENIS,
    MAKS_UKURAN_BYTE: MAKS_UKURAN_BYTE,
    MAKS_BARIS: MAKS_BARIS,
    periksaFile: periksaFile,
    periksaParse: periksaParse,
    keBarisImport: keBarisImport,
    samarkan: samarkan,

    render: function (container, params, ctx) {
      var ui = ctx.ui;
      var api = ctx.api;
      var el = ui.el;

      // seq dinaikkan setiap ganti tab/file agar hasil async lama diabaikan.
      var state = { jenis: JENIS.peserta, seq: 0, rows: null, hasil: null };

      /* ---------- kerangka ---------- */

      var btnBeranda = el('button', { type: 'button', class: 'btn', 'data-aksi': 'beranda',
        onclick: function () { ctx.navigate('#/admin'); } }, 'Kembali ke beranda');

      var tabBtn = {};
      var tabList = el('div', { class: 'btn-group', role: 'tablist', 'aria-label': 'Jenis data import' },
        Object.keys(JENIS).map(function (k) {
          tabBtn[k] = el('button', {
            type: 'button', class: 'btn', role: 'tab', id: 'import-tab-' + k,
            'aria-controls': 'import-panel', 'data-tab': k,
            onclick: function () { pilihTab(k); }
          }, JENIS[k].label);
          return tabBtn[k];
        }));

      var judulPanel = el('h2', { class: 'card-title', id: 'import-judul' });
      var linkTemplate = el('a', { class: 'btn', 'data-aksi': 'unduh-template' }, 'Unduh template CSV');
      var hintKolom = el('span', { class: 'field-hint' });
      var inputFile = el('input', {
        type: 'file', id: 'import-file', name: 'file', accept: '.csv,text/csv', 'data-aksi': 'pilih-file'
      });
      var pesanWrap = el('div', { 'data-area': 'pesan', 'aria-live': 'polite' });
      var pratinjauWrap = el('div', { class: 'stack', 'data-area': 'pratinjau' });
      var btnKonfirmasi = el('button', { type: 'button', class: 'btn btn-primary', 'data-aksi': 'konfirmasi', disabled: true },
        'Konfirmasi import');
      var ringkasanWrap = el('div', { class: 'stack', 'data-area': 'ringkasan', 'aria-live': 'polite' });

      var panel = el('section', { class: 'card', id: 'import-panel', role: 'tabpanel', 'aria-labelledby': 'import-judul' }, [
        el('div', { class: 'card-header' }, judulPanel),
        el('div', { class: 'card-body stack' }, [
          el('ol', { class: 'import-steps' }, [
            el('li', null, ['Unduh template, isi data sesuai kolom template. ', linkTemplate]),
            el('li', null, el('div', { class: 'field' }, [
              el('label', { class: 'field-label', for: 'import-file', text: 'Pilih file CSV (maks. 1 MB, 2.000 baris data)' }),
              inputFile,
              hintKolom
            ])),
            el('li', { text: 'Periksa pratinjau, lalu pilih "Konfirmasi import". Hanya baris valid yang disimpan.' })
          ]),
          pesanWrap,
          pratinjauWrap,
          el('div', { class: 'btn-group' }, btnKonfirmasi),
          ringkasanWrap
        ])
      ]);

      container.appendChild(el('div', { class: 'container stack' }, [
        el('div', { class: 'page-header' }, [
          el('h1', { class: 'page-title', text: 'Import CSV' }),
          el('div', { class: 'page-actions' }, btnBeranda)
        ]),
        tabList,
        panel
      ]));

      /* ---------- helper tampilan ---------- */

      function alert(jenis, teks, tanda) {
        return el('div', { class: 'alert alert-' + jenis, role: jenis === 'danger' ? 'alert' : 'status',
          'data-pesan': tanda || null, text: teks });
      }

      function setPesan(jenis, teks, tanda) {
        ui.kosongkan(pesanWrap);
        if (teks) pesanWrap.appendChild(alert(jenis, teks, tanda));
      }

      function resetPratinjau() {
        state.rows = null;
        state.hasil = null;
        ui.kosongkan(pratinjauWrap);
        btnKonfirmasi.disabled = true;
      }

      function jumlahValid() {
        return state.hasil ? state.hasil.filter(function (r) { return r.valid; }).length : 0;
      }

      /* ---------- tab ---------- */

      function pilihTab(k) {
        state.jenis = JENIS[k];
        state.seq++;
        Object.keys(tabBtn).forEach(function (t) {
          var aktif = t === k;
          tabBtn[t].className = aktif ? 'btn btn-primary' : 'btn';
          tabBtn[t].setAttribute('aria-selected', aktif ? 'true' : 'false');
        });
        panel.setAttribute('aria-labelledby', 'import-tab-' + k);
        panel.setAttribute('data-jenis', k);
        ui.setTeks(judulPanel, 'Import ' + state.jenis.label);
        linkTemplate.setAttribute('href', state.jenis.template);
        linkTemplate.setAttribute('download', state.jenis.namaTemplate);
        ui.setTeks(hintKolom, 'Kolom wajib: ' + state.jenis.kolom.join(', ') + '.');
        inputFile.value = '';
        setPesan(null, '');
        resetPratinjau();
        ui.kosongkan(ringkasanWrap);
      }

      /* ---------- pilih file ---------- */

      function muatPembanding(jenis) {
        if (jenis.kunci === 'peserta') {
          return Promise.resolve(api.getUserKeys()).then(function (env) {
            if (!env || !env.ok) return { error: env && env.error ? env.error : 'ERROR_UMUM' };
            var d = env.data || {};
            return { ctx: { jenis: 'peserta', existingIds: d.ids || [], existingUsernames: d.usernames || [] } };
          });
        }
        return Promise.resolve(api.listMapel()).then(function (env) {
          if (!env || !env.ok) return { error: env && env.error ? env.error : 'ERROR_UMUM' };
          var items = env.data && Array.isArray(env.data.items) ? env.data.items : [];
          return { ctx: { jenis: 'soal', kodeMapelSet: items.map(function (m) { return m.kodeMapel; }) } };
        });
      }

      function prosesFile(file) {
        var seq = ++state.seq;
        var jenis = state.jenis;
        setPesan(null, '');
        resetPratinjau();
        ui.kosongkan(ringkasanWrap);
        if (!file) return Promise.resolve();

        var tolak = periksaFile(file);
        if (tolak) {
          setPesan('danger', tolak.pesan, 'tolak-' + tolak.batas);
          return Promise.resolve();
        }
        var sembunyikan = ui.tampilkanLoading(pratinjauWrap, 'Membaca file...');
        function masihBerlaku() { return ctx.aktif() && seq === state.seq; }

        return bacaTeks(file).then(function (teks) {
          if (!masihBerlaku()) return undefined;
          var parsed = lib('CBTCsv').parseCsv(teks, { requiredColumns: jenis.kolom });
          var cek = periksaParse(parsed);
          if (!cek.ok) {
            sembunyikan();
            setPesan('danger', cek.pesan, 'tolak-' + cek.batas);
            return undefined;
          }
          var rows = keBarisImport(parsed, jenis.kolom);
          return muatPembanding(jenis).then(function (p) {
            sembunyikan();
            if (!masihBerlaku()) return;
            if (p.error) {
              setPesan('danger', 'Gagal memuat data pembanding untuk pratinjau. ' + ui.pesanError(p.error).teks, 'gagal-pembanding');
              return;
            }
            state.rows = rows;
            state.hasil = lib('CBTValidator').validateImportRows(rows, p.ctx);
            renderPratinjau();
          });
        }, function () {
          sembunyikan();
          if (!masihBerlaku()) return;
          setPesan('danger', 'File tidak dapat dibaca. Pastikan file CSV tidak rusak lalu pilih ulang.', 'tolak-baca');
        });
      }

      inputFile.addEventListener('change', function () {
        var f = inputFile.files && inputFile.files.length > 0 ? inputFile.files[0] : null;
        prosesFile(f);
      });

      /* ---------- pratinjau ---------- */

      function nilaiSel(jenis, kolom, v) {
        if (jenis.rahasia[kolom]) return samarkan(v);
        return potong(v);
      }

      function renderPratinjau() {
        var jenis = state.jenis;
        ui.kosongkan(pratinjauWrap);
        var total = state.hasil.length;
        var valid = jumlahValid();
        pratinjauWrap.appendChild(el('p', { 'data-info': 'jumlah',
          text: 'Pratinjau ' + angka(total) + ' baris data: ' + angka(valid) + ' valid, ' + angka(total - valid) + ' tidak valid.' }));
        if (valid === 0) {
          pratinjauWrap.appendChild(alert('warning', 'Tidak ada baris yang dapat diimpor. Perbaiki file lalu pilih ulang.', 'tidak-ada-valid'));
        }
        var kolomHead = ['Baris'].concat(jenis.kolom, ['Status', 'Alasan']);
        var body = state.hasil.map(function (h, i) {
          var values = state.rows[i].values;
          var sel = [el('td', { class: 'col-num', text: String(h.line) })];
          jenis.kolom.forEach(function (c) {
            var full = values[c];
            var terpotong = !jenis.rahasia[c] && String(full).length > MAKS_TAMPIL_SEL;
            sel.push(el('td', { 'data-kolom': c, title: terpotong ? full : null,
              text: nilaiSel(jenis, c, full) }));
          });
          sel.push(el('td', null, h.valid
            ? el('span', { class: 'badge badge-success', text: 'Valid' })
            : el('span', { class: 'badge badge-danger', text: 'Tidak valid' })));
          sel.push(el('td', { class: 'wrap', 'data-kolom': 'alasan', text: h.alasan.join('; ') }));
          return el('tr', { dataset: { line: h.line, valid: h.valid ? '1' : '0' } }, sel);
        });
        pratinjauWrap.appendChild(el('div', { class: 'table-wrap' },
          el('table', { class: 'table', 'aria-label': 'Pratinjau import ' + jenis.label }, [
            el('thead', null, el('tr', null, kolomHead.map(function (k) { return el('th', { scope: 'col', text: k }); }))),
            el('tbody', null, body)
          ])));
        btnKonfirmasi.disabled = valid === 0;
      }

      /* ---------- konfirmasi ---------- */

      function renderRingkasan(d, total) {
        ui.kosongkan(ringkasanWrap);
        var berhasil = Number(d.berhasil) || 0;
        var gagal = Number(d.gagal) || 0;
        var errors = Array.isArray(d.errors) ? d.errors : [];
        ringkasanWrap.appendChild(el('h3', { text: 'Ringkasan import' }));
        ringkasanWrap.appendChild(el('div', { class: 'import-summary' }, [
          el('span', { class: 'badge badge-success', 'data-ringkasan': 'berhasil', text: 'Berhasil disimpan: ' + angka(berhasil) }),
          el('span', { class: 'badge ' + (gagal > 0 ? 'badge-danger' : 'badge-muted'), 'data-ringkasan': 'gagal', text: 'Gagal: ' + angka(gagal) }),
          el('span', { class: 'badge badge-muted', 'data-ringkasan': 'total', text: 'Baris data di file: ' + angka(total) })
        ]));
        if (errors.length > 0) {
          ringkasanWrap.appendChild(el('ul', { class: 'import-errors', 'data-ringkasan': 'errors' },
            errors.map(function (e) {
              var alasan = Array.isArray(e.alasan) ? e.alasan.join('; ') : String(e.alasan || '');
              return el('li', { dataset: { line: e.line }, text: 'Baris ' + e.line + ': ' + alasan });
            })));
        }
      }

      function konfirmasi() {
        if (!state.rows || jumlahValid() === 0) return Promise.resolve();
        var seq = state.seq;
        var jenis = state.jenis;
        var rows = state.rows;
        ui.kosongkan(ringkasanWrap);
        setPesan(null, '');
        return ui.withBusy(btnKonfirmasi, function () {
          return api[jenis.aksiApi]({ rows: rows });
        }).then(function (env) {
          if (!ctx.aktif() || seq !== state.seq) return;
          if (!env || !env.ok) {
            // Pratinjau dipertahankan agar Admin dapat mengonfirmasi ulang (6.10, 12.9).
            var info = ui.tanganiError(env && env.error ? env.error : 'ERROR_UMUM');
            setPesan('danger', 'Import gagal. Tidak ada data yang tersimpan. ' + info.teks +
              ' Pratinjau tetap tersedia; pilih "Konfirmasi import" untuk mencoba lagi.', 'import-gagal');
            return;
          }
          var d = env.data || {};
          renderRingkasan(d, rows.length);
          ui.toast('Import ' + jenis.label + ' selesai: ' + angka(Number(d.berhasil) || 0) + ' ' + jenis.satuan +
            ' berhasil disimpan.', 'sukses');
          state.seq++;
          resetPratinjau();
          inputFile.value = '';
        });
      }

      btnKonfirmasi.addEventListener('click', function () { konfirmasi(); });

      pilihTab(params && JENIS[params.jenis] ? params.jenis : 'peserta');
      return undefined;
    }
  };

  if (root) {
    var CBT = root.CBT = root.CBT || {};
    CBT.pages = CBT.pages || {};
    CBT.pages['admin/import'] = page;
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = page;
})(typeof window !== 'undefined' ? window : null);
