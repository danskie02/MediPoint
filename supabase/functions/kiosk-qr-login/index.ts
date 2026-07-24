/**
 * MediPoint kiosk QR login (Supabase Edge Function)
 *
 * Called from the vanilla JS kiosk login page after a USB scanner
 * fills the hidden input and sends Enter. Compatible with payloads:
 *   - medipoint:v2:{token}  (recommended)
 *   - medipoint:v1:{idNumber} (legacy prototype format)
 */

import { corsHeaders, jsonResponse } from '../_shared/cors.js';
import { createAdminClient } from '../_shared/supabase-admin.js';

const LEGACY_PREFIX = 'medipoint:v1:';
const TOKEN_PREFIX = 'medipoint:v2:';
const KIOSK_ROLES = new Set(['student', 'personnel']);

function normalizePayload(rawValue: unknown) {
  return String(rawValue || '')
    .replace(/\r/g, '')
    .trim();
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

async function resolveProfile(supabase: ReturnType<typeof createAdminClient>, qrPayload: unknown) {
  const payload = normalizePayload(qrPayload);

  if (!payload) {
    return { error: 'Empty QR payload.', status: 400 };
  }

  const { data: rpcRows, error: rpcError } = await supabase.rpc('resolve_qr_login', {
    qr_payload: payload,
  });

  if (!rpcError && Array.isArray(rpcRows) && rpcRows.length > 0) {
    const match = rpcRows[0] as { profile_id: string };
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', match.profile_id)
      .maybeSingle();

    if (profileError || !profile) {
      return { error: 'Account not found.', status: 404 };
    }

    return {
      profile,
      tokenValue: payload.startsWith(TOKEN_PREFIX) ? payload.slice(TOKEN_PREFIX.length) : null,
    };
  }

  if (payload.startsWith(TOKEN_PREFIX)) {
    const token = payload.slice(TOKEN_PREFIX.length).trim();
    if (!token) {
      return { error: 'Invalid MediPoint QR code data.', status: 400 };
    }

    const { data: tokenRow, error: tokenError } = await supabase
      .from('qr_tokens')
      .select('id, profile_id, is_active')
      .eq('token', token)
      .maybeSingle();

    if (tokenError || !tokenRow || !tokenRow.is_active) {
      return { error: 'Invalid or inactive QR code.', status: 401 };
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', tokenRow.profile_id)
      .maybeSingle();

    if (profileError || !profile) {
      return { error: 'Account not found.', status: 404 };
    }

    return { profile, tokenValue: token };
  }

  if (payload.startsWith(LEGACY_PREFIX)) {
    const idNumber = payload.slice(LEGACY_PREFIX.length).trim();
    if (!idNumber) {
      return { error: 'Invalid MediPoint QR code data.', status: 400 };
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id_number', idNumber)
      .maybeSingle();

    if (profileError || !profile) {
      return { error: 'Account not found. Please create an account first.', status: 404 };
    }

    return { profile, tokenValue: null };
  }

  try {
    const legacy = JSON.parse(payload) as { idNumber?: string };
    const idNumber = String(legacy?.idNumber || '').trim();
    if (!idNumber) {
      return { error: 'Invalid MediPoint QR code data.', status: 400 };
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id_number', idNumber)
      .maybeSingle();

    if (profileError || !profile) {
      return { error: 'Account not found. Please create an account first.', status: 404 };
    }

    return { profile, tokenValue: null };
  } catch (_error) {
    return { error: 'Invalid MediPoint QR code data.', status: 400 };
  }
}

async function recordSuccessfulScan(
  supabase: ReturnType<typeof createAdminClient>,
  {
    profile,
    tokenValue,
    kioskId,
  }: {
    profile: Record<string, unknown>;
    tokenValue: string | null;
    kioskId: string | null;
  },
) {
  if (tokenValue) {
    await supabase
      .from('qr_tokens')
      .update({
        last_used_at: new Date().toISOString(),
        last_used_kiosk_id: kioskId || null,
      })
      .eq('token', tokenValue)
      .eq('is_active', true);
  }

  await supabase.from('audit_logs').insert({
    action: 'kiosk_qr_login',
    target_profile_id: profile.id,
    kiosk_id: kioskId || null,
    metadata: {
      id_number: profile.id_number,
      role: profile.role,
      qr_version: tokenValue ? 'v2' : 'v1',
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

  const qrPayload = body.qrPayload ?? body.qrData ?? body.qr ?? '';
  const requestedRole = String(body.requestedRole || '').trim().toLowerCase();
  const kioskId = (body.kioskId as string) || request.headers.get('x-kiosk-id') || null;

  if (!qrPayload) {
    return jsonResponse({ error: 'qrPayload is required.' }, 400);
  }

  let supabase;
  try {
    supabase = createAdminClient();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Server configuration error.';
    return jsonResponse({ error: message }, 500);
  }

  const resolved = await resolveProfile(supabase, qrPayload);
  if ('error' in resolved && resolved.error) {
    return jsonResponse({ error: resolved.error }, resolved.status);
  }

  const { profile, tokenValue } = resolved as {
    profile: Record<string, unknown>;
    tokenValue: string | null;
  };

  if (!KIOSK_ROLES.has(String(profile.role))) {
    return jsonResponse({ error: 'QR code does not match a kiosk account.' }, 403);
  }

  if (requestedRole && profile.role !== requestedRole) {
    return jsonResponse({ error: 'QR code does not match the registered account.' }, 403);
  }

  try {
    await recordSuccessfulScan(supabase, { profile, tokenValue, kioskId });
  } catch (error) {
    console.error('Failed to record QR login audit trail.', error);
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
