/* Komponen UI bersama: toast, dialog konfirmasi, indikator memuat,
 * `withBusy`, tabel PESAN_ERROR, penanda error per field, paginasi, helper DOM
 * aman, dan helper unduh Blob (Requirement 25.2, 25.5, 26.9, 26.12, 27.1, 27.6).
 *
 * Dipakai di browser sebagai `CBT.ui` (juga global `CBTUi`) dan di Node/jsdom
 * lewat module.exports. `document`/`window` dibaca saat fungsi dipanggil, bukan
 * saat modul dimuat.
 *
 * Keamanan DOM: tidak ada `innerHTML` di modul ini. Semua teks masuk lewat
 * `textContent`/text node, sehingga teks dari Backend atau Pengguna tidak
 * pernah ditafsirkan sebagai HTML.
 *
 * Kelas CSS yang dipakai (didefinisikan di frontend/css/base.css):
 *   .btn .btn-primary .btn-danger .toast .dialog .field-error .pagination
 *   .loading. Kelas tambahan: .toast-container, .toast-info|sukses|error|
 *   peringatan, .dialog-backdrop, .dialog-judul, .dialog-pesan, .dialog-aksi,
 *   .is-busy, .pagination-info.
 *
 * ATURAN PESAN ERROR (Requirement 26.9, 27.6)
 * Pesan untuk Pengguna selalu dibangun dari tabel PESAN_ERROR berdasarkan
 * `error.code`: { pesan, tindakan }. `error.message` dari Backend hanya dipakai
 * sebagai pengganti `pesan` untuk kode di PAKAI_PESAN_BACKEND (VALIDASI,
 * DUPLIKAT, KONFLIK, LOGIN_DIBLOKIR, UJIAN_BELUM_TERSEDIA). Untuk kode ini
 * Backend melempar AppError dengan teks Indonesia yang disusun sendiri
 * (mis. "Peserta memiliki riwayat ujian, nonaktifkan saja"), bukan pesan
 * exception. Pesan itu pun tetap disaring `pesanAman`: kosong, terlalu
 * panjang, atau berpola teknis (stack trace, nama file .gs, "Exception",
 * "TypeError", "Cannot ...", dll.) → kembali ke pesan tabel. Kode lain
 * (termasuk ERROR_UMUM, yang bisa berasal dari exception tak terduga) tidak
 * pernah menampilkan `error.message`. Kode tak dikenal atau error JavaScript
 * biasa diperlakukan sebagai ERROR_UMUM. Alasan per field (`error.fields`)
 * berasal dari Validator bersama (teks Indonesia) dan ditampilkan apa adanya
 * di samping field lewat `tandaiError`.
 */
var CBTUi = (function () {
  'use strict';

  /** Penghitung untuk id elemen yang dibuat modul ini. */
  var urutId = 0;

  /* ---------- tabel pesan error ---------- */

  var PESAN_ERROR = {
    OPERASI_TIDAK_DIKENAL: {
      pesan: 'Versi aplikasi tidak cocok dengan server.',
      tindakan: 'Muat ulang halaman (tekan F5), lalu coba lagi.'
    },
    SESI_BERAKHIR: {
      pesan: 'Sesi login Anda telah berakhir.',
      tindakan: 'Silakan login ulang.'
    },
    AKSES_DITOLAK: {
      pesan: 'Anda tidak memiliki akses untuk operasi ini.',
      tindakan: 'Kembali ke beranda atau login dengan akun yang sesuai.'
    },
    WAJIB_GANTI_PASSWORD: {
      pesan: 'Password wajib diganti terlebih dahulu.',
      tindakan: 'Buka halaman Ganti Password dan buat password baru.'
    },
    LOGIN_GAGAL: {
      pesan: 'Username atau password salah.',
      tindakan: 'Periksa kembali username dan password, lalu coba lagi.'
    },
    LOGIN_DIBLOKIR: {
      pesan: 'Login diblokir sementara karena terlalu banyak percobaan yang gagal.',
      tindakan: 'Tunggu beberapa menit, lalu coba login lagi.'
    },
    AKUN_NONAKTIF: {
      pesan: 'Akun Anda tidak aktif.',
      tindakan: 'Hubungi Admin untuk mengaktifkan akun.'
    },
    VALIDASI: {
      pesan: 'Data yang diisi belum valid.',
      tindakan: 'Perbaiki isian yang ditandai, lalu kirim ulang.'
    },
    DUPLIKAT: {
      pesan: 'ID, username, atau kode tersebut sudah dipakai.',
      tindakan: 'Gunakan nilai lain pada isian yang ditandai.'
    },
    TIDAK_DITEMUKAN: {
      pesan: 'Data tidak ditemukan, mungkin sudah dihapus.',
      tindakan: 'Muat ulang daftar, lalu coba lagi.'
    },
    KONFLIK: {
      pesan: 'Operasi ditolak karena data ini masih terkait dengan data lain.',
      tindakan: 'Nonaktifkan data tersebut, atau tunggu sampai ujian terkait selesai.'
    },
    UJIAN_BELUM_TERSEDIA: {
      pesan: 'Ujian ini belum tersedia.',
      tindakan: 'Hubungi pengawas atau Admin.'
    },
    UJIAN_SUDAH_DIKERJAKAN: {
      pesan: 'Ujian mapel ini sudah Anda kerjakan.',
      tindakan: 'Kembali ke daftar ujian untuk memilih mapel lain.'
    },
    UJIAN_SELESAI: {
      pesan: 'Ujian ini sudah selesai.',
      tindakan: 'Kembali ke daftar ujian untuk melihat hasil.'
    },
    WAKTU_HABIS: {
      pesan: 'Waktu ujian telah habis.',
      tindakan: 'Kembali ke daftar ujian untuk melihat hasil.'
    },
    PERANGKAT_LAIN: {
      pesan: 'Ujian ini sedang dibuka di perangkat atau tab lain.',
      tindakan: 'Pilih "Lanjutkan di perangkat ini" untuk melanjutkan di sini.'
    },
    SIBUK: {
      pesan: 'Server sedang sibuk.',
      tindakan: 'Tunggu sebentar, lalu coba lagi.'
    },
    ERROR_UMUM: {
      pesan: 'Terjadi kesalahan pada server.',
      tindakan: 'Coba lagi. Jika masih gagal, hubungi Admin.'
    },
    KONEKSI_GAGAL: {
      pesan: 'Tidak dapat terhubung ke server.',
      tindakan: 'Periksa koneksi internet Anda, lalu coba lagi.'
    },
    BATAS_WAKTU: {
      pesan: 'Server tidak merespons dalam batas waktu.',
      tindakan: 'Periksa koneksi internet Anda, lalu coba lagi.'
    },
    BACKEND_BELUM_DIKONFIGURASI: {
      pesan: 'Alamat server (Backend) belum diatur di config.js.',
      tindakan: 'Hubungi Admin untuk mengisi API_URL di config.js.'
    }
  };

  /** Kode yang boleh memakai `error.message` Backend (lihat aturan di atas). */
  var PAKAI_PESAN_BACKEND = {
    VALIDASI: true,
    DUPLIKAT: true,
    KONFLIK: true,
    LOGIN_DIBLOKIR: true,
    UJIAN_BELUM_TERSEDIA: true
  };

  var MAKS_PANJANG_PESAN = 300;
  var POLA_TEKNIS = /exception|\berror\b|typeerror|referenceerror|syntaxerror|rangeerror|\bstack\b|\.gs\b|\.js\b|\bline \d|\bat \S+ \(|\bcannot\b|\bundefined\b|\bnull\b|is not (a function|defined)|\bfailed\b|\bunexpected\b|\bservice\b|https?:\/\/|[<>{}]/i;

  /**
   * True jika teks pesan Backend layak ditampilkan: string, 1–300 karakter
   * setelah trim, satu baris, dan tidak berpola pesan teknis.
   */
  function pesanAman(teks) {
    if (typeof teks !== 'string') return false;
    var t = teks.trim();
    if (t === '' || t.length > MAKS_PANJANG_PESAN) return false;
    if (/[\r\n]/.test(t)) return false;
    return !POLA_TEKNIS.test(t);
  }

  function hasOwn(o, k) {
    return Object.prototype.hasOwnProperty.call(o, k);
  }

  /** Ambil objek error dari envelope, objek error, string kode, atau Error JS. */
  function normalisasiError(e) {
    if (typeof e === 'string') return { code: e };
    if (!e || typeof e !== 'object') return { code: 'ERROR_UMUM' };
    if (e.ok === false && e.error && typeof e.error === 'object') return e.error;
    return e;
  }

  /**
   * Pesan Indonesia + satu langkah tindakan untuk sebuah error.
   * @param {object|string} error `{code, message?, fields?, retryAfterMin?}`,
   *   envelope gagal, string kode, atau Error JavaScript.
   * @returns {{code:string, pesan:string, tindakan:string, teks:string}}
   */
  function pesanError(error) {
    var e = normalisasiError(error);
    var code = typeof e.code === 'string' && hasOwn(PESAN_ERROR, e.code) ? e.code : 'ERROR_UMUM';
    var entri = PESAN_ERROR[code];
    var pesan = entri.pesan;
    var tindakan = entri.tindakan;

    if (code === 'LOGIN_DIBLOKIR') {
      var menit = Number(e.retryAfterMin);
      if (isFinite(menit) && menit > 0) {
        tindakan = 'Coba login lagi dalam ' + Math.ceil(menit) + ' menit.';
      }
    }
    if (hasOwn(PAKAI_PESAN_BACKEND, code) && pesanAman(e.message)) {
      pesan = e.message.trim();
    }
    return { code: code, pesan: pesan, tindakan: tindakan, teks: pesan + ' ' + tindakan };
  }

  /* ---------- helper DOM aman ---------- */

  function doc() {
    return document;
  }

  var ATRIBUT_URL = { href: true, src: true, action: true, formaction: true, 'xlink:href': true };
  var PROPERTI = { value: true, checked: true, disabled: true, selected: true, hidden: true };

  function urlBerbahaya(nama, nilai) {
    var v = String(nilai).replace(/[\u0000-\u0020]/g, '').toLowerCase();
    if (/^(javascript|vbscript):/.test(v)) return true;
    return nama !== 'src' && /^data:/.test(v);
  }

  function tambahAnak(node, anak) {
    if (anak === null || anak === undefined || anak === false) return;
    if (Array.isArray(anak)) {
      anak.forEach(function (a) { tambahAnak(node, a); });
      return;
    }
    if (typeof anak === 'object' && typeof anak.nodeType === 'number') {
      node.appendChild(anak);
      return;
    }
    node.appendChild(doc().createTextNode(String(anak)));
  }

  /**
   * Membuat elemen tanpa innerHTML. Teks selalu menjadi text node.
   * attrs: `class` (string/array), `text`, `dataset` {}, `style` {}/string,
   * `on<event>` (fungsi → addEventListener), value/checked/disabled/selected/
   * hidden (properti), selain itu setAttribute. null/undefined/false dilewati.
   * Atribut `innerHTML`/`outerHTML` dan handler inline string ditolak;
   * URL `javascript:`/`vbscript:` (dan `data:` kecuali `src`) dibuang.
   * @param {string} tag
   * @param {object} [attrs]
   * @param {*} [children] string, angka, Node, atau array bertingkat
   * @returns {HTMLElement}
   */
  function el(tag, attrs, children) {
    var node = doc().createElement(tag);
    var a = attrs || {};
    Object.keys(a).forEach(function (k) {
      var v = a[k];
      if (v === null || v === undefined || v === false) return;
      var kl = k.toLowerCase();
      if (kl === 'innerhtml' || kl === 'outerhtml') {
        throw new Error('el(): atribut ' + k + ' tidak diizinkan');
      }
      if (kl.indexOf('on') === 0 && kl.length > 2) {
        if (typeof v !== 'function') throw new Error('el(): handler ' + k + ' harus fungsi');
        node.addEventListener(kl.slice(2), v);
        return;
      }
      if (k === 'class' || k === 'className') {
        node.className = Array.isArray(v) ? v.filter(Boolean).join(' ') : String(v);
      } else if (k === 'text') {
        node.textContent = String(v);
      } else if (k === 'dataset' && typeof v === 'object') {
        Object.keys(v).forEach(function (d) {
          if (v[d] !== null && v[d] !== undefined) node.dataset[d] = String(v[d]);
        });
      } else if (k === 'style' && typeof v === 'object') {
        Object.keys(v).forEach(function (s) { node.style[s] = v[s]; });
      } else if (hasOwn(PROPERTI, k)) {
        node[k] = k === 'value' ? String(v) : Boolean(v);
      } else if (hasOwn(ATRIBUT_URL, kl)) {
        if (!urlBerbahaya(kl, v)) node.setAttribute(k, String(v));
      } else {
        node.setAttribute(k, v === true ? '' : String(v));
      }
    });
    tambahAnak(node, children);
    return node;
  }

  /** Menghapus semua anak node. */
  function kosongkan(node) {
    while (node && node.firstChild) node.removeChild(node.firstChild);
    return node;
  }

  /** Mengganti isi node dengan teks (aman). */
  function setTeks(node, teks) {
    if (node) node.textContent = teks === null || teks === undefined ? '' : String(teks);
    return node;
  }

  /* ---------- toast ---------- */

  var DURASI_TOAST = { info: 4000, sukses: 4000, peringatan: 6000, error: 6000 };

  function wadahToast() {
    var d = doc();
    var w = d.querySelector('.toast-container');
    if (!w) {
      w = el('div', { class: 'toast-container', 'aria-live': 'polite', 'aria-atomic': 'false' });
      d.body.appendChild(w);
    }
    return w;
  }

  /**
   * Menampilkan notifikasi singkat yang hilang sendiri.
   * @param {string} pesan
   * @param {'info'|'sukses'|'peringatan'|'error'|{tipe?:string, durasi?:number}} [opsi]
   * @returns {{el:HTMLElement, tutup:function}}
   */
  function toast(pesan, opsi) {
    var o = typeof opsi === 'string' ? { tipe: opsi } : (opsi || {});
    var tipe = hasOwn(DURASI_TOAST, o.tipe) ? o.tipe : 'info';
    var durasi = typeof o.durasi === 'number' ? o.durasi : DURASI_TOAST[tipe];
    var timer = null;
    var node;

    function tutup() {
      if (timer !== null) { clearTimeout(timer); timer = null; }
      if (node && node.parentNode) node.parentNode.removeChild(node);
    }

    node = el('div', {
      class: ['toast', 'toast-' + tipe],
      role: tipe === 'error' || tipe === 'peringatan' ? 'alert' : 'status'
    }, [
      el('span', { class: 'toast-pesan', text: pesan }),
      el('button', { type: 'button', class: 'toast-tutup', 'aria-label': 'Tutup notifikasi', onclick: tutup }, '\u00d7')
    ]);
    wadahToast().appendChild(node);
    if (durasi > 0) timer = setTimeout(tutup, durasi);
    return { el: node, tutup: tutup };
  }

  /* ---------- dialog konfirmasi ---------- */

  /**
   * Dialog konfirmasi modal. Escape, klik latar, atau tombol batal → false.
   * @param {string|{judul?:string, pesan:string, ya?:string, tidak?:string, bahaya?:boolean}} opsi
   * @returns {Promise<boolean>}
   */
  function konfirmasi(opsi) {
    var o = typeof opsi === 'string' ? { pesan: opsi } : (opsi || {});
    var d = doc();
    var fokusSemula = d.activeElement;
    var idJudul = 'dialog-judul-' + (++urutId);
    var idPesan = 'dialog-pesan-' + urutId;

    return new Promise(function (resolve) {
      var selesai = false;
      var latar, btnYa, btnTidak;

      function akhiri(nilai) {
        if (selesai) return;
        selesai = true;
        d.removeEventListener('keydown', onKey, true);
        if (latar.parentNode) latar.parentNode.removeChild(latar);
        if (fokusSemula && typeof fokusSemula.focus === 'function') {
          try { fokusSemula.focus(); } catch (_) { /* elemen sudah hilang */ }
        }
        resolve(nilai);
      }

      function onKey(ev) {
        if (ev.key === 'Escape' || ev.key === 'Esc') {
          ev.preventDefault();
          akhiri(false);
        } else if (ev.key === 'Tab') {
          // Jaga fokus tetap di dalam dialog.
          var aktif = d.activeElement;
          if (ev.shiftKey && aktif === btnTidak) { ev.preventDefault(); btnYa.focus(); }
          else if (!ev.shiftKey && aktif === btnYa) { ev.preventDefault(); btnTidak.focus(); }
        }
      }

      btnTidak = el('button', { type: 'button', class: 'btn', onclick: function () { akhiri(false); } },
        o.tidak || 'Batal');
      btnYa = el('button', {
        type: 'button',
        class: ['btn', o.bahaya ? 'btn-danger' : 'btn-primary'],
        onclick: function () { akhiri(true); }
      }, o.ya || 'Ya');

      var kotak = el('div', {
        class: 'dialog',
        role: 'alertdialog',
        'aria-modal': 'true',
        'aria-labelledby': idJudul,
        'aria-describedby': idPesan
      }, [
        el('h2', { class: 'dialog-judul', id: idJudul, text: o.judul || 'Konfirmasi' }),
        el('p', { class: 'dialog-pesan', id: idPesan, text: o.pesan || '' }),
        el('div', { class: 'dialog-aksi' }, [btnTidak, btnYa])
      ]);
      latar = el('div', { class: 'dialog-backdrop' }, kotak);
      latar.addEventListener('click', function (ev) {
        if (ev.target === latar) akhiri(false);
      });
      d.addEventListener('keydown', onKey, true);
      d.body.appendChild(latar);
      // Aksi berbahaya: fokus awal di tombol batal agar Enter tidak langsung menghapus.
      (o.bahaya ? btnTidak : btnYa).focus();
    });
  }

  /* ---------- indikator memuat ---------- */

  /**
   * Menambahkan indikator memuat ke `target` (default body).
   * @returns {function} fungsi untuk menghapus indikator
   */
  function tampilkanLoading(target, teks) {
    var wadah = target || doc().body;
    var node = el('div', { class: 'loading', role: 'status', 'aria-live': 'polite' },
      el('span', { class: 'loading-teks', text: teks || 'Memuat...' }));
    wadah.appendChild(node);
    wadah.setAttribute('aria-busy', 'true');
    var sudah = false;
    return function sembunyikan() {
      if (sudah) return;
      sudah = true;
      if (node.parentNode) node.parentNode.removeChild(node);
      if (!wadah.querySelector('.loading')) wadah.removeAttribute('aria-busy');
    };
  }

  /* ---------- withBusy ---------- */

  var sedangSibuk = typeof WeakMap === 'function' ? new WeakMap() : null;

  /**
   * Menonaktifkan tombol dan menampilkan indikator memuat selama `kerja`
   * berjalan, lalu memulihkan tombol saat sukses maupun gagal
   * (Requirement 26.12). `kerja` boleh Promise atau fungsi yang mengembalikan
   * Promise; dengan fungsi, panggilan ulang pada tombol yang masih sibuk
   * mengembalikan Promise yang sama tanpa memanggil `kerja` lagi.
   * @param {HTMLButtonElement|null} button
   * @param {Promise|function():Promise} kerja
   * @returns {Promise} hasil `kerja` (penolakan diteruskan)
   */
  function withBusy(button, kerja) {
    function jalankan() {
      try {
        return Promise.resolve(typeof kerja === 'function' ? kerja() : kerja);
      } catch (err) {
        return Promise.reject(err);
      }
    }
    if (!button) return jalankan();
    if (sedangSibuk && sedangSibuk.has(button)) return sedangSibuk.get(button);

    var disabledSemula = button.disabled;
    var spinner = el('span', { class: 'loading', 'aria-hidden': 'true' });
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.classList.add('is-busy');
    button.insertBefore(spinner, button.firstChild);

    function pulihkan() {
      if (spinner.parentNode) spinner.parentNode.removeChild(spinner);
      button.classList.remove('is-busy');
      button.removeAttribute('aria-busy');
      button.disabled = disabledSemula;
      if (sedangSibuk) sedangSibuk.delete(button);
    }

    var hasil = jalankan().then(
      function (v) { pulihkan(); return v; },
      function (err) { pulihkan(); throw err; }
    );
    if (sedangSibuk) sedangSibuk.set(button, hasil);
    return hasil;
  }

  /* ---------- error per field ---------- */

  function cariField(form, nama) {
    var hasil = [];
    var semua = form.querySelectorAll('[name], [data-field]');
    for (var i = 0; i < semua.length; i++) {
      var n = semua[i].getAttribute('name');
      if (n === null) n = semua[i].getAttribute('data-field');
      if (n === nama) hasil.push(semua[i]);
    }
    return hasil;
  }

  function cariElemenError(form, nama) {
    var semua = form.querySelectorAll('.field-error');
    for (var i = 0; i < semua.length; i++) {
      if (semua[i].getAttribute('data-for') === nama) return semua[i];
    }
    return null;
  }

  function teksAlasan(alasan) {
    if (Array.isArray(alasan)) {
      return alasan.filter(function (x) { return x !== null && x !== undefined && String(x).trim() !== ''; })
        .map(String).join('; ');
    }
    return alasan === null || alasan === undefined ? '' : String(alasan);
  }

  /**
   * Menandai field tidak valid (Requirement 25.2, 25.5). Nilai isian tidak
   * diubah. Pesan ditulis ke `.field-error[data-for=<nama>]` di dalam form;
   * jika belum ada, elemen dibuat setelah field terakhir bernama sama.
   * Field mendapat `aria-invalid="true"` dan `aria-describedby` ke pesan.
   * Field pertama yang ditandai difokuskan.
   * @param {HTMLElement} form
   * @param {Object<string, string[]|string>} fields
   * @returns {{jumlah:number, tidakDitemukan:string[]}}
   */
  function tandaiError(form, fields) {
    var jumlah = 0;
    var tidakDitemukan = [];
    var pertama = null;
    if (!form || !fields) return { jumlah: 0, tidakDitemukan: [] };

    Object.keys(fields).forEach(function (nama) {
      var teks = teksAlasan(fields[nama]);
      if (teks === '') return;
      var input = cariField(form, nama);
      var pesanEl = cariElemenError(form, nama);
      if (input.length === 0 && !pesanEl) {
        tidakDitemukan.push(nama);
        return;
      }
      if (!pesanEl) {
        pesanEl = el('p', {
          class: 'field-error',
          id: 'galat-' + (++urutId),
          'data-for': nama,
          'data-dibuat': '1'
        });
        var akhir = input[input.length - 1];
        akhir.parentNode.insertBefore(pesanEl, akhir.nextSibling);
      }
      if (!pesanEl.id) pesanEl.id = 'galat-' + (++urutId);
      pesanEl.textContent = teks;
      pesanEl.hidden = false;
      input.forEach(function (f) {
        f.setAttribute('aria-invalid', 'true');
        var ids = (f.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
        if (ids.indexOf(pesanEl.id) === -1) {
          ids.push(pesanEl.id);
          f.setAttribute('aria-describedby', ids.join(' '));
          f.setAttribute('data-galat-id', pesanEl.id);
        }
        if (!pertama) pertama = f;
      });
      jumlah++;
    });
    if (pertama && typeof pertama.focus === 'function') pertama.focus();
    return { jumlah: jumlah, tidakDitemukan: tidakDitemukan };
  }

  /** Menghapus semua penanda error yang dipasang `tandaiError`. */
  function bersihkanError(form) {
    if (!form) return;
    var invalid = form.querySelectorAll('[aria-invalid="true"]');
    for (var i = 0; i < invalid.length; i++) {
      var f = invalid[i];
      f.removeAttribute('aria-invalid');
      var gid = f.getAttribute('data-galat-id');
      if (gid) {
        var ids = (f.getAttribute('aria-describedby') || '').split(/\s+/)
          .filter(function (x) { return x && x !== gid; });
        if (ids.length) f.setAttribute('aria-describedby', ids.join(' '));
        else f.removeAttribute('aria-describedby');
        f.removeAttribute('data-galat-id');
      }
    }
    var pesan = form.querySelectorAll('.field-error');
    for (var j = 0; j < pesan.length; j++) {
      if (pesan[j].getAttribute('data-dibuat') === '1') {
        pesan[j].parentNode.removeChild(pesan[j]);
      } else {
        pesan[j].textContent = '';
        pesan[j].hidden = true;
      }
    }
  }

  /**
   * Penanganan error standar untuk halaman: tandai field (jika ada `form` dan
   * `error.fields`), lalu tampilkan toast error berisi pesan + tindakan.
   * @param {object} error
   * @param {{form?:HTMLElement, toast?:boolean}} [opsi]
   * @returns {{code, pesan, tindakan, teks}}
   */
  function tanganiError(error, opsi) {
    var o = opsi || {};
    var info = pesanError(error);
    var e = normalisasiError(error);
    if (o.form && e.fields && typeof e.fields === 'object') tandaiError(o.form, e.fields);
    if (o.toast !== false) toast(info.teks, 'error');
    return info;
  }

  /* ---------- paginasi ---------- */

  /**
   * Komponen paginasi. Cocok dengan keluaran `CBTRekap.paginate`
   * (`{page, totalPages}`), sehingga hasil paginate bisa langsung diteruskan
   * bersama `onChange`.
   * @param {{page:number, totalPages:number, onChange:function(number)}} opsi
   * @returns {HTMLElement} nav.pagination
   */
  function paginasi(opsi) {
    var o = opsi || {};
    var total = Math.max(1, Math.floor(Number(o.totalPages)) || 1);
    var page = Math.floor(Number(o.page)) || 1;
    if (page < 1) page = 1;
    if (page > total) page = total;

    function ke(p) {
      return function () {
        if (p >= 1 && p <= total && p !== page && typeof o.onChange === 'function') o.onChange(p);
      };
    }

    return el('nav', { class: 'pagination', 'aria-label': 'Navigasi halaman' }, [
      el('button', {
        type: 'button', class: 'btn', 'data-aksi': 'sebelumnya',
        disabled: page <= 1, onclick: ke(page - 1)
      }, 'Sebelumnya'),
      el('span', { class: 'pagination-info', 'aria-live': 'polite' },
        'Halaman ' + page + ' dari ' + total),
      el('button', {
        type: 'button', class: 'btn', 'data-aksi': 'berikutnya',
        disabled: page >= total, onclick: ke(page + 1)
      }, 'Berikutnya')
    ]);
  }

  /* ---------- unduh ---------- */

  /**
   * Mengunduh data sebagai file lewat Blob + `<a download>`.
   * @param {string} namaFile
   * @param {string|Uint8Array|ArrayBuffer|Blob|number[]} data
   * @param {string} [mime] default 'application/octet-stream'
   * @returns {boolean} false jika browser tidak mendukung Blob URL
   */
  function unduh(namaFile, data, mime) {
    var w = typeof window !== 'undefined' ? window : null;
    var URLx = w && (w.URL || w.webkitURL);
    if (!URLx || typeof URLx.createObjectURL !== 'function' || typeof Blob !== 'function') return false;
    var isi = Array.isArray(data) ? new Uint8Array(data) : data;
    var blob = isi instanceof Blob ? isi : new Blob([isi === null || isi === undefined ? '' : isi],
      { type: mime || 'application/octet-stream' });
    var url = URLx.createObjectURL(blob);
    var a = el('a', { download: String(namaFile || 'unduhan'), style: { display: 'none' } });
    a.href = url; // URL blob: dibuat sendiri, aman
    doc().body.appendChild(a);
    a.click();
    a.parentNode.removeChild(a);
    setTimeout(function () { URLx.revokeObjectURL(url); }, 1000);
    return true;
  }

  return {
    PESAN_ERROR: PESAN_ERROR,
    PAKAI_PESAN_BACKEND: PAKAI_PESAN_BACKEND,
    pesanAman: pesanAman,
    pesanError: pesanError,
    el: el,
    kosongkan: kosongkan,
    setTeks: setTeks,
    toast: toast,
    konfirmasi: konfirmasi,
    tampilkanLoading: tampilkanLoading,
    withBusy: withBusy,
    tandaiError: tandaiError,
    bersihkanError: bersihkanError,
    tanganiError: tanganiError,
    paginasi: paginasi,
    unduh: unduh
  };
})();

if (typeof window !== 'undefined') {
  window.CBT = window.CBT || {};
  window.CBT.ui = CBTUi;
}
if (typeof module !== 'undefined' && module.exports) module.exports = CBTUi;
