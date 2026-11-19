/**
 * MediPoint kiosk ID login (Supabase Edge Function)
 *
 * Accepts full name + password from the kiosk login form.
 * Accounts that still use the ID number sign in with that temporary password
 * and must replace it before continuing.
 */

import { corsHeaders, jsonResponse } from '../_shared/cors.js';
import { createAdminClient } from '../_shared/supabase-admin.js';
import { mapProfileRowToUser, normalizeText } from '../_shared/profile-mapper.js';
import { findProfilesByName, matchProfileByPassword, mustChangePassword } from '../_shared/password.js';

const KIOSK_ROLES = new Set(['student', 'personnel']);

function mapProfileToSessionUser(profile: Record<string, unknown>) {
  return mapProfileRowToUser(profile, 'kiosk');
}

async function resolveProfile(
  supabase: ReturnType<typeof createAdminClient>,
  fullName: string,
  password: string,
  requestedRole: string,
) {
  if (!fullName || !password) {
    return { error: 'Please enter your full name and password.', status: 400 };
  }

  const lookedUp = await findProfilesByName(supabase, fullName);
  if ('error' in lookedUp && lookedUp.error) {
    return { error: lookedUp.error, status: lookedUp.status };
  }

  const normalizedRequestedRole = requestedRole.toLowerCase();
  const candidates = (lookedUp.profiles || []).filter((profile) => {
    const role = String(profile.role || '').toLowerCase();
    if (normalizedRequestedRole && role !== normalizedRequestedRole) return false;
    return KIOSK_ROLES.has(role);
  });

  if (!candidates.length) {
    return { error: 'Full name or password is incorrect.', status: 401 };
  }

  const matches = await matchProfileByPassword(candidates, password);
  if (matches.length !== 1) {
    return { error: 'Full name or password is incorrect.', status: 401 };
  }

  const profile = matches[0];
  return { profile, mustChangePassword: mustChangePassword(profile) };
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
  const password = normalizeText(body.password ?? body.idNumber ?? body.studentNumber ?? '');
  const requestedRole = normalizeText(body.requestedRole ?? '').toLowerCase();
  const kioskId = (body.kioskId as string) || request.headers.get('x-kiosk-id') || null;

  if (!fullName || !password) {
    return jsonResponse({ error: 'fullName and password are required.' }, 400);
  }

  let supabase;
  try {
    supabase = createAdminClient();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Server configuration error.';
    return jsonResponse({ error: message }, 500);
  }

  const resolved = await resolveProfile(supabase, fullName, password, requestedRole);
  if ('error' in resolved && resolved.error) {
    return jsonResponse({ error: resolved.error }, resolved.status);
  }

  const { profile, mustChangePassword: changeRequired } = resolved as {
    profile: Record<string, unknown>;
    mustChangePassword: boolean;
  };

  try {
    await recordSuccessfulLogin(supabase, { profile, kioskId });
  } catch (error) {
    console.error('Failed to record kiosk ID login audit trail.', error);
  }

  const user = {
    ...mapProfileToSessionUser(profile),
    mustChangePassword: changeRequired,
  };

  return jsonResponse({
    ok: true,
    mustChangePassword: changeRequired,
    user,
    session: {
      type: 'kiosk',
      profileId: profile.id,
      issuedAt: new Date().toISOString(),
    },
  });
});
