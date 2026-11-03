/*
 * pages/admin-laporan.js — Halaman rekap nilai untuk Admin (#/admin/laporan).
 * Requirement 14.8, 14.9, 14.10, 21.12, 21.13, 23.1–23.11, 27.4.
 *
 * - Dua jenis rekap: per Mapel (api.rekapMapel → CBTRekap.buildRekapMapel)
 *   dan per Peserta (api.rekapPeserta → CBTRekap.buildRekapPeserta). Pilihan
 *   Mapel dan Peserta diambil dari api.listMapel dan api.listPeserta.
 * - Rekap per Mapel: filter kelas/jenjang (opsi "Semua" = seluruh baris) dan
 *   ringkasan jumlah selesai, rata-rata, tertinggi, terendah dari baris yang
 *   lolos filter (23.3, 23.4, 23.6).
 * - Tabel di layar, CSV (CBTCsv.printCsv), dan XLSX (CBTXlsx.buildXlsx) memakai
 *   keluaran CBTRekap.rekapToTable yang sama (23.7, 23.8, 23.9). Nama file dari
 *   CBTRekap.namaFileEkspor (23.11). File dibuat utuh di memori sebelum
 *   diunduh; bila pembuatan gagal tidak ada unduhan dan tabel serta filter
 *   tetap (23.10). Paginasi 50 baris hanya membagi tampilan; ekspor memuat
 *   seluruh baris yang lolos filter, dengan urutan yang sama.
 * - Reset Sesi: dialog menyebut nama Peserta dan nama Mapel (14.8); konfirmasi
 *   → api.resetSesi lalu rekap dimuat ulang (14.9); batal → tidak ada request
 *   (14.10).
 * - "Hitung ulang nilai" tampil bila Mapel ditandai perluHitungUlang (21.12);
 *   hasilnya menampilkan jumlah Sesi yang dinilai ulang (21.13).
 * - Klik baris yang memiliki Sesi → #/admin/detail/{idSesi}.
 *
 * Tidak ada innerHTML: semua elemen dibuat lewat ctx.ui.el (teks aman).
 */
(function (root) {
  'use strict';

  var UKURAN_HALAMAN = 50;
  var MIME_CSV = 'text/csv;charset=utf-8';
  var MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  var PESAN_EKSPOR_GAGAL = 'Ekspor gagal. File tidak diunduh. Coba lagi, atau gunakan browser lain bila masalah berlanjut.';

  /* global CBTRekap, CBTCsv, CBTXlsx, CBTDatetime, require */
  function lib(nama, path) {
    if (nama === 'CBTRekap' && typeof CBTRekap !== 'undefined') return CBTRekap;
    if (nama === 'CBTCsv' && typeof CBTCsv !== 'undefined') return CBTCsv;
    if (nama === 'CBTXlsx' && typeof CBTXlsx !== 'undefined') return CBTXlsx;
    if (nama === 'CBTDatetime' && typeof CBTDatetime !== 'undefined') return CBTDatetime;
    if (root && root[nama]) return root[nama];
    if (typeof require === 'function') {
      try { return require(path); } catch (e) { /* tidak tersedia */ }
    }
    return null;
  }
  function R() { return lib('CBTRekap', '../shared/rekap.js'); }
  function DT() { return lib('CBTDatetime', '../shared/datetime.js'); }

  function str(v) { return v === null || v === undefined ? '' : String(v); }

  function errorDari(env) {
    if (env && env.ok === false && env.error && typeof env.error === 'object') return env.error;
    return { code: 'ERROR_UMUM' };
  }

  function bandingId(a, b) {
    var rk = R();
    return rk ? rk.compareId(a, b) : (str(a) < str(b) ? -1 : (str(a) > str(b) ? 1 : 0));
  }

  /**
   * Model rekap per Mapel dari data mentah Backend
   * `{mapel, rows: PesertaView + {sesi, hasil}}` (lihat LaporanService.gs).
   * @param {object} data
   * @param {string|null} filterKelas null/'' = Semua
   */
  function modelRekapMapel(data, filterKelas) {
    var rows = (data && Array.isArray(data.rows)) ? data.rows : [];
    var sesiByPeserta = {};
    var hasilBySesi = {};
    var idSesiByKunci = {};
    rows.forEach(function (r) {
      if (!r) return;
      var id = str(r.id);
      if (r.sesi) {
        sesiByPeserta[id] = r.sesi;
        idSesiByKunci[id] = str(r.sesi.idSesi);
        if (r.hasil) hasilBySesi[str(r.sesi.idSesi)] = r.hasil;
      }
    });
    var rekap = R().buildRekapMapel(rows, sesiByPeserta, hasilBySesi, filterKelas || null);
    return { rekap: rekap, idSesiByKunci: idSesiByKunci };
  }

  /**
   * Model rekap per Peserta dari data mentah Backend
   * `{peserta, rows: {kodeMapel, namaMapel, statusAktif, sesi, hasil}[]}`.
   */
  function modelRekapPeserta(data) {
    var rows = (data && Array.isArray(data.rows)) ? data.rows : [];
    var sesiByMapel = {};
    var hasilBySesi = {};
    var idSesiByKunci = {};
    rows.forEach(function (r) {
      if (!r) return;
      var kode = str(r.kodeMapel);
      if (r.sesi) {
        sesiByMapel[kode] = r.sesi;
        idSesiByKunci[kode] = str(r.sesi.idSesi);
        if (r.hasil) hasilBySesi[str(r.sesi.idSesi)] = r.hasil;
      }
    });
    var rekap = R().buildRekapPeserta(rows, sesiByMapel, hasilBySesi);
    return { rekap: rekap, idSesiByKunci: idSesiByKunci };
  }

  /** Daftar kelas unik (tanpa kosong) dari baris mentah rekap per Mapel. */
  function daftarKelas(data) {
    var lihat = {};
    var out = [];
    ((data && data.rows) || []).forEach(function (r) {
      var k = str(r && r.kelas);
      if (k === '' || Object.prototype.hasOwnProperty.call(lihat, k)) return;
      lihat[k] = true;
      out.push(k);
    });
    return out.sort(function (a, b) { return a.localeCompare(b, undefined, { numeric: true }); });
  }

  /**
   * Membuat isi file ekspor secara utuh. Melempar error bila gagal, sehingga
   * pemanggil tidak pernah mengunduh file sebagian (Requirement 23.10).
   * @param {object} rekap keluaran buildRekapMapel/buildRekapPeserta
   * @param {string} id kode mapel atau ID peserta
   * @param {'csv'|'xlsx'} ext
   * @param {number} ms waktu ekspor
   * @returns {{nama:string, data:(string|Uint8Array), mime:string}}
   */
  function buatFileEkspor(rekap, id, ext, ms) {
    var tabel = R().rekapToTable(rekap);
    var nama = R().namaFileEkspor('rekap', id, ms, ext);
    if (ext === 'csv') {
      var csv = lib('CBTCsv', '../shared/csv.js');
      if (!csv) throw new Error('Modul CSV tidak tersedia');
      return { nama: nama, data: csv.printCsv(tabel.header, tabel.rows), mime: MIME_CSV };
    }
    var xlsx = lib('CBTXlsx', '../shared/xlsx.js');
    if (!xlsx) throw new Error('Modul XLSX tidak tersedia');
    return { nama: nama, data: xlsx.buildXlsx('Rekap ' + id, tabel.header, tabel.rows), mime: MIME_XLSX };
  }

  var page = {
    modelRekapMapel: modelRekapMapel,
    modelRekapPeserta: modelRekapPeserta,
    daftarKelas: daftarKelas,
    buatFileEkspor: buatFileEkspor,

    render: function (container, params, ctx) {
      var ui = ctx.ui;
      var api = ctx.api;
      var el = ui.el;

      var state = {
        jenis: 'mapel',          // 'mapel' | 'peserta'
        mapelList: [],
        pesertaList: [],
        target: { mapel: '', peserta: '' },
        data: null,              // data mentah rekap terakhir (env.data)
        dataJenis: null,
        filterKelas: '',         // '' = Semua
        page: 1,
        model: null,             // {rekap, idSesiByKunci}
        urutMuat: 0,
        dimuatPada: null
      };

      /* ---------- kerangka ---------- */

      var btnBeranda = el('button', { type: 'button', class: 'btn', 'data-aksi': 'beranda',
        onclick: function () { ctx.navigate('#/admin'); } }, 'Kembali ke beranda');

      var pilihJenis = el('select', { id: 'laporan-jenis', name: 'jenis', 'data-kontrol': 'jenis' }, [
        el('option', { value: 'mapel', text: 'Per Mapel' }),
        el('option', { value: 'peserta', text: 'Per Peserta' })
      ]);
      var labelTarget = el('label', { class: 'field-label', for: 'laporan-target', text: 'Mapel' });
      var pilihTarget = el('select', { id: 'laporan-target', name: 'target', 'data-kontrol': 'target' });
      var pilihKelas = el('select', { id: 'laporan-kelas', name: 'kelas', 'data-kontrol': 'kelas' });
      var fieldKelas = el('div', { class: 'field' }, [
        el('label', { class: 'field-label', for: 'laporan-kelas', text: 'Kelas/jenjang' }),
        pilihKelas
      ]);

      var btnMuat = el('button', { type: 'button', class: 'btn', 'data-aksi': 'muat-ulang' }, 'Muat ulang');
      var btnCsv = el('button', { type: 'button', class: 'btn', 'data-aksi': 'ekspor-csv', disabled: true }, 'Ekspor CSV');
      var btnXlsx = el('button', { type: 'button', class: 'btn', 'data-aksi': 'ekspor-xlsx', disabled: true }, 'Ekspor Excel');
      var btnHitung = el('button', { type: 'button', class: 'btn btn-primary', 'data-aksi': 'hitung-ulang', hidden: true },
        'Hitung ulang nilai');

      var kontrolWrap = el('section', { class: 'card', 'aria-label': 'Pilihan rekap' }, el('div', { class: 'card-body' }, [
        el('div', { class: 'form-row' }, [
          el('div', { class: 'field' }, [
            el('label', { class: 'field-label', for: 'laporan-jenis', text: 'Jenis rekap' }),
            pilihJenis
          ]),
          el('div', { class: 'field' }, [labelTarget, pilihTarget]),
          fieldKelas
        ]),
        el('div', { class: 'btn-group toolbar' }, [btnMuat, btnCsv, btnXlsx, btnHitung])
      ]));
      var ringkasanWrap = el('section', { class: 'stats-grid', 'aria-label': 'Ringkasan rekap', hidden: true });
      var infoWaktu = el('p', { class: 'text-muted', 'data-info': 'dimuat', hidden: true });
      var tabelWrap = el('section', { class: 'card', 'aria-label': 'Tabel rekap' });

      container.appendChild(el('div', { class: 'container stack' }, [
        el('div', { class: 'page-header' }, [
          el('h1', { class: 'page-title', text: 'Laporan Nilai' }),
          el('div', { class: 'page-actions' }, [btnBeranda])
        ]),
        kontrolWrap,
        ringkasanWrap,
        infoWaktu,
        tabelWrap
      ]));

      /* ---------- pilihan ---------- */

      function isiPilihTarget() {
        ui.kosongkan(pilihTarget);
        var mapel = state.jenis === 'mapel';
        ui.setTeks(labelTarget, mapel ? 'Mapel' : 'Peserta');
        var list = mapel ? state.mapelList : state.pesertaList;
        list.forEach(function (x) {
          var id = mapel ? str(x.kodeMapel) : str(x.id);
          var nama = mapel ? str(x.namaMapel) : str(x.nama);
          pilihTarget.appendChild(el('option', { value: id, text: id + ' \u2013 ' + nama }));
        });
        var kunci = state.target[state.jenis];
        var ada = list.some(function (x) { return str(mapel ? x.kodeMapel : x.id) === kunci; });
        if (!ada) kunci = list.length ? str(mapel ? list[0].kodeMapel : list[0].id) : '';
        state.target[state.jenis] = kunci;
        pilihTarget.value = kunci;
        pilihTarget.disabled = list.length === 0;
        fieldKelas.hidden = !mapel;
      }

      function isiPilihKelas() {
        ui.kosongkan(pilihKelas);
        pilihKelas.appendChild(el('option', { value: '', text: 'Semua' }));
        var kelas = state.dataJenis === 'mapel' ? daftarKelas(state.data) : [];
        kelas.forEach(function (k) { pilihKelas.appendChild(el('option', { value: k, text: k })); });
        if (kelas.indexOf(state.filterKelas) === -1) state.filterKelas = '';
        pilihKelas.value = state.filterKelas;
      }

      function mapelTerpilih() {
        var kode = state.target.mapel;
        var dariRekap = state.dataJenis === 'mapel' && state.data && state.data.mapel ? state.data.mapel : null;
        var dariList = null;
        state.mapelList.forEach(function (m) { if (str(m.kodeMapel) === kode) dariList = m; });
        return { kodeMapel: kode, info: dariRekap || dariList };
      }

      /* ---------- tampilan ---------- */

      function hitungModel() {
        if (!state.data) { state.model = null; return; }
        state.model = state.dataJenis === 'mapel'
          ? modelRekapMapel(state.data, state.filterKelas)
          : modelRekapPeserta(state.data);
      }

      function statCard(label, nilai, kunci) {
        return el('div', { class: 'stat-card', 'data-ringkasan': kunci }, [
          el('span', { class: 'stat-label', text: label }),
          el('span', { class: 'stat-value', text: String(nilai) })
        ]);
      }

      function renderRingkasan() {
        ui.kosongkan(ringkasanWrap);
        var model = state.model;
        if (!model || state.dataJenis !== 'mapel') { ringkasanWrap.hidden = true; return; }
        var r = model.rekap.ringkasan;
        ringkasanWrap.appendChild(statCard('Jumlah selesai', r.jumlahSelesai, 'jumlah-selesai'));
        ringkasanWrap.appendChild(statCard('Nilai rata-rata', r.rataRata, 'rata-rata'));
        ringkasanWrap.appendChild(statCard('Nilai tertinggi', r.tertinggi, 'tertinggi'));
        ringkasanWrap.appendChild(statCard('Nilai terendah', r.terendah, 'terendah'));
        ringkasanWrap.hidden = false;
      }

      function kelasStatus(status) {
        var rk = R();
        if (status === rk.STATUS_SELESAI) return 'badge status-selesai';
        if (status === rk.STATUS_AKTIF) return 'badge status-sedang';
        return 'badge status-belum';
      }

      function namaPesertaBaris(rowObj) {
        if (state.dataJenis === 'mapel') return str(rowObj.nama);
        var p = state.data && state.data.peserta;
        return str(p && p.nama) || state.target.peserta;
      }
      function namaMapelBaris(rowObj) {
        if (state.dataJenis === 'peserta') return str(rowObj.namaMapel);
        var m = mapelTerpilih().info;
        return str(m && m.namaMapel) || state.target.mapel;
      }

      function barisTabel(sel, rowObj) {
        var mapel = state.dataJenis === 'mapel';
        var kunci = mapel ? str(rowObj.idPeserta) : str(rowObj.kodeMapel);
        var idSesi = state.model.idSesiByKunci[kunci] || '';
        var idxStatus = mapel ? 3 : 2;
        var tds = sel.map(function (teks, i) {
          if (i === idxStatus) return el('td', null, el('span', { class: kelasStatus(teks), text: teks }));
          return el('td', { class: i >= 6 || (!mapel && i === 3) ? 'col-num' : null, text: teks });
        });
        var aksi = [];
        if (idSesi) {
          var btnReset = el('button', { type: 'button', class: 'btn btn-sm btn-danger', 'data-aksi': 'reset' }, 'Reset sesi');
          btnReset.addEventListener('click', function (ev) {
            ev.stopPropagation();
            resetSesi(rowObj, btnReset);
          });
          aksi.push(btnReset);
        }
        tds.push(el('td', null, el('div', { class: 'table-actions' }, aksi)));
        var tr = el('tr', { dataset: { kunci: kunci, idSesi: idSesi || null } }, tds);
        if (idSesi) {
          tr.setAttribute('tabindex', '0');
          tr.setAttribute('title', 'Lihat detail jawaban');
          tr.style.cursor = 'pointer';
          var buka = function () { ctx.navigate('#/admin/detail/' + encodeURIComponent(idSesi)); };
          tr.addEventListener('click', buka);
          tr.addEventListener('keydown', function (ev) {
            if (ev.target === tr && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); buka(); }
          });
        }
        return tr;
      }

      function renderTabel() {
        ui.kosongkan(tabelWrap);
        var model = state.model;
        if (!model) return;
        var tabel = R().rekapToTable(model.rekap);
        var hal = R().paginate(model.rekap.rows, state.page, UKURAN_HALAMAN);
        state.page = hal.page;
        var awal = (hal.page - 1) * UKURAN_HALAMAN;
        var body = hal.items.map(function (rowObj, i) {
          return barisTabel(tabel.rows[awal + i], rowObj);
        });
        if (tabel.rows.length === 0) {
          body = [el('tr', null, el('td', { colspan: tabel.header.length + 1, class: 'empty-state',
            text: state.dataJenis === 'mapel' ? 'Tidak ada Peserta yang sesuai filter.' : 'Tidak ada Mapel aktif.' }))];
        }
        tabelWrap.appendChild(el('div', { class: 'table-wrap' },
          el('table', { class: 'table', 'data-tabel': 'rekap' }, [
            el('thead', null, el('tr', null, tabel.header.concat(['Aksi']).map(function (k) {
              return el('th', { scope: 'col', text: k });
            }))),
            el('tbody', null, body)
          ])));
        if (hal.totalPages > 1) {
          tabelWrap.appendChild(ui.paginasi({
            page: hal.page,
            totalPages: hal.totalPages,
            onChange: function (p) { state.page = p; renderTabel(); }
          }));
        }
      }

      function renderTombol() {
        var siap = !!state.model;
        btnCsv.disabled = !siap;
        btnXlsx.disabled = !siap;
        var m = mapelTerpilih().info;
        btnHitung.hidden = !(state.jenis === 'mapel' && state.dataJenis === 'mapel' && m && m.perluHitungUlang === true);
      }

      function renderInfoWaktu() {
        var dt = DT();
        if (!state.model || state.dimuatPada === null || !dt) { infoWaktu.hidden = true; return; }
        ui.setTeks(infoWaktu, 'Data dimuat pada ' + dt.formatJakarta(state.dimuatPada) + ' WIB.');
        infoWaktu.hidden = false;
      }

      function renderSemua() {
        hitungModel();
        renderRingkasan();
        renderTabel();
        renderTombol();
        renderInfoWaktu();
      }

      function renderPesan(teks, denganUlang) {
        ui.kosongkan(tabelWrap);
        var isi = [el('div', { class: denganUlang ? 'alert alert-danger' : 'empty-state',
          role: denganUlang ? 'alert' : null, text: teks })];
        if (denganUlang) {
          var btnUlang = el('button', { type: 'button', class: 'btn btn-primary', 'data-aksi': 'coba-lagi' }, 'Coba lagi');
          btnUlang.addEventListener('click', function () { ui.withBusy(btnUlang, denganUlang); });
          isi.push(btnUlang);
        }
        tabelWrap.appendChild(el('div', { class: 'card-body stack' }, isi));
      }

      function kosongkanRekap() {
        state.data = null;
        state.dataJenis = null;
        state.model = null;
        state.dimuatPada = null;
        ringkasanWrap.hidden = true;
        renderTombol();
        renderInfoWaktu();
      }

      /* ---------- muat ---------- */

      function muatRekap() {
        var jenis = state.jenis;
        var kunci = state.target[jenis];
        var nomor = ++state.urutMuat;
        if (!kunci) {
          kosongkanRekap();
          renderPesan(jenis === 'mapel' ? 'Belum ada Mapel. Tambahkan Mapel terlebih dahulu.'
            : 'Belum ada Peserta. Tambahkan Peserta terlebih dahulu.', null);
          return Promise.resolve();
        }
        var sembunyikan = ui.tampilkanLoading(tabelWrap, 'Memuat rekap...');
        var req = Promise.resolve(jenis === 'mapel'
          ? api.rekapMapel({ kodeMapel: kunci })
          : api.rekapPeserta({ idPeserta: kunci })).then(function (env) {
          sembunyikan();
          return env;
        }, function () {
          sembunyikan();
          return { ok: false, data: null, error: { code: 'ERROR_UMUM' } };
        });
        // Request selalu dikirim untuk pilihan terbaru; withBusy hanya
        // menandai tombol "Muat ulang" sibuk (Requirement 26.12). Respons
        // usang diabaikan lewat nomor urut.
        ui.withBusy(btnMuat, req);
        return req.then(function (env) {
          if (!ctx.aktif() || nomor !== state.urutMuat) return;
          if (!env || !env.ok) {
            kosongkanRekap();
            renderPesan('Gagal memuat rekap. ' + ui.pesanError(errorDari(env)).teks, muatRekap);
            return;
          }
          var gantiTarget = state.dataJenis !== jenis || state.dataKunci !== kunci;
          state.data = env.data || {};
          state.dataJenis = jenis;
          state.dataKunci = kunci;
          state.dimuatPada = Date.now();
          if (gantiTarget) { state.page = 1; }
          isiPilihKelas();
          renderSemua();
        });
      }

      function muatAwal() {
        var sembunyikan = ui.tampilkanLoading(tabelWrap, 'Memuat daftar Mapel dan Peserta...');
        return Promise.all([
          Promise.resolve(api.listMapel()),
          Promise.resolve(api.listPeserta())
        ]).then(function (hasil) {
          sembunyikan();
          if (!ctx.aktif()) return undefined;
          var envMapel = hasil[0];
          var envPeserta = hasil[1];
          if (!envMapel || !envMapel.ok || !envPeserta || !envPeserta.ok) {
            var gagal = !envMapel || !envMapel.ok ? envMapel : envPeserta;
            renderPesan('Gagal memuat daftar Mapel dan Peserta. ' + ui.pesanError(errorDari(gagal)).teks, muatAwal);
            return undefined;
          }
          state.mapelList = ((envMapel.data && envMapel.data.items) || []).slice()
            .sort(function (a, b) { return bandingId(a.kodeMapel, b.kodeMapel); });
          state.pesertaList = ((envPeserta.data && envPeserta.data.items) || []).slice()
            .sort(function (a, b) { return bandingId(a.id, b.id); });
          isiPilihTarget();
          isiPilihKelas();
          return muatRekap();
        }, function () {
          sembunyikan();
          if (!ctx.aktif()) return;
          renderPesan('Gagal memuat daftar Mapel dan Peserta. ' + ui.pesanError('ERROR_UMUM').teks, muatAwal);
        });
      }

      /* ---------- aksi ---------- */

      function ekspor(ext, btn) {
        if (!state.model) return Promise.resolve();
        return ui.withBusy(btn, function () {
          var berkas;
          try {
            berkas = buatFileEkspor(state.model.rekap, state.target[state.dataJenis], ext, Date.now());
          } catch (e) {
            berkas = null;
          }
          // Tabel dan filter tidak diubah apa pun hasilnya (Requirement 23.10).
          var terunduh = false;
          if (berkas) {
            try {
              terunduh = ui.unduh(berkas.nama, berkas.data, berkas.mime) !== false;
            } catch (e) {
              terunduh = false;
            }
          }
          if (!terunduh) {
            ui.toast(PESAN_EKSPOR_GAGAL, 'error');
            return false;
          }
          ui.toast('File ' + berkas.nama + ' berhasil dibuat.', 'sukses');
          return true;
        });
      }

      function resetSesi(rowObj, btn) {
        var mapel = state.dataJenis === 'mapel';
        var idPeserta = mapel ? str(rowObj.idPeserta) : state.dataKunci;
        var kodeMapel = mapel ? state.dataKunci : str(rowObj.kodeMapel);
        var namaPeserta = namaPesertaBaris(rowObj);
        var namaMapel = namaMapelBaris(rowObj);
        return ui.konfirmasi({
          judul: 'Reset sesi ujian',
          pesan: 'Reset sesi ujian ' + namaPeserta + ' (' + idPeserta + ') untuk Mapel ' + namaMapel +
            ' (' + kodeMapel + ')? Sesi ujian, seluruh jawaban, dan hasil Peserta ini pada Mapel tersebut akan dihapus, ' +
            'sehingga Peserta dapat mengerjakan ulang dari awal. Tindakan ini tidak dapat dibatalkan.',
          ya: 'Reset',
          tidak: 'Batal',
          bahaya: true
        }).then(function (ya) {
          if (!ya || !ctx.aktif()) return undefined;
          return ui.withBusy(btn, function () {
            return api.resetSesi({ idPeserta: idPeserta, kodeMapel: kodeMapel });
          }).then(function (env) {
            if (!ctx.aktif()) return undefined;
            if (!env || !env.ok) {
              ui.tanganiError(errorDari(env));
              return undefined;
            }
            ui.toast('Sesi ujian ' + namaPeserta + ' untuk Mapel ' + namaMapel + ' berhasil direset.', 'sukses');
            return muatRekap();
          });
        });
      }

      function hitungUlang() {
        var kode = state.dataKunci;
        return ui.withBusy(btnHitung, function () {
          return api.hitungUlang({ kodeMapel: kode });
        }).then(function (env) {
          if (!ctx.aktif()) return undefined;
          if (!env || !env.ok) {
            ui.tanganiError(errorDari(env));
            return undefined;
          }
          var jumlah = env.data && typeof env.data.jumlahDinilaiUlang === 'number' ? env.data.jumlahDinilaiUlang : 0;
          ui.toast('Nilai Mapel ' + kode + ' dihitung ulang: ' + jumlah + ' sesi ujian berhasil dinilai ulang.', 'sukses');
          state.mapelList.forEach(function (m) { if (str(m.kodeMapel) === kode) m.perluHitungUlang = false; });
          return muatRekap();
        });
      }

      pilihJenis.addEventListener('change', function () {
        state.jenis = pilihJenis.value === 'peserta' ? 'peserta' : 'mapel';
        isiPilihTarget();
        muatRekap();
      });
      pilihTarget.addEventListener('change', function () {
        state.target[state.jenis] = pilihTarget.value;
        muatRekap();
      });
      pilihKelas.addEventListener('change', function () {
        state.filterKelas = pilihKelas.value;
        state.page = 1;
        renderSemua();
      });
      btnMuat.addEventListener('click', function () { muatRekap(); });
      btnCsv.addEventListener('click', function () { ekspor('csv', btnCsv); });
      btnXlsx.addEventListener('click', function () { ekspor('xlsx', btnXlsx); });
      btnHitung.addEventListener('click', function () { hitungUlang(); });

      return muatAwal();
    }
  };

  if (root) {
    var CBT = root.CBT = root.CBT || {};
    CBT.pages = CBT.pages || {};
    CBT.pages['admin/laporan'] = page;
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = page;
})(typeof window !== 'undefined' ? window : null);
