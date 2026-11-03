/*
 * answer-queue.js — antrean simpan otomatis jawaban Halaman_Ujian.
 *
 * Modul murni: penyimpanan, jam, dan pengirim disuntik sebagai adaptor sehingga
 * dapat dites di Node dengan jam tiruan. Dipakai di Frontend (window.AnswerQueue)
 * dan di tes Node lewat module.exports.
 *
 * Adaptor:
 *   storage : { getItem(key), setItem(key, value), removeItem?(key) }  (mis. localStorage)
 *   clock   : { now(): ms, setTimeout(fn, ms): handle, clearTimeout(handle) }
 *   sender  : (items) => Promise<Envelope>   Envelope = { ok, data, error }
 *             items = [{ idSoal, pilihan: string[], ragu: boolean, t: number }]
 *             data  = { tersimpan: string[], ditolak: [{ idSoal, alasan }], sisaDetik }
 *             Pengirim tidak pernah melempar; tetap dijaga dengan try/catch.
 *
 * Perilaku (Requirement 16.2, 18.1, 18.4–18.7, 18.9, 18.11, 18.13, 19.10):
 *   - put() menulis ke storage kunci 'cbt_q_<idSesi>' secara sinkron; entri per
 *     idSoal = nilai terakhir + t (waktu perubahan, naik monoton).
 *   - Perubahan pertama menjadwalkan flush 1 detik kemudian (debounce batch).
 *   - Entri dihapus hanya jika t-nya tidak berubah sejak dikirim dan Backend
 *     mengonfirmasi (tersimpan) atau menolak (ditolak).
 *   - Gagal sementara (KONEKSI_GAGAL, BATAS_WAKTU, SIBUK) → entri tetap, jadwal
 *     ulang 2, 4, 8, 16, 30 detik lalu 30 detik.
 *   - Error lain (mis. PERANGKAT_LAIN, WAKTU_HABIS, UJIAN_SELESAI) → entri tetap,
 *     tidak dicoba ulang otomatis; halaman memutuskan tindakan lewat onResult.
 *   - notifyOnline()/notifyRequestOk() atau request berhasil setelah gagal →
 *     flush segera (≤ 2 detik), item diurutkan menurut t.
 *   - Jika setItem gagal (tidak tersedia/penuh) → antrean tetap di memori dan
 *     storageAvailable() bernilai false (untuk peringatan di halaman).
 */
var AnswerQueue = (function () {
  'use strict';

  var PREFIX_KUNCI = 'cbt_q_';
  var DEBOUNCE_MS = 1000;
  var SEGERA_MS = 0;
  var JADWAL_BACKOFF = [2, 4, 8, 16, 30];
  var BACKOFF_MAKS = 30;

  /** Kode error yang dianggap gagal sementara dan dicoba ulang otomatis. */
  var KODE_ULANG = { KONEKSI_GAGAL: true, BATAS_WAKTU: true, SIBUK: true };

  var MENYIMPAN = 'MENYIMPAN';
  var TERSIMPAN = 'TERSIMPAN';
  var BELUM_TERSIMPAN = 'BELUM_TERSIMPAN';

  // ---------------------------------------------------------------------------
  // Fungsi murni
  // ---------------------------------------------------------------------------

  /**
   * Jeda sebelum percobaan ulang ke-`attempt` (0 = percobaan ulang pertama), dalam detik.
   * Requirement 18.6: 2, 4, 8, 16, 30, lalu 30 seterusnya.
   */
  function backoffDelay(attempt) {
    var k = Math.floor(Number(attempt));
    if (!(k >= 0)) k = 0;
    return k < JADWAL_BACKOFF.length ? JADWAL_BACKOFF[k] : BACKOFF_MAKS;
  }

  function salinPilihan(p) {
    return Array.isArray(p) ? p.map(String) : [];
  }

  /**
   * Menggabungkan jawaban Backend dengan antrean lokal (Requirement 18.9).
   * Kedua argumen berbentuk { [idSoal]: { pilihan, ragu, t? } }. Entri antrean lokal
   * menimpa nilai Backend; soal lain memakai nilai Backend. Input tidak diubah.
   * @returns {Object<string,{pilihan:string[], ragu:boolean}>}
   */
  function mergeJawaban(dariBackend, antreanLokal) {
    var hasil = {};
    var b = dariBackend || {};
    var l = antreanLokal || {};
    Object.keys(b).forEach(function (id) {
      var v = b[id] || {};
      hasil[id] = { pilihan: salinPilihan(v.pilihan), ragu: v.ragu === true };
    });
    Object.keys(l).forEach(function (id) {
      var v = l[id] || {};
      hasil[id] = { pilihan: salinPilihan(v.pilihan), ragu: v.ragu === true };
    });
    return hasil;
  }

  // ---------------------------------------------------------------------------
  // Adaptor bawaan
  // ---------------------------------------------------------------------------

  function jamBawaan() {
    return {
      now: function () { return Date.now(); },
      setTimeout: function (fn, ms) { return setTimeout(fn, ms); },
      clearTimeout: function (h) { clearTimeout(h); }
    };
  }

  /** Membaca antrean dari storage; mengembalikan null jika storage tidak terbaca. */
  function bacaStorage(storage, kunci) {
    if (!storage || typeof storage.getItem !== 'function') return null;
    try {
      var raw = storage.getItem(kunci);
      if (raw === null || raw === undefined || raw === '') return {};
      var obj = JSON.parse(raw);
      var hasil = {};
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        Object.keys(obj).forEach(function (id) {
          var v = obj[id];
          if (v && typeof v === 'object' && typeof v.t === 'number' && isFinite(v.t)) {
            hasil[id] = { pilihan: salinPilihan(v.pilihan), ragu: v.ragu === true, t: v.t };
          }
        });
      }
      return hasil;
    } catch (e) {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Kelas AnswerQueue
  // ---------------------------------------------------------------------------

  /**
   * @param {string} idSesi
   * @param {object} storage adaptor getItem/setItem(/removeItem)
   * @param {object} [clock] adaptor now/setTimeout/clearTimeout (default jam sistem)
   * @param {function} sender (items) => Promise<Envelope>
   * @param {object} [options] { onState(state), onResult(result) }
   */
  function Queue(idSesi, storage, clock, sender, options) {
    if (typeof sender !== 'function') throw new Error('sender wajib berupa fungsi');
    this.idSesi = String(idSesi);
    this.kunci = PREFIX_KUNCI + this.idSesi;
    this._storage = storage || null;
    this._clock = clock || jamBawaan();
    this._sender = sender;
    this._opt = options || {};

    var dimuat = bacaStorage(this._storage, this.kunci);
    this._storageOk = dimuat !== null;
    this._entri = dimuat || {};
    this._lastT = 0;
    var self = this;
    Object.keys(this._entri).forEach(function (id) {
      if (self._entri[id].t > self._lastT) self._lastT = self._entri[id].t;
    });

    this._timer = null;
    this._timerDue = 0;
    this._inFlight = null;     // Promise flush yang sedang berjalan
    this._flushLagi = false;   // flush() dipanggil saat request berjalan
    this._gagal = false;       // pengiriman terakhir gagal (entri belum tersimpan)
    this._attempt = 0;         // jumlah kegagalan sementara berturut-turut
    this._disposed = false;
    this._stateTerakhir = this.state();
  }

  // --- penyimpanan --------------------------------------------------------------

  Queue.prototype._simpan = function () {
    if (!this._storageOk) return false;
    try {
      if (this.size() === 0 && typeof this._storage.removeItem === 'function') {
        this._storage.removeItem(this.kunci);
      } else {
        this._storage.setItem(this.kunci, JSON.stringify(this._entri));
      }
      return true;
    } catch (e) {
      // Penyimpanan tidak tersedia/penuh: lanjut di memori (Requirement 18.13).
      this._storageOk = false;
      return false;
    }
  };

  /** false jika antrean hanya ada di memori (tampilkan peringatan, Requirement 18.13). */
  Queue.prototype.storageAvailable = function () {
    return this._storageOk;
  };

  // --- penjadwalan --------------------------------------------------------------

  Queue.prototype._jadwalkan = function (ms) {
    if (this._disposed || this._inFlight) return;
    var due = this._clock.now() + ms;
    if (this._timer !== null) {
      if (this._timerDue <= due) return; // jadwal yang ada sudah lebih awal
      this._clock.clearTimeout(this._timer);
    }
    var self = this;
    this._timerDue = due;
    this._timer = this._clock.setTimeout(function () {
      self._timer = null;
      self.flush();
    }, ms);
  };

  Queue.prototype._batalJadwal = function () {
    if (this._timer !== null) {
      this._clock.clearTimeout(this._timer);
      this._timer = null;
    }
  };

  Queue.prototype._beriTahuState = function () {
    var s = this.state();
    if (s !== this._stateTerakhir) {
      this._stateTerakhir = s;
      if (typeof this._opt.onState === 'function') {
        try { this._opt.onState(s); } catch (e) { /* abaikan error UI */ }
      }
    }
  };

  // --- API publik -----------------------------------------------------------------

  /**
   * Mencatat jawaban/penanda ragu terakhir untuk satu soal (Requirement 18.1, 16.2).
   * @returns {{t:number, persisted:boolean}}
   */
  Queue.prototype.put = function (idSoal, nilai) {
    var v = nilai || {};
    var t = Math.max(this._clock.now(), this._lastT + 1);
    this._lastT = t;
    this._entri[String(idSoal)] = { pilihan: salinPilihan(v.pilihan), ragu: v.ragu === true, t: t };
    var persisted = this._simpan();
    this._jadwalkan(DEBOUNCE_MS);
    this._beriTahuState();
    return { t: t, persisted: persisted };
  };

  /** Salinan entri antrean { [idSoal]: {pilihan, ragu, t} } (untuk mergeJawaban). */
  Queue.prototype.entries = function () {
    var hasil = {};
    var e = this._entri;
    Object.keys(e).forEach(function (id) {
      hasil[id] = { pilihan: e[id].pilihan.slice(), ragu: e[id].ragu, t: e[id].t };
    });
    return hasil;
  };

  Queue.prototype.size = function () {
    return Object.keys(this._entri).length;
  };

  Queue.prototype.isEmpty = function () {
    return this.size() === 0;
  };

  /**
   * Keadaan indikator (Requirement 18.5):
   *   MENYIMPAN       — request berjalan, atau ada perubahan yang menunggu batch
   *   TERSIMPAN       — antrean kosong dan tidak ada request berjalan
   *   BELUM_TERSIMPAN — antrean memuat entri yang pengirimannya gagal
   */
  Queue.prototype.state = function () {
    if (this._inFlight) return MENYIMPAN;
    if (this.size() === 0) return TERSIMPAN;
    return this._gagal ? BELUM_TERSIMPAN : MENYIMPAN;
  };

  /** Event `online` browser: kirim seluruh antrean segera (Requirement 18.7). */
  Queue.prototype.notifyOnline = function () {
    if (this.size() > 0) this._jadwalkan(SEGERA_MS);
  };

  /** Request lain ke Backend berhasil: kirim ulang segera jika sebelumnya gagal (Requirement 18.7). */
  Queue.prototype.notifyRequestOk = function () {
    if (this._gagal && this.size() > 0) this._jadwalkan(SEGERA_MS);
  };

  /** Menghentikan seluruh timer (mis. saat meninggalkan Halaman_Ujian). */
  Queue.prototype.dispose = function () {
    this._disposed = true;
    this._batalJadwal();
  };

  /**
   * Mengirim seluruh entri sebagai satu batch, diurutkan menurut t.
   * @returns {Promise<{ok:boolean, terkirim:number, tersimpan:string[],
   *   ditolak:Array<{idSoal,alasan}>, sisaDetik?:number, error?:object}>}
   */
  Queue.prototype.flush = function () {
    if (this._inFlight) {
      this._flushLagi = true;
      return this._inFlight;
    }
    this._batalJadwal();
    if (this.size() === 0) {
      return Promise.resolve({ ok: true, terkirim: 0, tersimpan: [], ditolak: [] });
    }

    var e = this._entri;
    var items = Object.keys(e).map(function (id) {
      return { idSoal: id, pilihan: e[id].pilihan.slice(), ragu: e[id].ragu, t: e[id].t };
    }).sort(function (a, b) { return a.t - b.t; });
    var tTerkirim = {};
    items.forEach(function (it) { tTerkirim[it.idSoal] = it.t; });

    var self = this;
    var kirim;
    try {
      kirim = Promise.resolve(this._sender(items.map(function (it) {
        return { idSoal: it.idSoal, pilihan: it.pilihan.slice(), ragu: it.ragu, t: it.t };
      })));
    } catch (err) {
      kirim = Promise.resolve(null);
    }

    this._inFlight = kirim.then(null, function () { return null; }).then(function (env) {
      return self._proses(env, items, tTerkirim);
    });
    this._beriTahuState();
    return this._inFlight;
  };

  Queue.prototype._proses = function (env, items, tTerkirim) {
    var self = this;
    var hasil;
    var adaUlang = false;   // entri terkirim, tidak berubah, tetapi tidak diakui
    var berhasil = !!(env && env.ok);

    if (berhasil) {
      var data = env.data || {};
      var tersimpan = Array.isArray(data.tersimpan) ? data.tersimpan.map(String) : [];
      var ditolak = Array.isArray(data.ditolak) ? data.ditolak : [];
      var selesai = {};
      tersimpan.forEach(function (id) { selesai[id] = true; });
      ditolak.forEach(function (d) { if (d && d.idSoal !== undefined) selesai[String(d.idSoal)] = true; });

      items.forEach(function (it) {
        var cur = self._entri[it.idSoal];
        if (!cur || cur.t !== tTerkirim[it.idSoal]) return; // diubah lagi saat request berjalan
        if (selesai[it.idSoal]) delete self._entri[it.idSoal];
        else adaUlang = true;
      });
      this._simpan();

      var sebelumnyaGagal = this._gagal;
      this._gagal = adaUlang;
      hasil = { ok: true, terkirim: items.length, tersimpan: tersimpan, ditolak: ditolak };
      if (typeof data.sisaDetik === 'number') hasil.sisaDetik = data.sisaDetik;

      this._inFlight = null;
      if (adaUlang) {
        this._jadwalkan(backoffDelay(this._attempt) * 1000);
        this._attempt++;
      } else {
        this._attempt = 0;
        if (this.size() > 0) {
          this._jadwalkan(sebelumnyaGagal || this._flushLagi ? SEGERA_MS : DEBOUNCE_MS);
        }
      }
    } else {
      var error = (env && env.error) || { code: 'KONEKSI_GAGAL', message: '' };
      this._gagal = true;
      hasil = { ok: false, terkirim: items.length, tersimpan: [], ditolak: [], error: error };
      this._inFlight = null;
      if (KODE_ULANG[error.code]) {
        this._jadwalkan(backoffDelay(this._attempt) * 1000);
        this._attempt++;
      }
      // Error lain: entri tetap, tanpa percobaan ulang otomatis.
    }

    this._flushLagi = false;
    this._beriTahuState();
    if (typeof this._opt.onResult === 'function') {
      try { this._opt.onResult(hasil); } catch (e2) { /* abaikan error UI */ }
    }
    return hasil;
  };

  // ---------------------------------------------------------------------------
  // Ekspor
  // ---------------------------------------------------------------------------

  Queue.backoffDelay = backoffDelay;
  Queue.mergeJawaban = mergeJawaban;
  Queue.STATE = Object.freeze({ MENYIMPAN: MENYIMPAN, TERSIMPAN: TERSIMPAN, BELUM_TERSIMPAN: BELUM_TERSIMPAN });
  Queue.PREFIX_KUNCI = PREFIX_KUNCI;

  return {
    AnswerQueue: Queue,
    backoffDelay: backoffDelay,
    mergeJawaban: mergeJawaban,
    STATE: Queue.STATE,
    PREFIX_KUNCI: PREFIX_KUNCI
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = AnswerQueue;
