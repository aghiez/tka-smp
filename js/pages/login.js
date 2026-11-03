/*
 * pages/login.js — Halaman login (rute #/login).
 * Requirement 2.2, 2.3, 2.4, 2.5, 2.10, 2.11, 25.1, 25.2.
 *
 * - Validasi Frontend (CBTValidator.validateLogin) sebelum permintaan dikirim;
 *   field tidak valid ditandai di sampingnya dan permintaan tidak dikirim.
 * - Isi kolom username selalu dipertahankan. Kolom password hanya dikosongkan
 *   setelah Backend menolak kredensial (LOGIN_GAGAL, LOGIN_DIBLOKIR,
 *   AKUN_NONAKTIF); pada error validasi semua isian dipertahankan.
 * - LOGIN_DIBLOKIR menampilkan sisa waktu blokir dalam menit (error.retryAfterMin).
 * - Login berhasil: ctx.setUser(env.data.user) lalu ctx.goHome() (beranda
 *   peran, atau #/ganti-password bila Admin wajib ganti password).
 */
(function () {
  'use strict';
  var CBT = window.CBT = window.CBT || {};
  CBT.pages = CBT.pages || {};

  var KODE_KOSONGKAN_PASSWORD = { LOGIN_GAGAL: true, LOGIN_DIBLOKIR: true, AKUN_NONAKTIF: true };

  /** Teks pesan untuk error login. Diekspor untuk tes. */
  function pesanLogin(ui, error) {
    var e = error && typeof error === 'object' ? error : { code: error };
    if (e.code === 'LOGIN_DIBLOKIR') {
      var menit = Math.ceil(Number(e.retryAfterMin));
      if (isFinite(menit) && menit > 0) {
        return 'Login diblokir sementara karena terlalu banyak percobaan yang gagal. ' +
          'Coba lagi dalam ' + menit + ' menit.';
      }
    }
    return ui.pesanError(e).teks;
  }

  function render(container, params, ctx) {
    var ui = ctx.ui;
    var V = window.CBTValidator;

    var inputUsername = ui.el('input', {
      type: 'text', id: 'login-username', name: 'username',
      autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', maxlength: '200'
    });
    var inputPassword = ui.el('input', {
      type: 'password', id: 'login-password', name: 'password',
      autocomplete: 'current-password', maxlength: '300'
    });
    var alertEl = ui.el('div', { class: 'alert alert-danger', role: 'alert', hidden: true });
    var tombol = ui.el('button', { type: 'submit', class: 'btn btn-primary btn-block' }, 'Masuk');

    var form = ui.el('form', { class: 'form', novalidate: true, 'data-form': 'login' }, [
      alertEl,
      ui.el('div', { class: 'field' }, [
        ui.el('label', { class: 'field-label', for: 'login-username', text: 'Username' }),
        inputUsername,
        ui.el('p', { class: 'field-error', 'data-for': 'username', hidden: true })
      ]),
      ui.el('div', { class: 'field' }, [
        ui.el('label', { class: 'field-label', for: 'login-password', text: 'Password' }),
        inputPassword,
        ui.el('p', { class: 'field-error', 'data-for': 'password', hidden: true })
      ]),
      tombol
    ]);

    function tampilkanAlert(teks) {
      ui.setTeks(alertEl, teks);
      alertEl.hidden = !teks;
    }

    function kirim() {
      ui.bersihkanError(form);
      tampilkanAlert('');
      var v = V.validateLogin({ username: inputUsername.value, password: inputPassword.value });
      if (!v.valid) {
        ui.tandaiError(form, v.errors);
        return Promise.resolve();
      }
      return Promise.resolve(ctx.api.login({ username: v.value.username, password: v.value.password }))
        .then(function (env) {
          if (!ctx.aktif()) return;
          if (env && env.ok && env.data && env.data.user) {
            var user = ctx.setUser(env.data.user);
            if (!user) {
              tampilkanAlert(ui.pesanError('ERROR_UMUM').teks);
              return;
            }
            ctx.goHome();
            return;
          }
          var error = env && env.error ? env.error : { code: 'ERROR_UMUM' };
          if (error.fields && typeof error.fields === 'object') ui.tandaiError(form, error.fields);
          if (KODE_KOSONGKAN_PASSWORD[error.code]) inputPassword.value = '';
          tampilkanAlert(pesanLogin(ui, error));
          if (!error.fields) {
            try { (KODE_KOSONGKAN_PASSWORD[error.code] ? inputPassword : inputUsername).focus(); } catch (e) { /* abaikan */ }
          }
        }, function () {
          if (!ctx.aktif()) return;
          tampilkanAlert(ui.pesanError('KONEKSI_GAGAL').teks);
        });
    }

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      ui.withBusy(tombol, kirim);
    });

    container.appendChild(ui.el('div', { class: 'container' },
      ui.el('div', { class: 'card', style: { maxWidth: '420px', margin: '2rem auto' } }, [
        ui.el('div', { class: 'card-header' }, [
          ui.el('h1', { class: 'card-title', text: 'Login CBT TKA' }),
          ui.el('p', { class: 'text-muted', text: 'Masuk dengan username dan password Anda.' })
        ]),
        ui.el('div', { class: 'card-body' }, form)
      ])));
    try { inputUsername.focus(); } catch (e) { /* abaikan */ }
  }

  CBT.pages['login'] = { render: render, pesanLogin: pesanLogin };
})();
