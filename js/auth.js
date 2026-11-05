/* ============================================================
   LifeDrop+ — sign in / sign up UI
   Uses the Supabase store in js/cloud.js.
   ============================================================ */

window.LifeDropAuth = (function () {
  const C = window.LifeDropCloud;
  const enabled = !!(C && C.enabled);
  const $ = (id) => document.getElementById(id);

  let user = C && C.restore ? C.restore() : null;
  let admin = false;
  let mode = 'signin';
  let busy = false;

  function app() { return window.LifeDropApp || {}; }

  function open(which, note) {
    if (!enabled) {
      paint();
      return;
    }
    mode = which === 'signup' ? 'signup' : 'signin';
    paintForm();
    if ($('authNote') && note) $('authNote').textContent = note;
    if (typeof app().openModal === 'function') app().openModal($('authModal'));
    else if ($('authModal')) {
      $('authModal').classList.add('is-open');
      $('authModal').setAttribute('aria-hidden', 'false');
    }
    setTimeout(() => { if ($('authEmail')) $('authEmail').focus(); }, 60);
  }

  function close() {
    if (typeof app().closeModal === 'function') app().closeModal($('authModal'));
    else if ($('authModal')) {
      $('authModal').classList.remove('is-open');
      $('authModal').setAttribute('aria-hidden', 'true');
    }
  }

  function paintForm() {
    const signup = mode === 'signup';
    if ($('tabSignin')) $('tabSignin').classList.toggle('is-active', !signup);
    if ($('tabSignup')) $('tabSignup').classList.toggle('is-active', signup);
    if ($('authNameField')) $('authNameField').hidden = !signup;
    if ($('authTitle')) $('authTitle').textContent = signup ? 'Create your LifeDrop+ account' : 'Welcome back';
    if ($('authSub')) $('authSub').textContent = signup
      ? 'Free account. Used to publish your donor profile and emergency requests.'
      : 'Sign in to reveal donor numbers, raise an SOS and manage your profile.';
    if ($('authSubmit')) $('authSubmit').innerHTML = signup
      ? '<i class="fa-solid fa-user-plus" aria-hidden="true"></i> Create account'
      : '<i class="fa-solid fa-right-to-bracket" aria-hidden="true"></i> Sign in';
  }

  function paint() {
    const signedIn = !!user;
    if ($('btnAuth')) {
      const label = signedIn ? (user.name || 'Account') : 'Sign in';
      $('btnAuth').innerHTML = '<i class="fa-solid ' + (signedIn ? 'fa-circle-user' : 'fa-right-to-bracket') + '" aria-hidden="true"></i> <span>' + label + '</span>';
      $('btnAuth').setAttribute('title', signedIn ? 'Your LifeDrop+ account' : 'Sign in or create an account');
    }
    if ($('authFormWrap')) $('authFormWrap').hidden = signedIn;
    if ($('authAccount')) $('authAccount').hidden = !signedIn;
    if (signedIn) {
      if ($('authUserName')) $('authUserName').textContent = user.name || 'Donor';
      if ($('authEmailOut')) $('authEmailOut').textContent = user.email || '';
      if ($('authRole')) $('authRole').textContent = admin ? 'Admin access · you can verify donors and edit blood bank stock.' : 'Donor account';
      if ($('authTitle')) $('authTitle').textContent = 'Your account';
      if ($('authSub')) $('authSub').textContent = 'Signed in to the LifeDrop+ network.';
    }
  }

  function showError(message) {
    if ($('authError')) {
      $('authError').textContent = message || '';
      $('authError').hidden = !message;
    }
  }

  function setBusy(value) {
    busy = value;
    if ($('authSubmit')) $('authSubmit').disabled = value;
    if ($('authForgot')) $('authForgot').disabled = value;
  }

  async function finish(signedUser) {
    user = signedUser;
    admin = user ? await C.isAdmin() : false;
    paint();
    close();
    const A = app();
    if (typeof A.onAuthChange === 'function') await A.onAuthChange();
    if (typeof A.toast === 'function') {
      A.toast(user ? 'Signed in as ' + (user.name || user.email) + '.' : 'Signed out.', 'success');
    }
  }

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    showError('');
    const name = $('authNameInput') ? $('authNameInput').value.trim() : '';
    const email = $('authEmail') ? $('authEmail').value.trim() : '';
    const password = $('authPassword') ? $('authPassword').value : '';

    if (!enabled) return;
    setBusy(true);
    try {
      if (mode === 'signup') {
        if (name.length < 2) throw new Error('Enter your name.');
        await C.signUp(email, password, name);
        await C.signIn(email, password);
        user = C.user();
      } else {
        user = await C.signIn(email, password);
      }
      if ($('authPassword')) $('authPassword').value = '';
      await finish(user);
    } catch (e) {
      showError(e.message || 'Sign in failed.');
    } finally {
      setBusy(false);
    }
  }

  async function forgot() {
    const email = $('authEmail') ? $('authEmail').value.trim() : '';
    if (!email) { showError('Type your email first, then tap “Forgot password”.'); return; }
    setBusy(true);
    try {
      await C.resetPassword(email);
      showError('');
      if (typeof app().toast === 'function') app().toast('Password reset link sent to ' + email + '.', 'info');
    } catch (e) {
      showError(e.message || 'Could not send the reset link.');
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    await C.signOut();
    user = null;
    admin = false;
    paint();
    if ($('authPassword')) $('authPassword').value = '';
    close();
    const A = app();
    if (typeof A.onAuthChange === 'function') await A.onAuthChange();
    if (typeof A.toast === 'function') A.toast('Signed out.', 'info');
  }

  function needAuth(message) {
    showError('');
    open('signin', message || 'Sign in to continue.');
    if (typeof app().toast === 'function') app().toast(message || 'Sign in to continue.', 'info');
  }

  async function refreshAdmin() {
    admin = user ? await C.isAdmin() : false;
    paint();
    return admin;
  }

  function wire() {
    if (!enabled) { paint(); return; }

    if ($('btnAuth')) $('btnAuth').addEventListener('click', () => {
      if (user) { paint(); open('signin'); } else open('signin');
    });

    if ($('tabSignin')) $('tabSignin').addEventListener('click', () => { mode = 'signin'; paintForm(); showError(''); });
    if ($('tabSignup')) $('tabSignup').addEventListener('click', () => { mode = 'signup'; paintForm(); showError(''); });

    if ($('authForm')) $('authForm').addEventListener('submit', submit);
    if ($('authForgot')) $('authForgot').addEventListener('click', forgot);
    if ($('authSignOut')) $('authSignOut').addEventListener('click', signOut);
    if ($('authManage')) $('authManage').addEventListener('click', () => {
      close();
      if (typeof app().go === 'function') app().go('#register');
      const managePhone = document.getElementById('managePhone');
      if (managePhone) setTimeout(() => managePhone.focus(), 420);
    });

    document.querySelectorAll('[data-action="close-auth"]').forEach((btn) => {
      btn.addEventListener('click', (event) => { event.preventDefault(); close(); });
    });

    const backdrop = $('authModal');
    if (backdrop) backdrop.addEventListener('click', (event) => { if (event.target === backdrop) close(); });

    if (user) {
      setTimeout(async () => {
        try { await C.refreshUser(); user = C.user(); await refreshAdmin(); } catch (e) { /* offline */ }
      }, 400);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else {
    wire();
  }

  return {
    enabled: enabled,
    user: () => user,
    isAdmin: () => admin,
    open: open,
    close: close,
    needAuth: needAuth,
    refreshAdmin: refreshAdmin,
    signOut: signOut,
  };
})();
