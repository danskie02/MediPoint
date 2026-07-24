/**
 * MediPoint kiosk ID login (Supabase Edge Function)
 *
 * Accepts full name + ID number from the kiosk login form and resolves
 * the matching profile from Supabase.
 */

import { corsHeaders, jsonResponse } from '../_shared/cors.js';
import { createAdminClient } from '../_shared/supabase-admin.js';

const KIOSK_ROLES = new Set(['student', 'personnel']);

function normalizeText(value: unknown) {
  return String(value || '').trim();
}

function normalizeName(value: unknown) {
  return normalizeText(value).toLowerCase();
}

function mapProfileToSessionUser(profile: Record<string, unknown>) {
  return {
    id: profile.id,
    idNumber: profile.id_number,
    name: profile.full_name,
    email: profile.email || '',
    role: profile.role,
    birthday: profile.birthday || '',
    gender: profile.gender || '',
    program: profile.program || '',
    departmentOffice: profile.department_office || '',
    phone: profile.phone || '',
    emergencyContact: profile.emergency_contact_name || '',
    emergencyPhone: profile.emergency_phone || '',
    profileComplete: Boolean(profile.profile_complete),
    memberSince: profile.member_since,
    accountType: 'kiosk',
  };
}

async function resolveProfile(
  supabase: ReturnType<typeof createAdminClient>,
  fullName: string,
  idNumber: string,
  requestedRole: string,
) {
  if (!fullName || !idNumber) {
    return { error: 'Please enter your full name and ID number.', status: 400 };
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id_number', idNumber)
    .maybeSingle();

  if (profileError || !profile) {
    return { error: 'Account not found. Please create an account first.', status: 404 };
  }

  const normalizedProfileName = normalizeName(profile.full_name);
  const normalizedInputName = normalizeName(fullName);

  if (normalizedProfileName !== normalizedInputName) {
    return { error: 'Incorrect Full Name or ID Number.', status: 401 };
  }

  const normalizedRequestedRole = requestedRole.toLowerCase();
  if (normalizedRequestedRole && String(profile.role || '').toLowerCase() !== normalizedRequestedRole) {
    return { error: 'Account not found for the selected role.', status: 404 };
  }

  if (!KIOSK_ROLES.has(String(profile.role || '').toLowerCase())) {
    return { error: 'This account is not approved for kiosk access.', status: 403 };
  }

  return { profile };
}

async function recordSuccessfulLogin(
  supabase: ReturnType<typeof createAdminClient>,
  {
    profile,
    kioskId,
  }: {
    profile: Record<string, unknown>;
    kioskId: string | null;
  },
) {
  await supabase.from('audit_logs').insert({
    action: 'kiosk_id_login',
    target_profile_id: profile.id,
    kiosk_id: kioskId || null,
    metadata: {
      id_number: profile.id_number,
      role: profile.role,
      full_name: profile.full_name,
    },
  });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, 405);
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch (_error) {
    return jsonResponse({ error: 'Request body must be valid JSON.' }, 400);
  }

  const fullName = normalizeText(body.fullName ?? body.name ?? '');
  const idNumber = normalizeText(body.idNumber ?? body.studentNumber ?? '');
  const requestedRole = normalizeText(body.requestedRole ?? '').toLowerCase();
  const kioskId = (body.kioskId as string) || request.headers.get('x-kiosk-id') || null;

  if (!fullName || !idNumber) {
    return jsonResponse({ error: 'fullName and idNumber are required.' }, 400);
  }

  let supabase;
  try {
    supabase = createAdminClient();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Server configuration error.';
    return jsonResponse({ error: message }, 500);
  }

  const resolved = await resolveProfile(supabase, fullName, idNumber, requestedRole);
  if ('error' in resolved && resolved.error) {
    return jsonResponse({ error: resolved.error }, resolved.status);
  }

  const { profile } = resolved as { profile: Record<string, unknown> };

  try {
    await recordSuccessfulLogin(supabase, { profile, kioskId });
  } catch (error) {
    console.error('Failed to record kiosk ID login audit trail.', error);
  }

  const user = mapProfileToSessionUser(profile);

  return jsonResponse({
    ok: true,
    user,
    session: {
      type: 'kiosk',
      profileId: profile.id,
      issuedAt: new Date().toISOString(),
    },
  });
});
