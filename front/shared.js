(function () {
  'use strict';

  const SESSION_KEY = 'medipointSession';
  const PORTAL_ACCOUNT_PREFIX = 'portalAccount_';
  const PORTAL_PROFILE_PREFIX = 'portalProfile_';
  const CLINICAL_ACCOUNT = Object.freeze({
    name: 'MediPoint Doctor',
    idNumber: 'MP-DOC-2026',
    email: 'doctor@medipoint.local',
    role: 'doctor'
  });

  function parseJSON(value, fallback) {
    if(value === null || value === undefined || value === '') return fallback;

    try {
      return JSON.parse(value);
    } catch (error) {
      console.warn('Ignored invalid stored MediPoint data.', error);
      return fallback;
    }
  }

  function readJSON(storage, key, fallback) {
    return parseJSON(storage.getItem(key), fallback);
  }

  function normalizeId(value) {
    return String(value || '').trim();
  }

  function userKey(id) {
    return `user_${normalizeId(id)}`;
  }

  function measurementsKey(id) {
    return `measurements_${normalizeId(id)}`;
  }

  function latestAssessmentKey(id) {
    return `latestAssessment_${normalizeId(id)}`;
  }

  function setCurrentUser(user) {
    if(!user) return;
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(user));
    localStorage.removeItem('currentUser');
  }

  function getCurrentUser() {
    const sessionUser = readJSON(sessionStorage, SESSION_KEY, null);
    if(sessionUser) return sessionUser;

    // One-time compatibility migration from the original persistent session.
    const legacyUser = readJSON(localStorage, 'currentUser', null);
    if(legacyUser) {
      setCurrentUser(legacyUser);
      return legacyUser;
    }

    return null;
  }

  function clearCurrentUser() {
    sessionStorage.removeItem(SESSION_KEY);
    localStorage.removeItem('currentUser');
  }

  function getUser(id) {
    return readJSON(localStorage, userKey(id), null);
  }

  function getUsers() {
    const users = [];

    for(let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if(!key || !key.startsWith('user_')) continue;

      const user = readJSON(localStorage, key, null);
      if(user && normalizeId(user.idNumber || user.id || user.studentNumber)) {
        users.push(user);
      }
    }

    return users;
  }

  function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase();
  }

  function portalAccountKey(email) {
    return `${PORTAL_ACCOUNT_PREFIX}${normalizeEmail(email)}`;
  }

  function portalProfileKey(id) {
    return `${PORTAL_PROFILE_PREFIX}${normalizeId(id)}`;
  }

  function getPortalProfile(id) {
    return readJSON(localStorage, portalProfileKey(id), null);
  }

  function getPortalAccount(email) {
    return readJSON(localStorage, portalAccountKey(email), null);
  }

  function getPortalAccounts() {
    const accounts = [];
    for(let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if(!key || !key.startsWith(PORTAL_ACCOUNT_PREFIX)) continue;
      const account = readJSON(localStorage, key, null);
      if(account && account.email) accounts.push(account);
    }
    return accounts;
  }

  async function hashPassword(password) {
    const data = new TextEncoder().encode(String(password || ''));
    const digest = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  }

  async function savePortalAccount(profile) {
    if(profile && profile.role === 'doctor') {
      throw new Error('Doctor accounts must be provisioned by MediPoint administration.');
    }
    const email = normalizeEmail(profile && profile.email);
    if(!email) throw new Error('An email address is required.');
    const account = {
      email,
      userId: normalizeId(profile.idNumber),
      role: profile.role,
      createdAt: new Date().toISOString()
    };
    localStorage.setItem(portalAccountKey(email), JSON.stringify(account));
    localStorage.setItem(portalProfileKey(account.userId), JSON.stringify({
      ...profile,
      email,
      idNumber: account.userId,
      accountType: 'portal'
    }));
    return account;
  }

  function ensureClinicalAccount() {
    const email = normalizeEmail(CLINICAL_ACCOUNT.email);
    const account = {
      email,
      userId: CLINICAL_ACCOUNT.idNumber,
      role: 'doctor',
      managed: true,
      createdAt: '2026-01-01T00:00:00.000Z'
    };
    localStorage.setItem(portalAccountKey(email), JSON.stringify(account));
    localStorage.setItem(portalProfileKey(account.userId), JSON.stringify({
      ...CLINICAL_ACCOUNT,
      departmentOffice: 'University Clinic',
      profileComplete: true,
      accountType: 'portal',
      managedAccount: true,
      memberSince: account.createdAt
    }));
  }

  function authenticatePortalIdentity(name, idNumber) {
    const normalizedName = String(name || '').trim().toLowerCase();
    const normalizedId = normalizeId(idNumber);
    const account = getPortalAccounts().find(item => item.userId === normalizedId);
    if(!account) return null;
    const user = getPortalProfile(account.userId);
    return user && String(user.name || '').trim().toLowerCase() === normalizedName ? user : null;
  }

  function saveUser(user, previousId) {
    const id = normalizeId(user && (user.idNumber || user.id || user.studentNumber));
    if(!id) throw new Error('A user ID is required.');

    const isPortalProfile = user && user.accountType === 'portal';
    const destinationKey = isPortalProfile ? portalProfileKey(id) : userKey(id);
    localStorage.setItem(destinationKey, JSON.stringify({ ...user, idNumber: id }));

    const oldId = normalizeId(previousId);
    if(oldId && oldId !== id) {
      const oldMeasurements = getMeasurements(oldId);
      const newMeasurements = getMeasurements(id);
      const oldLatest = readJSON(localStorage, latestAssessmentKey(oldId), null);
      const merged = [...oldMeasurements, ...newMeasurements]
        .filter((record, index, records) => records.findIndex(item => item.date === record.date) === index)
        .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

      if(merged.length) localStorage.setItem(measurementsKey(id), JSON.stringify(merged));
      if(oldLatest) {
        localStorage.setItem(latestAssessmentKey(id), JSON.stringify({
          ...oldLatest,
          userId: id,
          user: user.name || oldLatest.user
        }));
      }
      localStorage.removeItem(measurementsKey(oldId));
      localStorage.removeItem(latestAssessmentKey(oldId));
      localStorage.removeItem(isPortalProfile ? portalProfileKey(oldId) : userKey(oldId));
    }
  }

  function getMeasurements(id) {
    const records = readJSON(localStorage, measurementsKey(id), []);
    return Array.isArray(records) ? records : [];
  }

  function saveAssessment(user, assessment) {
    const id = normalizeId(user && (user.idNumber || user.id || user.studentNumber));
    if(!id) throw new Error('Sign in before saving an assessment.');

    const record = {
      userId: id,
      user: user.name || 'Unknown User',
      program: user.program || user.departmentOffice || 'Not specified',
      date: assessment.date || new Date().toISOString(),
      results: Array.isArray(assessment.results) ? assessment.results : []
    };

    const records = getMeasurements(id).filter(item => item.date !== record.date);
    records.unshift({ date: record.date, results: record.results });
    localStorage.setItem(measurementsKey(id), JSON.stringify(records));
    localStorage.setItem(latestAssessmentKey(id), JSON.stringify(record));
    localStorage.removeItem('latestAssessment');
    return record;
  }

  function getLatestAssessment(user) {
    if(!user) return null;
    const id = normalizeId(user.idNumber || user.id || user.studentNumber);
    if(!id) return null;

    const current = readJSON(localStorage, latestAssessmentKey(id), null);
    if(current) return current;

    // Migrate legacy data only when its identity matches the signed-in user.
    const legacy = readJSON(localStorage, 'latestAssessment', null);
    if(legacy && legacy.userId === id) {
      return saveAssessment(user, legacy);
    }

    return null;
  }

  function escapeHTML(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function routeFor(user, base) {
    const prefix = base || '';
    const role = String(user && user.role || '').toLowerCase();
    return role === 'doctor'
      ? `${prefix}system/doctor-portal.html`
      : `${prefix}index.html`;
  }

  window.MediPoint = {
    parseJSON,
    readJSON,
    normalizeId,
    userKey,
    measurementsKey,
    latestAssessmentKey,
    setCurrentUser,
    getCurrentUser,
    clearCurrentUser,
    getUser,
    getUsers,
    normalizeEmail,
    getPortalAccount,
    getPortalProfile,
    getPortalAccounts,
    savePortalAccount,
    ensureClinicalAccount,
    authenticatePortalIdentity,
    saveUser,
    getMeasurements,
    saveAssessment,
    getLatestAssessment,
    escapeHTML,
    routeFor
  };
})();
