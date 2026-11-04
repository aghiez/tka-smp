/*
 * api.js — Lapisan_API Frontend (design.md §2).
 *
 * Satu-satunya file Frontend yang membaca CBT_CONFIG.API_URL dan memanggil
 * fetch / google.script.run (Requirement 1.1, 1.5). Halaman hanya memanggil
 * CBT.api.<operasi>(params, opts).
 *
 * CBT.api.call(action, params, { timeoutMs, retryBusy }) -> Promise<Envelope>
 *   1. API_URL kosong dan google.script.run tidak tersedia ->
 *      BACKEND_BELUM_DIKONFIGURASI tanpa request (Requirement 1.9).
 *   2. Body: JSON.stringify({ action, token: storage['cbt_token'] || null, params }).
 *      Transport: google.script.run.handleRequest(body) jika tersedia
 *      (HtmlService), selain itu fetch POST text/plain;charset=utf-8.
 *   3. Batas waktu per percobaan: 30 detik; 15 detik untuk simpanJawaban dan
 *      sisaWaktu; opts.timeoutMs menimpa (mis. 15000 untuk pengumpulan
 *      otomatis) -> BATAS_WAKTU (Requirement 1.7, 26.8).
 *   4. Error jaringan / respons bukan JSON envelope -> KONEKSI_GAGAL.
 *   5. SIBUK -> diulang maksimal 3 kali dengan jeda 2 detik (Requirement 26.7);
 *      opts.retryBusy = false mematikan pengulangan.
 *   6. SESI_BERAKHIR -> Token dihapus dari storage lalu hook onSessionExpired
 *      dipanggil (Requirement 2.7).
 *   Promise selalu resolve dengan Envelope; tidak pernah reject/melempar.
 *
 * Fungsi bernama: satu per kunci OPERASI di backend/Code.gs (Requirement 1.2),
 * daftarnya di CBT.api.ACTIONS. Efek samping Token:
 *   - login ok  -> Token disimpan ke storage.
 *   - logout    -> Token dihapus dari storage apa pun hasilnya (Requirement 2.9).
 *
 * Dependensi dapat disuntik (untuk tes) lewat createApi(deps) atau
 * CBT.api.configure(deps):
 *   fetch, gsr (objek google.script.run), setTimeout, clearTimeout,
 *   AbortController, storage ({getItem, setItem, removeItem}),
 *   config ({API_URL}), onSessionExpired(envelope).
 * Dependensi yang tidak disuntik diambil dari global saat setiap panggilan.
 */
var CBTApi = (function (root) {
  'use strict';

  var TOKEN_KEY = 'cbt_token';
  var TIMEOUT_DEFAULT_MS = 30000;
  var TIMEOUT_PENDEK_MS = 15000;
  var SIBUK_MAKS_ULANG = 3;
  var SIBUK_JEDA_MS = 2000;

  /** Operasi dengan batas waktu 15 detik (Requirement 26.8). */
  var AKSI_PENDEK = { simpanJawaban: true, sisaWaktu: true };

  /** Tepat sama dengan kunci OPERASI di backend/Code.gs. */
  var ACTIONS = [
    'ping', 'login', 'me', 'logout', 'gantiPassword',
    'listPeserta', 'getUserKeys', 'createPeserta', 'updatePeserta', 'deletePeserta',
    'resetPasswordPeserta', 'importPeserta',
    'listMapel', 'createMapel', 'updateMapel', 'deleteMapel',
    'listSoal', 'createSoal', 'updateSoal', 'deleteSoal', 'importSoal',
    'resetSesi', 'rekapMapel', 'rekapPeserta', 'detailJawaban', 'hitungUlang', 'muatDataContoh',
    'listUjian', 'mulaiUjian', 'lanjutUjian', 'simpanJawaban', 'sisaWaktu', 'kumpulkan', 'lihatHasil',
    // tampilan-anbk design §1: publik tanpa Token (Requirement 1.3, 6.4).
    'infoAplikasi', 'daftarMapelPublik',
    // Peserta: konfirmasi, Token_Ujian, verifikasi, info tes, reviu (Requirement 10.2, 11.3, 12.5, 14.7, 31.1).
    'infoKonfirmasi', 'tokenUjianPeserta', 'verifikasiUjian', 'infoTes', 'reviuHasil',
    // Admin: pengaturan dan Token_Ujian.
    'getPengaturan', 'simpanPengaturan', 'lihatTokenUjian', 'gantiTokenUjian'
  ];

  var PESAN = {
    KONEKSI_GAGAL: 'Tidak dapat terhubung ke server, periksa internet.',
    BATAS_WAKTU: 'Server tidak merespons.',
    BACKEND_BELUM_DIKONFIGURASI: 'Alamat Backend belum diisi di config.js.',
    VALIDASI: 'Format permintaan tidak valid.'
  };

  function fail(code, message) {
    return { ok: false, data: null, error: { code: code, message: message || PESAN[code] || code } };
  }

  function isObj(x) { return x !== null && typeof x === 'object'; }

  /**
   * Menormalkan nilai dari transport menjadi Envelope. String di-parse JSON.
   * Bentuk tidak dikenal -> KONEKSI_GAGAL.
   */
  function toEnvelope(raw) {
    var v = raw;
    if (typeof v === 'string') {
      try { v = JSON.parse(v); } catch (e) { return fail('KONEKSI_GAGAL'); }
    }
    if (!isObj(v) || typeof v.ok !== 'boolean') return fail('KONEKSI_GAGAL');
    if (v.ok) return { ok: true, data: v.data === undefined ? null : v.data, error: null };
    var err = v.error;
    if (!isObj(err) || typeof err.code !== 'string' || err.code === '') return fail('KONEKSI_GAGAL');
    var out = { code: err.code, message: typeof err.message === 'string' && err.message !== '' ? err.message : err.code };
    if (isObj(err.fields)) out.fields = err.fields;
    if (typeof err.retryAfterMin === 'number') out.retryAfterMin = err.retryAfterMin;
    return { ok: false, data: null, error: out };
  }

  function createApi(initialDeps) {
    var deps = {};
    var api = {};

    function configure(d) {
      if (isObj(d)) {
        for (var k in d) {
          if (Object.prototype.hasOwnProperty.call(d, k)) deps[k] = d[k];
        }
      }
      return api;
    }
    configure(initialDeps);

    // ---- Resolusi dependensi (suntikan dulu, lalu global) ----
    function g(name) {
      try { return root ? root[name] : undefined; } catch (e) { return undefined; }
    }
    function getStorage() {
      if (deps.storage !== undefined) return deps.storage;
      return g('localStorage');
    }
    function getConfig() {
      if (deps.config !== undefined) return deps.config;
      return g('CBT_CONFIG');
    }
    function getGsr() {
      if (deps.gsr !== undefined) return deps.gsr;
      var goog = g('google');
      try {
        return goog && goog.script && goog.script.run ? goog.script.run : null;
      } catch (e) { return null; }
    }
    function getFetch() {
      if (deps.fetch !== undefined) return deps.fetch;
      var f = g('fetch');
      return typeof f === 'function' ? function (u, o) { return f.call(root, u, o); } : null;
    }
    function timers() {
      var st = deps.setTimeout || g('setTimeout');
      var ct = deps.clearTimeout || g('clearTimeout');
      return {
        set: function (fn, ms) { return st.call(root, fn, ms); },
        clear: function (h) { try { if (ct) ct.call(root, h); } catch (e) { /* abaikan */ } }
      };
    }
    function getAbortController() {
      if (deps.AbortController !== undefined) return deps.AbortController;
      return g('AbortController');
    }
    function apiUrl() {
      try {
        var c = getConfig();
        var u = c && c.API_URL;
        return typeof u === 'string' ? u.trim() : '';
      } catch (e) { return ''; }
    }

    // ---- Token ----
    function getToken() {
      try {
        var s = getStorage();
        var t = s ? s.getItem(TOKEN_KEY) : null;
        return typeof t === 'string' && t !== '' ? t : null;
      } catch (e) { return null; }
    }
    function setToken(token) {
      try {
        var s = getStorage();
        if (s && typeof token === 'string' && token !== '') s.setItem(TOKEN_KEY, token);
      } catch (e) { /* abaikan */ }
    }
    function clearToken() {
      try {
        var s = getStorage();
        if (s && typeof s.removeItem === 'function') s.removeItem(TOKEN_KEY);
      } catch (e) { /* abaikan */ }
    }

    // ---- Transport ----
    /** Satu percobaan; resolve Envelope, tidak pernah reject. */
    function sendOnce(body, timeoutMs) {
      return new Promise(function (resolve) {
        var done = false;
        var t = timers();
        var timer = null;
        var controller = null;

        function settle(env) {
          if (done) return;
          done = true;
          if (timer !== null) t.clear(timer);
          resolve(env);
        }

        try {
          var gsr = getGsr();
          var url = apiUrl();
          var fetchFn = gsr ? null : getFetch();
          if (!gsr && (url === '' || !fetchFn)) {
            settle(url === '' ? fail('BACKEND_BELUM_DIKONFIGURASI') : fail('KONEKSI_GAGAL'));
            return;
          }

          timer = t.set(function () {
            timer = null;
            if (controller) { try { controller.abort(); } catch (e) { /* abaikan */ } }
            settle(fail('BATAS_WAKTU'));
          }, timeoutMs);

          if (gsr) {
            gsr.withSuccessHandler(function (res) { settle(toEnvelope(res)); })
              .withFailureHandler(function () { settle(fail('KONEKSI_GAGAL')); })
              .handleRequest(body);
            return;
          }

          var AC = getAbortController();
          if (typeof AC === 'function') {
            try { controller = new AC(); } catch (e) { controller = null; }
          }
          var opts = {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: body,
            redirect: 'follow'
          };
          if (controller) opts.signal = controller.signal;

          Promise.resolve(fetchFn(url, opts))
            .then(function (res) {
              if (!res || typeof res.text !== 'function') return null;
              return res.text();
            })
            .then(function (text) {
              settle(typeof text === 'string' ? toEnvelope(text) : fail('KONEKSI_GAGAL'));
            }, function () {
              settle(fail('KONEKSI_GAGAL'));
            });
        } catch (e) {
          settle(fail('KONEKSI_GAGAL'));
        }
      });
    }

    function delay(ms) {
      return new Promise(function (resolve) {
        try { timers().set(resolve, ms); } catch (e) { resolve(); }
      });
    }

    function handleSessionExpired(env) {
      clearToken();
      try {
        var hook = deps.onSessionExpired || api.onSessionExpired;
        if (typeof hook === 'function') hook(env);
      } catch (e) { /* abaikan */ }
    }

    /**
     * @param {string} action nama operasi
     * @param {object} [params]
     * @param {{timeoutMs?: number, retryBusy?: boolean}} [opts]
     * @returns {Promise<Envelope>} selalu resolve
     */
    function call(action, params, opts) {
      try {
        var o = isObj(opts) ? opts : {};
        var timeoutMs = typeof o.timeoutMs === 'number' && o.timeoutMs > 0 && isFinite(o.timeoutMs)
          ? o.timeoutMs
          : (AKSI_PENDEK[action] === true ? TIMEOUT_PENDEK_MS : TIMEOUT_DEFAULT_MS);
        var retryBusy = o.retryBusy !== false;
        var p = params === undefined || params === null ? {} : params;

        if (apiUrl() === '' && !getGsr()) {
          return Promise.resolve(fail('BACKEND_BELUM_DIKONFIGURASI'));
        }

        var attempt = 0;
        var loop = function () {
          var body;
          try {
            body = JSON.stringify({ action: action, token: getToken(), params: p });
          } catch (e) {
            return Promise.resolve(fail('VALIDASI'));
          }
          if (typeof body !== 'string') return Promise.resolve(fail('VALIDASI'));
          return sendOnce(body, timeoutMs).then(function (env) {
            if (!env.ok && env.error.code === 'SIBUK' && retryBusy && attempt < SIBUK_MAKS_ULANG) {
              attempt++;
              return delay(SIBUK_JEDA_MS).then(loop);
            }
            if (!env.ok && env.error.code === 'SESI_BERAKHIR') handleSessionExpired(env);
            return env;
          });
        };
        return loop().then(null, function () { return fail('KONEKSI_GAGAL'); });
      } catch (e) {
        return Promise.resolve(fail('KONEKSI_GAGAL'));
      }
    }

    api.call = call;
    api.configure = configure;
    api.getToken = getToken;
    api.setToken = setToken;
    api.clearToken = clearToken;
    api.onSessionExpired = null;
    api.ACTIONS = ACTIONS.slice();
    api.TOKEN_KEY = TOKEN_KEY;
    api.TIMEOUT_DEFAULT_MS = TIMEOUT_DEFAULT_MS;
    api.TIMEOUT_PENDEK_MS = TIMEOUT_PENDEK_MS;

    ACTIONS.forEach(function (action) {
      api[action] = function (params, opts) { return call(action, params, opts); };
    });

    // Efek samping Token untuk login/logout.
    api.login = function (params, opts) {
      return call('login', params, opts).then(function (env) {
        if (env.ok && isObj(env.data)) setToken(env.data.token);
        return env;
      });
    };
    api.logout = function (params, opts) {
      return call('logout', params, opts).then(function (env) {
        clearToken();
        return env;
      });
    };

    return api;
  }

  return { createApi: createApi, ACTIONS: ACTIONS.slice(), toEnvelope: toEnvelope };
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

(function (root) {
  if (!root) return;
  root.CBT = root.CBT || {};
  root.CBT.api = CBTApi.createApi();
  root.CBT.api.createApi = CBTApi.createApi;
})(typeof window !== 'undefined' ? window : null);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CBTApi;
}
