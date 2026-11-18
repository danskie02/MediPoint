(function () {
  'use strict';

  const SESSION_KEY = 'medipointSession';
  const CLINIC_REQUESTS_KEY = 'medipointClinicRequests';
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

  function isUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalizeId(value));
  }

  function getPublicIdNumber(user) {
    if (!user) return '';

    const candidates = [user.idNumber, user.studentNumber, user.id];
    for (const candidate of candidates) {
      const value = normalizeId(candidate);
      if (value && !isUuid(value)) {
        return value;
      }
    }

    return normalizeId(user.idNumber || user.studentNumber || '');
  }

  function getProfileId(user) {
    if (!user) return '';

    if (isUuid(user.profileId)) {
      return normalizeId(user.profileId);
    }

    if (isUuid(user.id)) {
      return normalizeId(user.id);
    }

    return normalizeId(user.profileId || '');
  }

  async function repairUserIdentity(user) {
    if (!user) return user;

    const publicId = getPublicIdNumber(user);
    if (publicId) {
      const repaired = {
        ...user,
        idNumber: publicId,
        profileId: getProfileId(user) || user.profileId || ''
      };

      if (repaired.idNumber !== user.idNumber) {
        saveUser(repaired);
        setCurrentUser(repaired);
      }

      return repaired;
    }

    const profileId = getProfileId(user);
    if (!profileId || !window.MEDIPOINT_SUPABASE_URL || !window.MEDIPOINT_SUPABASE_ANON_KEY) {
      return user;
    }

    try {
      const response = await fetch(`${window.MEDIPOINT_SUPABASE_URL}/functions/v1/data-retrieval`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${window.MEDIPOINT_SUPABASE_ANON_KEY}`,
          apikey: window.MEDIPOINT_SUPABASE_ANON_KEY
        },
        body: JSON.stringify({
          action: 'profile',
          profileId
        })
      });

      const data = await response.json().catch(() => ({}));
      if (response.ok && data.user && data.user.idNumber && !isUuid(data.user.idNumber)) {
        const repaired = {
          ...user,
          ...data.user,
          id: data.user.id,
          profileId: data.user.id,
          idNumber: data.user.idNumber
        };
        saveUser(repaired);
        setCurrentUser(repaired);
        return repaired;
      }
    } catch (error) {
      console.warn('Unable to repair stored user identity.', error);
    }

    return user;
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

  function getKioskQrPayload(user) {
    const explicit = normalizeId(user && (user.kioskQrPayload || user.qrPayload || user.qrCode || user.qrText || user.qr));
    if (explicit) {
      return explicit;
    }

    const id = getPublicIdNumber(user);
    if (id) {
      return `medipoint:v1:${id}`;
    }

    return '';
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
      kioskQrPayload: getKioskQrPayload(profile) || undefined,
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

    if (account) {
      const user = getPortalProfile(account.userId);
      if (user && String(user.name || '').trim().toLowerCase() === normalizedName) {
        return user;
      }
    }

    const kioskUser = getUser(normalizedId);
    if (kioskUser && String(kioskUser.name || '').trim().toLowerCase() === normalizedName) {
      const role = String(kioskUser.role || '').toLowerCase();
      if (role === 'doctor' && !kioskUser.managedAccount) {
        return null;
      }
      return {
        ...kioskUser,
        accountType: kioskUser.accountType || 'kiosk'
      };
    }

    return null;
  }

  function saveUser(user, previousId) {
    const idNumber = getPublicIdNumber(user);
    if (!idNumber) throw new Error('A user ID is required.');

    const profileId = getProfileId(user);
    const storedUser = {
      ...user,
      idNumber,
      profileId: profileId || user.profileId || '',
      id: profileId || user.id || idNumber,
      kioskQrPayload: getKioskQrPayload(user) || undefined
    };

    const isPortalProfile = user && user.accountType === 'portal';
    const destinationKey = isPortalProfile ? portalProfileKey(idNumber) : userKey(idNumber);
    localStorage.setItem(destinationKey, JSON.stringify(storedUser));

    const oldId = normalizeId(previousId);
    if(oldId && oldId !== idNumber) {
      const oldMeasurements = getMeasurements(oldId);
      const newMeasurements = getMeasurements(idNumber);
      const oldLatest = readJSON(localStorage, latestAssessmentKey(oldId), null);
      const merged = [...oldMeasurements, ...newMeasurements]
        .filter((record, index, records) => records.findIndex(item => item.date === record.date) === index)
        .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

      if(merged.length) localStorage.setItem(measurementsKey(idNumber), JSON.stringify(merged));
      if(oldLatest) {
        localStorage.setItem(latestAssessmentKey(idNumber), JSON.stringify({
          ...oldLatest,
          userId: idNumber,
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

  function doctorFollowUpKey(patientId) {
    return `doctorFollowUp_${normalizeId(patientId)}`;
  }

  function getDoctorFollowUp(patientId) {
    if (!normalizeId(patientId)) return null;
    return readJSON(localStorage, doctorFollowUpKey(patientId), null);
  }

  function saveDoctorFollowUp(patientId, followUp) {
    if (!normalizeId(patientId)) throw new Error('A patient ID is required.');

    const previous = getDoctorFollowUp(patientId);
    const updatedAt = new Date().toISOString();
    const record = {
      status: normalizeId(followUp && followUp.status) || 'New',
      assignedTo: String(followUp && followUp.assignedTo || '').trim(),
      dueDate: normalizeId(followUp && followUp.dueDate),
      note: String(followUp && followUp.note || '').trim(),
      updatedAt,
      updatedBy: String(followUp && followUp.updatedBy || '').trim(),
      history: [
        ...(Array.isArray(previous && previous.history) ? previous.history : []),
        {
          status: normalizeId(followUp && followUp.status) || 'New',
          assignedTo: String(followUp && followUp.assignedTo || '').trim(),
          dueDate: normalizeId(followUp && followUp.dueDate),
          note: String(followUp && followUp.note || '').trim(),
          updatedAt,
          updatedBy: String(followUp && followUp.updatedBy || '').trim()
        }
      ]
    };

    localStorage.setItem(doctorFollowUpKey(patientId), JSON.stringify(record));
    return record;
  }

  function getClinicRequests() {
    const requests = readJSON(localStorage, CLINIC_REQUESTS_KEY, []);
    return Array.isArray(requests) ? requests : [];
  }

  function getClinicRequestsForUser(patientId) {
    const id = normalizeId(patientId);
    return id ? getClinicRequests().filter(request => request.patientId === id) : [];
  }

  function createClinicRequest(request) {
    const patientId = normalizeId(request && request.patientId);
    if (!patientId) throw new Error('Sign in before requesting clinic follow-up.');

    const now = new Date().toISOString();
    const record = {
      requestId: globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function'
        ? globalThis.crypto.randomUUID()
        : `request-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      patientId,
      patientName: String(request.patientName || '').trim(),
      type: request.type === 'Appointment' ? 'Appointment' : 'Follow-up',
      preferredDate: normalizeId(request.preferredDate),
      message: String(request.message || '').trim(),
      status: 'Submitted',
      requestedAt: now,
      updatedAt: now,
      staffNote: '',
      scheduledAt: '',
      history: [{ status: 'Submitted', at: now, note: 'Request submitted by user.' }]
    };

    localStorage.setItem(CLINIC_REQUESTS_KEY, JSON.stringify([...getClinicRequests(), record]));
    return record;
  }

  function updateClinicRequest(requestId, update) {
    const allowedStatuses = ['Contacted', 'Scheduled', 'Resolved'];
    const status = normalizeId(update && update.status);
    if (!allowedStatuses.includes(status)) throw new Error('Choose a valid request status.');

    const requests = getClinicRequests();
    const index = requests.findIndex(request => request.requestId === requestId);
    if (index < 0) throw new Error('Clinic request was not found.');

    const previous = requests[index];
    const now = new Date().toISOString();
    const staffNote = String(update && update.staffNote || '').trim();
    const scheduledAt = status === 'Scheduled'
      ? normalizeId(update && update.scheduledAt)
      : previous.scheduledAt || '';
    const next = {
      ...previous,
      status,
      staffNote,
      scheduledAt,
      updatedAt: now,
      updatedBy: String(update && update.updatedBy || '').trim(),
      history: [
        ...(Array.isArray(previous.history) ? previous.history : []),
        { status, at: now, note: staffNote, scheduledAt, updatedBy: String(update && update.updatedBy || '').trim() }
      ]
    };

    requests[index] = next;
    localStorage.setItem(CLINIC_REQUESTS_KEY, JSON.stringify(requests));
    return next;
  }

  function buildHealthTimeline(assessments, followUp, includeStaffNotes = false, clinicRequests = []) {
    const records = Array.isArray(assessments) ? assessments : [];
    const orderedRecords = [...records].sort((first, second) =>
      new Date(first.date || 0).getTime() - new Date(second.date || 0).getTime()
    );
    const previousReadings = new Map();
    const events = orderedRecords.map(record => {
      const date = record.date || '';
      const readings = (Array.isArray(record.results) ? record.results : [])
        .filter(result => result && result.type !== 'caremate' && result.title !== '__caremate__')
        .map(result => {
          const title = String(result.title || 'Measurement');
          const key = title.trim().toLowerCase();
          const previous = previousReadings.get(key) || null;
          const reading = {
            title,
            value: String(result.value ?? ''),
            unit: String(result.unit || ''),
            status: String(result.status || 'Recorded'),
            note: String(result.note || ''),
            previous
          };
          previousReadings.set(key, { value: reading.value, unit: reading.unit, date });
          return reading;
        });
      const noteText = readings.map(reading => reading.note.toLowerCase()).join(' ');
      const simulated = Boolean(record.isSimulated || /simulat|demo value/.test(noteText));

      return {
        type: 'assessment',
        date,
        source: '',
        context: String(record.context || record.program || ''),
        readings,
        simulated: false
      };
    });

    const followUpEvents = Array.isArray(followUp && followUp.history) ? followUp.history : [];
    const updates = followUpEvents.length ? followUpEvents : (followUp && followUp.updatedAt ? [followUp] : []);
    updates.forEach(update => {
      events.push({
        type: 'follow-up',
        date: update.updatedAt || '',
        status: String(update.status || 'New'),
        assignedTo: String(update.assignedTo || ''),
        dueDate: String(update.dueDate || ''),
        note: includeStaffNotes ? String(update.note || '') : ''
      });
    });

    (Array.isArray(clinicRequests) ? clinicRequests : []).forEach(request => {
      const requestHistory = Array.isArray(request.history) && request.history.length
        ? request.history
        : [{ status: request.status, at: request.updatedAt || request.requestedAt }];
      requestHistory.forEach(update => {
        events.push({
          type: 'clinic-request',
          date: update.at || request.requestedAt || '',
          requestType: String(request.type || 'Follow-up'),
          status: String(update.status || request.status || 'Submitted'),
          scheduledAt: String(update.scheduledAt || (
            ['Scheduled', 'Resolved'].includes(update.status) ? request.scheduledAt : ''
          ) || ''),
          note: includeStaffNotes ? String(update.note || request.message || '') : ''
        });
      });
    });

    return events.sort((first, second) =>
      new Date(second.date || 0).getTime() - new Date(first.date || 0).getTime()
    );
  }

  function saveAssessment(user, assessment) {
    const id = getPublicIdNumber(user);
    if(!id) throw new Error('Sign in before saving an assessment.');

    const rawResults = Array.isArray(assessment.results) ? assessment.results : [];
    const caremate = assessment.caremate || null;
    const results = window.MediPointCareMate
      ? window.MediPointCareMate.stripCareMateResults(rawResults)
      : rawResults;

    const record = {
      userId: id,
      user: user.name || 'Unknown User',
      program: user.program || user.departmentOffice || 'Not specified',
      date: assessment.date || new Date().toISOString(),
      results,
      caremate
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
    const id = getPublicIdNumber(user);
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

  function showPortalDetailDialog(title, content) {
    let dialog = document.getElementById('portalDetailDialog');
    if(!dialog){
      dialog = document.createElement('dialog');
      dialog.id = 'portalDetailDialog';
      dialog.className = 'portal-detail-dialog';
      dialog.setAttribute('aria-labelledby', 'portalDetailDialogTitle');
      dialog.innerHTML = `
        <div class="portal-dialog-shell">
          <header class="portal-dialog-header">
            <h2 id="portalDetailDialogTitle"></h2>
            <button type="button" class="portal-dialog-close">Close</button>
          </header>
          <div class="portal-dialog-content"></div>
        </div>
      `;
      document.body.append(dialog);
      dialog.querySelector('.portal-dialog-close').addEventListener('click', () => dialog.close());
      dialog.addEventListener('click', event => {
        if(event.target === dialog) dialog.close();
      });
    }

    dialog.querySelector('#portalDetailDialogTitle').textContent = title;
    dialog.querySelector('.portal-dialog-content').innerHTML = content;
    if(!dialog.open) dialog.showModal();
    return dialog;
  }

  function routeFor(user, base) {
    const prefix = base || '';
    const role = String(user && user.role || '').toLowerCase();
    return role === 'doctor'
      ? `${prefix}system/doctor-portal.html`
      : `${prefix}kiosk/kiosk.html`;
  }

  async function fetchAssessmentsFromDatabase(user) {
    if (!window.MEDIPOINT_SUPABASE_URL || !window.MEDIPOINT_SUPABASE_ANON_KEY) {
      return null;
    }

    const idNumber = getPublicIdNumber(user);
    const profileId = getProfileId(user);
    if (!idNumber && !profileId) {
      return [];
    }

    try {
      const response = await fetch(`${window.MEDIPOINT_SUPABASE_URL}/functions/v1/data-retrieval`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${window.MEDIPOINT_SUPABASE_ANON_KEY}`,
          apikey: window.MEDIPOINT_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          action: 'profile',
          idNumber,
          profileId,
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (response.ok && data && Array.isArray(data.assessments)) {
        return data.assessments;
      }

      console.warn(
        'Unable to load assessments from Supabase.',
        data.error || `HTTP ${response.status}`,
      );
    } catch (error) {
      console.warn('Unable to load assessments from Supabase.', error);
    }

    return [];
  }

  function setupPortalMobileNavigation() {
    const sidePanel = document.querySelector('.side-panel');
    const sideNav = sidePanel?.querySelector('.side-nav');
    const shell = document.querySelector('.portal-shell');

    if(!sidePanel || !sideNav || !shell || shell.querySelector('.mobile-menu-toggle')) {
      return;
    }

    if(!sideNav.id) {
      sideNav.id = 'portalNavigationLinks';
    }

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'mobile-menu-toggle';
    toggle.setAttribute('aria-controls', sideNav.id);
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Open navigation menu');
    toggle.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16"/></svg>';

    const backdrop = document.createElement('button');
    backdrop.type = 'button';
    backdrop.className = 'mobile-nav-backdrop';
    backdrop.setAttribute('aria-label', 'Close navigation menu');

    function setExpanded(expanded) {
      sidePanel.classList.toggle('mobile-nav-expanded', expanded);
      backdrop.classList.toggle('visible', expanded);
      toggle.setAttribute('aria-expanded', String(expanded));
      toggle.setAttribute('aria-label', expanded ? 'Close navigation menu' : 'Open navigation menu');
      document.body.classList.toggle('mobile-nav-open', expanded);
    }

    toggle.addEventListener('click', () => {
      setExpanded(toggle.getAttribute('aria-expanded') !== 'true');
    });

    backdrop.addEventListener('click', () => setExpanded(false));
    sideNav.addEventListener('click', event => {
      if(event.target.closest('a')) {
        setExpanded(false);
      }
    });

    document.addEventListener('keydown', event => {
      if(event.key === 'Escape') {
        setExpanded(false);
      }
    });

    sidePanel.classList.add('mobile-nav-enabled');
    shell.insertBefore(toggle, shell.firstChild);
    shell.appendChild(backdrop);
  }

  setupPortalMobileNavigation();

  window.MediPoint = {
    parseJSON,
    readJSON,
    normalizeId,
    isUuid,
    getPublicIdNumber,
    getProfileId,
    repairUserIdentity,
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
    getDoctorFollowUp,
    saveDoctorFollowUp,
    getClinicRequests,
    getClinicRequestsForUser,
    createClinicRequest,
    updateClinicRequest,
    buildHealthTimeline,
    fetchAssessmentsFromDatabase,
    saveAssessment,
    getLatestAssessment,
    escapeHTML,
    showPortalDetailDialog,
    getKioskQrPayload,
    routeFor
  };
})();
