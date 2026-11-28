import { createCaptureRecordDraft } from '../domain/capture-pipeline.js';

export class CapturePartPersistenceError extends Error {
  constructor(captureId, cause) {
    super('La captura se guardó, pero falta preparar su fragmento: ' + (cause?.message || 'error desconocido'));
    this.name = 'CapturePartPersistenceError';
    this.captureId = captureId;
    this.cause = cause;
  }
}

/**
 * Persists the source first, then its initial whole-capture part.
 *
 * Owner identity is supplied by the authenticated UI session and enforced by
 * the existing capture/capture_part RLS policies. If the second insert fails,
 * the source capture intentionally remains recoverable in Inbox.
 */
export async function persistTextCapture({ supabase, ownerUserId, contentOriginal, createId } = {}) {
  if (!supabase || typeof supabase.from !== 'function') {
    throw new TypeError('A configured Supabase client is required.');
  }
  if (typeof ownerUserId !== 'string' || !ownerUserId.trim()) {
    throw new TypeError('An authenticated owner profile is required.');
  }
  if (typeof createId !== 'function') {
    throw new TypeError('An ID generator is required.');
  }

  const captureDraft = createCaptureRecordDraft({
    inputType: 'text',
    contentOriginal,
  });
  const captureId = createId();
  const partId = createId();

  const { error: captureError } = await supabase.from('capture').insert({
    id: captureId,
    owner_user_id: ownerUserId,
    created_by_user_id: ownerUserId,
    ...captureDraft,
  });
  if (captureError) throw captureError;

  const { error: partError } = await supabase.from('capture_part').insert({
    id: partId,
    capture_id: captureId,
    part_index: 0,
    original_fragment: contentOriginal,
  });
  if (partError) throw new CapturePartPersistenceError(captureId, partError);

  return Object.freeze({ captureId, partId });
}
