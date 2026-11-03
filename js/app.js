/*
 * app.js — Router hash, state auth, dan guard peran Frontend (design.md §15).
 * Dimuat terakhir di index.html, setelah api.js, ui.js, dan seluruh script halaman.
 * Requirement 2.4, 2.5, 2.7, 2.12, 3.6, 14.6.
 *
 * ======================================================================
 * KONTRAK REGISTRASI HALAMAN (untuk task 20.x, 22.x, 24.x)
 * ======================================================================
 * Setiap file di js/pages/ mendaftarkan satu objek halaman ke CBT.pages dengan
 * kunci = pola rute tanpa segmen parameter (lihat tabel ROUTES di bawah):
 *
 *   (function () {
 *     'use strict';
 *     var CBT = window.CBT = window.CBT || {};
 *     CBT.pages = CBT.pages || {};
 *     CBT.pages['admin/peserta'] = {
 *       render: function (container, params, ctx) { ... },  // wajib
 *       destroy: function () { ... }                          // opsional
 *     };
 *   })();
 *
 * render(container, params, ctx)
 *   - container : elemen <main id="app">, sudah dikosongkan oleh router.
 *   - params    : parameter rute yang sudah di-decode, mis. {idSesi: 'S-1'}
 *                 untuk #/ujian/S-1, {kodeMapel: 'MTK'} untuk
 *                 #/peserta/konfirmasi/MTK; {} untuk rute tanpa parameter.
 *   - ctx       : {
 *       api, ui            // CBT.api dan CBT.ui
 *       user               // salinan {id, nama, peran:'ADMIN'|'PESERTA', kelas,
 *                          //   wajibGantiPassword}; null di #/login
 *       params             // sama dengan argumen params
 *       deviceId           // penanda perangkat per tab (sessionStorage)
 *       navigate(hash)     // pindah rute, mis. ctx.navigate('#/admin/soal')
 *       logout()           // keluar: Token dihapus, tampil #/login (Req 2.9)
 *       setUser(user)      // perbarui state auth, mis. setelah login berhasil
 *                          //   atau setelah ganti password (wajibGantiPassword:false)
 *       goHome()           // ke beranda peran (#/admin, #/peserta, atau
 *                          //   #/ganti-password jika wajib ganti password)
 *       aktif()            // true selama halaman ini masih halaman aktif;
 *                          //   cek setelah await sebelum menyentuh DOM
 *     }
 *   - Boleh mengembalikan Promise. Promise yang reject ditampilkan sebagai
 *     pesan error umum di container.
 *
 * destroy()
 *   Dipanggil sebelum halaman lain dirender (navigasi apa pun, termasuk
 *   redirect guard dan sesi berakhir). Wajib membersihkan timer, interval,
 *   dan listener global (mis. timer Halaman_Ujian dan antrean simpan).
 *
 * Alur login halaman login.js: env = await ctx.api.login(...); jika ok →
 *   ctx.setUser(env.data.user); ctx.goHome().
 * Alur ganti-password.js: setelah sukses → ctx.setUser(Object.assign({},
 *   ctx.user, {wajibGantiPassword:false})); ctx.goHome().
 * Halaman yang belum terdaftar dirender sebagai placeholder "belum tersedia".
 * ======================================================================
 *
 * GUARD (resolveRoute):
 *   - Belum login: hanya #/login; rute lain (termasuk tak dikenal) → #/login.
 *   - Admin dengan wajibGantiPassword: hanya #/ganti-password; selain itu →
 *     #/ganti-password (Requirement 3.6). Keluar tetap lewat ctx.logout().
 *   - Sudah login: #/login dan rute tak dikenal → beranda peran; rute milik
 *     peran lain → beranda peran sendiri; #/ganti-password boleh untuk semua peran.
 *   Beranda: ADMIN → #/admin (Req 2.4), PESERTA → #/peserta (Req 2.5).
 *
 * BOOT (start):
 *   - Pasang CBT.api.onSessionExpired: state user dikosongkan, toast sesi
 *     berakhir, ke #/login (api.js sudah menghapus Token) (Requirement 2.7).
 *   - Ada Token → api.me() (Requirement 2.12):
 *       ok            → set user; tetap di hash sekarang jika diizinkan, selain
 *                       itu ke beranda peran.
 *       SESI_BERAKHIR → #/login (toast oleh hook).
 *       error lain    → layar error + tombol "Coba lagi"; Token TIDAK dihapus.
 *   - Tanpa Token → langsung routing (berujung #/login).
 *
 * deviceId: string acak per tab di sessionStorage['cbt_device'], dibuat sekali
 * lalu dipakai ulang selama tab hidup (Requirement 14.6). Catatan: fitur
 * "duplikat tab" pada browser ikut menyalin sessionStorage.
 *
 * Testabilitas: CBTApp.createApp(deps) dengan deps opsional
 *   { window, document, location, history, sessionStorage, crypto, api, ui,
 *     pages, container, now }
 * Dependensi yang tidak disuntik diambil dari global saat start(). Di Node
 * (module.exports tersedia) app tidak dijalankan otomatis.
 */
var CBTApp = (function () {
  'use strict';

  var DEVICE_KEY = 'cbt_device';
  var JEDA_TOAST_SESI_MS = 3000;
  var MAKS_REDIRECT = 5;

  var HOME = { ADMIN: '#/admin', PESERTA: '#/peserta' };
  var HASH_LOGIN = '#/login';
  var HASH_GANTI_PASSWORD = '#/ganti-password';

  /**
   * Tabel rute. `page` = kunci di CBT.pages. `akses`:
   *   'publik' (hanya saat belum login), 'login' (semua peran yang login),
   *   'ADMIN', atau 'PESERTA'.
   */
  var ROUTES = [
    { pola: 'login', page: 'login', akses: 'publik' },
    { pola: 'ganti-password', page: 'ganti-password', akses: 'login' },
    { pola: 'admin', page: 'admin', akses: 'ADMIN' },
    { pola: 'admin/peserta', page: 'admin/peserta', akses: 'ADMIN' },
    { pola: 'admin/mapel', page: 'admin/mapel', akses: 'ADMIN' },
    { pola: 'admin/soal', page: 'admin/soal', akses: 'ADMIN' },
    { pola: 'admin/import', page: 'admin/import', akses: 'ADMIN' },
    { pola: 'admin/laporan', page: 'admin/laporan', akses: 'ADMIN' },
    { pola: 'admin/detail/:idSesi', page: 'admin/detail', akses: 'ADMIN' },
    { pola: 'peserta', page: 'peserta', akses: 'PESERTA' },
    { pola: 'peserta/konfirmasi/:kodeMapel', page: 'peserta/konfirmasi', akses: 'PESERTA' },
    { pola: 'ujian/:idSesi', page: 'ujian', akses: 'PESERTA' },
    { pola: 'hasil/:idSesi', page: 'hasil', akses: 'PESERTA' }
  ];

  function isObj(x) { return x !== null && typeof x === 'object'; }

  /* ---------- fungsi murni ---------- */

  /**
   * Memecah hash menjadi segmen yang sudah di-decode.
   * '#/admin/detail/S%201' → ['admin','detail','S 1']. Query (?...) diabaikan.
   * @returns {string[]|null} null jika encoding rusak
   */
  function parseHash(hash) {
    var h = typeof hash === 'string' ? hash : '';
    if (h.charAt(0) === '#') h = h.slice(1);
    var q = h.indexOf('?');
    if (q !== -1) h = h.slice(0, q);
    var seg = h.split('/').filter(function (s) { return s !== ''; });
    try {
      return seg.map(function (s) { return decodeURIComponent(s); });
    } catch (e) {
      return null;
    }
  }

  /** Mencocokkan segmen ke ROUTES. @returns {{route, params}|null} */
  function matchRoute(segmen) {
    if (!segmen || segmen.length === 0) return null;
    for (var i = 0; i < ROUTES.length; i++) {
      var pola = ROUTES[i].pola.split('/');
      if (pola.length !== segmen.length) continue;
      var params = {};
      var cocok = true;
      for (var j = 0; j < pola.length; j++) {
        if (pola[j].charAt(0) === ':') {
          if (segmen[j].trim() === '') { cocok = false; break; }
          params[pola[j].slice(1)] = segmen[j];
        } else if (pola[j] !== segmen[j]) {
          cocok = false;
          break;
        }
      }
      if (cocok) return { route: ROUTES[i], params: params };
    }
    return null;
  }

  /** Menormalkan user dari Backend; peran tak dikenal → null. */
  function normalisasiUser(u) {
    if (!isObj(u)) return null;
    var peran = String(u.peran === undefined || u.peran === null ? '' : u.peran).trim().toUpperCase();
    if (!Object.prototype.hasOwnProperty.call(HOME, peran)) return null;
    var str = function (v) { return v === undefined || v === null ? '' : String(v); };
    return {
      id: str(u.id),
      nama: str(u.nama),
      peran: peran,
      kelas: str(u.kelas),
      wajibGantiPassword: u.wajibGantiPassword === true
    };
  }

  function wajibGanti(user) {
    return !!user && user.peran === 'ADMIN' && user.wajibGantiPassword === true;
  }

  /** Hash beranda untuk user (null → #/login). */
  function homeFor(user) {
    var u = normalisasiUser(user);
    if (!u) return HASH_LOGIN;
    if (wajibGanti(u)) return HASH_GANTI_PASSWORD;
    return HOME[u.peran];
  }

  /**
   * Keputusan guard untuk sebuah hash.
   * @param {string} hash mis. '#/admin/peserta'
   * @param {object|null} user
   * @returns {{page:string, params:object}|{redirect:string}}
   */
  function resolveRoute(hash, user) {
    var u = normalisasiUser(user);
    var segmen = parseHash(hash);
    var m = segmen ? matchRoute(segmen) : null;

    if (!u) {
      if (m && m.route.akses === 'publik') return { page: m.route.page, params: m.params };
      return { redirect: HASH_LOGIN };
    }
    if (wajibGanti(u)) {
      if (m && m.route.page === 'ganti-password') return { page: m.route.page, params: m.params };
      return { redirect: HASH_GANTI_PASSWORD };
    }
    if (!m || m.route.akses === 'publik') return { redirect: homeFor(u) };
    if (m.route.akses === 'login' || m.route.akses === u.peran) {
      return { page: m.route.page, params: m.params };
    }
    return { redirect: homeFor(u) };
  }

  /** Normalisasi argumen navigate: 'admin' / '/admin' / '#admin' → '#/admin'. */
  function normalisasiHash(hash) {
    var h = typeof hash === 'string' ? hash.trim() : '';
    if (h.charAt(0) === '#') h = h.slice(1);
    if (h.charAt(0) === '/') h = h.slice(1);
    return '#/' + h;
  }

  /* ---------- aplikasi ---------- */

  function createApp(initialDeps) {
    var deps = isObj(initialDeps) ? initialDeps : {};
    var g = typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : {});

    var state = {
      user: null,
      deviceId: null,
      route: null,        // {page, params, hash}
      halaman: null,      // objek halaman aktif
      siap: false,        // routing awal selesai
      booting: false,
      keluar: false,      // logout sedang berjalan
      hashTerakhir: null,
      toastSesiTerakhir: -Infinity
    };
    var urutRender = 0;
    var mulai = null;

    function W() { return deps.window || g; }
    function D() { return deps.document || W().document; }
    function L() { return deps.location || W().location; }
    function H() { return deps.history !== undefined ? deps.history : W().history; }
    function api() { return deps.api || (W().CBT && W().CBT.api); }
    function ui() { return deps.ui || (W().CBT && W().CBT.ui); }
    function pages() { return deps.pages || (W().CBT && W().CBT.pages) || {}; }
    function now() { return typeof deps.now === 'function' ? deps.now() : Date.now(); }
    function wadah() { return deps.container || D().getElementById('app'); }

    function sesiStorage() {
      if (deps.sessionStorage !== undefined) return deps.sessionStorage;
      try { return W().sessionStorage; } catch (e) { return null; }
    }

    /* ---- deviceId ---- */

    function buatId() {
      var c = deps.crypto !== undefined ? deps.crypto : W().crypto;
      var hex = '';
      try {
        if (c && typeof c.getRandomValues === 'function') {
          var b = c.getRandomValues(new Uint8Array(16));
          for (var i = 0; i < b.length; i++) hex += (b[i] < 16 ? '0' : '') + b[i].toString(16);
        }
      } catch (e) { hex = ''; }
      if (hex === '') {
        for (var j = 0; j < 4; j++) hex += Math.floor(Math.random() * 0x100000000).toString(16);
        hex += now().toString(16);
      }
      return 'd-' + hex;
    }

    /** deviceId per tab; dibuat sekali, disimpan di sessionStorage. */
    function getDeviceId() {
      if (state.deviceId) return state.deviceId;
      var s = sesiStorage();
      var id = null;
      try { id = s ? s.getItem(DEVICE_KEY) : null; } catch (e) { id = null; }
      if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{8,80}$/.test(id)) {
        id = buatId();
        try { if (s) s.setItem(DEVICE_KEY, id); } catch (e) { /* tetap di memori */ }
      }
      state.deviceId = id;
      return id;
    }

    /* ---- hash ---- */

    function lokasiHash() {
      try { return L().hash || ''; } catch (e) { return ''; }
    }

    /** Ganti hash tanpa menambah riwayat (untuk redirect guard). */
    function gantiHash(hash) {
      var h = H();
      try {
        if (h && typeof h.replaceState === 'function') h.replaceState(null, '', hash);
        else L().replace(hash);
      } catch (e) {
        try { L().hash = hash; } catch (e2) { /* abaikan */ }
      }
      state.hashTerakhir = lokasiHash();
    }

    /* ---- render ---- */

    function hancurkanHalaman() {
      var p = state.halaman;
      state.halaman = null;
      if (p && typeof p.destroy === 'function') {
        try { p.destroy(); } catch (e) { /* jangan halangi navigasi */ }
      }
    }

    function salinUser() {
      return state.user ? Object.assign({}, state.user) : null;
    }

    function tampilkanPesan(c, judul, pesan, aksi) {
      var U = ui();
      U.kosongkan(c);
      c.appendChild(U.el('div', { class: 'container' },
        U.el('div', { class: 'card' }, [
          U.el('div', { class: 'card-body stack' }, [
            U.el('h1', { class: 'card-title', text: judul }),
            U.el('div', { class: 'alert alert-danger', role: 'alert', text: pesan }),
            aksi || null
          ])
        ])));
    }

    function tampilkanHalaman(pageKey, params, hash) {
      hancurkanHalaman();
      var token = ++urutRender;
      var c = wadah();
      var U = ui();
      U.kosongkan(c);
      state.route = { page: pageKey, params: params, hash: hash };

      var page = pages()[pageKey];
      if (!isObj(page) || typeof page.render !== 'function') {
        tampilkanPesan(c, 'Halaman belum tersedia',
          'Halaman ini belum tersedia di versi aplikasi ini.',
          state.user ? U.el('button', { type: 'button', class: 'btn btn-primary', onclick: goHome }, 'Ke beranda') : null);
        return Promise.resolve();
      }
      state.halaman = page;

      var aktif = function () { return token === urutRender; };
      var ctx = {
        api: api(),
        ui: U,
        user: salinUser(),
        params: params,
        deviceId: getDeviceId(),
        navigate: navigate,
        logout: logout,
        setUser: setUser,
        goHome: goHome,
        aktif: aktif
      };
      var gagal = function () {
        if (!aktif()) return;
        var info = U.pesanError('ERROR_UMUM');
        tampilkanPesan(c, 'Terjadi kesalahan', info.teks, null);
      };
      try {
        return Promise.resolve(page.render(c, params, ctx)).then(function () {}, gagal);
      } catch (e) {
        gagal();
        return Promise.resolve();
      }
    }

    /** Merutekan hash saat ini (dengan guard). */
    function route() {
      var hash = lokasiHash();
      for (var i = 0; i < MAKS_REDIRECT; i++) {
        var r = resolveRoute(hash, state.user);
        if (r.redirect !== undefined) {
          if (r.redirect === hash) break;
          gantiHash(r.redirect);
          hash = lokasiHash();
          continue;
        }
        state.hashTerakhir = hash;
        return tampilkanHalaman(r.page, r.params, hash);
      }
      // Seharusnya tidak terjadi: jatuh ke login.
      state.user = null;
      gantiHash(HASH_LOGIN);
      return tampilkanHalaman('login', {}, lokasiHash());
    }

    /** Pindah ke hash (menambah riwayat) lalu merutekan. */
    function navigate(hash) {
      var h = normalisasiHash(hash);
      if (lokasiHash() !== h) {
        try { L().hash = h; } catch (e) { /* abaikan */ }
      }
      state.hashTerakhir = lokasiHash();
      return route();
    }

    function goHome() {
      return navigate(homeFor(state.user));
    }

    function setUser(user) {
      state.user = normalisasiUser(user);
      return salinUser();
    }

    function onHashChange() {
      if (!state.siap) return;
      if (lokasiHash() === state.hashTerakhir) return;
      route();
    }

    /* ---- sesi ---- */

    function onSessionExpired() {
      if (state.keluar) return; // berasal dari logout yang sedang berjalan
      state.user = null;
      // api.js sudah menghapus Token; diulang di sini agar hook aman dipanggil langsung.
      try {
        var A = api();
        if (A && typeof A.clearToken === 'function') A.clearToken();
      } catch (e) { /* abaikan */ }
      var t = now();
      if (t - state.toastSesiTerakhir >= JEDA_TOAST_SESI_MS) {
        state.toastSesiTerakhir = t;
        try {
          var U = ui();
          U.toast(U.pesanError('SESI_BERAKHIR').teks, 'peringatan');
        } catch (e) { /* abaikan */ }
      }
      if (state.siap) navigate(HASH_LOGIN);
    }

    /**
     * Keluar (Requirement 2.9): permintaan logout dikirim dengan Token saat ini,
     * Token langsung dihapus dan #/login ditampilkan tanpa menunggu respons.
     * @returns {Promise<void>} selesai saat permintaan logout selesai
     */
    function logout() {
      var A = api();
      state.keluar = true;
      var p;
      try { p = A.logout(); } catch (e) { p = null; }
      try { if (typeof A.clearToken === 'function') A.clearToken(); } catch (e) { /* abaikan */ }
      state.user = null;
      navigate(HASH_LOGIN);
      var selesai = function () { state.keluar = false; };
      return Promise.resolve(p).then(selesai, selesai);
    }

    /* ---- boot ---- */

    function tampilkanMemuat(teks) {
      var U = ui();
      var c = wadah();
      hancurkanHalaman();
      U.kosongkan(c);
      c.appendChild(U.el('div', { class: 'loading loading-page', role: 'status' }, [
        U.el('span', { class: 'spinner', 'aria-hidden': 'true' }),
        U.el('span', { text: teks })
      ]));
    }

    function selesaiBoot() {
      state.booting = false;
      state.siap = true;
      return route();
    }

    /** Verifikasi Token via api.me() (Requirement 2.12). */
    function verifikasiToken() {
      state.booting = true;
      state.siap = false;
      tampilkanMemuat('Memeriksa sesi login...');
      return Promise.resolve(api().me()).then(function (env) {
        if (env && env.ok) {
          setUser(env.data && env.data.user);
          return selesaiBoot();
        }
        var code = env && env.error ? env.error.code : 'KONEKSI_GAGAL';
        if (code === 'SESI_BERAKHIR') {
          state.user = null;
          return selesaiBoot();
        }
        tampilkanGagalBoot(env ? env.error : null);
        return undefined;
      }, function () {
        tampilkanGagalBoot(null);
      });
    }

    /** Layar error saat verifikasi gagal karena jaringan/server; Token dipertahankan. */
    function tampilkanGagalBoot(error) {
      state.booting = false;
      var U = ui();
      var info = U.pesanError(error || 'KONEKSI_GAGAL');
      var btn = U.el('button', { type: 'button', class: 'btn btn-primary', 'data-aksi': 'coba-lagi' }, 'Coba lagi');
      btn.addEventListener('click', function () {
        U.withBusy(btn, function () { return verifikasiToken(); });
      });
      tampilkanPesan(wadah(), 'Gagal memeriksa sesi login', info.teks, btn);
    }

    /**
     * Menjalankan aplikasi. Idempoten.
     * @returns {Promise<void>} selesai saat halaman pertama dirender
     *   (atau layar error verifikasi ditampilkan)
     */
    function start() {
      if (mulai) return mulai;
      var A = api();
      A.onSessionExpired = onSessionExpired;
      try { W().addEventListener('hashchange', onHashChange); } catch (e) { /* abaikan */ }
      getDeviceId();
      var token = null;
      try { token = A.getToken(); } catch (e) { token = null; }
      mulai = token ? verifikasiToken() : selesaiBoot();
      return mulai;
    }

    return {
      start: start,
      navigate: navigate,
      route: route,
      logout: logout,
      setUser: setUser,
      goHome: goHome,
      getDeviceId: getDeviceId,
      onSessionExpired: onSessionExpired,
      state: state
    };
  }

  return {
    createApp: createApp,
    resolveRoute: resolveRoute,
    parseHash: parseHash,
    matchRoute: matchRoute,
    normalisasiUser: normalisasiUser,
    homeFor: homeFor,
    ROUTES: ROUTES,
    DEVICE_KEY: DEVICE_KEY
  };
})();

(function () {
  var diNode = typeof module !== 'undefined' && module.exports;
  if (typeof window === 'undefined' || diNode) return;
  var CBT = window.CBT = window.CBT || {};
  CBT.pages = CBT.pages || {};
  CBT.app = CBTApp.createApp();
  CBT.app.createApp = CBTApp.createApp;
  CBT.app.resolveRoute = CBTApp.resolveRoute;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { CBT.app.start(); });
  } else {
    CBT.app.start();
  }
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CBTApp;
}
