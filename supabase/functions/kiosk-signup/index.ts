/**
 * MediPoint kiosk sign-up (Supabase Edge Function)
 *
 * Creates a new kiosk profile in Supabase and issues a v2 QR token.
 */

import { corsHeaders, jsonResponse } from '../_shared/cors.js';
import { createAdminClient } from '../_shared/supabase-admin.js';
import { mapProfileRowToUser, normalizeRole, normalizeText } from '../_shared/profile-mapper.js';
import { hashPassword } from '../_shared/password.js';

const KIOSK_ROLES = new Set(['student', 'personnel']);

function mapProfileToSessionUser(profile: Record<string, unknown>) {
  return mapProfileRowToUser(profile, 'kiosk');
}

async function createProfile(
  supabase: ReturnType<typeof createAdminClient>,
  payload: Record<string, unknown>,
) {
  const fullName = normalizeText(payload.fullName ?? payload.name ?? '');
  const birthday = normalizeText(payload.birthday ?? '');
  const gender = normalizeText(payload.gender ?? '');
  const email = normalizeText(payload.email ?? '');
  const userId = normalizeText(payload.userId ?? payload.idNumber ?? '');
  const programDepartment = normalizeText(payload.programDepartment ?? payload.departmentOffice ?? '');
  const role = normalizeRole(payload.role ?? payload.selectedRole ?? 'student');

  if (!fullName || !birthday || !gender || !email || !userId) {
    return { error: 'Please complete all required profile fields.', status: 400 };
  }

  if (!KIOSK_ROLES.has(role)) {
    return { error: 'Invalid role selected.', status: 400 };
  }

  const existingProfile = await supabase
    .from('profiles')
    .select('id')
    .eq('id_number', userId)
    .maybeSingle();

  if (existingProfile.error) {
    return { error: existingProfile.error.message || 'Unable to validate account ID.', status: 500 };
  }

  if (existingProfile.data) {
    return { error: 'An account with this ID already exists. Please sign in instead.', status: 409 };
  }

  const profilePayload = {
    full_name: fullName,
    email,
    id_number: userId,
    role,
    birthday,
    gender,
    program: role === 'student' ? programDepartment : null,
    department_office: role === 'personnel' ? programDepartment : null,
    profile_complete: false,
    password_hash: await hashPassword(userId),
    must_change_password: true,
    member_since: new Date().toISOString(),
  };

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .insert(profilePayload)
    .select('*')
    .single();

  if (profileError || !profile) {
    return { error: profileError?.message || 'Unable to create the account.', status: 500 };
  }

  const token = crypto.randomUUID();
  const { error: tokenError } = await supabase.from('qr_tokens').insert({
    token,
    profile_id: profile.id,
    is_active: true,
    issued_at: new Date().toISOString(),
  });

  if (tokenError) {
    return { error: tokenError.message || 'Unable to issue a QR code token.', status: 500 };
  }

  return { profile, qrPayload: `medipoint:v2:${token}` };
}

async function recordSuccessfulSignup(
  supabase: ReturnType<typeof createAdminClient>,
  profile: Record<string, unknown>,
) {
  await supabase.from('audit_logs').insert({
    action: 'kiosk_signup',
    target_profile_id: profile.id,
    kiosk_id: null,
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

  let supabase;
  try {
    supabase = createAdminClient();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Server configuration error.';
    return jsonResponse({ error: message }, 500);
  }

  const result = await createProfile(supabase, body);
  if ('error' in result && result.error) {
    return jsonResponse({ error: result.error }, result.status);
  }

  const { profile, qrPayload } = result as { profile: Record<string, unknown>; qrPayload: string };

  try {
    await recordSuccessfulSignup(supabase, profile);
  } catch (error) {
    console.error('Failed to record kiosk sign-up audit trail.', error);
  }

  return jsonResponse({
    ok: true,
    user: mapProfileToSessionUser(profile),
    qrPayload,
  });
});
