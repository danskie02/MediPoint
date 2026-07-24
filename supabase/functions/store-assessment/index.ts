/**
 * MediPoint assessment storage (Supabase Edge Function)
 *
 * Receives assessment results from the kiosk and stores them in the
 * assessment_results table for later retrieval by the portal and doctor views.
 */

import { corsHeaders, jsonResponse } from '../_shared/cors.js';
import { createAdminClient } from '../_shared/supabase-admin.js';

function normalizeText(value: unknown) {
  return String(value || '').trim();
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

  const profileId = normalizeText(body.profileId ?? '');
  const idNumber = normalizeText(body.idNumber ?? body.studentNumber ?? '');
  const userName = normalizeText(body.userName ?? body.user ?? '');
  const program = normalizeText(body.program ?? body.departmentOffice ?? '');
  const results = Array.isArray(body.results) ? body.results : [];

  let supabase;
  try {
    supabase = createAdminClient();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Server configuration error.';
    return jsonResponse({ error: message }, 500);
  }

  let resolvedProfileId = profileId;

  if (!resolvedProfileId && idNumber) {
    const { data, error } = await supabase
      .from('profiles')
      .select('id')
      .eq('id_number', idNumber)
      .maybeSingle();

    if (!error && data?.id) {
      resolvedProfileId = String(data.id);
    }
  }

  if (!resolvedProfileId) {
    return jsonResponse({ error: 'Profile not found.' }, 404);
  }

  const insertPayload = {
    profile_id: resolvedProfileId,
    user_name: userName,
    program,
    results,
    created_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('assessment_results')
    .insert(insertPayload)
    .select()
    .single();

  if (error) {
    return jsonResponse({ error: error.message || 'Unable to store assessment.' }, 500);
  }

  return jsonResponse({ ok: true, assessment: data });
});
