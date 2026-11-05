(() => {
    'use strict';

    /* ====================================================================
       CONFIG — change these values to reuse the app for another network
       ==================================================================== */
    const CONFIG = {
      appName: 'LifeDrop+',
      cooldownDays: 90,
      minAge: 18,
      maxAge: 65,
      minWeight: 50,
      countryCode: '91',
      sosTtlHours: 72,
      storageKey: 'lifedrop.v2',
      storageVersion: 2,
      themeKey: 'lifedrop.theme',
      pageSize: 9
    };
    const DB_KEY = CONFIG.storageKey;
    const DB_VERSION = CONFIG.storageVersion;
    const THEME_KEY = CONFIG.themeKey;
    const STEP = CONFIG.pageSize;

    /* cloud layer (js/cloud.js). Falls back to local-only mode when disabled. */
    const CLOUD = window.LifeDropCloud || { enabled: false };
    const CLOUD_ON = !!CLOUD.enabled;
    const revealedPhones = Object.create(null);
    let adminRows = null;
    let cloudBusy = false;

    const GROUPS = ['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'];

    const RECEIVE = {
      'O-':  ['O-'],
      'O+':  ['O-', 'O+'],
      'A-':  ['O-', 'A-'],
      'A+':  ['O-', 'O+', 'A-', 'A+'],
      'B-':  ['O-', 'B-'],
      'B+':  ['O-', 'O+', 'B-', 'B+'],
      'AB-': ['O-', 'A-', 'B-', 'AB-'],
      'AB+': ['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+']
    };

    const FACTS = {
      'O-':  'O-negative is the universal red-cell donor. It can be given to every blood type in an emergency when the patient group is unknown.',
      'O+':  'O-positive is the most common group worldwide. It can donate to all positive groups and can receive only from O donors.',
      'A-':  'A-negative can donate red cells to A and AB patients (positive or negative) and can receive only from O- and A-.',
      'A+':  'A-positive is in constant hospital demand. It can donate to A+ and AB+ patients and receive from A and O donors.',
      'B-':  'B-negative is rare — under 2% of many populations. It can donate to B and AB patients of any Rh type.',
      'B+':  'B-positive can donate to B+ and AB+ patients and can receive from B and O donors.',
      'AB-': 'AB-negative is one of the rarest groups. It can donate only to AB patients but receives from all negative groups.',
      'AB+': 'AB-positive is the universal recipient: it can receive red cells from every group but can donate only to AB+ patients.'
    };

    const URGENCY = {
      critical: { label: 'Critical', cls: 'critical' },
      urgent:   { label: 'Urgent',   cls: 'urgent' },
      routine:  { label: 'Routine',  cls: 'routine' }
    };

    const RULES = (() => {
      const rules = {};
      GROUPS.forEach((g) => { rules[g] = { receive: RECEIVE[g], fact: FACTS[g], give: [] }; });
      GROUPS.forEach((donor) => {
        GROUPS.forEach((patient) => {
          if (RECEIVE[patient].includes(donor)) rules[donor].give.push(patient);
        });
      });
      return rules;
    })();

    /* ====================================================================
       UTILITIES
       ==================================================================== */
    const $ = (id) => document.getElementById(id);
    const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

    function digits(value) { return String(value == null ? '' : value).replace(/\D/g, ''); }
    function clamp(n, min, max) { return Math.min(max, Math.max(min, n)); }
    function esc(value) {
      return String(value == null ? '' : value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function uid(prefix) {
      return prefix + '-' + Date.now().toString(36).toUpperCase().slice(-5) +
        Math.random().toString(36).slice(2, 4).toUpperCase();
    }
    function debounce(fn, wait) {
      let timer = 0;
      return function () {
        const args = arguments;
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(null, args), wait);
      };
    }
    function pad2(n) { return String(n).padStart(2, '0'); }
    function todayISO() {
      const d = new Date();
      return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    }
    function dayNum(iso) {
      const parts = String(iso).split('-').map(Number);
      return Math.floor(Date.UTC(parts[0], parts[1] - 1, parts[2]) / 86400000);
    }
    function todayDayNum() {
      const d = new Date();
      return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
    }
    function isValidDay(value) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return false;
      const p = String(value).split('-').map(Number);
      const d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
      return d.getUTCFullYear() === p[0] && d.getUTCMonth() === p[1] - 1 && d.getUTCDate() === p[2];
    }
    function toDateOnly(value) {
      const m = String(value == null ? '' : value).match(/^(\d{4})-(\d{2})-(\d{2})/);
      return m && isValidDay(m[1] + '-' + m[2] + '-' + m[3]) ? (m[1] + '-' + m[2] + '-' + m[3]) : null;
    }
    function daysAgoISO(days) {
      return new Date((todayDayNum() - days) * 86400000).toISOString().slice(0, 10);
    }
    function addDaysISO(iso, days) {
      return new Date((dayNum(iso) + days) * 86400000).toISOString().slice(0, 10);
    }
    function hoursAgoISO(hours) {
      return new Date(Date.now() - hours * 3600000).toISOString();
    }
    function formatDate(iso) {
      if (!iso || !isValidDay(iso)) return '—';
      const p = iso.split('-').map(Number);
      return new Date(p[0], p[1] - 1, p[2]).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    }
    function formatDateTime(iso) {
      const d = new Date(iso);
      return isNaN(d.getTime()) ? '—' : d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    }
    function timeAgo(iso) {
      const then = new Date(iso).getTime();
      if (isNaN(then)) return '—';
      const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
      if (secs < 60) return 'Just now';
      const mins = Math.floor(secs / 60);
      if (mins < 60) return mins + 'm ago';
      const hours = Math.floor(mins / 60);
      if (hours < 24) return hours + 'h ago';
      return Math.floor(hours / 24) + 'd ago';
    }
    function initials(name) {
      const words = String(name || '?').trim().split(/\s+/).filter(Boolean);
      return (words.slice(0, 2).map((w) => w[0]).join('') || '?').toUpperCase();
    }
    function firstName(name) { return String(name || '').trim().split(/\s+/)[0] || 'friend'; }
    function norm(value) { return String(value == null ? '' : value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
    function cityMatch(a, b) {
      const A = norm(a); const B = norm(b);
      if (!A || !B) return true;
      return A.includes(B) || B.includes(A);
    }
    const reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    function prefersReduced() { return reduceQuery.matches; }
    function csvCell(value) {
      const s = String(value == null ? '' : value);
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }
    function download(content, filename, mime) {
      const blob = new Blob([content], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1200);
    }
    function storedTheme() {
      try {
        const t = localStorage.getItem(THEME_KEY);
        return (t === 'dark' || t === 'light') ? t : null;
      } catch (e) { return null; }
    }
    function eligibility(lastDonation) {
      if (!lastDonation || !isValidDay(lastDonation)) {
        return { state: 'eligible', daysLeft: 0, daysSince: null, label: 'Ready to donate' };
      }
      const since = todayDayNum() - dayNum(lastDonation);
      if (since >= CONFIG.cooldownDays) {
        return { state: 'eligible', daysLeft: 0, daysSince: since, label: 'Eligible' };
      }
      const left = Math.max(1, CONFIG.cooldownDays - since);
      return { state: 'cooldown', daysLeft: left, daysSince: since, label: 'Cooldown · ' + left + 'd left' };
    }

    /* ====================================================================
       DEMO SEED DATA — dates are relative so the demo never goes stale
       ==================================================================== */
    function seedDonors() {
      return [
        { id: 'DNR-1001', name: 'Rahul Sharma', phone: '9876543210', bloodGroup: 'O-', age: 26, weight: 68, gender: 'Male', city: 'Mumbai', lastDonation: daysAgoISO(130), verified: true, available: true, createdAt: hoursAgoISO(900) },
        { id: 'DNR-1002', name: 'Priya Nair', phone: '9823456781', bloodGroup: 'A+', age: 23, weight: 56, gender: 'Female', city: 'Mumbai', lastDonation: daysAgoISO(18), verified: true, available: true, createdAt: hoursAgoISO(800) },
        { id: 'DNR-1003', name: 'Amit Patel', phone: '9712345678', bloodGroup: 'B+', age: 31, weight: 74, gender: 'Male', city: 'Pune', lastDonation: daysAgoISO(210), verified: true, available: true, createdAt: hoursAgoISO(760) },
        { id: 'DNR-1004', name: 'Sneha Kulkarni', phone: '9867123450', bloodGroup: 'O+', age: 28, weight: 62, gender: 'Female', city: 'Pune', lastDonation: daysAgoISO(95), verified: true, available: true, createdAt: hoursAgoISO(720) },
        { id: 'DNR-1005', name: 'Vikram Sengupta', phone: '9901234567', bloodGroup: 'AB+', age: 35, weight: 80, gender: 'Male', city: 'Delhi', lastDonation: daysAgoISO(260), verified: true, available: true, createdAt: hoursAgoISO(680) },
        { id: 'DNR-1006', name: 'Ananya Roy', phone: '9830123456', bloodGroup: 'AB-', age: 24, weight: 54, gender: 'Female', city: 'Kolkata', lastDonation: daysAgoISO(140), verified: false, available: true, createdAt: hoursAgoISO(640) },
        { id: 'DNR-1007', name: 'Karthik Raja', phone: '9841234567', bloodGroup: 'B-', age: 29, weight: 71, gender: 'Male', city: 'Chennai', lastDonation: daysAgoISO(60), verified: true, available: true, createdAt: hoursAgoISO(600) },
        { id: 'DNR-1008', name: 'Farhan Akhtar', phone: '9885123456', bloodGroup: 'A-', age: 27, weight: 66, gender: 'Male', city: 'Hyderabad', lastDonation: null, verified: true, available: true, createdAt: hoursAgoISO(560) },
        { id: 'DNR-1009', name: 'Meera Iyer', phone: '9845671230', bloodGroup: 'O-', age: 32, weight: 59, gender: 'Female', city: 'Bengaluru', lastDonation: daysAgoISO(100), verified: true, available: true, createdAt: hoursAgoISO(500) },
        { id: 'DNR-1010', name: 'Arjun Deshmukh', phone: '9765432109', bloodGroup: 'O+', age: 22, weight: 70, gender: 'Male', city: 'Mumbai', lastDonation: daysAgoISO(12), verified: true, available: false, createdAt: hoursAgoISO(460) },
        { id: 'DNR-1011', name: 'Neha Gupta', phone: '9812345670', bloodGroup: 'A+', age: 30, weight: 57, gender: 'Female', city: 'Delhi', lastDonation: daysAgoISO(400), verified: true, available: true, createdAt: hoursAgoISO(420) },
        { id: 'DNR-1012', name: 'Sanjay Rao', phone: '9743210987', bloodGroup: 'AB+', age: 40, weight: 85, gender: 'Male', city: 'Bengaluru', lastDonation: daysAgoISO(150), verified: false, available: true, createdAt: hoursAgoISO(380) },
        { id: 'DNR-1013', name: 'Divya Menon', phone: '9847001122', bloodGroup: 'B+', age: 26, weight: 55, gender: 'Female', city: 'Hyderabad', lastDonation: daysAgoISO(88), verified: true, available: true, createdAt: hoursAgoISO(320) },
        { id: 'DNR-1014', name: 'Imran Khan', phone: '9822004455', bloodGroup: 'O-', age: 34, weight: 78, gender: 'Male', city: 'Pune', lastDonation: null, verified: true, available: true, createdAt: hoursAgoISO(260) }
      ];
    }

    function seedSOS() {
      return [
        { id: 'SOS-5001', patient: 'Sunita Verma', phone: '9876501234', bloodGroup: 'O-', units: 2, hospital: 'KEM Hospital', city: 'Mumbai', urgency: 'critical', notes: 'Road accident, trauma ICU. Two units required immediately.', status: 'ACTIVE', createdAt: hoursAgoISO(2) },
        { id: 'SOS-5002', patient: 'Ramesh Joshi', phone: '9823401234', bloodGroup: 'A+', units: 3, hospital: 'Ruby Hall Clinic', city: 'Pune', urgency: 'urgent', notes: 'Open-heart surgery scheduled for tomorrow morning.', status: 'ACTIVE', createdAt: hoursAgoISO(5) },
        { id: 'SOS-5003', patient: 'Kavya Reddy', phone: '9845567788', bloodGroup: 'B+', units: 1, hospital: 'Manipal Hospital', city: 'Bengaluru', urgency: 'routine', notes: 'Scheduled transfusion for thalassaemia patient.', status: 'ACTIVE', createdAt: hoursAgoISO(30) }
      ];
    }

    function seedHospitals() {
      return [
        { id: 'H-01', name: 'KEM Hospital Blood Bank', city: 'Mumbai', phone: '02224107000', stock: { 'O+': 26, 'O-': 3, 'A+': 21, 'A-': 8, 'B+': 24, 'B-': 6, 'AB+': 14, 'AB-': 1 } },
        { id: 'H-02', name: 'Ruby Hall Clinic Blood Bank', city: 'Pune', phone: '02066455100', stock: { 'O+': 18, 'O-': 6, 'A+': 16, 'A-': 4, 'B+': 20, 'B-': 3, 'AB+': 9, 'AB-': 2 } },
        { id: 'H-03', name: 'AIIMS Blood Bank', city: 'Delhi', phone: '01126588500', stock: { 'O+': 34, 'O-': 9, 'A+': 30, 'A-': 12, 'B+': 28, 'B-': 7, 'AB+': 16, 'AB-': 4 } },
        { id: 'H-04', name: 'Manipal Hospital Blood Bank', city: 'Bengaluru', phone: '08025024444', stock: { 'O+': 22, 'O-': 2, 'A+': 19, 'A-': 5, 'B+': 17, 'B-': 4, 'AB+': 11, 'AB-': 0 } }
      ];
    }

    /* ====================================================================
       STATE & PERSISTENCE
       ==================================================================== */
    let state = loadState();
    let storageOK = true;

    function loadState() {
      try {
        const raw = localStorage.getItem(DB_KEY);
        if (raw) return normalizeState(JSON.parse(raw));
        const legacyDonors = localStorage.getItem('lifedrop_donors');
        const legacySOS = localStorage.getItem('lifedrop_sos');
        if (legacyDonors || legacySOS) {
          const migrated = normalizeState({
            donors: safeParse(legacyDonors, []),
            sos: safeParse(legacySOS, []),
            hospitals: seedHospitals()
          });
          try { localStorage.setItem(DB_KEY, JSON.stringify(migrated)); } catch (e) { /* ignore */ }
          return migrated;
        }
      } catch (e) {
        console.warn('LifeDrop: saved data could not be read, starting fresh.', e);
      }
      return normalizeState({});
    }

    function safeParse(raw, fallback) {
      try { return raw ? JSON.parse(raw) : fallback; } catch (e) { return fallback; }
    }

    function normalizeState(raw) {
      const source = raw && typeof raw === 'object' ? raw : {};
      const seedOk = !CLOUD_ON;
      const donors = Array.isArray(source.donors) ? source.donors.map(normalizeDonor).filter(Boolean) : (seedOk ? seedDonors() : []);
      const sos = Array.isArray(source.sos) ? source.sos.map(normalizeSOS).filter(Boolean) : (seedOk ? seedSOS() : []);
      let hospitals = Array.isArray(source.hospitals) ? source.hospitals.map(normalizeHospital).filter(Boolean) : (seedOk ? seedHospitals() : []);
      if (!hospitals.length) hospitals = seedHospitals();
      const theme = source.prefs && (source.prefs.theme === 'dark' || source.prefs.theme === 'light') ? source.prefs.theme : null;
      return {
        version: DB_VERSION,
        donors: donors,
        sos: sos,
        hospitals: hospitals,
        prefs: { theme: theme },
        updatedAt: source.updatedAt || new Date().toISOString()
      };
    }

    function normalizeDonor(raw) {
      if (!raw || typeof raw !== 'object') return null;
      const phone = digits(raw.phone);
      const name = String(raw.name || '').trim().slice(0, 70);
      const group = GROUPS.includes(raw.bloodGroup) ? raw.bloodGroup : null;
      if (!group || !name || phone.length !== 10) return null;
      return {
        id: String(raw.id || uid('DNR')),
        name: name,
        phone: phone,
        bloodGroup: group,
        age: clamp(parseInt(raw.age, 10) || CONFIG.minAge, CONFIG.minAge, 100),
        weight: clamp(parseInt(raw.weight, 10) || CONFIG.minWeight, 30, 250),
        gender: ['Male', 'Female', 'Other'].includes(raw.gender) ? raw.gender : 'Other',
        city: String(raw.city || 'Unknown').trim().slice(0, 60) || 'Unknown',
        lastDonation: toDateOnly(raw.lastDonation),
        verified: raw.verified === true,
        available: raw.available !== false,
        createdAt: isValidISO(raw.createdAt) ? raw.createdAt : new Date().toISOString()
      };
    }

    function normalizeSOS(raw) {
      if (!raw || typeof raw !== 'object' || !raw.patient) return null;
      return {
        id: String(raw.id || uid('SOS')),
        patient: String(raw.patient).trim().slice(0, 80),
        phone: digits(raw.phone).slice(0, 12),
        bloodGroup: GROUPS.includes(raw.bloodGroup) ? raw.bloodGroup : 'O+',
        units: clamp(parseInt(raw.units, 10) || 1, 1, 15),
        hospital: String(raw.hospital || 'Hospital').trim().slice(0, 90),
        city: String(raw.city || 'Unknown').trim().slice(0, 70),
        urgency: ['critical', 'urgent', 'routine'].includes(raw.urgency) ? raw.urgency : 'urgent',
        notes: String(raw.notes || 'Urgent medical requirement.').slice(0, 400),
        status: raw.status === 'RESOLVED' ? 'RESOLVED' : 'ACTIVE',
        createdAt: isValidISO(raw.createdAt) ? raw.createdAt : new Date().toISOString()
      };
    }

    function normalizeHospital(raw) {
      if (!raw || typeof raw !== 'object') return null;
      const stock = {};
      GROUPS.forEach((g) => { stock[g] = clamp(parseInt(raw.stock && raw.stock[g], 10) || 0, 0, 9999); });
      return {
        id: String(raw.id || uid('H')),
        name: String(raw.name || 'Blood bank').trim().slice(0, 90),
        city: String(raw.city || '').trim().slice(0, 60),
        phone: digits(raw.phone).slice(0, 12),
        stock: stock
      };
    }

    function isValidISO(value) {
      if (!value) return false;
      const d = new Date(value);
      return !isNaN(d.getTime());
    }

    function saveState(silent) {
      state.updatedAt = new Date().toISOString();
      try {
        localStorage.setItem(DB_KEY, JSON.stringify(state));
      } catch (e) {
        if (storageOK) {
          storageOK = false;
          if (!silent) toast('Browser storage is unavailable. Changes will last for this session only.', 'warn');
        }
      }
    }

    /* ====================================================================
       CLOUD BRIDGE
       ==================================================================== */
    function authUser() {
      return (window.LifeDropAuth && window.LifeDropAuth.user) ? window.LifeDropAuth.user() : null;
    }

    function needSignIn(message) {
      if (window.LifeDropAuth) window.LifeDropAuth.needAuth(message || 'Sign in to continue.');
      else toast(message || 'Sign in to continue.', 'error');
    }

    function applyRemote(payload) {
      if (!payload) return;
      state.donors = payload.donors || [];
      state.sos = payload.sos || [];
      if (payload.hospitals && payload.hospitals.length) state.hospitals = payload.hospitals;
      if (payload.myDonor) revealedPhones[payload.myDonor.id] = payload.myDonor.phone;
      state.updatedAt = new Date().toISOString();
      saveState(true);
      buildHospitalSelect(true);
      renderAll();
    }

    let cloudRefreshing = null;
    async function cloudRefresh(silent) {
      if (!CLOUD_ON) return;
      if (cloudRefreshing) return cloudRefreshing;
      cloudRefreshing = (async () => {
        try {
          const payload = await CLOUD.pull();
          applyRemote(payload);
          if (!silent) toast('Network data refreshed.', 'info');
        } catch (e) {
          if (!silent) toast(e.message || 'Could not reach the donor network.', 'error');
          else console.warn('LifeDrop+ network:', e);
        } finally {
          cloudRefreshing = null;
        }
      })();
      return cloudRefreshing;
    }

    async function revealPhone(id) {
      const user = authUser();
      if (!user) { needSignIn('Sign in to see donor phone numbers. It is free and takes 20 seconds.'); return; }
      if (!CLOUD_ON) return;
      try {
        const phone = await CLOUD.revealPhone(id);
        if (!phone) throw new Error('Phone number unavailable.');
        revealedPhones[id] = phone;
        renderDonors();
        toast('Number revealed. Please use it only to coordinate this donation.', 'success');
      } catch (e) {
        toast(e.message || 'Could not reveal the number.', 'error');
      }
    }

    /* ====================================================================
       DOM REFERENCES
       ==================================================================== */
    const metaThemeColor = $('metaThemeColor');
    const navToggle = $('navToggle');
    const primaryNav = $('primaryNav');
    const statDonors = $('statDonors');
    const statEligible = $('statEligible');
    const statSOS = $('statSOS');
    const statCities = $('statCities');
    const bloodPills = $('bloodPills');
    const factText = $('factText');
    const giveToList = $('giveToList');
    const receiveFromList = $('receiveFromList');
    const giveCount = $('giveCount');
    const receiveCount = $('receiveCount');
    const compatCtaText = $('compatCtaText');
    const searchBlood = $('searchBlood');
    const searchCity = $('searchCity');
    const cityList = $('cityList');
    const searchLogic = $('searchLogic');
    const searchEligibility = $('searchEligibility');
    const searchSort = $('searchSort');
    const searchVerified = $('searchVerified');
    const activeChips = $('activeChips');
    const resultsMeta = $('resultsMeta');
    const donorContainer = $('donorContainer');
    const loadMoreBtn = $('loadMoreBtn');
    const sosForm = $('sosForm');
    const sosPatient = $('sosPatient');
    const sosPhone = $('sosPhone');
    const sosBlood = $('sosBlood');
    const sosUnits = $('sosUnits');
    const sosHospital = $('sosHospital');
    const sosCity = $('sosCity');
    const sosUrgency = $('sosUrgency');
    const sosNotes = $('sosNotes');
    const sosFeedList = $('sosFeedList');
    const sosActiveCount = $('sosActiveCount');
    const donorRegisterForm = $('donorRegisterForm');
    const regName = $('regName');
    const regPhone = $('regPhone');
    const regBlood = $('regBlood');
    const regAge = $('regAge');
    const regWeight = $('regWeight');
    const regGender = $('regGender');
    const regCity = $('regCity');
    const regLastDonation = $('regLastDonation');
    const regConsent = $('regConsent');
    const cooldownNotice = $('cooldownNotice');
    const managePhone = $('managePhone');
    const manageResult = $('manageResult');
    const hospitalSelect = $('hospitalSelect');
    const inventoryGrid = $('inventoryGrid');
    const inventoryAlert = $('inventoryAlert');
    const stockHospital = $('stockHospital');
    const stockGroup = $('stockGroup');
    const stockUnits = $('stockUnits');
    const stockMsg = $('stockMsg');
    const adminModal = $('adminModal');
    const adminKpis = $('adminKpis');
    const adminChartBars = $('adminChartBars');
    const adminDonut = $('adminDonut');
    const adminLegend = $('adminLegend');
    const adminDonorSearch = $('adminDonorSearch');
    const adminDonorCount = $('adminDonorCount');
    const adminTableBody = $('adminTableBody');
    const adminReqBody = $('adminReqBody');
    const adminImportInput = $('adminImportInput');
    const storageInfo = $('storageInfo');
    const slipModal = $('slipModal');
    const slipContent = $('slipContent');
    const paletteModal = $('paletteModal');
    const paletteInput = $('paletteInput');
    const paletteList = $('paletteList');
    const toastContainer = $('toastContainer');
    const toTop = $('toTop');
    /* ====================================================================
       VIEW STATE
       ==================================================================== */
    let selectedBlood = 'O-';
    let sosFilter = 'active';
    let manageDonorId = null;
    let adminQuery = '';
    let paletteResults = [];
    let paletteIndex = 0;
    const modalStack = [];
    const modalReturnFocus = new Map();

    const searchState = {
      blood: '',
      city: '',
      logic: 'compatible',
      eligibility: 'eligible',
      sort: 'recommended',
      verified: false,
      limit: STEP
    };

    /* ====================================================================
       THEME
       ==================================================================== */
    function applyTheme(theme) {
      const value = theme === 'dark' ? 'dark' : 'light';
      document.documentElement.dataset.theme = value;
      if (metaThemeColor) metaThemeColor.content = value === 'dark' ? '#080d18' : '#ffffff';
      $$('[data-theme-icon]').forEach((icon) => {
        icon.className = 'fa-solid ' + (value === 'dark' ? 'fa-sun' : 'fa-moon');
      });
      $$('[data-action="theme"]').forEach((btn) => {
        const label = value === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
        btn.setAttribute('aria-label', label);
        btn.setAttribute('title', label);
      });
    }

    function initTheme() {
      applyTheme(document.documentElement.dataset.theme || storedTheme() ||
        (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
    }

    function toggleTheme() {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* storage unavailable */ }
    }

    /* ====================================================================
       TOASTS
       ==================================================================== */
    function toast(message, type, action) {
      if (!toastContainer) return;
      const kind = type || 'success';
      const icons = {
        success: 'fa-circle-check',
        error: 'fa-circle-xmark',
        warn: 'fa-triangle-exclamation',
        info: 'fa-circle-info'
      };
      const el = document.createElement('div');
      el.className = 'toast toast-' + kind;
      el.setAttribute('role', 'status');
      el.innerHTML =
        '<span class="toast-icon"><i class="fa-solid ' + (icons[kind] || icons.info) + '" aria-hidden="true"></i></span>' +
        '<div class="toast-body">' + esc(message) + '</div>' +
        (action ? '<button class="toast-action" type="button"></button>' : '') +
        '<button class="toast-close" type="button" aria-label="Dismiss notification">&times;</button>';

      let timer = 0;
      function dismiss() {
        if (!el.isConnected) return;
        clearTimeout(timer);
        el.classList.add('is-out');
        setTimeout(() => el.remove(), 220);
      }

      if (action) {
        const actionBtn = el.querySelector('.toast-action');
        actionBtn.textContent = action.label;
        actionBtn.addEventListener('click', () => {
          try { action.onClick(); } finally { dismiss(); }
        });
      }
      el.querySelector('.toast-close').addEventListener('click', dismiss);
      el.addEventListener('mouseenter', () => clearTimeout(timer));

      toastContainer.appendChild(el);
      while (toastContainer.children.length > 4) toastContainer.firstElementChild.remove();
      timer = setTimeout(dismiss, action ? 7500 : 4500);
    }

    /* ====================================================================
       MODALS (focus trap + restore focus)
       ==================================================================== */
    function openModal(modal) {
      if (!modal || modalStack.includes(modal)) return;
      modalReturnFocus.set(modal, document.activeElement);
      modal.classList.add('is-open');
      modal.setAttribute('aria-hidden', 'false');
      modalStack.push(modal);
      document.body.classList.add('has-modal');
      const target = modal.querySelector('[data-autofocus]') ||
        modal.querySelector('button, input:not([type="hidden"]), select, textarea, a[href]');
      setTimeout(() => { if (target) target.focus(); }, 40);
    }

    function closeModal(modal) {
      if (!modal || !modalStack.includes(modal)) return;
      modal.classList.remove('is-open');
      modal.setAttribute('aria-hidden', 'true');
      const index = modalStack.indexOf(modal);
      if (index > -1) modalStack.splice(index, 1);
      if (!modalStack.length) document.body.classList.remove('has-modal');
      const previous = modalReturnFocus.get(modal);
      modalReturnFocus.delete(modal);
      if (previous && document.contains(previous) && typeof previous.focus === 'function') {
        setTimeout(() => previous.focus(), 20);
      }
    }

    function trapFocus(event) {
      if (!modalStack.length) return;
      const modal = modalStack[modalStack.length - 1];
      const focusables = $$('a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])', modal)
        .filter((el) => el.offsetParent !== null);
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    /* ====================================================================
       STATS
       ==================================================================== */
    function animateStat(el, value) {
      const from = parseInt(el.textContent, 10) || 0;
      if (from === value) return;
      if (el._raf) cancelAnimationFrame(el._raf);
      if (prefersReduced()) { el.textContent = String(value); return; }
      const start = performance.now();
      const duration = 420;
      const step = (now) => {
        const p = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - p, 3);
        el.textContent = String(Math.round(from + (value - from) * eased));
        if (p < 1) el._raf = requestAnimationFrame(step);
      };
      el._raf = requestAnimationFrame(step);
    }

    function updateStats() {
      const total = state.donors.length;
      const ready = state.donors.filter((d) => d.available && eligibility(d.lastDonation).state === 'eligible').length;
      const active = state.sos.filter((s) => sosStatus(s).value === 'ACTIVE').length;
      const cities = new Set(state.donors.map((d) => norm(d.city)).filter(Boolean)).size;
      animateStat(statDonors, total);
      animateStat(statEligible, ready);
      animateStat(statSOS, active);
      animateStat(statCities, cities);
    }

    /* ====================================================================
       COMPATIBILITY
       ==================================================================== */
    function selectBloodGroup(group) {
      if (!RULES[group]) group = 'O-';
      selectedBlood = group;
      $$('.blood-pill', bloodPills).forEach((btn) => {
        const on = btn.dataset.group === group;
        btn.classList.toggle('is-active', on);
        btn.setAttribute('aria-pressed', String(on));
      });
      const rule = RULES[group];
      factText.textContent = rule.fact;
      receiveFromList.innerHTML = rule.receive.map((g) => '<span class="tag">' + g + '</span>').join('');
      giveToList.innerHTML = rule.give.map((g) => '<span class="tag">' + g + '</span>').join('');
      receiveCount.textContent = String(rule.receive.length);
      giveCount.textContent = String(rule.give.length);
      updateCompatCta();
    }

    function countCompatibleReady(group) {
      const rule = RULES[group];
      if (!rule) return 0;
      return state.donors.filter((d) =>
        rule.receive.includes(d.bloodGroup) &&
        d.available &&
        eligibility(d.lastDonation).state === 'eligible'
      ).length;
    }

    function updateCompatCta() {
      const count = countCompatibleReady(selectedBlood);
      compatCtaText.textContent = count
        ? 'Find ' + count + ' ready donor' + (count === 1 ? '' : 's') + ' for ' + selectedBlood
        : 'Search donors for ' + selectedBlood;
    }

    /* ====================================================================
       SEARCH & DONOR RENDERING
       ==================================================================== */
    function getFilteredDonors() {
      const s = searchState;
      const rule = s.blood ? RULES[s.blood] : null;
      const list = state.donors.filter((d) => {
        if (s.blood) {
          const bloodPass = s.logic === 'exact' ? d.bloodGroup === s.blood : (rule ? rule.receive.includes(d.bloodGroup) : true);
          if (!bloodPass) return false;
        }
        if (s.city && !cityMatch(d.city, s.city)) return false;
        if (s.verified && !d.verified) return false;
        if (s.eligibility !== 'all') {
          const ready = eligibility(d.lastDonation).state === 'eligible';
          if (s.eligibility === 'eligible' && !(ready && d.available)) return false;
          if (s.eligibility === 'available' && !d.available) return false;
        }
        return true;
      });
      return sortDonors(list, s.sort);
    }

    function sortDonors(list, sort) {
      const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      if (sort === 'name') return list.sort(byName);
      if (sort === 'newest') return list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      if (sort === 'soonest') {
        return list.sort((a, b) => {
          const ea = eligibility(a.lastDonation);
          const eb = eligibility(b.lastDonation);
          return (ea.daysLeft - eb.daysLeft) || byName(a, b);
        });
      }
      const score = (d) => {
        let n = 0;
        if (!d.available) n += 4;
        if (eligibility(d.lastDonation).state !== 'eligible') n += 2;
        if (!d.verified) n += 1;
        return n;
      };
      return list.sort((a, b) => (score(a) - score(b)) || byName(a, b));
    }

    function donorCard(d) {
      const el = eligibility(d.lastDonation);
      const statusCls = !d.available ? 'paused' : el.state;
      const statusText = !d.available ? 'Paused' : (el.state === 'eligible' ? 'Ready' : el.daysLeft + 'd cooldown');
      const need = searchState.blood || d.bloodGroup;
      const phone = d.phone || revealedPhones[d.id] || '';
      const message = encodeURIComponent(
        'Hello ' + d.name + ', I found your profile on LifeDrop+ (' + d.bloodGroup + ' donor, ' + d.city + '). ' +
        'We urgently need ' + need + ' blood. Are you available to donate? — sent via LifeDrop+'
      );
      const wa = phone ? 'https://wa.me/' + CONFIG.countryCode + phone + '?text=' + message : '#';
      const pct = el.state === 'eligible' ? 100 : Math.round(((CONFIG.cooldownDays - el.daysLeft) / CONFIG.cooldownDays) * 100);

      return '<article class="donor-card">' +
        '<div class="donor-top">' +
          '<div class="avatar" aria-hidden="true">' + esc(initials(d.name)) + '</div>' +
          '<div class="donor-id">' +
            '<h3>' + esc(d.name) + (d.verified ? ' <i class="fa-solid fa-circle-check verified" role="img" title="Verified donor" aria-label="Verified donor"></i>' : '') + '</h3>' +
            '<p><i class="fa-solid fa-location-dot" aria-hidden="true"></i> ' + esc(d.city) + '</p>' +
          '</div>' +
          '<span class="blood-badge">' + esc(d.bloodGroup) + '</span>' +
        '</div>' +
        '<dl class="donor-meta">' +
          '<div><dt>Age / gender</dt><dd>' + esc(d.age) + ' yrs · ' + esc(d.gender) + '</dd></div>' +
          '<div><dt>Weight</dt><dd>' + esc(d.weight) + ' kg</dd></div>' +
          '<div><dt>Last donated</dt><dd>' + (d.lastDonation ? esc(formatDate(d.lastDonation)) : 'First-time donor') + '</dd></div>' +
          '<div><dt>Status</dt><dd><span class="badge badge-' + statusCls + '">' + esc(statusText) + '</span></dd></div>' +
        '</dl>' +
        '<div class="cooldown" aria-hidden="true"><span style="width:' + pct + '%"></span></div>' +
        '<div class="donor-actions">' +
          (phone
            ? '<a class="btn btn-dark btn-sm" href="tel:' + esc(phone) + '"><i class="fa-solid fa-phone" aria-hidden="true"></i> Call</a>' +
              '<a class="btn btn-wa btn-sm" href="' + wa + '" target="_blank" rel="noopener"><i class="fa-brands fa-whatsapp" aria-hidden="true"></i> WhatsApp</a>'
            : '<button class="btn btn-dark btn-sm" type="button" data-action="reveal-phone" data-id="' + esc(d.id) + '">' +
              '<i class="fa-solid fa-eye" aria-hidden="true"></i> Show ' + (d.phoneHint ? '••••' + esc(d.phoneHint) : 'number') + '</button>') +
        '</div>' +
      '</article>';
    }

    function emptyState() {
      return '<div class="empty-state">' +
        '<i class="fa-solid fa-user-slash" aria-hidden="true"></i>' +
        '<h3>No matching donors yet</h3>' +
        '<p style="max-width:440px">Try a nearby city, switch to “All compatible groups”, or raise an SOS so the network can respond.</p>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center;margin-top:8px">' +
          '<button class="btn btn-ghost btn-sm" type="button" data-action="reset-filters"><i class="fa-solid fa-rotate-left" aria-hidden="true"></i> Clear filters</button>' +
          '<a class="btn btn-sos btn-sm" href="#sos"><i class="fa-solid fa-bullhorn" aria-hidden="true"></i> Raise SOS</a>' +
        '</div>' +
      '</div>';
    }

    function renderDonors() {
      const list = getFilteredDonors();
      const total = list.length;
      const shown = list.slice(0, searchState.limit);
      donorContainer.innerHTML = total ? shown.map(donorCard).join('') : emptyState();
      resultsMeta.innerHTML = total
        ? 'Showing <strong>' + shown.length + '</strong> of <strong>' + total + '</strong> matching donor' + (total === 1 ? '' : 's')
        : 'No donors match these filters';
      loadMoreBtn.hidden = total <= searchState.limit;
      if (!loadMoreBtn.hidden) {
        loadMoreBtn.innerHTML = '<i class="fa-solid fa-chevron-down" aria-hidden="true"></i> Show ' +
          Math.min(STEP, total - searchState.limit) + ' more';
      }
      renderChips();
      updateCompatCta();
    }

    function chip(key, label) {
      return '<button class="chip" type="button" data-action="clear-chip" data-key="' + key + '" title="Remove filter">' +
        esc(label) + ' <i class="fa-solid fa-xmark" aria-hidden="true"></i></button>';
    }

    function renderChips() {
      const s = searchState;
      const items = [];
      if (s.blood) items.push(chip('blood', 'Group ' + s.blood));
      if (s.city) items.push(chip('city', 'City: ' + s.city));
      if (s.logic === 'exact') items.push(chip('logic', 'Exact match'));
      if (s.eligibility !== 'eligible') items.push(chip('eligibility', s.eligibility === 'available' ? 'Available profiles' : 'All registered donors'));
      if (s.verified) items.push(chip('verified', 'Verified only'));
      if (s.sort !== 'recommended') items.push(chip('sort', 'Sorted'));
      activeChips.innerHTML = items.length
        ? items.join('') + '<button class="chip chip-clear" type="button" data-action="clear-all">Clear all</button>'
        : '';
    }

    function syncSearchInputs() {
      searchBlood.value = searchState.blood;
      searchCity.value = searchState.city;
      searchLogic.value = searchState.logic;
      searchEligibility.value = searchState.eligibility;
      searchSort.value = searchState.sort;
      searchVerified.checked = searchState.verified;
    }

    function readSearchInputs() {
      searchState.blood = searchBlood.value;
      searchState.city = searchCity.value.trim();
      searchState.logic = searchLogic.value;
      searchState.eligibility = searchEligibility.value;
      searchState.sort = searchSort.value;
      searchState.verified = searchVerified.checked;
    }

    function onFilterChange() {
      readSearchInputs();
      searchState.limit = STEP;
      renderDonors();
    }

    function resetFilters() {
      searchState.blood = '';
      searchState.city = '';
      searchState.logic = 'compatible';
      searchState.eligibility = 'eligible';
      searchState.sort = 'recommended';
      searchState.verified = false;
      searchState.limit = STEP;
      syncSearchInputs();
      renderDonors();
    }

    function clearChip(key) {
      if (key === 'blood') searchState.blood = '';
      else if (key === 'city') searchState.city = '';
      else if (key === 'logic') searchState.logic = 'compatible';
      else if (key === 'eligibility') searchState.eligibility = 'eligible';
      else if (key === 'verified') searchState.verified = false;
      else if (key === 'sort') searchState.sort = 'recommended';
      searchState.limit = STEP;
      syncSearchInputs();
      renderDonors();
    }

    function findForGroup(group) {
      searchState.blood = group || selectedBlood;
      searchState.city = '';
      searchState.logic = 'compatible';
      searchState.eligibility = 'eligible';
      searchState.verified = false;
      searchState.sort = 'recommended';
      searchState.limit = STEP;
      syncSearchInputs();
      renderDonors();
      go('#find');
      toast('Showing donors who can safely donate to a ' + searchState.blood + ' patient.', 'info');
    }

    /* ====================================================================
       SOS DISPATCH
       ==================================================================== */
    function sosStatus(item) {
      if (item.status === 'RESOLVED') return { value: 'RESOLVED', label: 'Resolved', cls: 'resolved' };
      const created = new Date(item.createdAt).getTime();
      const ageHours = isNaN(created) ? 0 : (Date.now() - created) / 3600000;
      if (ageHours > CONFIG.sosTtlHours) return { value: 'EXPIRED', label: 'Expired', cls: 'expired' };
      return { value: 'ACTIVE', label: 'Active', cls: 'active' };
    }

    function countMatching(blood, city) {
      const rule = RULES[blood];
      if (!rule) return 0;
      return state.donors.filter((d) =>
        rule.receive.includes(d.bloodGroup) &&
        (!city || cityMatch(d.city, city)) &&
        d.available &&
        eligibility(d.lastDonation).state === 'eligible'
      ).length;
    }

    function sosCard(item) {
      const status = sosStatus(item);
      const urgency = URGENCY[item.urgency] || URGENCY.urgent;
      const matches = countMatching(item.bloodGroup, item.city);
      const shareText = encodeURIComponent(
        '🚨 EMERGENCY BLOOD REQUEST\n' +
        'Patient: ' + item.patient + '\n' +
        'Blood group: ' + item.bloodGroup + ' · ' + item.units + ' unit(s)\n' +
        'Hospital: ' + item.hospital + ', ' + item.city + '\n' +
        'Contact: ' + item.phone + '\n' +
        item.notes + '\n' +
        'Please share — every minute counts. (via LifeDrop+)'
      );
      const wa = 'https://wa.me/?text=' + shareText;

      return '<article class="sos-card sos-' + status.cls + '">' +
        '<div class="sos-top">' +
          '<div><span class="badge badge-' + urgency.cls + '">' + urgency.label + '</span> ' +
            '<span class="badge badge-' + status.cls + '">' + status.label + '</span></div>' +
          '<time datetime="' + esc(item.createdAt) + '" title="' + esc(formatDateTime(item.createdAt)) + '">' + timeAgo(item.createdAt) + '</time>' +
        '</div>' +
        '<h3>' + esc(item.patient) + ' <span class="sos-group">needs ' + esc(item.bloodGroup) + '</span></h3>' +
        '<p class="sos-line"><i class="fa-solid fa-droplet" aria-hidden="true"></i> ' + item.units + ' unit(s)' +
          ' <span aria-hidden="true">·</span> <i class="fa-solid fa-hospital" aria-hidden="true"></i> ' + esc(item.hospital) + ', ' + esc(item.city) + '</p>' +
        '<p class="sos-notes">' + esc(item.notes) + '</p>' +
        '<div class="sos-actions">' +
          '<a class="btn btn-dark" href="tel:' + esc(digits(item.phone)) + '"><i class="fa-solid fa-phone" aria-hidden="true"></i> Call</a>' +
          '<a class="btn btn-wa" href="' + wa + '" target="_blank" rel="noopener"><i class="fa-brands fa-whatsapp" aria-hidden="true"></i> Share</a>' +
          '<button class="btn btn-soft" type="button" data-action="view-matches" data-id="' + esc(item.id) + '">' +
            '<i class="fa-solid fa-users" aria-hidden="true"></i> ' + matches + ' match' + (matches === 1 ? '' : 'es') + '</button>' +
          '<button class="btn btn-ghost" type="button" data-action="open-slip" data-id="' + esc(item.id) + '">' +
            '<i class="fa-solid fa-file-lines" aria-hidden="true"></i> Pass</button>' +
          (status.value !== 'RESOLVED'
            ? '<button class="btn btn-ghost" type="button" data-action="resolve-sos" data-id="' + esc(item.id) + '">' +
              '<i class="fa-solid fa-check" aria-hidden="true"></i> Resolve</button>'
            : '') +
        '</div>' +
      '</article>';
    }

    function renderSOS() {
      const all = state.sos.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      const active = all.filter((s) => sosStatus(s).value === 'ACTIVE');
      sosActiveCount.textContent = String(active.length);
      const list = sosFilter === 'active' ? active : all;
      sosFeedList.innerHTML = list.length
        ? list.map(sosCard).join('')
        : '<div class="feed-empty"><i class="fa-solid fa-circle-check" aria-hidden="true"></i><br>No ' + (sosFilter === 'active' ? 'active' : '') + ' requests right now.</div>';
      $$('[data-action="sos-filter"]').forEach((btn) => {
        const on = btn.dataset.filter === sosFilter;
        btn.classList.toggle('is-active', on);
        btn.setAttribute('aria-selected', String(on));
      });
    }

    function setSosFilter(filter) {
      sosFilter = filter === 'all' ? 'all' : 'active';
      renderSOS();
    }

    async function handleSOS(event) {
      event.preventDefault();
      if (!sosForm.reportValidity()) return;
      if (CLOUD_ON && !authUser()) {
        needSignIn('Sign in to broadcast an emergency SOS. It takes 20 seconds.');
        return;
      }

      const patient = sosPatient.value.trim();
      const phone = digits(sosPhone.value);
      const bloodGroup = sosBlood.value;
      const units = clamp(parseInt(sosUnits.value, 10) || 1, 1, 15);
      const hospital = sosHospital.value.trim();
      const city = sosCity.value.trim();
      const urgency = sosUrgency.value;
      const notes = sosNotes.value.trim();

      if (patient.length < 2) { toast('Enter the patient’s full name.', 'error'); return; }
      if (phone.length !== 10) { toast('Enter a valid 10-digit attendant contact number.', 'error'); return; }
      if (!RULES[bloodGroup]) { toast('Select the required blood group.', 'error'); return; }
      if (!hospital || !city) { toast('Hospital and city are required.', 'error'); return; }

      const item = {
        id: uid('SOS'),
        patient: patient,
        phone: phone,
        bloodGroup: bloodGroup,
        units: units,
        hospital: hospital,
        city: city,
        urgency: ['critical', 'urgent', 'routine'].includes(urgency) ? urgency : 'urgent',
        notes: notes || 'Urgent medical requirement.',
        status: 'ACTIVE',
        createdAt: new Date().toISOString()
      };

      state.sos.unshift(item);
      sosFilter = 'active';
      if (CLOUD_ON) {
        try {
          await CLOUD.addSOS(item);
        } catch (e) {
          state.sos = state.sos.filter((s) => s.id !== item.id);
          toast(e.message || 'The SOS could not be published.', 'error');
          return;
        }
        saveState(true);
        renderAll();
        sosForm.reset();
        sosUrgency.value = 'urgent';
        await cloudRefresh(true);
      } else {
        saveState();
        renderAll();
        sosForm.reset();
        sosUrgency.value = 'urgent';
      }

      const matches = countMatching(bloodGroup, city);
      toast(
        'SOS is live. ' + matches + ' ready donor' + (matches === 1 ? '' : 's') + ' match in ' + city + '.',
        'success',
        matches ? { label: 'View matches', onClick: () => viewMatches(item.id) } : null
      );
    }

    function viewMatches(id) {
      const item = state.sos.find((s) => s.id === id);
      if (!item) return;
      let city = item.city;
      if (city && countMatching(item.bloodGroup, city) === 0 && city.includes(',')) {
        const first = city.split(',')[0].trim();
        if (first) city = first;
      }
      searchState.blood = item.bloodGroup;
      searchState.city = city;
      searchState.logic = 'compatible';
      searchState.eligibility = 'eligible';
      searchState.verified = false;
      searchState.sort = 'recommended';
      searchState.limit = STEP;
      syncSearchInputs();
      renderDonors();
      go('#find');
      toast('Showing ready donors compatible with ' + item.bloodGroup + ' near ' + city + '.', 'info');
    }

    async function resolveSOS(id) {
      const item = state.sos.find((s) => s.id === id);
      if (!item || item.status === 'RESOLVED') return;
      item.status = 'RESOLVED';
      if (CLOUD_ON) {
        try { await CLOUD.patchSOS(id, { status: 'RESOLVED' }); }
        catch (e) { item.status = 'ACTIVE'; toast(e.message || 'Could not update the request.', 'error'); return; }
        await cloudRefresh(true);
      } else {
        saveState();
        renderAll();
      }
      toast('Request marked as resolved. Thank you for closing the loop.', 'success');
    }

    async function deleteSOS(id) {
      const item = state.sos.find((s) => s.id === id);
      if (!item) return;
      if (!confirm('Delete the request for “' + item.patient + '”? This cannot be undone.')) return;
      if (CLOUD_ON) {
        try { await CLOUD.deleteSOSRow(id); }
        catch (e) { toast(e.message || 'Could not delete the request.', 'error'); return; }
        await cloudRefresh(true);
      } else {
        state.sos = state.sos.filter((s) => s.id !== id);
        saveState();
        renderAll();
      }
      toast('Request deleted.', 'warn');
    }

    /* ====================================================================
       REGISTRATION & SELF-SERVICE
       ==================================================================== */
    function previewEligibility() {
      const value = regLastDonation.value;
      if (!value) { cooldownNotice.hidden = true; return; }
      const el = eligibility(value);
      cooldownNotice.hidden = false;
      if (el.state === 'eligible') {
        cooldownNotice.className = 'notice notice-ok';
        cooldownNotice.innerHTML = '<i class="fa-solid fa-circle-check" aria-hidden="true"></i>' +
          '<span><strong>Eligible today.</strong> You can safely donate now.</span>';
      } else {
        cooldownNotice.className = 'notice notice-warn';
        cooldownNotice.innerHTML = '<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>' +
          '<span><strong>' + el.daysLeft + ' days of cooldown remaining.</strong> You can donate again on ' +
          formatDate(addDaysISO(value, CONFIG.cooldownDays)) + '.</span>';
      }
    }

    async function handleRegister(event) {
      event.preventDefault();
      if (!donorRegisterForm.reportValidity()) return;
      if (CLOUD_ON && !authUser()) {
        needSignIn('Sign in (or create a free account) to publish your donor profile.');
        return;
      }

      const name = regName.value.trim();
      const phone = digits(regPhone.value);
      const bloodGroup = regBlood.value;
      const age = parseInt(regAge.value, 10);
      const weight = parseInt(regWeight.value, 10);
      const gender = regGender.value;
      const city = regCity.value.trim();
      const lastDonation = toDateOnly(regLastDonation.value);

      if (name.length < 2) { toast('Enter your full name.', 'error'); return; }
      if (phone.length !== 10) { toast('Enter a valid 10-digit mobile number.', 'error'); return; }
      if (!RULES[bloodGroup]) { toast('Select your blood group.', 'error'); return; }
      if (!(age >= CONFIG.minAge && age <= CONFIG.maxAge)) { toast('Donors must be between ' + CONFIG.minAge + ' and ' + CONFIG.maxAge + ' years old.', 'error'); return; }
      if (!(weight >= CONFIG.minWeight)) { toast('A minimum weight of ' + CONFIG.minWeight + ' kg is required for donor safety.', 'error'); return; }
      if (!regConsent.checked) { toast('Please confirm consent before registering.', 'error'); return; }
      if (lastDonation && dayNum(lastDonation) > todayDayNum()) { toast('The last donation date cannot be in the future.', 'error'); return; }
      if (state.donors.some((d) => d.phone === phone)) {
        toast('A donor with this mobile number already exists. Use “Manage your profile”.', 'error');
        return;
      }

      const donor = {
        id: uid('DNR'),
        name: name.slice(0, 70),
        phone: phone,
        bloodGroup: bloodGroup,
        age: age,
        weight: weight,
        gender: gender,
        city: city.slice(0, 60),
        lastDonation: lastDonation,
        verified: false,
        available: true,
        createdAt: new Date().toISOString()
      };

      state.donors.unshift(donor);
      if (CLOUD_ON) {
        try {
          await CLOUD.addDonor(donor);
        } catch (e) {
          state.donors = state.donors.filter((d) => d.id !== donor.id);
          toast(e.message || 'Your profile could not be saved.', 'error');
          return;
        }
        saveState(true);
        renderAll();
        donorRegisterForm.reset();
        cooldownNotice.hidden = true;
        await cloudRefresh(true);
        toast('Welcome, ' + firstName(name) + '! Your profile is live and pending verification.', 'success');
        return;
      }
      saveState();
      renderAll();
      donorRegisterForm.reset();
      cooldownNotice.hidden = true;
      toast('Welcome, ' + firstName(name) + '! Your profile is registered and pending verification.', 'success');
    }

    async function manageFind() {
      if (CLOUD_ON) {
        if (!authUser()) {
          needSignIn('Sign in with the account you registered with to manage your profile.');
          return;
        }
        manageResult.innerHTML = '<div class="empty-inline"><i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i>Loading your profile…</div>';
        try {
          const donor = await CLOUD.myDonor();
          if (!donor) {
            manageDonorId = null;
            manageResult.innerHTML = '<div class="empty-inline"><i class="fa-solid fa-user-slash" aria-hidden="true"></i>No donor profile on this account yet. Register above and it will appear here.</div>';
            return;
          }
          const i = state.donors.findIndex((d) => d.id === donor.id);
          if (i > -1) state.donors[i] = donor; else state.donors.unshift(donor);
          revealedPhones[donor.id] = donor.phone;
          manageDonorId = donor.id;
          renderManage();
        } catch (e) {
          manageResult.innerHTML = '';
          toast(e.message || 'Could not load your profile.', 'error');
        }
        return;
      }
      const phone = digits(managePhone.value).slice(-10);
      if (phone.length !== 10) {
        toast('Enter the 10-digit mobile number you registered with.', 'error');
        return;
      }
      const donor = state.donors.find((d) => d.phone === phone || d.phone.endsWith(phone));
      if (!donor) {
        manageDonorId = null;
        manageResult.innerHTML = '<div class="empty-inline"><i class="fa-solid fa-user-slash" aria-hidden="true"></i>No profile found for that number. Register above or check the number.</div>';
        return;
      }
      manageDonorId = donor.id;
      renderManage();
    }

    function renderManage() {
      const donor = state.donors.find((d) => d.id === manageDonorId);
      if (!donor) {
        manageDonorId = null;
        manageResult.innerHTML = '';
        return;
      }
      const el = eligibility(donor.lastDonation);
      const statusText = !donor.available ? 'Paused' : (el.state === 'eligible' ? 'Ready to donate' : el.daysLeft + ' days left in cooldown');
      const statusCls = !donor.available ? 'paused' : el.state;
      manageResult.innerHTML = '<div class="manage-profile">' +
        '<div class="manage-top">' +
          '<span class="blood-badge">' + esc(donor.bloodGroup) + '</span>' +
          '<div><strong>' + esc(donor.name) + '</strong><p>' + esc(donor.city) + ' · ' + esc(donor.phone) + '</p></div>' +
        '</div>' +
        '<p class="manage-status">Status: <span class="badge badge-' + statusCls + '">' + esc(statusText) + '</span></p>' +
        '<p class="small muted">' + (donor.verified ? 'Verified donor' : 'Pending admin verification') +
          (donor.lastDonation ? ' · Last donated ' + formatDate(donor.lastDonation) : ' · First-time donor') + '</p>' +
        '<div class="manage-actions">' +
          '<button class="btn btn-primary btn-sm" type="button" data-action="manage-donated" data-id="' + esc(donor.id) + '">' +
            '<i class="fa-solid fa-droplet" aria-hidden="true"></i> I donated today</button>' +
          '<button class="btn btn-ghost btn-sm" type="button" data-action="manage-toggle" data-id="' + esc(donor.id) + '">' +
            '<i class="fa-solid fa-' + (donor.available ? 'pause' : 'play') + '" aria-hidden="true"></i> ' +
            (donor.available ? 'Pause availability' : 'Resume availability') + '</button>' +
          '<button class="btn btn-ghost btn-sm danger-text" type="button" data-action="manage-delete" data-id="' + esc(donor.id) + '">' +
            '<i class="fa-solid fa-trash-can" aria-hidden="true"></i> Delete my data</button>' +
        '</div>' +
        '<p class="manage-note">Logging a donation starts a new ' + CONFIG.cooldownDays + '-day safety cooldown automatically.</p>' +
      '</div>';
    }

    async function manageDonated(id) {
      const donor = state.donors.find((d) => d.id === id);
      if (!donor) return;
      if (!confirm('Mark ' + donor.name + ' as having donated today? A ' + CONFIG.cooldownDays + '-day cooldown will start.')) return;
      donor.lastDonation = todayISO();
      donor.available = true;
      if (CLOUD_ON) {
        try { await CLOUD.patchDonor(id, { lastDonation: donor.lastDonation, available: true }); }
        catch (e) { toast(e.message || 'Could not save the donation.', 'error'); return; }
        await cloudRefresh(true);
      } else {
        saveState();
        renderAll();
      }
      toast('Donation logged. Next eligible date: ' + formatDate(addDaysISO(todayISO(), CONFIG.cooldownDays)) + '.', 'success');
    }

    async function manageToggle(id) {
      const donor = state.donors.find((d) => d.id === id);
      if (!donor) return;
      donor.available = !donor.available;
      if (CLOUD_ON) {
        try { await CLOUD.patchDonor(id, { available: donor.available }); }
        catch (e) { donor.available = !donor.available; toast(e.message || 'Could not update availability.', 'error'); return; }
        await cloudRefresh(true);
      } else {
        saveState();
        renderAll();
      }
      toast(donor.available ? 'Your profile is visible to people who need blood.' : 'Your profile is paused — you will not appear in searches.', donor.available ? 'success' : 'info');
    }

    async function manageDelete(id) {
      const donor = state.donors.find((d) => d.id === id);
      if (!donor) return;
      if (!confirm('Permanently delete your profile and contact details? This cannot be undone.')) return;
      if (CLOUD_ON) {
        try { await CLOUD.deleteDonorRow(id); }
        catch (e) { toast(e.message || 'Could not delete the profile.', 'error'); return; }
        await cloudRefresh(true);
      } else {
        state.donors = state.donors.filter((d) => d.id !== id);
        saveState();
        renderAll();
      }
      manageDonorId = null;
      manageResult.innerHTML = '';
      managePhone.value = '';
      toast('Your profile has been deleted from the network.', 'warn');
    }

    /* ====================================================================
       BLOOD BANK INVENTORY
       ==================================================================== */
    function buildHospitalSelect(preserve) {
      const previous = preserve ? hospitalSelect.value : '';
      hospitalSelect.innerHTML = '<option value="all">All hospitals (network average)</option>' +
        state.hospitals.map((h) => '<option value="' + esc(h.id) + '">' + esc(h.name) + ' — ' + esc(h.city) + '</option>').join('');
      if (preserve && (previous === 'all' || state.hospitals.some((h) => h.id === previous))) {
        hospitalSelect.value = previous;
      } else {
        hospitalSelect.value = state.hospitals[0] ? state.hospitals[0].id : 'all';
      }
    }

    function stockStatus(avg) {
      if (avg <= 0) return { cls: 'critical', label: 'Out of stock' };
      if (avg <= 3) return { cls: 'critical', label: 'Critical' };
      if (avg <= 8) return { cls: 'low', label: 'Low' };
      if (avg <= 16) return { cls: 'ok', label: 'Adequate' };
      return { cls: 'high', label: 'Healthy' };
    }

    function renderInventory() {
      const scope = hospitalSelect.value;
      const banks = scope === 'all' ? state.hospitals : state.hospitals.filter((h) => h.id === scope);
      if (!banks.length) {
        inventoryGrid.innerHTML = '';
        inventoryAlert.innerHTML = '<div class="alert alert-warn"><i class="fa-solid fa-circle-info" aria-hidden="true"></i>No blood banks configured.</div>';
        return;
      }
      const totals = {};
      GROUPS.forEach((g) => { totals[g] = 0; });
      banks.forEach((bank) => GROUPS.forEach((g) => { totals[g] += Number(bank.stock[g] || 0); }));
      const perBank = scope === 'all' ? banks.length : 1;

      const data = GROUPS.map((g) => {
        const units = totals[g];
        const avg = units / perBank;
        return { g: g, units: units, avg: avg, status: stockStatus(avg) };
      });

      inventoryGrid.innerHTML = data.map((row) => {
        const pct = clamp(Math.round((row.avg / 25) * 100), 0, 100);
        return '<article class="stock-card stock-' + row.status.cls + '">' +
          '<div class="stock-head"><span class="stock-type">' + row.g + '</span>' +
            '<span class="badge badge-' + (row.status.cls === 'low' ? 'low' : row.status.cls) + '">' + row.status.label + '</span></div>' +
          '<div class="stock-units"><strong>' + row.units + '</strong> unit' + (row.units === 1 ? '' : 's') + '</div>' +
          '<div class="stock-bar" aria-hidden="true"><span style="width:' + pct + '%"></span></div>' +
          '<div class="stock-foot">' + (scope === 'all' ? 'avg ' + row.avg.toFixed(1) + ' / bank' : 'available now') + '</div>' +
        '</article>';
      }).join('');

      const low = data.filter((row) => row.status.cls === 'critical' || row.status.cls === 'low');
      if (low.length) {
        inventoryAlert.innerHTML = '<div class="alert alert-warn">' +
          '<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>' +
          '<div><strong>' + low.length + ' blood type' + (low.length === 1 ? '' : 's') + ' need attention.</strong><br>' +
            low.map((row) => row.g + ' — ' + row.units + ' unit' + (row.units === 1 ? '' : 's') + ' (' + row.status.label + ')').join(' · ') +
          '</div>' +
          (scope !== 'all' && banks[0].phone
            ? '<a class="btn btn-ghost btn-sm" href="tel:' + esc(banks[0].phone) + '"><i class="fa-solid fa-phone" aria-hidden="true"></i> Call bank</a>'
            : '') +
        '</div>';
      } else {
        inventoryAlert.innerHTML = '<div class="alert alert-ok">' +
          '<i class="fa-solid fa-circle-check" aria-hidden="true"></i>' +
          '<div><strong>Stock looks healthy.</strong> Every blood group is above the low-stock threshold for this selection.</div>' +
          (scope !== 'all' && banks[0].phone
            ? '<a class="btn btn-ghost btn-sm" href="tel:' + esc(banks[0].phone) + '"><i class="fa-solid fa-phone" aria-hidden="true"></i> Call bank</a>'
            : '') +
        '</div>';
      }
    }

    /* ====================================================================
       ADMIN CONSOLE
       ==================================================================== */
    function setAdminTab(tab) {
      const valid = ['overview', 'donors', 'requests', 'data'];
      const target = valid.includes(tab) ? tab : 'overview';
      $$('.tab[data-tab]').forEach((btn) => {
        const on = btn.dataset.tab === target;
        btn.setAttribute('aria-selected', String(on));
        btn.classList.toggle('is-active', on);
      });
      $$('.admin-panel').forEach((panel) => {
        panel.hidden = panel.id !== 'adminPanel-' + target;
      });
    }

    async function openAdmin() {
      if (CLOUD_ON) {
        if (!authUser()) {
          needSignIn('Sign in with an admin account to open the console.');
          return;
        }
        const admin = window.LifeDropAuth ? await window.LifeDropAuth.refreshAdmin() : false;
        if (!admin) {
          toast('Admin access required. Promote this account to admin in Supabase (see README).', 'error');
          return;
        }
        try {
          adminRows = await CLOUD.adminDonors();
        } catch (e) {
          toast(e.message || 'Could not load admin data.', 'error');
          return;
        }
      }
      setAdminTab('overview');
      buildStockEditor();
      renderAdmin();
      openModal(adminModal);
    }

    function buildStockEditor() {
      if (!stockHospital || !stockGroup) return;
      const previous = stockHospital.value;
      stockHospital.innerHTML = state.hospitals
        .map((h) => '<option value="' + esc(h.id) + '">' + esc(h.name) + ' — ' + esc(h.city) + '</option>')
        .join('');
      stockGroup.innerHTML = GROUPS.map((g) => '<option value="' + g + '">' + g + '</option>').join('');
      if (previous && state.hospitals.some((h) => h.id === previous)) stockHospital.value = previous;
      syncStockUnits();
    }

    function syncStockUnits() {
      if (!stockHospital || !stockGroup || !stockUnits) return;
      const bank = state.hospitals.find((h) => h.id === stockHospital.value);
      stockUnits.value = bank ? String(Number(bank.stock[stockGroup.value] || 0)) : '0';
    }

    async function saveStock() {
      if (!stockHospital || !stockGroup || !stockUnits) return;
      const bank = state.hospitals.find((h) => h.id === stockHospital.value);
      if (!bank) return;
      const group = stockGroup.value;
      const units = clamp(parseInt(stockUnits.value, 10) || 0, 0, 9999);
      if (CLOUD_ON) {
        try {
          await CLOUD.updateStock(bank.id, group, units);
        } catch (e) {
          toast(e.message || 'Could not save the stock.', 'error');
          return;
        }
      }
      bank.stock[group] = units;
      saveState(true);
      renderInventory();
      if (stockMsg) {
        stockMsg.textContent = bank.name + ' · ' + group + ' → ' + units + ' unit(s) saved ' +
          (CLOUD_ON ? 'to the live network.' : 'locally.');
      }
      toast('Blood bank stock updated.', 'success');
    }

    function kpi(icon, label, value) {
      return '<div class="kpi"><i class="fa-solid ' + icon + '" aria-hidden="true"></i>' +
        '<strong>' + value + '</strong><span>' + label + '</span></div>';
    }

    function renderAdminKpis() {
      const total = state.donors.length;
      const ready = state.donors.filter((d) => d.available && eligibility(d.lastDonation).state === 'eligible').length;
      const cooldown = state.donors.filter((d) => d.available && eligibility(d.lastDonation).state !== 'eligible').length;
      const active = state.sos.filter((s) => sosStatus(s).value === 'ACTIVE').length;
      adminKpis.innerHTML =
        kpi('fa-users', 'Registered donors', total) +
        kpi('fa-user-check', 'Ready now', ready) +
        kpi('fa-clock', 'In cooldown', cooldown) +
        kpi('fa-bell', 'Active SOS', active);
    }

    function renderAdminCharts() {
      const counts = GROUPS.map((g) => state.donors.filter((d) => d.bloodGroup === g).length);
      const max = Math.max(1, ...counts);
      adminChartBars.innerHTML = GROUPS.map((g, i) => {
        const n = counts[i];
        const height = n ? Math.max(6, Math.round((n / max) * 100)) : 2;
        return '<div class="bar-col" title="' + g + ': ' + n + ' donor' + (n === 1 ? '' : 's') + '">' +
          '<div class="bar-track"><div class="bar-fill" style="height:' + height + '%"></div></div>' +
          '<span class="bar-count">' + n + '</span><span class="bar-label">' + g + '</span></div>';
      }).join('');

      const total = state.donors.length;
      const ready = state.donors.filter((d) => d.available && eligibility(d.lastDonation).state === 'eligible').length;
      const paused = state.donors.filter((d) => !d.available).length;
      const cooldown = Math.max(0, total - ready - paused);
      if (!total) {
        adminDonut.style.background = 'var(--surface-3)';
      } else {
        const p1 = (ready / total) * 100;
        const p2 = ((ready + cooldown) / total) * 100;
        adminDonut.style.background = 'conic-gradient(var(--ok) 0 ' + p1 + '%, var(--warn) ' + p1 + '% ' + p2 + '%, var(--muted) ' + p2 + '% 100%)';
      }
      adminDonut.innerHTML = '<div class="donut-hole"><strong>' + total + '</strong><span>donors</span></div>';
      adminDonut.setAttribute('aria-label', total + ' donors: ' + ready + ' ready, ' + cooldown + ' in cooldown, ' + paused + ' paused');
      adminLegend.innerHTML =
        '<li><span class="swatch" style="background:var(--ok)"></span>Ready <strong>' + ready + '</strong></li>' +
        '<li><span class="swatch" style="background:var(--warn)"></span>Cooldown <strong>' + cooldown + '</strong></li>' +
        '<li><span class="swatch" style="background:var(--muted)"></span>Paused <strong>' + paused + '</strong></li>';
    }

    function eligBadge(donor) {
      if (!donor.available) return '<span class="badge badge-paused">Paused</span>';
      const el = eligibility(donor.lastDonation);
      return el.state === 'eligible'
        ? '<span class="badge badge-eligible">Ready</span>'
        : '<span class="badge badge-cooldown">' + el.daysLeft + 'd left</span>';
    }

    function renderAdminDonors() {
      const q = adminQuery.trim().toLowerCase();
      const all = adminRows || state.donors;
      const list = all.filter((d) =>
        !q ||
        d.name.toLowerCase().includes(q) ||
        d.phone.includes(q) ||
        d.city.toLowerCase().includes(q) ||
        d.bloodGroup.toLowerCase().includes(q)
      );
      adminDonorCount.textContent = list.length + ' of ' + all.length + ' records';
      adminTableBody.innerHTML = list.length ? list.map((d) =>
        '<tr>' +
          '<td><strong>' + esc(d.name) + '</strong>' + (d.verified ? ' <i class="fa-solid fa-circle-check verified" role="img" title="Verified" aria-label="Verified"></i>' : '') +
            '<br><span class="sub">' + esc(d.phone) + '</span></td>' +
          '<td><strong style="color:var(--brand)">' + esc(d.bloodGroup) + '</strong></td>' +
          '<td>' + esc(d.city) + '</td>' +
          '<td>' + eligBadge(d) + '</td>' +
          '<td><span class="badge badge-' + (d.available ? 'eligible' : 'paused') + '">' + (d.available ? 'Active' : 'Paused') + '</span></td>' +
          '<td><div class="row-actions">' +
            '<button class="mini-btn' + (d.verified ? ' is-on' : '') + '" type="button" data-action="toggle-verified" data-id="' + esc(d.id) + '" title="' + (d.verified ? 'Remove verification' : 'Verify donor') + '" aria-label="Toggle verification"><i class="fa-solid fa-certificate" aria-hidden="true"></i></button>' +
            '<button class="mini-btn" type="button" data-action="toggle-availability" data-id="' + esc(d.id) + '" title="Toggle availability" aria-label="Toggle availability"><i class="fa-solid fa-power-off" aria-hidden="true"></i></button>' +
            '<button class="mini-btn danger" type="button" data-action="delete-donor" data-id="' + esc(d.id) + '" title="Delete donor" aria-label="Delete donor"><i class="fa-solid fa-trash-can" aria-hidden="true"></i></button>' +
          '</div></td>' +
        '</tr>'
      ).join('') : '<tr><td colspan="6" class="small muted" style="text-align:center;padding:24px">No matching donor records.</td></tr>';
    }

    function renderAdminRequests() {
      const list = state.sos.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      adminReqBody.innerHTML = list.length ? list.map((s) => {
        const st = sosStatus(s);
        const urgency = URGENCY[s.urgency] || URGENCY.urgent;
        return '<tr>' +
          '<td><strong>' + esc(s.patient) + '</strong><br><span class="sub">' + esc(s.phone) + '</span></td>' +
          '<td><strong style="color:var(--brand)">' + esc(s.bloodGroup) + '</strong> · ' + s.units + 'u<br><span class="sub">' + urgency.label + '</span></td>' +
          '<td>' + esc(s.hospital) + '<br><span class="sub">' + esc(s.city) + '</span></td>' +
          '<td><span class="badge badge-' + st.cls + '">' + st.label + '</span></td>' +
          '<td><div class="row-actions">' +
            '<button class="mini-btn" type="button" data-action="open-slip" data-id="' + esc(s.id) + '" title="Open pass" aria-label="Open pass"><i class="fa-solid fa-file-lines" aria-hidden="true"></i></button>' +
            (st.value !== 'RESOLVED'
              ? '<button class="mini-btn" type="button" data-action="resolve-sos" data-id="' + esc(s.id) + '" title="Mark resolved" aria-label="Mark resolved"><i class="fa-solid fa-check" aria-hidden="true"></i></button>'
              : '') +
            '<button class="mini-btn danger" type="button" data-action="delete-sos" data-id="' + esc(s.id) + '" title="Delete request" aria-label="Delete request"><i class="fa-solid fa-trash-can" aria-hidden="true"></i></button>' +
          '</div></td>' +
        '</tr>';
      }).join('') : '<tr><td colspan="5" class="small muted" style="text-align:center;padding:24px">No emergency requests.</td></tr>';
    }

    function renderStorageInfo() {
      if (CLOUD_ON) {
        const user = authUser();
        const demo = state.donors.filter((d) => d.demo).length;
        storageInfo.textContent = 'Live network · ' + state.donors.length + ' donors' +
          (demo ? ' (' + demo + ' sample)' : '') + ' · ' + state.sos.length + ' requests · ' +
          state.hospitals.length + ' blood banks · ' +
          (user ? 'signed in as ' + user.email : 'public view (sign in to see numbers)') +
          '. Last sync: ' + formatDateTime(state.updatedAt);
        return;
      }
      let bytes = 0;
      try { bytes = new Blob([JSON.stringify(state)]).size; } catch (e) { bytes = JSON.stringify(state).length * 2; }
      storageInfo.textContent = state.donors.length + ' donors · ' + state.sos.length + ' requests · ' +
        state.hospitals.length + ' blood banks · about ' + (bytes / 1024).toFixed(1) + ' KB stored locally. Last update: ' +
        formatDateTime(state.updatedAt);
    }

    function renderAdmin() {
      renderAdminKpis();
      renderAdminCharts();
      renderAdminDonors();
      renderAdminRequests();
      renderStorageInfo();
    }

    async function toggleDonor(id, field) {
      const donor = state.donors.find((d) => d.id === id);
      if (!donor) return;
      donor[field] = !donor[field];
      if (CLOUD_ON) {
        const patch = {};
        patch[field] = donor[field];
        try {
          await CLOUD.patchDonor(id, patch);
        } catch (e) {
          donor[field] = !donor[field];
          toast(e.message || 'Could not update the donor.', 'error');
          return;
        }
        await cloudRefresh(true);
        try { adminRows = await CLOUD.adminDonors(); } catch (e) { adminRows = null; }
        renderAdmin();
      } else {
        saveState();
        renderAll();
      }
      if (field === 'available') {
        toast(donor.name + (donor.available ? ' is now visible to searches.' : ' is now paused.'), 'success');
      } else {
        toast(donor.name + (donor.verified ? ' is now verified.' : ' is no longer verified.'), 'success');
      }
    }

    async function deleteDonor(id) {
      const donor = state.donors.find((d) => d.id === id);
      if (!donor) return;
      if (!confirm('Remove ' + donor.name + ' from the donor database?')) return;
      if (CLOUD_ON) {
        try { await CLOUD.deleteDonorRow(id); }
        catch (e) { toast(e.message || 'Could not delete the donor.', 'error'); return; }
        await cloudRefresh(true);
        try { adminRows = await CLOUD.adminDonors(); } catch (e) { adminRows = null; }
        renderAdmin();
      } else {
        state.donors = state.donors.filter((d) => d.id !== id);
        saveState();
        renderAll();
      }
      if (manageDonorId === id) manageDonorId = null;
      toast('Donor record removed.', 'warn');
    }

    async function seedDemo() {
      if (CLOUD_ON) {
        const admin = window.LifeDropAuth ? await window.LifeDropAuth.refreshAdmin() : false;
        if (!admin) { toast('Admin access required to load sample data.', 'error'); return; }
        if (!confirm('Load sample donor profiles into the live network? They are marked as demo and removable in one click.')) return;
        const donors = seedDonors().map((d) => Object.assign({}, d, { id: uid('DNR'), demo: true }));
        try {
          await CLOUD.importDonors(donors, true);
        } catch (e) {
          toast(e.message || 'Sample data could not be loaded.', 'error');
          return;
        }
        await cloudRefresh(true);
        try { adminRows = await CLOUD.adminDonors(); } catch (e) { adminRows = null; }
        renderAdmin();
        toast(donors.length + ' sample donor profiles loaded.', 'success');
        return;
      }
      if (!confirm('Reload the sample donors, requests and hospital stock? Current data will be replaced.')) return;
      state.donors = seedDonors();
      state.sos = seedSOS();
      state.hospitals = seedHospitals();
      manageDonorId = null;
      manageResult.innerHTML = '';
      saveState();
      buildHospitalSelect(false);
      renderAll();
      toast('Sample demo data reloaded.', 'success');
    }

    async function clearDemo() {
      if (CLOUD_ON) {
        const admin = window.LifeDropAuth ? await window.LifeDropAuth.refreshAdmin() : false;
        if (!admin) { toast('Admin access required.', 'error'); return; }
        if (!confirm('Remove every sample donor and request from the live network?')) return;
        try { await CLOUD.clearDemo(); }
        catch (e) { toast(e.message || 'Could not remove sample data.', 'error'); return; }
        await cloudRefresh(true);
        adminRows = null;
        try { adminRows = await CLOUD.adminDonors(); } catch (e) { /* ignore */ }
        renderAdmin();
        toast('Sample data removed.', 'success');
        return;
      }
      state.donors = state.donors.filter((d) => !d.demo);
      state.sos = state.sos.filter((s) => !s.demo);
      saveState();
      renderAll();
      toast('Sample data removed.', 'success');
    }

    async function resetAll() {
      if (CLOUD_ON) {
        const admin = window.LifeDropAuth ? await window.LifeDropAuth.refreshAdmin() : false;
        if (!admin) { toast('Admin access required.', 'error'); return; }
        if (!confirm('Delete every sample donor and request from the live network? Real registered donors are never touched.')) return;
        try { await CLOUD.clearDemo(); }
        catch (e) { toast(e.message || 'Could not clear the sample data.', 'error'); return; }
        await cloudRefresh(true);
        try { adminRows = await CLOUD.adminDonors(); } catch (e) { adminRows = null; }
        renderAdmin();
        toast('Sample data cleared. Real donor profiles are untouched.', 'warn');
        return;
      }
      if (!confirm('Delete every donor and request stored in this browser? This cannot be undone.')) return;
      state.donors = [];
      state.sos = [];
      state.hospitals = seedHospitals();
      manageDonorId = null;
      manageResult.innerHTML = '';
      saveState();
      buildHospitalSelect(false);
      renderAll();
      toast('Local database cleared. Hospital stock reset.', 'warn');
    }

    function exportJSON() {
      const payload = {
        app: CONFIG.appName,
        version: DB_VERSION,
        exportedAt: new Date().toISOString(),
        donors: state.donors,
        sos: state.sos,
        hospitals: state.hospitals
      };
      download(JSON.stringify(payload, null, 2), 'lifedrop-backup-' + todayISO() + '.json', 'application/json');
      toast('JSON backup downloaded.', 'success');
    }

    function exportCSV() {
      const rows = [['ID', 'Name', 'Phone', 'Blood Group', 'Age', 'Weight (kg)', 'Gender', 'City', 'Last Donation', 'Verified', 'Available', 'Registered']];
      state.donors.forEach((d) => {
        rows.push([d.id, d.name, d.phone, d.bloodGroup, d.age, d.weight, d.gender, d.city, d.lastDonation || '', d.verified ? 'Yes' : 'No', d.available ? 'Yes' : 'No', d.createdAt]);
      });
      const csv = '\uFEFF' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
      download(csv, 'lifedrop-donors-' + todayISO() + '.csv', 'text/csv;charset=utf-8');
      toast('Donor CSV downloaded.', 'success');
    }

    async function handleImport(event) {
      const file = event.target.files && event.target.files[0];
      event.target.value = '';
      if (!file) return;
      if (file.size > 3 * 1024 * 1024) { toast('That file is too large (max 3 MB).', 'error'); return; }
      let text;
      try { text = await file.text(); } catch (e) { toast('The file could not be read.', 'error'); return; }
      let data;
      try { data = JSON.parse(text); } catch (e) { toast('That file is not valid JSON.', 'error'); return; }
      const payload = Array.isArray(data) ? { donors: data } : data;
      if (!payload || !Array.isArray(payload.donors)) { toast('JSON must contain a “donors” array.', 'error'); return; }
      const donors = payload.donors.map(normalizeDonor).filter(Boolean);
      if (!donors.length) { toast('No valid donor records were found in that file.', 'error'); return; }
      if (!confirm('Import ' + donors.length + ' donor record' + (donors.length === 1 ? '' : 's') + ' into the network?')) return;

      if (CLOUD_ON) {
        const admin = window.LifeDropAuth ? await window.LifeDropAuth.refreshAdmin() : false;
        if (!admin) { toast('Admin access required to import donors.', 'error'); return; }
        try {
          const n = await CLOUD.importDonors(donors, true);
          await cloudRefresh(true);
          toast(n + ' donor record(s) imported as sample data.', 'success');
        } catch (e) {
          toast(e.message || 'The import failed.', 'error');
        }
        return;
      }

      state.donors = donors;
      if (Array.isArray(payload.sos)) state.sos = payload.sos.map(normalizeSOS).filter(Boolean);
      if (Array.isArray(payload.hospitals)) {
        const hospitals = payload.hospitals.map(normalizeHospital).filter(Boolean);
        if (hospitals.length) state.hospitals = hospitals;
      }
      saveState();
      buildHospitalSelect(true);
      renderAll();
      toast('Backup restored successfully.', 'success');
    }

    /* ====================================================================
       PRINTABLE PASS
       ==================================================================== */
    function openSlip(id) {
      const item = state.sos.find((s) => s.id === id);
      if (!item) return;
      const st = sosStatus(item);
      const urgency = URGENCY[item.urgency] || URGENCY.urgent;
      slipContent.innerHTML =
        '<table style="width:100%;border-collapse:collapse;line-height:1.9">' +
          '<tr><td style="color:var(--muted)">Emergency token</td><td style="text-align:right;font-weight:700">' + esc(item.id) + '</td></tr>' +
          '<tr><td style="color:var(--muted)">Patient name</td><td style="text-align:right;font-weight:700">' + esc(item.patient) + '</td></tr>' +
          '<tr><td style="color:var(--muted)">Required blood type</td><td style="text-align:right;font-weight:800;color:var(--brand)">' + esc(item.bloodGroup) + ' · ' + item.units + ' unit(s)</td></tr>' +
          '<tr><td style="color:var(--muted)">Hospital</td><td style="text-align:right;font-weight:600">' + esc(item.hospital) + ', ' + esc(item.city) + '</td></tr>' +
          '<tr><td style="color:var(--muted)">Attendant helpline</td><td style="text-align:right;font-weight:600">' + esc(item.phone) + '</td></tr>' +
          '<tr><td style="color:var(--muted)">Urgency</td><td style="text-align:right">' + urgency.label + ' · ' + st.label + '</td></tr>' +
          '<tr><td style="color:var(--muted)">Created</td><td style="text-align:right">' + esc(formatDateTime(item.createdAt)) + '</td></tr>' +
          '<tr><td style="color:var(--muted);vertical-align:top">Medical note</td><td style="text-align:right">' + esc(item.notes) + '</td></tr>' +
        '</table>';
      openModal(slipModal);
    }

    /* ====================================================================
       COMMAND PALETTE
       ==================================================================== */
    const PALETTE = [
      { label: 'Go to home', icon: 'fa-house', keywords: 'start hero top', run: () => go('#home') },
      { label: 'Blood compatibility matrix', icon: 'fa-dna', keywords: 'match group transfusion', run: () => go('#compatibility') },
      { label: 'Find donors', icon: 'fa-magnifying-glass', keywords: 'search blood city', run: () => go('#find') },
      { label: 'Focus city search', icon: 'fa-location-dot', keywords: 'filter location', run: () => { go('#find'); setTimeout(() => searchCity.focus(), 380); } },
      { label: 'Raise an emergency SOS', icon: 'fa-triangle-exclamation', keywords: 'urgent request broadcast', run: () => { go('#sos'); setTimeout(() => sosPatient.focus(), 380); } },
      { label: 'Register as a donor', icon: 'fa-user-plus', keywords: 'signup join', run: () => { go('#register'); setTimeout(() => regName.focus(), 380); } },
      { label: 'Manage my donor profile', icon: 'fa-sliders', keywords: 'pause delete phone', run: () => { go('#register'); setTimeout(() => managePhone.focus(), 380); } },
      { label: 'Blood bank inventory', icon: 'fa-hospital', keywords: 'stock units hospital', run: () => go('#inventory') },
      { label: 'Open admin console', icon: 'fa-shield-halved', keywords: 'dashboard analytics', run: () => openAdmin() },
      { label: 'Sign in / my account', icon: 'fa-circle-user', keywords: 'login signup email password', run: () => { if (window.LifeDropAuth) window.LifeDropAuth.open('signin'); } },
      { label: 'Admin: donor records', icon: 'fa-users', keywords: 'verify delete toggle', run: () => { openAdmin(); setAdminTab('donors'); } },
      { label: 'Admin: emergency requests', icon: 'fa-bell', keywords: 'sos resolve', run: () => { openAdmin(); setAdminTab('requests'); } },
      { label: 'Admin: export backup', icon: 'fa-download', keywords: 'json data save', run: () => exportJSON() },
      { label: 'Toggle dark mode', icon: 'fa-moon', keywords: 'theme light appearance', run: () => toggleTheme() }
    ];

    function openPalette() {
      closeNav();
      paletteInput.value = '';
      renderPalette('');
      if (modalStack.includes(paletteModal)) {
        paletteInput.focus();
        paletteInput.select();
      } else {
        openModal(paletteModal);
      }
    }

    function renderPalette(query) {
      const q = String(query || '').trim().toLowerCase();
      paletteResults = PALETTE.filter((action) => !q || (action.label + ' ' + action.keywords).toLowerCase().includes(q));
      paletteIndex = 0;
      if (!paletteResults.length) {
        paletteList.innerHTML = '<div class="palette-empty">No actions match “' + esc(query) + '”.</div>';
        return;
      }
      paletteList.innerHTML = paletteResults.map((action, i) =>
        '<button class="palette-item' + (i === 0 ? ' is-selected' : '') + '" type="button" role="option" aria-selected="' + (i === 0) + '" data-index="' + i + '">' +
          '<i class="fa-solid ' + action.icon + '" aria-hidden="true"></i>' +
          '<span>' + esc(action.label) + '</span>' +
        '</button>'
      ).join('');
    }

    function movePalette(delta) {
      if (!paletteResults.length) return;
      paletteIndex = (paletteIndex + delta + paletteResults.length) % paletteResults.length;
      $$('.palette-item', paletteList).forEach((item, i) => {
        const on = i === paletteIndex;
        item.classList.toggle('is-selected', on);
        item.setAttribute('aria-selected', String(on));
        if (on) item.scrollIntoView({ block: 'nearest' });
      });
    }

    function runPalette(index) {
      const action = paletteResults[index];
      if (!action) return;
      closeModal(paletteModal);
      action.run();
    }

    function onPaletteKey(event) {
      if (event.key === 'ArrowDown') { event.preventDefault(); movePalette(1); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); movePalette(-1); }
      else if (event.key === 'Enter') { event.preventDefault(); runPalette(paletteIndex); }
    }

    /* ====================================================================
       NAVIGATION
       ==================================================================== */
    function go(hash) {
      const target = document.querySelector(hash);
      if (!target) return;
      closeNav();
      target.scrollIntoView({ behavior: prefersReduced() ? 'auto' : 'smooth', block: 'start' });
      if (history.replaceState) history.replaceState(null, '', hash);
    }

    function toggleNav() {
      const open = primaryNav.classList.toggle('is-open');
      navToggle.setAttribute('aria-expanded', String(open));
      navToggle.setAttribute('aria-label', open ? 'Close navigation menu' : 'Open navigation menu');
      navToggle.innerHTML = '<i class="fa-solid ' + (open ? 'fa-xmark' : 'fa-bars') + '" aria-hidden="true"></i>';
    }

    function closeNav() {
      if (!primaryNav.classList.contains('is-open')) return;
      primaryNav.classList.remove('is-open');
      navToggle.setAttribute('aria-expanded', 'false');
      navToggle.setAttribute('aria-label', 'Open navigation menu');
      navToggle.innerHTML = '<i class="fa-solid fa-bars" aria-hidden="true"></i>';
    }

    function setupScrollSpy() {
      const links = $$('.nav-link[href^="#"]');
      const sections = links.map((link) => document.querySelector(link.getAttribute('href'))).filter(Boolean);
      if (!('IntersectionObserver' in window) || !sections.length) return;
      const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const id = '#' + entry.target.id;
          links.forEach((link) => {
            const on = link.getAttribute('href') === id;
            link.classList.toggle('active', on);
            if (on) link.setAttribute('aria-current', 'location');
            else link.removeAttribute('aria-current');
          });
        });
      }, { rootMargin: '-42% 0px -52% 0px', threshold: 0 });
      sections.forEach((section) => observer.observe(section));
    }

    function onScroll() {
      const header = document.getElementById('siteHeader');
      if (header) header.classList.toggle('is-scrolled', window.scrollY > 8);
      if (toTop) toTop.classList.toggle('is-visible', window.scrollY > 700);
    }

    function onGlobalKey(event) {
      const key = event.key;
      if ((event.ctrlKey || event.metaKey) && (key === 'k' || key === 'K')) {
        event.preventDefault();
        openPalette();
        return;
      }
      if (key === 'Escape') {
        if (modalStack.length) {
          event.preventDefault();
          closeModal(modalStack[modalStack.length - 1]);
          return;
        }
        if (primaryNav.classList.contains('is-open')) {
          event.preventDefault();
          closeNav();
          return;
        }
      }
      if (key === 'Tab') trapFocus(event);
    }

    /* ====================================================================
       RENDER PIPELINE
       ==================================================================== */
    function buildStaticOptions() {
      const options = GROUPS.map((g) => '<option value="' + g + '">' + g + '</option>').join('');
      searchBlood.innerHTML = '<option value="">All blood groups</option>' + options;
      sosBlood.innerHTML = '<option value="">Select blood group</option>' + options;
      regBlood.innerHTML = '<option value="">Choose blood group</option>' + options;
      bloodPills.innerHTML = GROUPS.map((g) =>
        '<button class="blood-pill" type="button" aria-pressed="false" data-action="select-blood" data-group="' + g + '">' + g + '</button>'
      ).join('');
      regLastDonation.max = todayISO();
      const year = document.getElementById('year');
      if (year) year.textContent = String(new Date().getFullYear());
      selectBloodGroup('O-');
      syncSearchInputs();
    }

    function renderCityOptions() {
      const cities = Array.from(new Set(
        state.donors.map((d) => d.city).concat(state.sos.map((s) => s.city)).filter(Boolean)
      )).sort((a, b) => a.localeCompare(b));
      cityList.innerHTML = cities.map((city) => '<option value="' + esc(city) + '"></option>').join('');
    }

    function renderAll() {
      updateStats();
      renderDonors();
      renderSOS();
      renderInventory();
      renderCityOptions();
      if (adminModal && adminModal.classList.contains('is-open')) renderAdmin();
      if (manageDonorId) renderManage();
    }

    /* ====================================================================
       ACTION MAP (event delegation — no inline handlers)
       ==================================================================== */
    const ACTIONS = {
      'theme': () => toggleTheme(),
      'select-blood': (el) => selectBloodGroup(el.dataset.group),
      'find-compat': () => findForGroup(selectedBlood),
      'reset-filters': () => resetFilters(),
      'clear-chip': (el) => clearChip(el.dataset.key),
      'clear-all': () => resetFilters(),
      'load-more': () => { searchState.limit += STEP; renderDonors(); },
      'view-matches': (el) => viewMatches(el.dataset.id),
      'resolve-sos': (el) => resolveSOS(el.dataset.id),
      'delete-sos': (el) => deleteSOS(el.dataset.id),
      'open-slip': (el) => openSlip(el.dataset.id),
      'sos-filter': (el) => setSosFilter(el.dataset.filter),
      'open-admin': () => openAdmin(),
      'admin-tab': (el) => setAdminTab(el.dataset.tab),
      'toggle-availability': (el) => toggleDonor(el.dataset.id, 'available'),
      'toggle-verified': (el) => toggleDonor(el.dataset.id, 'verified'),
      'delete-donor': (el) => deleteDonor(el.dataset.id),
      'export-json': () => exportJSON(),
      'export-csv': () => exportCSV(),
      'import-json': () => adminImportInput.click(),
      'seed-demo': () => seedDemo(),
      'reset-all': () => resetAll(),
      'close-modal': (el) => closeModal(el.closest('.modal-backdrop')),
      'print-slip': () => window.print(),
      'scroll-top': () => window.scrollTo({ top: 0, behavior: prefersReduced() ? 'auto' : 'smooth' }),
      'manage-find': () => manageFind(),
      'manage-donated': (el) => manageDonated(el.dataset.id),
      'manage-toggle': (el) => manageToggle(el.dataset.id),
      'manage-delete': (el) => manageDelete(el.dataset.id),
      'reveal-phone': (el) => revealPhone(el.dataset.id),
      'save-stock': () => saveStock(),
      'clear-demo': () => clearDemo()
    };

    function handleActionClick(event) {
      const trigger = event.target.closest('[data-action]');
      if (!trigger) return;
      const handler = ACTIONS[trigger.dataset.action];
      if (!handler) return;
      event.preventDefault();
      handler(trigger, event);
    }

    /* ====================================================================
       EVENT WIRING
       ==================================================================== */
    function wireEvents() {
      navToggle.addEventListener('click', toggleNav);
      primaryNav.addEventListener('click', (event) => {
        if (event.target.closest('a')) closeNav();
      });

      searchBlood.addEventListener('change', onFilterChange);
      searchLogic.addEventListener('change', onFilterChange);
      searchEligibility.addEventListener('change', onFilterChange);
      searchSort.addEventListener('change', onFilterChange);
      searchVerified.addEventListener('change', onFilterChange);
      searchCity.addEventListener('input', debounce(onFilterChange, 160));

      hospitalSelect.addEventListener('change', renderInventory);
      if (stockHospital) stockHospital.addEventListener('change', syncStockUnits);
      if (stockGroup) stockGroup.addEventListener('change', syncStockUnits);
      regLastDonation.addEventListener('change', previewEligibility);
      donorRegisterForm.addEventListener('submit', handleRegister);
      sosForm.addEventListener('submit', handleSOS);
      adminImportInput.addEventListener('change', handleImport);
      adminDonorSearch.addEventListener('input', debounce(() => {
        adminQuery = adminDonorSearch.value;
        renderAdminDonors();
      }, 150));

      managePhone.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') { event.preventDefault(); manageFind(); }
      });

      paletteInput.addEventListener('input', () => renderPalette(paletteInput.value));
      paletteInput.addEventListener('keydown', onPaletteKey);
      paletteList.addEventListener('click', (event) => {
        const item = event.target.closest('[data-index]');
        if (item) runPalette(parseInt(item.dataset.index, 10));
      });

      document.addEventListener('click', handleActionClick);
      $$('.modal-backdrop').forEach((backdrop) => {
        backdrop.addEventListener('click', (event) => {
          if (event.target === backdrop) closeModal(backdrop);
        });
      });
      document.addEventListener('keydown', onGlobalKey);
      window.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('resize', () => { if (window.innerWidth > 1020) closeNav(); });
      window.addEventListener('storage', (event) => {
        if (event.key === THEME_KEY) {
          const theme = storedTheme();
          if (theme) applyTheme(theme);
          return;
        }
        if (event.key === DB_KEY && event.newValue) {
          try {
            state = normalizeState(JSON.parse(event.newValue));
            buildHospitalSelect(true);
            renderAll();
            toast('Data updated from another tab.', 'info');
          } catch (e) { /* ignore malformed cross-tab payloads */ }
        }
      });

      const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
      if (darkQuery.addEventListener) {
        darkQuery.addEventListener('change', (event) => {
          if (!storedTheme()) applyTheme(event.matches ? 'dark' : 'light');
        });
      }
    }

    /* ====================================================================
       BOOTSTRAP
       ==================================================================== */
    function init() {
      initTheme();
      buildStaticOptions();
      buildHospitalSelect(false);
      setAdminTab('overview');
      renderAll();
      wireEvents();
      setupScrollSpy();
      onScroll();
      if (CLOUD_ON) cloudRefresh(true);
    }

    /* ====================================================================
       PUBLIC BRIDGE — used by js/cloud.js + js/auth.js
       ==================================================================== */
    async function onAuthChange() {
      if (!authUser()) {
        Object.keys(revealedPhones).forEach((key) => { delete revealedPhones[key]; });
        adminRows = null;
      }
      await cloudRefresh(true);
      if (adminModal && adminModal.classList.contains('is-open')) {
        if (authUser()) {
          try { adminRows = await CLOUD.adminDonors(); } catch (e) { adminRows = null; }
          renderAdmin();
        } else {
          closeModal(adminModal);
        }
      }
      renderAll();
    }

    window.LifeDropApp = {
      getState: () => state,
      renderAll: renderAll,
      renderAdmin: renderAdmin,
      refresh: () => cloudRefresh(false),
      applyRemote: applyRemote,
      onAuthChange: onAuthChange,
      toast: toast,
      go: go,
      openModal: openModal,
      closeModal: closeModal,
      openAdmin: openAdmin,
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }




  })();
