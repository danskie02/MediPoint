/**
 * MediPoint assessment storage (Supabase Edge Function)
 *
 * Persists kiosk measurements into assessments + assessment_results.
 */

import { corsHeaders, jsonResponse } from '../_shared/cors.js';
import { createAdminClient } from '../_shared/supabase-admin.js';
import {
  buildAssessmentInsertPayload,
  buildAssessmentResultRows,
  buildCareMateResultRow,
  extractCareMatePayload,
  stripCareMatePayloads,
} from '../_shared/assessment-db.js';
import { buildCareMateResult, requestCareMatePrediction } from '../_shared/caremate.js';

function normalizeText(value) {
  return String(value || '').trim();
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, 405);
  }

  let body;
  try {
    body = await request.json();
  } catch (_error) {
    return jsonResponse({ error: 'Request body must be valid JSON.' }, 400);
  }

  const profileId = normalizeText(body.profileId ?? '');
  const idNumber = normalizeText(body.idNumber ?? body.studentNumber ?? '');
  const program = normalizeText(body.program ?? body.departmentOffice ?? '');
  const kioskId = normalizeText(body.kioskId ?? request.headers.get('x-kiosk-id') ?? '');
  const rawResults = Array.isArray(body.results) ? body.results : [];
  const vitals = stripCareMatePayloads(rawResults);
  let caremate = extractCareMatePayload(rawResults);

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

  if (!caremate) {
    const { data: profileData } = await supabase
      .from('profiles')
      .select('birthday, gender')
      .eq('id', resolvedProfileId)
      .maybeSingle();

    const prediction = await requestCareMatePrediction({
      results: vitals,
      birthday: profileData?.birthday || '',
      gender: profileData?.gender || '',
    });

    const caremateResult = buildCareMateResult(prediction);
    if (caremateResult) {
      caremate = {
        recommendation: caremateResult.recommendation,
        probabilities: caremateResult.probabilities || {},
        features: caremateResult.features || null,
        generatedAt: caremateResult.generatedAt || new Date().toISOString(),
      };
    }
  }

  const assessedAt = new Date().toISOString();
  const { data: assessment, error: assessmentError } = await supabase
    .from('assessments')
    .insert(buildAssessmentInsertPayload({
      profileId: resolvedProfileId,
      kioskId,
      program,
      results: vitals,
      assessedAt,
    }))
    .select('*')
    .single();

  if (assessmentError || !assessment) {
    return jsonResponse({
      error: assessmentError?.message || 'Unable to create assessment record.',
    }, 500);
  }

  const resultRows = buildAssessmentResultRows(assessment.id, vitals);
  const caremateRow = buildCareMateResultRow(assessment.id, caremate, resultRows.length);
  if (caremateRow) {
    resultRows.push(caremateRow);
  }

  if (resultRows.length) {
    const { error: resultsError } = await supabase
      .from('assessment_results')
      .insert(resultRows);

    if (resultsError) {
      await supabase.from('assessments').delete().eq('id', assessment.id);
      return jsonResponse({
        error: resultsError.message || 'Unable to store assessment results.',
      }, 500);
    }
  }

  return jsonResponse({
    ok: true,
    assessment: {
      id: assessment.id,
      profile_id: assessment.profile_id,
      assessed_at: assessment.assessed_at,
      is_simulated: assessment.is_simulated,
      result_count: resultRows.length,
      caremate,
    },
  });
});
