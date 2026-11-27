import { uuidv7 } from '../../../lib/uuidv7.js';

export const LOCAL_VOICE_TRANSCRIPT_MAX_CHARS = 20000;

export function getLocalVoiceTranscriptSaveError({
  asset,
  ownerUserId,
  transcriptText,
  now = Date.now(),
} = {}) {
  if (typeof ownerUserId !== 'string' || !ownerUserId.trim()
    || !asset || asset.owner_user_id !== ownerUserId) {
    return 'Este audio no pertenece a la cuenta activa.';
  }
  if (asset.status !== 'uploaded' || asset.capture_id != null) {
    return 'Este audio ya no está pendiente de transcripción.';
  }
  const retention = Date.parse(asset.retention_until || '');
  if (!Number.isFinite(retention) || retention <= now) {
    return 'La retención temporal de este audio venció. No se guardó ninguna captura.';
  }
  if (typeof transcriptText !== 'string' || !transcriptText.trim()) {
    return 'La transcripción está vacía. No se guardó ninguna captura.';
  }
  if (transcriptText.trim().length > LOCAL_VOICE_TRANSCRIPT_MAX_CHARS) {
    return 'El texto reconocido supera el límite de 20 000 caracteres. No se guardó ninguna captura.';
  }
  return null;
}

/**
 * Save an owner-reviewed transcript as a new Inbox capture through the
 * authenticated, owner-scoped RPC. This never downloads, replaces, or deletes
 * the original private audio object.
 */
export async function persistLocalVoiceTranscript({
  supabase,
  asset,
  ownerUserId,
  transcriptText,
  createId = uuidv7,
  now = Date.now,
} = {}) {
  const validationError = getLocalVoiceTranscriptSaveError({
    asset,
    ownerUserId,
    transcriptText,
    now: now(),
  });
  if (validationError) throw new Error(validationError);
  if (typeof supabase?.rpc !== 'function') {
    throw new TypeError('A configured Supabase RPC client is required.');
  }
  if (typeof createId !== 'function') {
    throw new TypeError('An ID generator is required.');
  }

  const text = transcriptText.trim();
  const proposedCaptureId = createId();
  const proposedPartId = createId();
  const { data, error } = await supabase.rpc('record_inbox_voice_transcription_local', {
    p_asset_id: asset.id,
    p_capture_id: proposedCaptureId,
    p_part_id: proposedPartId,
    p_transcript_text: text,
  });
  if (error) throw error;

  const receipt = Array.isArray(data) ? data[0] : data;
  const captureId = typeof receipt?.capture_id === 'string' ? receipt.capture_id : '';
  const partId = typeof receipt?.part_id === 'string' ? receipt.part_id : '';
  const replayed = receipt?.replayed === true;
  if (!captureId || !partId
    || (!replayed && captureId.toLowerCase() !== proposedCaptureId.toLowerCase())) {
    throw new Error('El servidor no confirmó la captura de voz vinculada al original.');
  }

  return Object.freeze({ captureId, partId, replayed });
}
