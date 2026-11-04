/*
 * pages/peserta-konfirmasi.js — Halaman Konfirmasi ANBK
 * (#/peserta/konfirmasi/{kodeMapel}, params.kodeMapel).
 * Requirement 10.2, 11.3, 12.4–12.6, 13.3, 13.4, 14.3–14.7.
 *
 * Alur ANBK (tampilan-anbk):
 *   1. Data dari api.infoKonfirmasi({kodeMapel}): identitas Peserta
 *      (username, nama, jenis kelamin, tanggal lahir tersimpan), Mapel,
 *      status Sesi, dan status verifikasi. Membuka halaman ini TIDAK
 *      membuat Sesi_Ujian dan tidak menjalankan Timer (13.3).
 *   2. Pil Token di atas kartu dari api.tokenUjianPeserta() — hanya tampil
 *      bila Backend mengizinkan (Pengaturan tampilkanTokenKePeserta) —
 *      dengan tombol refresh untuk membaca token periode berjalan.
 *   3. Peserta mengetik Nama Peserta, Tanggal Lahir (Hari/Bulan/Tahun), dan
 *      Token, lalu Submit → api.verifikasiUjian(). Validasi format memakai
 *      CBTValidator (validateTanggalDariKotak + validateVerifikasi);
 *      VERIFIKASI_GAGAL menandai field yang salah; VERIFIKASI_DIBLOKIR
 *      menampilkan sisa waktu blokir.
 *   4. Berhasil (atau Sesi AKTIF / sudah terverifikasi) → kartu
 *      "Konfirmasi Tes" dari api.infoTes(): Nama Tes, Status Tes,
 *      Waktu Tes (CBTDatetime.formatWaktuTes), Alokasi Waktu, Jumlah Soal,
 *      dan tombol "Mulai" → api.mulaiUjian({kodeMapel, deviceId}) seperti
 *      sebelumnya (paket dititipkan lewat CBT.ujianHandoff lalu ke
 *      #/ujian/{idSesi}). VERIFIKASI_DIPERLUKAN dari mulaiUjian membawa
 *      peserta kembali ke formulir verifikasi.
 *   5. Status SELESAI → pesan sudah dikerjakan + tombol "Lihat hasil".
 *      Mapel tidak tersedia → pesan UJIAN_BELUM_TERSEDIA tanpa formulir.
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

  function lib(nama) {
    if (root && root[nama]) return root[nama];
    if (typeof window !== 'undefined' && window[nama]) return window[nama];
    return null;
  }
  function V() { return lib('CBTValidator'); }
  function DT() { return lib('CBTDatetime'); }

  function handoff() {
    return root && root.CBT && root.CBT.ujianHandoff ? root.CBT.ujianHandoff : null;
  }

  /** Instans aktif untuk destroy() (interval penyegar token). */
  var aktifSekarang = null;

  var page = {
    TATA_TERTIB: TATA_TERTIB,

    destroy: function () {
      if (aktifSekarang) aktifSekarang.hancurkan();
    },

    render: function (container, params, ctx) {
      var ui = ctx.ui;
      var api = ctx.api;
      var el = ui.el;
      var kodeMapel = params && params.kodeMapel ? String(params.kodeMapel) : '';

      var state = { info: null, tokenTimer: null, hancur: false };
      aktifSekarang = {
        hancurkan: function () {
          state.hancur = true;
          if (state.tokenTimer !== null) { clearInterval(state.tokenTimer); state.tokenTimer = null; }
        }
      };

      var kembali = function () { ctx.navigate('#/peserta'); };
      var btnKeluar = el('button', { type: 'button', class: 'btn', 'data-aksi': 'keluar',
        onclick: function () { ctx.logout(); } }, 'Keluar');
      var namaHeader = el('span', { 'data-info': 'peserta-header', text: (ctx.user && ctx.user.nama) || '' });
      var tokenBar = el('div', { class: 'anbk-token-bar', 'data-info': 'token-bar', hidden: true });
      var isi = el('section', { class: 'anbk-konfirmasi-kartu', 'aria-labelledby': 'konfirmasi-judul' });

      // Tampilan ANBK: kepala biru PUSMENDIK, peserta di kanan, pil token
      // di kiri atas, lalu kartu putih.
      container.appendChild(el('div', { class: 'anbk-konfirmasi-page' }, [
        el('header', { class: 'anbk-topbar' }, [
          el('div', { class: 'anbk-brand' }, [
            el('span', { class: 'anbk-logo', 'aria-hidden': 'true', text: '\uD83C\uDF93' }),
            el('span', { class: 'anbk-brand-teks' }, [
              el('span', { class: 'anbk-brand-nama', text: 'PUSMENDIK' }),
              el('span', { class: 'anbk-brand-sub', text: 'APLIKASI ANBK' })
            ])
          ]),
          el('div', { class: 'anbk-topbar-kanan' }, [
            namaHeader,
            el('span', { class: 'anbk-user-ikon', 'aria-hidden': 'true', text: '\uD83C\uDF93' }),
            btnKeluar
          ])
        ]),
        el('div', { class: 'anbk-konfirmasi-bungkus' }, [tokenBar, isi])
      ]));

      function tombolKembali() {
        return el('button', { type: 'button', class: 'btn anbk-btn-kembali', 'data-aksi': 'kembali', onclick: kembali }, 'Kembali');
      }

      function baris(label, nilai, kunci) {
        return el('div', { class: 'anbk-baris' }, [
          el('span', { class: 'anbk-baris-label', text: label }),
          el('span', { class: 'anbk-baris-nilai', 'data-info': kunci, text: nilai === undefined || nilai === null ? '' : String(nilai) })
        ]);
      }

      /* ---------- pil Token ---------- */

      function muatToken() {
        if (typeof api.tokenUjianPeserta !== 'function') return Promise.resolve();
        return Promise.resolve(api.tokenUjianPeserta({})).then(function (env) {
          if (!ctx.aktif() || state.hancur) return;
          ui.kosongkan(tokenBar);
          if (!env || !env.ok || !env.data || env.data.tampilkan !== true || !env.data.token) {
            tokenBar.hidden = true;
            return;
          }
          var d = env.data;
          var sisaDetik = Math.max(0, Math.round((Number(d.berlakuSampai) - Number(d.sekarang)) / 1000));
          var sisaTeks = el('span', { class: 'anbk-token-sisa', 'data-info': 'token-sisa',
            text: 'berlaku ' + Math.floor(sisaDetik / 60) + ':' + ('0' + (sisaDetik % 60)).slice(-2) + ' lagi' });
          var btnRefresh = el('button', { type: 'button', class: 'anbk-token-refresh', 'data-aksi': 'token-refresh',
            'aria-label': 'Muat ulang token', text: '\u21BB Refresh' });
          btnRefresh.addEventListener('click', function () { ui.withBusy(btnRefresh, muatToken); });
          tokenBar.appendChild(el('span', { class: 'anbk-token-pil' }, [
            el('span', { text: 'Token:' }),
            el('strong', { class: 'anbk-token-kode', 'data-info': 'token-kode', text: String(d.token) }),
            btnRefresh
          ]));
          tokenBar.appendChild(sisaTeks);
          tokenBar.hidden = false;
        });
      }

      /* ---------- tampilan-tampilan ---------- */

      function renderTidakTersedia() {
        ui.kosongkan(isi);
        isi.classList.remove('anbk-info-tes');
        isi.appendChild(el('div', { class: 'stack' }, [
          el('h1', { class: 'anbk-konfirmasi-judul', id: 'konfirmasi-judul', text: 'Konfirmasi data Peserta' }),
          el('div', { class: 'alert alert-warning', role: 'alert', 'data-pesan': 'tidak-tersedia',
            text: ui.pesanError('UJIAN_BELUM_TERSEDIA').teks }),
          el('div', { class: 'anbk-konfirmasi-aksi' }, [tombolKembali()])
        ]));
      }

      function renderGagalMuat(error, cobaLagi) {
        ui.kosongkan(isi);
        isi.classList.remove('anbk-info-tes');
        var btnUlang = el('button', { type: 'button', class: 'btn btn-primary', 'data-aksi': 'muat-ulang' }, 'Coba lagi');
        btnUlang.addEventListener('click', function () { ui.withBusy(btnUlang, cobaLagi); });
        isi.appendChild(el('div', { class: 'stack' }, [
          el('h1', { class: 'anbk-konfirmasi-judul', id: 'konfirmasi-judul', text: 'Konfirmasi data Peserta' }),
          el('div', { class: 'alert alert-danger', role: 'alert', text: 'Gagal memuat data ujian. ' + ui.pesanError(error).teks }),
          el('div', { class: 'anbk-konfirmasi-aksi' }, [tombolKembali(), btnUlang])
        ]));
      }

      function renderSudah(info) {
        ui.kosongkan(isi);
        isi.classList.remove('anbk-info-tes');
        var anak = [
          el('h1', { class: 'anbk-konfirmasi-judul', id: 'konfirmasi-judul', text: 'Konfirmasi data Peserta' }),
          baris('Nama Peserta', info.peserta.nama, 'nama'),
          baris('Mata Ujian', info.mapel.namaMapel, 'mapel'),
          el('div', { class: 'alert alert-info', role: 'status', 'data-pesan': 'sudah',
            text: ui.pesanError('UJIAN_SUDAH_DIKERJAKAN').teks })
        ];
        var aksi = [tombolKembali()];
        if (info.idSesi) {
          aksi.push(el('button', { type: 'button', class: 'btn btn-primary anbk-btn-mulai', 'data-aksi': 'lihat-hasil',
            onclick: function () { ctx.navigate('#/hasil/' + encodeURIComponent(info.idSesi)); } }, 'Lihat hasil'));
        }
        anak.push(el('div', { class: 'anbk-konfirmasi-aksi' }, aksi));
        isi.appendChild(el('div', null, anak));
      }

      function fieldVerif(nama, labelTeks, kontrol, hint) {
        return el('div', { class: 'field' }, [
          el('label', { class: 'field-label', text: labelTeks }),
          kontrol,
          hint ? el('span', { class: 'field-hint', text: hint }) : null,
          el('p', { class: 'field-error', 'data-for': nama, hidden: true })
        ]);
      }

      function renderForm(info, pesanAwal) {
        ui.kosongkan(isi);
        isi.classList.remove('anbk-info-tes');
        var peserta = info.peserta;
        var mapel = info.mapel;
        if (peserta.nama) ui.setTeks(namaHeader, peserta.nama + ' - PESERTA TKA');

        var pesan = el('div', { class: 'alert alert-danger', role: 'alert', 'data-pesan': 'error', hidden: true });
        function tampilkanPesan(teks) {
          ui.setTeks(pesan, teks || '');
          pesan.hidden = !teks;
        }
        if (pesanAwal) tampilkanPesan(pesanAwal);

        var inNama = el('input', { type: 'text', id: 'verif-nama', name: 'nama', autocomplete: 'off',
          maxlength: '100', value: peserta.nama || '' });
        var tgl = String(peserta.tanggalLahir || '').split('-');
        var inHari = el('input', { type: 'text', id: 'verif-hari', name: 'hari', inputmode: 'numeric',
          maxlength: '2', placeholder: 'Hari', 'aria-label': 'Tanggal lahir: hari', value: tgl.length === 3 ? String(Number(tgl[2])) : '' });
        var inBulan = el('input', { type: 'text', id: 'verif-bulan', name: 'bulan', inputmode: 'numeric',
          maxlength: '2', placeholder: 'Bulan', 'aria-label': 'Tanggal lahir: bulan', value: tgl.length === 3 ? String(Number(tgl[1])) : '' });
        var inTahun = el('input', { type: 'text', id: 'verif-tahun', name: 'tahun', inputmode: 'numeric',
          maxlength: '4', placeholder: 'Tahun', 'aria-label': 'Tanggal lahir: tahun', class: 'anbk-tgl-tahun', value: tgl.length === 3 ? tgl[0] : '' });
        var inToken = el('input', { type: 'text', id: 'verif-token', name: 'token', autocomplete: 'off',
          maxlength: '6', class: 'anbk-token-input', placeholder: 'TOKEN', 'aria-label': 'Token ujian' });
        var btnSubmit = el('button', { type: 'submit', class: 'btn anbk-btn-submit', 'data-aksi': 'submit' }, 'Submit');

        var form = el('form', { class: 'anbk-verif-form', 'data-form': 'verifikasi', novalidate: true }, [
          fieldVerif('nama', 'Nama Peserta', inNama, null),
          fieldVerif('tanggalLahir', 'Tanggal Lahir',
            el('div', { class: 'anbk-tgl-baris' }, [inHari, inBulan, inTahun]),
            peserta.tanggalLahir ? null : 'Tanggal lahir belum tercatat di data peserta; periksa kembali isian Anda.'),
          fieldVerif('token', 'Token', inToken,
            'Ketik token ujian yang diumumkan pengawas persis seperti yang diberikan.'),
          pesan,
          el('div', { class: 'anbk-konfirmasi-aksi' }, [tombolKembali(), btnSubmit])
        ]);

        form.addEventListener('submit', function (ev) {
          ev.preventDefault();
          ui.bersihkanError(form);
          tampilkanPesan('');
          var validator = V();
          if (!validator) { tampilkanPesan(ui.pesanError('ERROR_UMUM').teks); return; }
          var hasilTgl = validator.validateTanggalDariKotak(inHari.value, inBulan.value, inTahun.value);
          if (!hasilTgl.valid) { ui.tandaiError(form, hasilTgl.errors); return; }
          var v = validator.validateVerifikasi(
            { nama: inNama.value, tanggalLahir: hasilTgl.value, token: inToken.value },
            { punyaTanggalLahir: !!peserta.tanggalLahir }
          );
          if (!v.valid) {
            ui.tandaiError(form, v.errors);
            tampilkanPesan(ui.pesanError('VALIDASI').teks);
            return;
          }
          ui.withBusy(btnSubmit, function () {
            return api.verifikasiUjian({
              kodeMapel: mapel.kodeMapel,
              nama: v.value.nama,
              tanggalLahir: v.value.tanggalLahir,
              token: v.value.token
            });
          }).then(function (env) {
            if (!ctx.aktif() || state.hancur) return;
            if (env && env.ok) { renderInfoTes(); return; }
            var error = env && env.error ? env.error : 'ERROR_UMUM';
            if (error.code === 'VERIFIKASI_GAGAL' && error.fields) ui.tandaiError(form, error.fields);
            if (error.code === 'UJIAN_SUDAH_DIKERJAKAN') { muat(); return; }
            tampilkanPesan(ui.pesanError(error).teks);
          });
        });

        isi.appendChild(el('div', null, [
          el('h1', { class: 'anbk-konfirmasi-judul', id: 'konfirmasi-judul', text: 'Konfirmasi data Peserta' }),
          baris('Username', peserta.username, 'username'),
          baris('Nama Peserta', peserta.nama, 'nama'),
          baris('Jenis Kelamin', peserta.jenisKelaminTeks || '-', 'jenis-kelamin'),
          baris('Mata Ujian', mapel.namaMapel, 'mapel'),
          form,
          el('h2', { class: 'anbk-konfirmasi-subjudul', text: 'Tata tertib ujian' }),
          el('ol', { class: 'anbk-tata-tertib', 'data-info': 'tata-tertib' }, TATA_TERTIB.map(function (t) { return el('li', { text: t }); }))
        ]));
        inToken.focus();
      }

      function renderInfoTes() {
        var sembunyikan = ui.tampilkanLoading(isi, 'Memuat konfirmasi tes...');
        return Promise.resolve(api.infoTes({ kodeMapel: kodeMapel })).then(function (env) {
          sembunyikan();
          if (!ctx.aktif() || state.hancur) return;
          if (!env || !env.ok) {
            renderGagalMuat(env && env.error ? env.error : 'ERROR_UMUM', renderInfoTes);
            return;
          }
          var d = env.data || {};
          ui.kosongkan(isi);
          isi.classList.add('anbk-info-tes');
          var pesan = el('div', { class: 'alert alert-danger', role: 'alert', 'data-pesan': 'error', hidden: true });
          function tampilkanPesan(teks) {
            ui.setTeks(pesan, teks || '');
            pesan.hidden = !teks;
          }
          var lanjut = d.statusSesi === 'AKTIF';
          var btnMulai = el('button', { type: 'button', class: 'btn btn-primary anbk-btn-mulai', 'data-aksi': 'mulai' },
            lanjut ? 'Lanjutkan' : 'Mulai');
          btnMulai.addEventListener('click', function () {
            tampilkanPesan('');
            ui.withBusy(btnMulai, function () {
              return api.mulaiUjian({ kodeMapel: kodeMapel, deviceId: ctx.deviceId });
            }).then(function (envMulai) {
              if (!ctx.aktif() || state.hancur) return;
              if (envMulai && envMulai.ok && envMulai.data && envMulai.data.sesi && envMulai.data.sesi.idSesi) {
                var h = handoff();
                if (h) h.simpan(envMulai.data);
                ctx.navigate('#/ujian/' + encodeURIComponent(envMulai.data.sesi.idSesi));
                return;
              }
              var error = envMulai && envMulai.error ? envMulai.error : 'ERROR_UMUM';
              var info = ui.pesanError(error);
              if (info.code === 'VERIFIKASI_DIPERLUKAN' && state.info) {
                state.info.sudahVerifikasi = false;
                renderForm(state.info, info.teks);
                return;
              }
              tampilkanPesan('Ujian gagal dimulai. ' + info.teks);
              if (info.code === 'UJIAN_SUDAH_DIKERJAKAN') btnMulai.disabled = true;
            });
          });

          var waktuTeks = '';
          var dt = DT();
          if (dt && typeof dt.formatWaktuTes === 'function') waktuTeks = dt.formatWaktuTes(Number(d.waktuTes));
          isi.appendChild(el('div', null, [
            el('h1', { class: 'anbk-konfirmasi-judul', id: 'konfirmasi-judul', text: 'Konfirmasi Tes' }),
            baris('Nama Tes', d.namaTes, 'nama-tes'),
            baris('Status Tes', d.statusTes, 'status-tes'),
            baris('Waktu Tes', waktuTeks, 'waktu-tes'),
            baris('Alokasi Waktu Tes', d.alokasiMenit + ' Menit', 'durasi'),
            baris('Jumlah Soal', d.jumlahSoal, 'jumlah-soal'),
            pesan,
            el('div', { class: 'anbk-konfirmasi-aksi' }, [tombolKembali(), btnMulai])
          ]));
        });
      }

      /* ---------- muat awal ---------- */

      function muat() {
        var sembunyikan = ui.tampilkanLoading(isi, 'Memuat data ujian...');
        return Promise.resolve(api.infoKonfirmasi({ kodeMapel: kodeMapel })).then(function (env) {
          sembunyikan();
          if (!ctx.aktif() || state.hancur) return;
          if (!env || !env.ok) {
            var error = env && env.error ? env.error : 'ERROR_UMUM';
            if (error.code === 'UJIAN_BELUM_TERSEDIA') { renderTidakTersedia(); return; }
            renderGagalMuat(error, muat);
            return;
          }
          var info = env.data || {};
          state.info = info;
          var p = info.peserta || {};
          var u = ctx.user || {};
          if (p.nama) ui.setTeks(namaHeader, p.nama + ' - PESERTA TKA');
          else if (u.nama) ui.setTeks(namaHeader, u.nama);
          muatToken();
          if (state.tokenTimer === null && !state.hancur) {
            state.tokenTimer = setInterval(function () {
              if (ctx.aktif() && !state.hancur) muatToken();
            }, 20000);
          }
          if (info.sesiStatus === 'SELESAI') { renderSudah(info); return; }
          if (info.sudahVerifikasi || info.sesiStatus === 'AKTIF') { renderInfoTes(); return; }
          renderForm(info);
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
