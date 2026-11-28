const STAGE_MESSAGES = {
  owner: 'No se pudo confirmar una sesión activa para asociar el audio a tu cuenta. Comprueba que SimpleLife siga conectado y vuelve a intentarlo.',
  validation: 'El audio se grabó, pero su tamaño o formato no es compatible con el almacenamiento privado.',
  local_integrity: 'El navegador no pudo preparar la comprobación de integridad del audio. El archivo no llegó a enviarse al almacenamiento.',
  metadata: 'No se pudo crear el registro privado del audio. El archivo no llegó a subirse al bucket.',
  storage: 'Se creó el registro temporal, pero la subida al almacenamiento privado no se confirmó. No repitas la grabación todavía; actualiza Inbox y comprueba si aparece en «Audios privados pendientes».',
  server_verification: 'La subida pudo completarse, pero el servidor no confirmó la integridad del archivo. No vuelvas a grabarlo; actualiza Inbox y usa «Reintentar verificación» si aparece como pendiente.',
};

export function getVoiceCaptureSaveErrorMessage(error) {
  const stage = typeof error?.voiceCaptureStage === 'string'
    ? error.voiceCaptureStage
    : 'unknown';
  if (stage === 'validation' && /formato.*no está permitido/i.test(String(error?.message || ''))) {
    return 'Android produjo un formato no admitido por el bucket privado. No se subió el audio; el formato detectado fue: '
      + String(error.message).split(':').slice(1).join(':').trim().slice(0, 48);
  }
  if (stage === 'validation' && /supera el límite/i.test(String(error?.message || ''))) {
    return String(error.message);
  }
  let message = STAGE_MESSAGES[stage]
    || 'No se pudo guardar el audio privado. El fallo ocurrió antes de confirmar el almacenamiento; no repitas la grabación hasta revisar el estado de Inbox.';
  const diagnosticCode = typeof error?.code === 'string'
    ? error.code.slice(0, 32)
    : Number.isInteger(error?.status) ? 'HTTP_' + error.status : '';
  if (diagnosticCode) message += ' Referencia técnica: ' + diagnosticCode + '.';
  return message;
}
