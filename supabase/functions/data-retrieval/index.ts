/**
 * MediPoint data retrieval (Supabase Edge Function)
 *
 * Returns profile and assessment data for kiosk/portal/doctor views.
 */

import { corsHeaders, jsonResponse } from '../_shared/cors.js';
import { createAdminClient } from '../_shared/supabase-admin.js';

function normalizeText(value: unknown) {
  return String(value || '').trim();
}

function normalizeRole(value: unknown) {
  const role = normalizeText(value).toLowerCase();
  return role === 'doctor' ? 'doctor' : role === 'personnel' ? 'personnel' : 'student';
}

function mapProfileToUser(profile: Record<string, unknown>) {
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
    accountType: 'supabase',
  };
}

function mapAssessment(record: Record<string, unknown>) {
  return {
    date: record.created_at || record.date || new Date().toISOString(),
    results: Array.isArray(record.results) ? record.results : [],
    userId: record.profile_id || record.user_id || record.userId,
    user: record.user_name || record.user || '',
    program: record.program || record.department || '',
  };
}

async function fetchProfile(
  supabase: ReturnType<typeof createAdminClient>,
  profileId: string,
) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', profileId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return data as Record<string, unknown>;
}

async function fetchAssessments(
  supabase: ReturnType<typeof createAdminClient>,
  profileId: string,
) {
  const { data, error } = await supabase
    .from('assessment_results')
    .select('*')
    .eq('profile_id', profileId)
    .order('created_at', { ascending: false });

  if (error || !data) {
    return [];
  }

  return (data as Record<string, unknown>[]).map(mapAssessment);
}

async function fetchProfilesForDoctor(
  supabase: ReturnType<typeof createAdminClient>,
  role: string,
) {
  const normalizedRole = normalizeRole(role);
  let query = supabase.from('profiles').select('*').order('created_at', { ascending: false });

  if (normalizedRole === 'student' || normalizedRole === 'personnel') {
    query = query.in('role', [normalizedRole, 'student', 'personnel']);
  }

  const { data, error } = await query;
  if (error || !data) {
    return [];
  }

  return (data as Record<string, unknown>[]).map(mapProfileToUser);
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

  const action = normalizeText(body.action ?? '').toLowerCase();
  const profileId = normalizeText(body.profileId ?? '');
  const requestedRole = normalizeText(body.role ?? '');
  const idNumber = normalizeText(body.idNumber ?? body.studentNumber ?? '');

  let supabase;
  try {
    supabase = createAdminClient();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Server configuration error.';
    return jsonResponse({ error: message }, 500);
  }

  if (action === 'doctor-list') {
    const profiles = await fetchProfilesForDoctor(supabase, requestedRole);
    return jsonResponse({ ok: true, profiles });
  }

  let profile = null;
  if (profileId) {
    profile = await fetchProfile(supabase, profileId);
  } else if (idNumber) {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id_number', idNumber)
      .maybeSingle();

    if (!error && data) {
      profile = data as Record<string, unknown>;
    }
  }

  if (!profile) {
    return jsonResponse({ error: 'Profile not found.' }, 404);
  }

  if (!profile) {
    return jsonResponse({ error: 'Profile not found.' }, 404);
  }

  const assessments = await fetchAssessments(supabase, profile.id as string);

  return jsonResponse({
    ok: true,
    user: mapProfileToUser(profile),
    assessments,
  });
});
