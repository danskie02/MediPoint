/**
 * MediPoint doctor data (Supabase Edge Function)
 *
 * Returns the latest profile records from the shared profiles table so the
 * doctor portal can render current data without relying on stale browser storage.
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

function mapProfileToDoctorUser(profile: Record<string, unknown>) {
  return {
    id: profile.id,
    idNumber: profile.id_number,
    name: profile.full_name,
    email: profile.email || '',
    role: normalizeRole(profile.role),
    birthday: profile.birthday || '',
    gender: profile.gender || '',
    program: profile.program || '',
    departmentOffice: profile.department_office || '',
    phone: profile.phone || '',
    emergencyContact: profile.emergency_contact_name || '',
    emergencyPhone: profile.emergency_phone || '',
    profileComplete: Boolean(profile.profile_complete),
    memberSince: profile.member_since,
    accountType: 'portal',
  };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (request.method !== 'GET' && request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, 405);
  }

  let supabase;
  try {
    supabase = createAdminClient();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Server configuration error.';
    return jsonResponse({ error: message }, 500);
  }

  const { data: profiles, error } = await supabase
    .from('profiles')
    .select('id,id_number,full_name,email,role,birthday,gender,program,department_office,phone,emergency_contact_name,emergency_phone,profile_complete,member_since')
    .order('full_name');

  if (error) {
    return jsonResponse({ error: error.message || 'Unable to load doctor data.' }, 500);
  }

  const users = (Array.isArray(profiles) ? profiles : [])
    .map((profile) => mapProfileToDoctorUser(profile as Record<string, unknown>))
    .filter((user) => user.role === 'student' || user.role === 'personnel' || user.role === 'doctor');

  return jsonResponse({ ok: true, profiles: users, count: users.length });
});
