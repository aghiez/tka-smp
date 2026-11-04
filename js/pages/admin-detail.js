/*
 * pages/admin-detail.js — Detail jawaban satu Sesi_Ujian untuk Admin
 * (#/admin/detail/{idSesi}).
 * Requirement 9.10, 24.1, 24.2, 24.4, 24.5, 24.6, 24.7, 24.9, 24.10, 24.11.
 *
 * Data: ctx.api.detailJawaban({idSesi}) → DetailJawaban (design.md §2):
 *   { ringkasan: {idSesi, idPeserta, kodeMapel, namaPeserta, namaMapel,
 *                 waktuMulai, waktuSelesai, benar, salah, kosong,
 *                 totalBobotDiperoleh, skor},
 *     items: [{no, idSoal, dihapus, tipe?, teks?, urlGambar?, opsi?: [{huruf, teks}],
 *              jawaban: string[], kunci?: string[], status, bobotDiperoleh, pembahasan?}] }
 * Jawaban dan kunci sudah berupa huruf opsi pada urutan asli Soal (BS: B/S).
 *
 * - Ringkasan di atas memakai angka dari Backend apa adanya (baris Hasil),
 *   dengan format yang sama dengan tabel rekap: skor dua desimal, waktu
 *   DD/MM/YYYY HH:mm Asia/Jakarta (24.4).
 * - Daftar Soal sesuai urutan `items` (= urutan Sesi), memakai kelas yang sama
 *   dengan pratinjau admin-soal/Halaman_Ujian (.ujian-soal, .soal-teks,
 *   .soal-gambar, .opsi-list) (24.1, 24.2). Teks soal, opsi, dan pembahasan
 *   dirender lewat CBTMarkup.renderHtml (9.10, 24.5).
 * - Soal yang sudah dihapus tetap tampil dengan ID soal, jawaban, status, dan
 *   bobot yang tercatat, serta keterangan dihapus (24.6).
 * - Sesi AKTIF / tanpa Hasil (Backend: KONFLIK) → pesan belum selesai dinilai,
 *   tanpa detail (24.7).
 * - Gagal muat (termasuk batas waktu 30 detik di api.js) → pesan error dan
 *   tombol "Coba lagi" di bagian detail saja. `muat()` bisa dipasang di dalam
 *   halaman rekap sehingga rekap tetap tampil (24.9); pada rute mandiri
 *   tombol "Kembali ke rekap nilai" selalu tersedia.
 * - Ekspor CSV (CBTCsv.printCsv) satu baris per Soal dengan urutan tampilan,
 *   nama file `detail_{ID peserta}_{kode mapel}_{YYYYMMDD}.csv` (24.10, 24.11).
 *
 * Satu-satunya pemakaian innerHTML adalah keluaran CBTMarkup.renderHtml, yang
 * meng-escape seluruh teks masukan. Elemen lain dibuat lewat ctx.ui.el.
 */
(function (root) {
  'use strict';

  var KOSONG = '-';
  var TEKS_BS = { B: 'Benar', S: 'Salah' };
  var LABEL_STATUS = { BENAR: 'Benar', SALAH: 'Salah', KOSONG: 'Kosong' };
  var BADGE_STATUS = { BENAR: 'badge-success', SALAH: 'badge-danger', KOSONG: 'badge-muted' };
  var HEADER_CSV = ['No', 'ID Soal', 'Tipe Soal', 'Teks Soal', 'Jawaban Peserta',
    'Kunci Jawaban', 'Status', 'Bobot Diperoleh'];

  var BATAS_GAMBAR_MS = 10000;
  var PESAN_GAMBAR_GAGAL = 'Gambar tidak dapat dimuat';
  var PESAN_BELUM_DINILAI = 'Ujian belum selesai dinilai. Detail jawaban dapat dilihat setelah Peserta ' +
    'mengumpulkan ujian atau waktu ujian habis.';
  var PESAN_GAGAL = 'Detail jawaban gagal dimuat.';
  var PESAN_DIHAPUS = 'Soal ini sudah dihapus dari bank soal. Yang ditampilkan hanya data yang tercatat pada sesi ujian.';
  var PESAN_EKSPOR_GAGAL = 'Ekspor detail jawaban gagal. Tidak ada file yang diunduh. Coba lagi.';

  function ambilGlobal(nama) {
    /* eslint-disable no-undef */
    if (nama === 'CBTMarkup' && typeof CBTMarkup !== 'undefined') return CBTMarkup;
    if (nama === 'CBTCsv' && typeof CBTCsv !== 'undefined') return CBTCsv;
    if (nama === 'CBTRekap' && typeof CBTRekap !== 'undefined') return CBTRekap;
    if (nama === 'CBTDatetime' && typeof CBTDatetime !== 'undefined') return CBTDatetime;
    /* eslint-enable no-undef */
    return root ? root[nama] : undefined;
  }

  function str(v) {
    return v === null || v === undefined ? '' : String(v);
  }

  function toNumber(v) {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (typeof v === 'string' && v.trim() !== '') {
      var n = Number(v);
      return isFinite(n) ? n : null;
    }
    return null;
  }

  /** Pembulatan setengah ke atas dua desimal (sama dengan Penilai dan rekap). */
  function roundHalfUp2(x) {
    var r = Number(Math.round(Number(x + 'e2')) + 'e-2');
    return isFinite(r) ? r : Math.round(x * 100) / 100;
  }

  /** Skor dua desimal seperti tabel rekap, atau "-". */
  function fmtSkor(v) {
    var n = toNumber(v);
    return n === null ? KOSONG : roundHalfUp2(n).toFixed(2);
  }

  /** Bilangan (jumlah/bobot) tanpa galat float, atau "-". */
  function fmtAngka(v) {
    var n = toNumber(v);
    return n === null ? KOSONG : String(roundHalfUp2(n));
  }

  /** Waktu DD/MM/YYYY HH:mm Asia/Jakarta, atau "-". */
  function fmtWaktu(v) {
    var n = toNumber(v);
    var DT = ambilGlobal('CBTDatetime');
    if (n === null || !DT) return KOSONG;
    var s = DT.formatJakarta(n);
    return s === '' ? KOSONG : s;
  }

  function daftarHuruf(v) {
    return Array.isArray(v) ? v.map(str).filter(function (x) { return x !== ''; }) : [];
  }

  function statusSah(s) {
    var k = str(s).toUpperCase();
    return Object.prototype.hasOwnProperty.call(LABEL_STATUS, k) ? k : 'KOSONG';
  }

  /** Teks opsi asli untuk huruf `h` pada item (BS: Benar/Salah). */
  function teksOpsi(item, h) {
    if (item.tipe === 'BS') return Object.prototype.hasOwnProperty.call(TEKS_BS, h) ? TEKS_BS[h] : h;
    var opsi = Array.isArray(item.opsi) ? item.opsi : [];
    for (var i = 0; i < opsi.length; i++) {
      if (opsi[i] && str(opsi[i].huruf) === h) return str(opsi[i].teks);
    }
    return '';
  }

  /**
   * Teks polos jawaban/kunci untuk CSV dan pembaca layar: PG/PGK "A. teks; C. teks",
   * BS "Benar"/"Salah", Soal dihapus hanya huruf, kosong "-".
   */
  function teksPilihan(item, huruf) {
    var list = daftarHuruf(huruf);
    if (list.length === 0) return KOSONG;
    if (item.dihapus) return list.join(', ');
    if (item.tipe === 'BS') return list.map(function (h) { return teksOpsi(item, h); }).join(', ');
    return list.map(function (h) {
      var t = teksOpsi(item, h);
      return t === '' ? h : h + '. ' + t;
    }).join('; ');
  }

  /**
   * Tabel CSV detail jawaban (Requirement 24.10): satu baris per item dalam
   * urutan tampilan.
   * @param {object} detail DetailJawaban
   * @returns {{header:string[], rows:string[][]}}
   */
  function tabelDetail(detail) {
    var items = detail && Array.isArray(detail.items) ? detail.items : [];
    return {
      header: HEADER_CSV.slice(),
      rows: items.map(function (it, i) {
        var no = toNumber(it.no) === null ? i + 1 : it.no;
        return [
          str(no),
          str(it.idSoal),
          it.dihapus ? KOSONG : str(it.tipe),
          it.dihapus ? 'Soal sudah dihapus' : str(it.teks),
          teksPilihan(it, it.jawaban),
          it.dihapus ? KOSONG : teksPilihan(it, it.kunci),
          LABEL_STATUS[statusSah(it.status)],
          fmtAngka(it.bobotDiperoleh)
        ];
      })
    };
  }

  /** Nama file ekspor `detail_{ID peserta}_{kode mapel}_{YYYYMMDD}.csv` (Requirement 24.11). */
  function namaFile(detail, ms) {
    var r = (detail && detail.ringkasan) || {};
    return ambilGlobal('CBTRekap').namaFileEkspor('detail', [str(r.idPeserta), str(r.kodeMapel)], ms);
  }

  /** Mengisi node dengan HTML hasil Perender_Soal (aman: teks di-escape). */
  function isiMarkup(node, teks) {
    node.innerHTML = ambilGlobal('CBTMarkup').renderHtml(str(teks));
    return node;
  }

  /* ---------- bagian tampilan ---------- */

  function baris(el, label, nilai, field) {
    return [
      el('dt', { text: label }),
      el('dd', { 'data-field': field }, nilai)
    ];
  }

  /** Ringkasan atas (Requirement 24.4). */
  function buatRingkasan(ui, ringkasan) {
    var el = ui.el;
    var r = ringkasan || {};
    var kartu = function (field, label, nilai) {
      return el('div', { class: 'stat-card' }, [
        el('div', { class: 'stat-value', 'data-field': field, text: nilai }),
        el('div', { class: 'stat-label', text: label })
      ]);
    };
    return el('section', { class: 'card', 'data-bagian': 'ringkasan', 'aria-label': 'Ringkasan hasil' },
      el('div', { class: 'card-body stack' }, [
        el('dl', { class: 'detail-info' }, [].concat(
          baris(el, 'Nama Peserta', str(r.namaPeserta) || KOSONG, 'namaPeserta'),
          baris(el, 'Mata pelajaran', str(r.namaMapel) || KOSONG, 'namaMapel'),
          baris(el, 'Waktu mulai', fmtWaktu(r.waktuMulai), 'waktuMulai'),
          baris(el, 'Waktu selesai', fmtWaktu(r.waktuSelesai), 'waktuSelesai')
        )),
        el('div', { class: 'stats-grid' }, [
          kartu('benar', 'Benar', fmtAngka(r.benar)),
          kartu('salah', 'Salah', fmtAngka(r.salah)),
          kartu('kosong', 'Kosong', fmtAngka(r.kosong)),
          kartu('totalBobotDiperoleh', 'Total bobot diperoleh', fmtAngka(r.totalBobotDiperoleh)),
          kartu('skor', 'Skor', fmtSkor(r.skor))
        ])
      ]));
  }

  function buatGambar(ui, url, timers) {
    var el = ui.el;
    var wadah = el('div', { class: 'soal-gambar' });
    var img = el('img', { src: url, alt: 'Gambar soal', referrerpolicy: 'no-referrer' });
    var timer = null;
    var henti = function () { if (timer !== null) { clearTimeout(timer); timer = null; } };
    var gagal = function () {
      henti();
      if (wadah.getAttribute('data-status') === 'gagal') return;
      wadah.setAttribute('data-status', 'gagal');
      ui.kosongkan(wadah);
      wadah.appendChild(el('p', { class: 'gambar-gagal', role: 'note', text: PESAN_GAMBAR_GAGAL }));
    };
    img.addEventListener('error', gagal);
    img.addEventListener('load', function () { henti(); wadah.setAttribute('data-status', 'termuat'); });
    timer = setTimeout(function () {
      timer = null;
      if (!img.complete || !img.naturalWidth) gagal();
    }, BATAS_GAMBAR_MS);
    timers.push(henti);
    wadah.appendChild(img);
    return wadah;
  }

  /** Isi <dd> jawaban/kunci: huruf + teks opsi terformat (BS: Benar/Salah). */
  function isiPilihan(ui, item, huruf) {
    var el = ui.el;
    var list = daftarHuruf(huruf);
    if (list.length === 0) return el('span', { class: 'text-muted', text: 'Tidak dijawab' });
    if (item.dihapus || item.tipe === 'BS') return teksPilihan(item, list);
    return el('ul', { class: 'pilihan-list' }, list.map(function (h) {
      return el('li', null, [
        el('span', { class: 'opsi-huruf', text: h + '. ' }),
        isiMarkup(el('span', { class: 'opsi-teks' }), teksOpsi(item, h))
      ]);
    }));
  }

  /** Satu Soal pada detail jawaban (Requirement 24.1, 24.2, 24.5, 24.6). */
  function buatItem(ui, item, timers) {
    var el = ui.el;
    var it = item || {};
    var status = statusSah(it.status);
    var jawaban = daftarHuruf(it.jawaban);
    var kunci = daftarHuruf(it.kunci);

    var soal = el('article', {
      class: 'ujian-soal detail-soal',
      'data-id-soal': str(it.idSoal),
      'data-status': status,
      'data-dihapus': it.dihapus ? '1' : null,
      'data-tipe': it.dihapus ? null : str(it.tipe)
    });
    soal.appendChild(el('div', { class: 'soal-header' }, [
      el('h3', { class: 'soal-nomor', text: 'Soal No. ' + str(it.no) }),
      it.dihapus ? null : el('span', { class: 'badge badge-info', 'data-field': 'tipe', text: str(it.tipe) }),
      el('span', { class: ['badge', BADGE_STATUS[status]], 'data-field': 'status', text: LABEL_STATUS[status] })
    ]));

    var rincian = [].concat(baris(el, 'ID soal', str(it.idSoal), 'idSoal'));

    if (it.dihapus) {
      soal.appendChild(el('p', { class: 'alert alert-warning', 'data-field': 'dihapus', role: 'note', text: PESAN_DIHAPUS }));
      rincian = rincian.concat(baris(el, 'Jawaban peserta', isiPilihan(ui, it, jawaban), 'jawaban'));
    } else {
      soal.appendChild(isiMarkup(el('div', { class: 'soal-teks' }), it.teks));
      var url = str(it.urlGambar).trim();
      if (url !== '') soal.appendChild(buatGambar(ui, url, timers));

      var opsi = Array.isArray(it.opsi) ? it.opsi : [];
      var bs = it.tipe === 'BS';
      soal.appendChild(el('ul', { class: 'opsi-list', 'aria-label': 'Opsi jawaban' }, opsi.map(function (o) {
        var h = str(o && o.huruf);
        var dipilih = jawaban.indexOf(h) >= 0;
        var benar = kunci.indexOf(h) >= 0;
        var kelas = ['opsi'];
        if (dipilih) kelas.push('opsi-dipilih');
        if (benar) kelas.push('opsi-kunci');
        var isi = el('span', { class: 'opsi-teks' });
        if (bs) ui.setTeks(isi, teksOpsi(it, h));
        else isiMarkup(isi, o && o.teks);
        return el('li', { class: kelas, 'data-opsi': h, 'data-dipilih': dipilih ? '1' : null, 'data-kunci': benar ? '1' : null },
          el('div', { class: 'opsi-label' }, [
            bs ? null : el('span', { class: 'opsi-huruf', text: h + '.' }),
            isi,
            dipilih ? el('span', { class: 'badge badge-info', text: 'Jawaban peserta' }) : null,
            benar ? el('span', { class: 'badge badge-success kunci-tanda', text: 'Kunci jawaban' }) : null
          ]));
      })));

      rincian = rincian.concat(
        baris(el, 'Jawaban peserta', isiPilihan(ui, it, jawaban), 'jawaban'),
        baris(el, 'Kunci jawaban', isiPilihan(ui, it, kunci), 'kunci')
      );
    }
    rincian = rincian.concat(
      baris(el, 'Status', LABEL_STATUS[status], 'statusTeks'),
      baris(el, 'Bobot diperoleh', fmtAngka(it.bobotDiperoleh), 'bobotDiperoleh')
    );
    soal.appendChild(el('dl', { class: 'detail-info' }, rincian));

    if (!it.dihapus && str(it.pembahasan).trim() !== '') {
      soal.appendChild(el('section', { class: 'soal-pembahasan', 'aria-label': 'Pembahasan' }, [
        el('h4', { class: 'soal-pembahasan-judul', text: 'Pembahasan' }),
        isiMarkup(el('div', { class: 'soal-pembahasan-isi' }), it.pembahasan)
      ]));
    }
    return soal;
  }

  /* ---------- pemuatan ---------- */

  // Pembersih timer gambar milik render terakhir (dipanggil destroy()).
  var bersihkanAktif = null;

  /**
   * Memuat dan menampilkan detail jawaban ke `wadah`. Error dan pesan belum
   * dinilai hanya mengganti isi `wadah`, sehingga konten lain di halaman
   * (mis. rekap nilai) tetap tampil (Requirement 24.9).
   * @param {HTMLElement} wadah
   * @param {string} idSesi
   * @param {object} ctx {api, ui, aktif?}
   * @param {{onData?:function(object|null)}} [opsi] dipanggil dengan detail (atau null bila tidak ada)
   * @returns {{promise:Promise, ulang:function():Promise, hentikan:function()}}
   */
  function muat(wadah, idSesi, ctx, opsi) {
    var ui = ctx.ui;
    var el = ui.el;
    var o = opsi || {};
    var aktif = typeof ctx.aktif === 'function' ? ctx.aktif : function () { return true; };
    var timers = [];
    var ke = 0;

    function hentikan() {
      timers.forEach(function (f) { f(); });
      timers = [];
    }

    function kabari(data) {
      if (typeof o.onData === 'function') o.onData(data);
    }

    function tampilGagal(error) {
      var btn = el('button', { type: 'button', class: 'btn btn-primary', 'data-aksi': 'coba-lagi' }, 'Coba lagi');
      btn.addEventListener('click', function () { ui.withBusy(btn, ulang); });
      wadah.appendChild(el('div', { class: 'card', 'data-bagian': 'gagal' }, el('div', { class: 'card-body stack' }, [
        el('div', { class: 'alert alert-danger', role: 'alert', text: PESAN_GAGAL + ' ' + ui.pesanError(error).teks }),
        el('div', { class: 'btn-group' }, btn)
      ])));
    }

    function tampilBelumDinilai() {
      var btn = el('button', { type: 'button', class: 'btn', 'data-aksi': 'coba-lagi' }, 'Muat ulang');
      btn.addEventListener('click', function () { ui.withBusy(btn, ulang); });
      wadah.appendChild(el('div', { class: 'card', 'data-bagian': 'belum-dinilai' }, el('div', { class: 'card-body stack' }, [
        el('div', { class: 'alert alert-info', role: 'status', text: PESAN_BELUM_DINILAI }),
        el('div', { class: 'btn-group' }, btn)
      ])));
    }

    function tampilDetail(detail) {
      wadah.appendChild(buatRingkasan(ui, detail.ringkasan));
      var items = Array.isArray(detail.items) ? detail.items : [];
      var daftar = el('section', { class: 'stack', 'data-bagian': 'daftar-soal', 'aria-label': 'Jawaban per soal' });
      if (items.length === 0) {
        daftar.appendChild(el('p', { class: 'empty-state', text: 'Sesi ujian ini tidak memiliki Soal.' }));
      }
      items.forEach(function (it) {
        // Satu item rusak tidak menghentikan item lainnya (Requirement 24.6).
        try {
          daftar.appendChild(el('div', { class: 'card soal-preview' }, buatItem(ui, it, timers)));
        } catch (e) {
          daftar.appendChild(el('div', { class: 'card' }, el('div', { class: 'card-body' },
            el('p', { class: 'alert alert-warning', text: 'Soal No. ' + str(it && it.no) + ' tidak dapat ditampilkan.' }))));
        }
      });
      wadah.appendChild(daftar);
    }

    function ulang() {
      var nomor = ++ke;
      hentikan();
      ui.kosongkan(wadah);
      kabari(null);
      var sembunyikan = ui.tampilkanLoading(wadah, 'Memuat detail jawaban...');
      var p;
      try {
        p = Promise.resolve(ctx.api.detailJawaban({ idSesi: idSesi }));
      } catch (e) {
        p = Promise.reject(e);
      }
      return p.then(function (env) { return env; }, function () {
        return { ok: false, error: { code: 'KONEKSI_GAGAL' } };
      }).then(function (env) {
        sembunyikan();
        if (!aktif() || nomor !== ke) return;
        ui.kosongkan(wadah);
        if (!env || !env.ok) {
          var err = env && env.error ? env.error : 'ERROR_UMUM';
          if (err && err.code === 'KONFLIK') tampilBelumDinilai(); // Requirement 24.7
          else tampilGagal(err); // Requirement 24.9
          return;
        }
        var data = env.data || {};
        tampilDetail(data);
        kabari(data);
      });
    }

    return { promise: ulang(), ulang: ulang, hentikan: hentikan };
  }

  /* ---------- ekspor ---------- */

  /**
   * Ekspor CSV detail (Requirement 24.10, 24.11). Seluruh isi dibangun dulu;
   * error apa pun → pesan gagal tanpa unduhan sebagian.
   * @returns {boolean} true bila unduhan dimulai
   */
  function ekspor(ui, detail, ms) {
    var nama;
    var isi;
    try {
      var t = tabelDetail(detail);
      isi = ambilGlobal('CBTCsv').printCsv(t.header, t.rows);
      nama = namaFile(detail, typeof ms === 'number' ? ms : Date.now());
    } catch (e) {
      ui.toast(PESAN_EKSPOR_GAGAL, 'error');
      return false;
    }
    var berhasil = false;
    try {
      berhasil = ui.unduh(nama, isi, 'text/csv;charset=utf-8') !== false;
    } catch (e) {
      berhasil = false;
    }
    if (!berhasil) {
      ui.toast(PESAN_EKSPOR_GAGAL, 'error');
      return false;
    }
    ui.toast('Detail jawaban diekspor ke ' + nama + '.', 'sukses');
    return true;
  }

  var page = {
    tabelDetail: tabelDetail,
    namaFile: namaFile,
    buatRingkasan: buatRingkasan,
    buatItem: buatItem,
    muat: muat,
    ekspor: ekspor,

    destroy: function () {
      if (bersihkanAktif) bersihkanAktif();
      bersihkanAktif = null;
    },

    render: function (container, params, ctx) {
      var ui = ctx.ui;
      var el = ui.el;
      var idSesi = str(params && params.idSesi).trim();
      var detail = null;

      var btnKembali = el('button', { type: 'button', class: 'btn', 'data-aksi': 'kembali',
        onclick: function () { ctx.navigate('#/admin/laporan'); } }, 'Kembali ke rekap nilai');
      var btnEkspor = el('button', { type: 'button', class: 'btn btn-primary', 'data-aksi': 'ekspor-csv', disabled: true,
        onclick: function () { if (detail) ekspor(ui, detail); } }, 'Ekspor CSV');
      var wadah = el('div', { class: 'stack', 'data-bagian': 'detail' });

      container.appendChild(el('div', { class: 'container stack' }, [
        el('div', { class: 'page-header' }, [
          el('h1', { class: 'page-title', text: 'Detail Jawaban Peserta' }),
          el('div', { class: 'page-actions' }, [btnKembali, btnEkspor])
        ]),
        wadah
      ]));

      if (idSesi === '') {
        wadah.appendChild(el('div', { class: 'alert alert-danger', role: 'alert',
          text: 'ID sesi ujian tidak valid. Kembali ke rekap nilai, lalu pilih baris Peserta.' }));
        return Promise.resolve();
      }

      var m = muat(wadah, idSesi, ctx, {
        onData: function (d) {
          detail = d;
          btnEkspor.disabled = !d;
        }
      });
      bersihkanAktif = m.hentikan;
      return m.promise;
    }
  };

  if (root) {
    var CBT = root.CBT = root.CBT || {};
    CBT.pages = CBT.pages || {};
    CBT.pages['admin/detail'] = page;
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = page;
})(typeof window !== 'undefined' ? window : null);
