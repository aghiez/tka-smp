/*
 * pages/ganti-password.js — Halaman ganti password (rute #/ganti-password).
 * Requirement 2.9, 3.6, 3.8, 3.9, 3.10, 25.1, 25.2.
 *
 * - Selama Admin wajib ganti password, router hanya mengizinkan halaman ini
 *   (Requirement 3.6); halaman menampilkan form dan tombol keluar saja.
 * - Validasi Frontend sebelum kirim: password lama wajib, password baru lewat
 *   CBTValidator.validatePasswordBaru (semua pelanggaran ditampilkan
 *   sekaligus), dan ulangi password baru harus sama.
 * - Error dari Backend (mis. passwordLama: "Password lama salah.") ditandai
 *   di samping field; semua isian dipertahankan.
 * - Berhasil: ctx.setUser({...ctx.user, wajibGantiPassword:false}) lalu
 *   ctx.goHome().
 * - Tombol keluar memanggil ctx.logout(): Token dihapus dan #/login tampil
 *   walaupun permintaan logout gagal (Requirement 2.9).
 */
(function () {
  'use strict';
  var CBT = window.CBT = window.CBT || {};
  CBT.pages = CBT.pages || {};

  /**
   * Validasi form ganti password di Frontend. Diekspor untuk tes.
   * @returns {{valid:boolean, value:{passwordLama, passwordBaru}, errors:object}}
   */
  function validasiForm(V, isian) {
    var o = isian || {};
    var errors = {};
    var lama = V.trimText(o.passwordLama);
    if (lama === '') errors.passwordLama = ['Password lama wajib diisi.'];
    var v = V.validatePasswordBaru(o.passwordBaru, lama === '' ? undefined : lama);
    if (!v.valid) errors.passwordBaru = v.errors.passwordBaru.slice();
    var ulang = V.trimText(o.ulangiPassword);
    if (ulang === '') errors.ulangiPassword = ['Ulangi password baru wajib diisi.'];
    else if (ulang !== v.value) errors.ulangiPassword = ['Ulangi password baru tidak sama dengan password baru.'];
    return {
      valid: Object.keys(errors).length === 0,
      value: { passwordLama: lama, passwordBaru: v.value },
      errors: errors
    };
  }

  function render(container, params, ctx) {
    var ui = ctx.ui;
    var V = window.CBTValidator;
    var wajib = !!(ctx.user && ctx.user.wajibGantiPassword);

    function field(id, nama, labelTeks, autocomplete, hint) {
      var input = ui.el('input', {
        type: 'password', id: id, name: nama, autocomplete: autocomplete, maxlength: '300'
      });
      return {
        input: input,
        node: ui.el('div', { class: 'field' }, [
          ui.el('label', { class: 'field-label', for: id, text: labelTeks }),
          input,
          hint ? ui.el('p', { class: 'field-hint', text: hint }) : null,
          ui.el('p', { class: 'field-error', 'data-for': nama, hidden: true })
        ])
      };
    }

    var fLama = field('gp-lama', 'passwordLama', 'Password lama', 'current-password');
    var fBaru = field('gp-baru', 'passwordBaru', 'Password baru', 'new-password',
      '8 sampai 64 karakter, minimal satu huruf dan satu angka, tidak sama dengan password lama.');
    var fUlang = field('gp-ulang', 'ulangiPassword', 'Ulangi password baru', 'new-password');

    var alertEl = ui.el('div', { class: 'alert alert-danger', role: 'alert', hidden: true });
    var tombolSimpan = ui.el('button', { type: 'submit', class: 'btn btn-primary' }, 'Simpan password');
    var tombolKeluar = ui.el('button', { type: 'button', class: 'btn', 'data-aksi': 'keluar' }, 'Keluar');
    var tombolBatal = wajib ? null
      : ui.el('button', { type: 'button', class: 'btn', 'data-aksi': 'batal' }, 'Batal');

    var form = ui.el('form', { class: 'form', novalidate: true, 'data-form': 'ganti-password' }, [
      alertEl,
      fLama.node,
      fBaru.node,
      fUlang.node,
      ui.el('div', { class: 'btn-group' }, [tombolSimpan, tombolBatal])
    ]);

    function tampilkanAlert(teks) {
      ui.setTeks(alertEl, teks);
      alertEl.hidden = !teks;
    }

    function kirim() {
      ui.bersihkanError(form);
      tampilkanAlert('');
      var v = validasiForm(V, {
        passwordLama: fLama.input.value,
        passwordBaru: fBaru.input.value,
        ulangiPassword: fUlang.input.value
      });
      if (!v.valid) {
        ui.tandaiError(form, v.errors);
        return Promise.resolve();
      }
      return Promise.resolve(ctx.api.gantiPassword(v.value)).then(function (env) {
        if (!ctx.aktif()) return;
        if (env && env.ok) {
          ui.toast('Password berhasil diganti.', 'sukses');
          ctx.setUser(Object.assign({}, ctx.user, { wajibGantiPassword: false }));
          ctx.goHome();
          return;
        }
        var error = env && env.error ? env.error : { code: 'ERROR_UMUM' };
        if (error.code === 'SESI_BERAKHIR') return; // ditangani router (onSessionExpired)
        if (error.fields && typeof error.fields === 'object') ui.tandaiError(form, error.fields);
        tampilkanAlert(ui.pesanError(error).teks);
      }, function () {
        if (!ctx.aktif()) return;
        tampilkanAlert(ui.pesanError('KONEKSI_GAGAL').teks);
      });
    }

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      ui.withBusy(tombolSimpan, kirim);
    });
    tombolKeluar.addEventListener('click', function () {
      tombolKeluar.disabled = true;
      try { ctx.logout(); } catch (e) { /* logout di app.js tetap menghapus Token */ }
    });
    if (tombolBatal) tombolBatal.addEventListener('click', function () { ctx.goHome(); });

    var nama = ctx.user && ctx.user.nama ? ctx.user.nama : '';
    container.appendChild(ui.el('div', { class: 'container' },
      ui.el('div', { class: 'card', style: { maxWidth: '480px', margin: '2rem auto' } }, [
        ui.el('div', { class: 'card-header' }, [
          ui.el('h1', { class: 'card-title', text: 'Ganti Password' }),
          nama ? ui.el('p', { class: 'text-muted', text: 'Akun: ' + nama }) : null
        ]),
        ui.el('div', { class: 'card-body stack' }, [
          wajib ? ui.el('div', {
            class: 'alert alert-warning', role: 'status',
            text: 'Password bawaan wajib diganti sebelum Anda dapat memakai aplikasi.'
          }) : null,
          form
        ]),
        ui.el('div', { class: 'card-footer' }, tombolKeluar)
      ])));
    try { fLama.input.focus(); } catch (e) { /* abaikan */ }
  }

  CBT.pages['ganti-password'] = { render: render, validasiForm: validasiForm };
})();
