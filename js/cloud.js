/* ============================================================
   LifeDrop+ — cloud layer (Supabase: Auth + PostgREST + RPC)
   No SDK, plain fetch. Enable with config.cloud.enabled = true.

   Privacy model:
   - public donor search reads the phone-free `donors_public` view
   - the real number is only returned by donor_contact() for a
     signed-in user, logged and rate limited in the database
   ============================================================ */

window.LifeDropCloud = (function () {
  const cfg = (window.LIFEDROP_CONFIG && window.LIFEDROP_CONFIG.cloud) || {};
  const enabled = !!(cfg.enabled && cfg.url && cfg.anonKey);
  const base = String(cfg.url || '').replace(/\/$/, '');
  const key = cfg.anonKey || '';
  const SESSION_KEY = 'lifedrop.auth.v1';

  let auth = null;
  try { auth = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch (e) { auth = null; }

  function saveAuth(a) {
    auth = a;
    try {
      if (a) localStorage.setItem(SESSION_KEY, JSON.stringify(a));
      else localStorage.removeItem(SESSION_KEY);
    } catch (e) { /* storage can be blocked */ }
  }

  function apiError(j, fallback) {
    const m = (j && (j.msg || j.message || j.error_description || j.error)) || fallback || 'Something went wrong.';
    if (/invalid login credentials/i.test(m)) return 'Wrong email or password.';
    if (/user already registered|already been registered/i.test(m)) return 'This email already has an account. Sign in instead.';
    if (/password should be at least|Password should be at least/i.test(m)) return 'Password must be at least 6 characters.';
    if (/email not confirmed/i.test(m)) return 'Email not confirmed — turn off Confirm email in Supabase → Auth → Providers → Email.';
    if (/rate limit|too many/i.test(m)) return 'Too many attempts. Wait a minute and try again.';
    if (/duplicate key|donors_phone_uniq/i.test(m)) return 'A donor profile with this mobile number already exists.';
    if (/row-level security|permission denied/i.test(m)) return 'You do not have permission for this action.';
    if (/jwt|invalid claim|token is expired/i.test(m)) return 'Session expired. Sign in again.';
    return m;
  }

  async function authCall(path, body, token) {
    const res = await fetch(base + '/auth/v1/' + path, {
      method: 'POST',
      headers: {
        apikey: key,
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    let j = {};
    try { j = await res.json(); } catch (e) { j = {}; }
    if (!res.ok) throw new Error(apiError(j));
    return j;
  }

  function applySession(d, name) {
    const user = d.user || {};
    const meta = user.user_metadata || {};
    saveAuth({
      access_token: d.access_token,
      refresh_token: d.refresh_token,
      expires_at: Date.now() + (Number(d.expires_in) || 3600) * 1000,
      id: user.id || (auth && auth.id) || '',
      email: user.email || (auth && auth.email) || '',
      name: meta.name || name || (auth && auth.name) || '',
    });
    return auth;
  }

  async function ensureToken() {
    if (!auth) return null;
    if (auth.expires_at && Date.now() < auth.expires_at - 60000) return auth.access_token;
    if (!auth.refresh_token) return auth.access_token;
    try {
      const d = await authCall('token?grant_type=refresh_token', { refresh_token: auth.refresh_token });
      applySession(d);
      return auth.access_token;
    } catch (e) {
      saveAuth(null);
      throw new Error('Session expired. Sign in again.');
    }
  }

  async function rest(path, opts) {
    opts = opts || {};
    const token = await ensureToken();
    const res = await fetch(base + '/rest/v1/' + path, {
      method: opts.method || 'GET',
      headers: {
        apikey: key,
        Authorization: 'Bearer ' + (token || key),
        'Content-Type': 'application/json',
        ...(opts.headers || {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (!res.ok) {
      let j = {};
      try { j = await res.json(); } catch (e) { /* empty body */ }
      throw new Error(apiError(j, res.status + ' ' + res.statusText));
    }
    if (res.status === 204) return null;
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  const rpc = (fn, args) => rest('rpc/' + fn, { method: 'POST', body: args || {} });
  const minimal = { Prefer: 'return=minimal' };

  /* ---------------- row <-> app shape ---------------- */
  function donorFromRow(r) {
    return {
      id: r.id,
      name: r.name,
      phone: r.phone_digits || '',
      phoneHint: r.phone_hint || (r.phone_digits ? r.phone_digits.slice(-4) : ''),
      bloodGroup: r.blood_group,
      age: r.age,
      weight: r.weight,
      gender: r.gender || 'Other',
      city: r.city || '',
      lastDonation: r.last_donation || null,
      verified: r.verified === true,
      available: r.available !== false,
      demo: r.demo === true,
      createdAt: r.created_at || new Date().toISOString(),
    };
  }

  function donorToRow(d) {
    return {
      id: d.id,
      name: String(d.name || '').trim(),
      phone_digits: String(d.phone || '').replace(/\D/g, ''),
      blood_group: d.bloodGroup,
      age: Number(d.age) || null,
      weight: Number(d.weight) || null,
      gender: d.gender || 'Other',
      city: String(d.city || '').trim(),
      last_donation: d.lastDonation || null,
      available: d.available !== false,
      verified: d.verified === true,
      demo: d.demo === true,
    };
  }

  function sosFromRow(r) {
    return {
      id: r.id,
      patient: r.patient,
      phone: r.phone_digits,
      bloodGroup: r.blood_group,
      units: Number(r.units) || 1,
      hospital: r.hospital,
      city: r.city,
      urgency: r.urgency,
      notes: r.notes,
      status: r.status === 'RESOLVED' ? 'RESOLVED' : 'ACTIVE',
      demo: r.demo === true,
      createdAt: r.created_at,
    };
  }

  function buildHospitals(hospitals, inventory) {
    const groups = ['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'];
    const byId = {};
    (hospitals || []).forEach((h) => {
      const stock = {};
      groups.forEach((g) => { stock[g] = 0; });
      byId[h.id] = { id: h.id, name: h.name, city: h.city, phone: h.phone, stock: stock };
    });
    (inventory || []).forEach((row) => {
      const h = byId[row.hospital_id];
      if (h) h.stock[row.blood_group] = Number(row.units) || 0;
    });
    return Object.keys(byId).map((id) => byId[id]);
  }

  /* ---------------- store ---------------- */
  const store = {
    enabled: enabled,
    ready: false,

    /* ---- auth ---- */
    user() {
      if (!auth) return null;
      return {
        id: auth.id,
        email: auth.email,
        name: auth.name || (auth.email ? auth.email.split('@')[0] : 'User'),
      };
    },

    restore() {
      return store.user();
    },

    async signUp(email, password, name) {
      email = String(email || '').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Enter a real email address.');
      if (String(password).length < 6) throw new Error('Password must be at least 6 characters.');
      const d = await authCall('signup', { email: email, password: password, data: { name: String(name || '').trim() } });
      if (!d.access_token) throw new Error('Email confirmation is on. Turn it off in Supabase → Auth → Providers → Email.');
      applySession(d, name);
      return store.user();
    },

    async signIn(email, password) {
      email = String(email || '').trim().toLowerCase();
      if (!email) throw new Error('Enter your email.');
      if (!password) throw new Error('Enter your password.');
      const d = await authCall('token?grant_type=password', { email: email, password: password });
      applySession(d);
      return store.user();
    },

    async resetPassword(email) {
      email = String(email || '').trim().toLowerCase();
      if (!email) throw new Error('Enter your email first.');
      await authCall('recover', { email: email, redirect_to: location.origin + location.pathname });
      return true;
    },

    async signOut() {
      const token = auth && auth.access_token;
      if (token) {
        fetch(base + '/auth/v1/logout', { method: 'POST', headers: { apikey: key, Authorization: 'Bearer ' + token } }).catch(() => {});
      }
      saveAuth(null);
      store.ready = false;
      store._admin = false;
    },

    async refreshUser() {
      const token = await ensureToken();
      if (!token) return null;
      const res = await fetch(base + '/auth/v1/user', {
        headers: { apikey: key, Authorization: 'Bearer ' + token },
      });
      if (!res.ok) return store.user();
      const j = await res.json();
      if (auth) {
        auth.id = j.id || auth.id;
        auth.email = j.email || auth.email;
        auth.name = (j.user_metadata && j.user_metadata.name) || auth.name;
        saveAuth(auth);
      }
      return store.user();
    },

    async isAdmin() {
      if (!auth) return false;
      try {
        store._admin = (await rpc('is_admin')) === true;
      } catch (e) {
        store._admin = false;
      }
      return store._admin;
    },

    /* ---- pull ---- */
    async pull() {
      const [donors, sos, hospitals, inventory] = await Promise.all([
        rest('donors_public?select=*&order=created_at.desc&limit=1000'),
        rest('sos_requests?select=*&order=created_at.desc&limit=300'),
        rest('hospitals?select=*&order=id.asc'),
        rest('inventory?select=hospital_id,blood_group,units'),
      ]);

      const payload = {
        donors: (donors || []).map(donorFromRow),
        sos: (sos || []).map(sosFromRow),
        hospitals: buildHospitals(hospitals, inventory),
      };

      // merge the signed-in user's own record (has the real phone number)
      if (auth) {
        try {
          const own = await rpc('my_donor');
          const mine = own && own[0] ? donorFromRow(own[0]) : null;
          if (mine) {
            const i = payload.donors.findIndex((d) => d.id === mine.id);
            if (i > -1) payload.donors[i] = mine;
            else payload.donors.unshift(mine);
            payload.myDonor = mine;
          }
        } catch (e) { /* not fatal */ }
      }

      store.ready = true;
      return payload;
    },

    /* ---- donors ---- */
    async addDonor(donor) {
      const user = store.user();
      if (!user) throw new Error('Sign in to add a donor profile.');
      const row = donorToRow(donor);
      row.user_id = user.id;
      await rest('donors', { method: 'POST', headers: minimal, body: row });
      return donor;
    },

    async patchDonor(id, patch) {
      const body = {};
      if (patch.name !== undefined) body.name = patch.name;
      if (patch.phone !== undefined) body.phone_digits = String(patch.phone).replace(/\D/g, '');
      if (patch.bloodGroup !== undefined) body.blood_group = patch.bloodGroup;
      if (patch.age !== undefined) body.age = Number(patch.age) || null;
      if (patch.weight !== undefined) body.weight = Number(patch.weight) || null;
      if (patch.gender !== undefined) body.gender = patch.gender;
      if (patch.city !== undefined) body.city = patch.city;
      if (patch.lastDonation !== undefined) body.last_donation = patch.lastDonation || null;
      if (patch.available !== undefined) body.available = !!patch.available;
      if (patch.verified !== undefined) body.verified = !!patch.verified;
      if (patch.demo !== undefined) body.demo = !!patch.demo;
      await rest('donors?id=eq.' + encodeURIComponent(id), { method: 'PATCH', headers: minimal, body: body });
    },

    async deleteDonorRow(id) {
      await rest('donors?id=eq.' + encodeURIComponent(id), { method: 'DELETE', headers: minimal });
    },

    async myDonor() {
      const rows = await rpc('my_donor');
      return rows && rows[0] ? donorFromRow(rows[0]) : null;
    },

    async revealPhone(id) {
      return String(await rpc('donor_contact', { p_id: id }) || '');
    },

    async adminDonors() {
      const rows = await rpc('admin_donors');
      return (rows || []).map(donorFromRow);
    },

    /* ---- sos ---- */
    async addSOS(item) {
      const user = store.user();
      if (!user) throw new Error('Sign in to raise an SOS.');
      await rest('sos_requests', {
        method: 'POST',
        headers: minimal,
        body: {
          id: item.id,
          user_id: user.id,
          patient: item.patient,
          phone_digits: item.phone,
          blood_group: item.bloodGroup,
          units: item.units,
          hospital: item.hospital,
          city: item.city,
          urgency: item.urgency,
          notes: item.notes,
          status: 'ACTIVE',
          demo: item.demo === true,
        },
      });
      return item;
    },

    async patchSOS(id, patch) {
      const body = {};
      if (patch.status !== undefined) body.status = patch.status;
      if (patch.notes !== undefined) body.notes = patch.notes;
      await rest('sos_requests?id=eq.' + encodeURIComponent(id), { method: 'PATCH', headers: minimal, body: body });
    },

    async deleteSOSRow(id) {
      await rest('sos_requests?id=eq.' + encodeURIComponent(id), { method: 'DELETE', headers: minimal });
    },

    /* ---- inventory ---- */
    async updateStock(hospitalId, group, units) {
      await rest('inventory?on_conflict=hospital_id,blood_group', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: {
          hospital_id: hospitalId,
          blood_group: group,
          units: Math.max(0, Number(units) || 0),
          updated_at: new Date().toISOString(),
        },
      });
    },

    /* ---- admin maintenance ---- */
    async importDonors(donors, demo) {
      if (!donors || !donors.length) return 0;
      const user = store.user();
      const rows = donors.map((d) => {
        const row = donorToRow(d);
        row.user_id = user ? user.id : null;
        row.demo = demo !== false;
        return row;
      });
      await rest('donors', { method: 'POST', headers: minimal, body: rows });
      return rows.length;
    },

    async clearDemo() {
      await rpc('admin_clear_demo');
    },
  };

  return store;
})();
