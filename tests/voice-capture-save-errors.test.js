import test from 'node:test';
import assert from 'node:assert/strict';
import { getVoiceCaptureSaveErrorMessage } from '../src/features/inbox/domain/voice-capture-save-errors.js';

test('voice save diagnostics distinguish failures before metadata from storage and verification failures', () => {
  assert.match(getVoiceCaptureSaveErrorMessage({ voiceCaptureStage: 'local_integrity' }), /no llegó a enviarse/i);
  assert.match(getVoiceCaptureSaveErrorMessage({ voiceCaptureStage: 'metadata' }), /no llegó a subirse/i);
  assert.match(getVoiceCaptureSaveErrorMessage({ voiceCaptureStage: 'storage' }), /registro temporal/i);
  assert.match(getVoiceCaptureSaveErrorMessage({ voiceCaptureStage: 'server_verification' }), /Reintentar verificación/i);
});

test('voice save diagnostics expose safe backend reference codes without raw server messages', () => {
  const message = getVoiceCaptureSaveErrorMessage({
    voiceCaptureStage: 'metadata',
    code: '42501',
    message: 'sensitive database detail',
  });
  assert.match(message, /42501/);
  assert.doesNotMatch(message, /sensitive database detail/i);
});

test('voice save diagnostics explain an unsupported Android recorder MIME type', () => {
  const message = getVoiceCaptureSaveErrorMessage({
    voiceCaptureStage: 'validation',
    message: 'El formato de audio del navegador no está permitido: audio/3gpp',
  });
  assert.match(message, /audio\/3gpp/);
  assert.match(message, /bucket privado/i);
});
