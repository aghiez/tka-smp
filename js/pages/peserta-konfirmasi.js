/*
 * pages/peserta-konfirmasi.js — Halaman konfirmasi mulai ujian
 * (#/peserta/konfirmasi/{kodeMapel}, params.kodeMapel).
 * Requirement 13.3, 13.4, 13.6, 13.7, 13.10, 14.3, 14.5.
 *
 * - Data diambil dari api.listUjian() (nama & kelas Peserta + info Mapel).
 *   Membuka halaman ini TIDAK membuat Sesi_Ujian dan tidak menjalankan Timer (13.3).
 * - Menampilkan nama, kelas, nama Mapel, durasi (menit), jumlah soal,
 *   tata tertib, tombol "Mulai" dan "Kembali" (ke #/peserta).
 * - Mapel tidak ada di daftar (nonaktif/tidak dikenal) → pesan ujian belum
 *   tersedia, tanpa tombol "Mulai". Status SELESAI → pesan sudah dikerjakan
 *   dan "Mulai" nonaktif (13.6, 14.3).
 * - "Mulai" → api.mulaiUjian({kodeMapel, deviceId}). Sukses → paket
 *   dititipkan lewat CBT.ujianHandoff.simpan(paket) (lihat header
 *   peserta-pilih.js) lalu ke #/ujian/{idSesi} (13.4). Gagal → pesan
 *   "Ujian gagal dimulai" + pesan error (UJIAN_SUDAH_DIKERJAKAN,
 *   UJIAN_BELUM_TERSEDIA dengan pesan Backend, SIBUK, BATAS_WAKTU, ...),
 *   halaman tetap, tombol aktif kembali (13.7, 13.10, 14.5); khusus
 *   UJIAN_SUDAH_DIKERJAKAN tombol "Mulai" tetap nonaktif.
 */
(function (root) {
  'use strict';

  var TATA_TERTIB = [
    'Waktu ujian mulai berjalan setelah Anda memilih "Mulai" dan tidak dapat dihentikan.',
    'Jawaban tersimpan otomatis setiap kali Anda memilih jawaban.',
    'Gunakan tombol "Ragu-ragu" untuk menandai soal yang ingin Anda periksa kembali.',
    'Ujian hanya dapat dikerjakan satu kali dan hanya di satu perangkat dalam satu waktu.',
    'Jika waktu habis, jawaban yang sudah tersimpan dikumpulkan secara otomatis.',
    'Kerjakan sendiri dengan jujur dan jangan menutup halaman ujian sebelum selesai.'
  ];

  function handoff() {
    return root && root.CBT && root.CBT.ujianHandoff ? root.CBT.ujianHandoff : null;
  }

  var page = {
    TATA_TERTIB: TATA_TERTIB,

    render: function (container, params, ctx) {
      var ui = ctx.ui;
      var api = ctx.api;
      var el = ui.el;
      var kodeMapel = params && params.kodeMapel ? String(params.kodeMapel) : '';

      var kembali = function () { ctx.navigate('#/peserta'); };
      var btnKeluar = el('button', { type: 'button', class: 'btn', 'data-aksi': 'keluar',
        onclick: function () { ctx.logout(); } }, 'Keluar');
      var isi = el('section', { class: 'card', 'aria-labelledby': 'konfirmasi-judul' });

      container.appendChild(el('div', { class: 'container stack' }, [
        el('div', { class: 'page-header' }, [
          el('h1', { class: 'page-title', id: 'konfirmasi-judul', text: 'Konfirmasi Ujian' }),
          el('div', { class: 'page-actions' }, [btnKeluar])
        ]),
        isi
      ]));

      function tombolKembali() {
        return el('button', { type: 'button', class: 'btn', 'data-aksi': 'kembali', onclick: kembali }, 'Kembali');
      }

      function renderTidakTersedia() {
        ui.kosongkan(isi);
        isi.appendChild(el('div', { class: 'card-body stack' }, [
          el('div', { class: 'alert alert-warning', role: 'alert', 'data-pesan': 'tidak-tersedia',
            text: ui.pesanError('UJIAN_BELUM_TERSEDIA').teks }),
          el('div', { class: 'btn-group' }, [tombolKembali()])
        ]));
      }

      function baris(label, nilai, kunci) {
        return el('tr', null, [
          el('th', { scope: 'row', text: label }),
          el('td', { 'data-info': kunci, text: nilai === undefined || nilai === null ? '' : String(nilai) })
        ]);
      }

      function renderKonfirmasi(peserta, item) {
        ui.kosongkan(isi);
        var selesai = item.status === 'SELESAI';
        var pesan = el('div', { class: 'alert alert-danger', role: 'alert', 'data-pesan': 'error', hidden: true });
        var btnMulai = el('button', { type: 'button', class: 'btn btn-primary', 'data-aksi': 'mulai',
          disabled: selesai }, 'Mulai');

        function tampilkanPesan(teks) {
          ui.setTeks(pesan, teks);
          pesan.hidden = !teks;
        }
        if (selesai) tampilkanPesan(ui.pesanError('UJIAN_SUDAH_DIKERJAKAN').teks);

        btnMulai.addEventListener('click', function () {
          tampilkanPesan('');
          ui.withBusy(btnMulai, function () {
            return api.mulaiUjian({ kodeMapel: item.kodeMapel, deviceId: ctx.deviceId });
          }).then(function (env) {
            if (!ctx.aktif()) return;
            if (env && env.ok && env.data && env.data.sesi && env.data.sesi.idSesi) {
              var h = handoff();
              if (h) h.simpan(env.data);
              ctx.navigate('#/ujian/' + encodeURIComponent(env.data.sesi.idSesi));
              return;
            }
            var error = env && env.error ? env.error : 'ERROR_UMUM';
            var info = ui.pesanError(error);
            // Halaman tetap; withBusy sudah mengaktifkan tombol kembali (13.10).
            tampilkanPesan('Ujian gagal dimulai. ' + info.teks);
            if (info.code === 'UJIAN_SUDAH_DIKERJAKAN') btnMulai.disabled = true;
          });
        });

        isi.appendChild(el('div', { class: 'card-body stack' }, [
          el('div', { class: 'table-wrap' }, el('table', { class: 'table' }, el('tbody', null, [
            baris('Nama', peserta.nama, 'nama'),
            baris('Kelas', peserta.kelas, 'kelas'),
            baris('Mata pelajaran', item.namaMapel, 'mapel'),
            baris('Durasi', item.durasiMenit + ' menit', 'durasi'),
            baris('Jumlah soal', item.jumlahSoal, 'jumlah-soal')
          ]))),
          el('h2', { class: 'card-title', text: 'Tata tertib ujian' }),
          el('ol', { 'data-info': 'tata-tertib' }, TATA_TERTIB.map(function (t) { return el('li', { text: t }); })),
          pesan,
          el('div', { class: 'btn-group' }, [tombolKembali(), btnMulai])
        ]));
      }

      function renderGagalMuat(error) {
        ui.kosongkan(isi);
        var btnUlang = el('button', { type: 'button', class: 'btn btn-primary', 'data-aksi': 'muat-ulang' }, 'Coba lagi');
        btnUlang.addEventListener('click', function () { ui.withBusy(btnUlang, muat); });
        isi.appendChild(el('div', { class: 'card-body stack' }, [
          el('div', { class: 'alert alert-danger', role: 'alert', text: 'Gagal memuat data ujian. ' + ui.pesanError(error).teks }),
          el('div', { class: 'btn-group' }, [tombolKembali(), btnUlang])
        ]));
      }

      function muat() {
        var sembunyikan = ui.tampilkanLoading(isi, 'Memuat data ujian...');
        return Promise.resolve(api.listUjian()).then(function (env) {
          sembunyikan();
          if (!ctx.aktif()) return;
          if (!env || !env.ok) {
            renderGagalMuat(env && env.error ? env.error : 'ERROR_UMUM');
            return;
          }
          var data = env.data || {};
          var items = Array.isArray(data.items) ? data.items : [];
          var item = null;
          for (var i = 0; i < items.length; i++) {
            if (items[i] && items[i].kodeMapel === kodeMapel) { item = items[i]; break; }
          }
          if (!item) { renderTidakTersedia(); return; }
          var u = ctx.user || {};
          var p = data.peserta || {};
          renderKonfirmasi({ nama: p.nama || u.nama || '', kelas: p.kelas || u.kelas || '' }, item);
        });
      }

      return muat();
    }
  };

  if (root) {
    var CBT = root.CBT = root.CBT || {};
    CBT.pages = CBT.pages || {};
    CBT.pages['peserta/konfirmasi'] = page;
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = page;
})(typeof window !== 'undefined' ? window : null);
