/*
 * pages/peserta-pilih.js — Halaman pemilihan Mapel untuk Peserta (#/peserta).
 * Requirement 13.1, 13.2, 13.5, 13.6, 13.9, 13.10, 14.3, 14.5.
 *
 * - Daftar dari api.listUjian(): {peserta:{nama,kelas}, items:[{kodeMapel,
 *   namaMapel, durasiMenit, jumlahSoal, status, idSesi?}]}. Backend hanya
 *   mengirim Mapel aktif dan sudah menutup Sesi kadaluwarsa (13.9).
 *   Status: BELUM → "Belum dikerjakan", AKTIF → "Sedang dikerjakan",
 *   SELESAI → "Selesai" (13.1).
 * - Tidak ada Mapel → pesan "belum ada ujian" tanpa tombol mulai (13.2).
 * - BELUM → tombol "Mulai" ke #/peserta/konfirmasi/{kodeMapel} (tanpa request).
 * - AKTIF → tombol "Lanjutkan" memanggil api.lanjutUjian({idSesi, deviceId}) di
 *   halaman ini, agar kegagalan tetap menampilkan halaman yang sama dan tombol
 *   aktif kembali (13.5, 13.10). UJIAN_SELESAI/WAKTU_HABIS → daftar dimuat
 *   ulang (Mapel tampil "Selesai").
 * - SELESAI → tombol mulai nonaktif "Sudah dikerjakan" (13.6) + "Lihat hasil".
 *
 * SERAH-TERIMA PAKET KE HALAMAN UJIAN (CBT.ujianHandoff)
 * ------------------------------------------------------
 * Halaman ini dan peserta-konfirmasi.js sudah menerima PaketUjian dari
 * mulaiUjian/lanjutUjian sebelum pindah ke #/ujian/{idSesi}. Paket dititipkan
 * di memori agar pages/ujian.js tidak perlu memanggil lanjutUjian lagi:
 *
 *   CBT.ujianHandoff.simpan(paket)   // dipanggil sebelum navigate
 *   CBT.ujianHandoff.ambil(idSesi)   // dipanggil ujian.js saat render
 *     → {paket, diterima} lalu titipan dihapus (sekali pakai), atau null
 *       jika tidak ada / idSesi berbeda / lebih tua dari 60 detik.
 *
 * `diterima` = Date.now() saat paket diterima; ujian.js sebaiknya mengurangi
 * selisih (Date.now() - diterima) dari paket.sesi.sisaDetik. Jika ambil()
 * mengembalikan null (mis. halaman dimuat ulang), ujian.js memanggil
 * api.lanjutUjian({idSesi, deviceId}) sendiri.
 */
(function (root) {
  'use strict';

  var UMUR_TITIPAN_MS = 60000;

  var STATUS = {
    BELUM: { teks: 'Belum dikerjakan', badge: 'badge-muted' },
    AKTIF: { teks: 'Sedang dikerjakan', badge: 'badge-warning' },
    SELESAI: { teks: 'Selesai', badge: 'badge-success' }
  };

  /** Membuat penitip paket sekali pakai (lihat header). */
  function buatHandoff(now) {
    var jam = typeof now === 'function' ? now : function () { return Date.now(); };
    var titipan = null;
    return {
      simpan: function (paket) {
        var id = paket && paket.sesi ? paket.sesi.idSesi : null;
        titipan = id ? { idSesi: String(id), paket: paket, diterima: jam() } : null;
      },
      ambil: function (idSesi) {
        var t = titipan;
        titipan = null;
        if (!t || t.idSesi !== String(idSesi)) return null;
        if (jam() - t.diterima > UMUR_TITIPAN_MS) return null;
        return { paket: t.paket, diterima: t.diterima };
      }
    };
  }

  function labelStatus(status) {
    return Object.prototype.hasOwnProperty.call(STATUS, status) ? STATUS[status] : STATUS.BELUM;
  }

  function handoff() {
    return root && root.CBT && root.CBT.ujianHandoff ? root.CBT.ujianHandoff : null;
  }

  var page = {
    labelStatus: labelStatus,
    buatHandoff: buatHandoff,

    render: function (container, params, ctx) {
      var ui = ctx.ui;
      var api = ctx.api;
      var el = ui.el;

      var btnKeluar = el('button', { type: 'button', class: 'btn', 'data-aksi': 'keluar',
        onclick: function () { ctx.logout(); } }, 'Keluar');
      var identitas = el('p', { class: 'page-subtitle', 'data-info': 'peserta' });
      var pesan = el('div', { class: 'alert alert-danger', role: 'alert', 'data-pesan': 'error', hidden: true });
      var daftarWrap = el('section', { class: 'stack', 'aria-label': 'Daftar ujian' });

      container.appendChild(el('div', { class: 'container stack' }, [
        el('div', { class: 'page-header' }, [
          el('div', null, [el('h1', { class: 'page-title', text: 'Pilih Ujian' }), identitas]),
          el('div', { class: 'page-actions' }, [btnKeluar])
        ]),
        pesan,
        daftarWrap
      ]));

      function tampilkanPesan(teks) {
        ui.setTeks(pesan, teks);
        pesan.hidden = !teks;
      }

      function lanjutkan(item, btn) {
        tampilkanPesan('');
        return ui.withBusy(btn, function () {
          return api.lanjutUjian({ idSesi: item.idSesi, deviceId: ctx.deviceId });
        }).then(function (env) {
          if (!ctx.aktif()) return undefined;
          if (env && env.ok && env.data && env.data.sesi) {
            var h = handoff();
            if (h) h.simpan(env.data);
            ctx.navigate('#/ujian/' + encodeURIComponent(env.data.sesi.idSesi || item.idSesi));
            return undefined;
          }
          var error = env && env.error ? env.error : 'ERROR_UMUM';
          var code = typeof error === 'object' ? error.code : error;
          if (code === 'UJIAN_SELESAI' || code === 'WAKTU_HABIS') {
            ui.toast(ui.pesanError(error).teks, 'peringatan');
            return muat();
          }
          // Tetap di halaman ini; withBusy sudah mengaktifkan tombol kembali (13.10).
          tampilkanPesan('Ujian gagal dimulai. ' + ui.pesanError(error).teks);
          return undefined;
        });
      }

      function kartu(item) {
        var st = labelStatus(item.status);
        var aksi;
        if (item.status === 'AKTIF' && item.idSesi) {
          var btnLanjut = el('button', { type: 'button', class: 'btn btn-primary', 'data-aksi': 'lanjutkan' }, 'Lanjutkan');
          btnLanjut.addEventListener('click', function () { lanjutkan(item, btnLanjut); });
          aksi = [btnLanjut];
        } else if (item.status === 'SELESAI') {
          aksi = [el('button', { type: 'button', class: 'btn', 'data-aksi': 'mulai', disabled: true,
            title: 'Ujian Mapel ini sudah dikerjakan.' }, 'Sudah dikerjakan')];
          if (item.idSesi) {
            aksi.push(el('button', { type: 'button', class: 'btn', 'data-aksi': 'lihat-hasil',
              onclick: function () { ctx.navigate('#/hasil/' + encodeURIComponent(item.idSesi)); } }, 'Lihat hasil'));
          }
        } else {
          aksi = [el('button', { type: 'button', class: 'btn btn-primary', 'data-aksi': 'mulai',
            onclick: function () { ctx.navigate('#/peserta/konfirmasi/' + encodeURIComponent(item.kodeMapel)); } }, 'Mulai')];
        }
        return el('article', { class: 'card', dataset: { kode: item.kodeMapel, status: item.status } },
          el('div', { class: 'card-body stack' }, [
            el('h2', { class: 'card-title', text: item.namaMapel }),
            el('p', { text: 'Durasi: ' + item.durasiMenit + ' menit · Jumlah soal: ' + item.jumlahSoal }),
            el('p', null, el('span', { class: 'badge ' + st.badge, 'data-info': 'status', text: st.teks })),
            el('div', { class: 'btn-group' }, aksi)
          ]));
      }

      function renderDaftar(data) {
        ui.kosongkan(daftarWrap);
        var p = data && data.peserta ? data.peserta : (ctx.user || {});
        ui.setTeks(identitas, [p.nama, p.kelas ? 'Kelas ' + p.kelas : ''].filter(Boolean).join(' · '));
        var items = data && Array.isArray(data.items) ? data.items : [];
        if (items.length === 0) {
          daftarWrap.appendChild(el('div', { class: 'card' }, el('div', { class: 'card-body' },
            el('p', { class: 'empty-state', text: 'Belum ada ujian yang tersedia saat ini.' }))));
          return;
        }
        items.forEach(function (it) { daftarWrap.appendChild(kartu(it)); });
      }

      function renderGagalMuat(error) {
        ui.kosongkan(daftarWrap);
        var btnUlang = el('button', { type: 'button', class: 'btn btn-primary', 'data-aksi': 'muat-ulang' }, 'Coba lagi');
        btnUlang.addEventListener('click', function () { ui.withBusy(btnUlang, muat); });
        daftarWrap.appendChild(el('div', { class: 'card' }, el('div', { class: 'card-body stack' }, [
          el('div', { class: 'alert alert-danger', role: 'alert', text: 'Gagal memuat daftar ujian. ' + ui.pesanError(error).teks }),
          btnUlang
        ])));
      }

      function muat() {
        var sembunyikan = ui.tampilkanLoading(daftarWrap, 'Memuat daftar ujian...');
        return Promise.resolve(api.listUjian()).then(function (env) {
          sembunyikan();
          if (!ctx.aktif()) return;
          if (!env || !env.ok) {
            renderGagalMuat(env && env.error ? env.error : 'ERROR_UMUM');
            return;
          }
          renderDaftar(env.data);
        });
      }

      return muat();
    }
  };

  if (root) {
    var CBT = root.CBT = root.CBT || {};
    CBT.pages = CBT.pages || {};
    CBT.pages.peserta = page;
    if (!CBT.ujianHandoff) CBT.ujianHandoff = buatHandoff();
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = page;
})(typeof window !== 'undefined' ? window : null);
