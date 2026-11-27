import { useState } from 'react';
import { supabase } from '../../../lib/supabase.js';
import { uuidv7 } from '../../../lib/uuidv7.js';
import { transcribeLocalVoiceAsset } from '../domain/local-voice-transcription.js';

export function LocalVoiceTranscriptionPanel({
  asset,
  profile,
  busy = false,
  runAction,
}) {
  const [transcribing, setTranscribing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState('');

  const retentionTime = Date.parse(asset?.retention_until || '');
  const retained = Number.isFinite(retentionTime) && retentionTime > Date.now();
  const canTranscribe = asset?.status === 'uploaded' && asset?.capture_id == null
    && retained && globalThis.navigator?.onLine !== false && Boolean(profile?.id);

  const handleTranscribe = async () => {
    if (!canTranscribe || busy || transcribing) return;
    setTranscribing(true);
    setError('');
    setTranscript('');
    setStatus('Preparando el audio privado seleccionado…');
    try {
      const result = await transcribeLocalVoiceAsset({
        supabase,
        asset,
        ownerUserId: profile.id,
        onStatus: setStatus,
      });
      if (!result.text.trim()) {
        setStatus('Whisper terminó en este dispositivo, pero no detectó voz reconocible. El audio original sigue intacto.');
        return;
      }
      if (result.text.length > 20000) {
        throw new Error('El texto reconocido supera el límite de 20 000 caracteres. No se guardó ninguna captura.');
      }
      setTranscript(result.text);
      setStatus('Transcripción local completada · ' + result.durationSeconds.toFixed(1)
        + ' s · revisa y corrige el texto antes de guardarlo.');
    } catch (failure) {
      setError(failure?.message || 'No se pudo transcribir este audio en el dispositivo.');
      setStatus('No se guardó ninguna captura. El audio original permanece intacto.');
    } finally {
      setTranscribing(false);
    }
  };

  const handleSave = async () => {
    const text = transcript.trim();
    if (!text || text.length > 20000 || saving || busy) return;
    setSaving(true);
    setError('');
    const operation = async () => {
      const proposedCaptureId = uuidv7();
      const proposedPartId = uuidv7();
      const { data, error: rpcError } = await supabase.rpc('record_inbox_voice_transcription_local', {
        p_asset_id: asset.id,
        p_capture_id: proposedCaptureId,
        p_part_id: proposedPartId,
        p_transcript_text: text,
      });
      if (rpcError) throw rpcError;
      const receipt = Array.isArray(data) ? data[0] : data;
      if (!receipt?.capture_id || !receipt?.part_id
        || (receipt.replayed !== true && receipt.capture_id !== proposedCaptureId)) {
        throw new Error('El servidor no confirmó la captura de voz vinculada al original.');
      }
      setStatus('Transcripción guardada como captura de Inbox. El original se conserva.');
    };

    try {
      if (runAction) {
        await runAction(operation, 'Transcripción guardada como captura de Inbox.', {
          onError: (failure) => setError(failure?.message || 'No se pudo guardar la transcripción.'),
        });
      } else {
        await operation();
      }
    } catch (failure) {
      setError(failure?.message || 'No se pudo guardar la transcripción.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      className="inbox-local-stt-panel"
      aria-label="Transcripción local del audio"
      data-testid="inbox-local-stt-panel"
    >
      <div className="inbox-local-stt-copy">
        <strong>Transcribir esta grabación en este dispositivo</strong>
        <p>
          Solo se descarga este original privado al pulsar el botón. Se verifica su integridad
          y Whisper lo procesa localmente en español. No se envía a un proveedor ni se modifica el original.
        </p>
      </div>
      {!transcript && (
        <button
          type="button"
          className="capture-action-button inbox-local-stt-primary"
          onClick={handleTranscribe}
          disabled={!canTranscribe || busy || transcribing}
        >
          {transcribing ? 'Transcribiendo localmente…' : 'Transcribir localmente'}
        </button>
      )}
      {globalThis.navigator?.onLine === false && (
        <small className="inbox-local-stt-status">Conéctate para descargar de forma privada el audio seleccionado; la inferencia se ejecuta aquí.</small>
      )}
      {asset?.status === 'uploaded' && !retained && (
        <small className="inbox-local-stt-status">La ventana de retención de este audio venció. No se intentará descargarlo.</small>
      )}
      {status && <p className="inbox-local-stt-status" role="status">{status}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {transcript && (
        <div className="inbox-local-stt-result">
          <label htmlFor={'local-voice-transcript-' + asset.id}>Texto reconocido · puedes corregirlo</label>
          <textarea
            id={'local-voice-transcript-' + asset.id}
            aria-label="Texto reconocido"
            rows={4}
            maxLength={20000}
            value={transcript}
            onChange={(event) => setTranscript(event.target.value)}
            disabled={busy || saving}
          />
          <div className="inbox-local-stt-controls">
            <button
              type="button"
              className="capture-action-button inbox-local-stt-primary"
              onClick={handleSave}
              disabled={!transcript.trim() || busy || saving || transcribing}
            >
              {saving ? 'Guardando captura…' : 'Guardar transcripción como captura'}
            </button>
            <button
              type="button"
              className="capture-action-button"
              onClick={() => { setTranscript(''); setStatus('Puedes volver a transcribir el mismo original.'); setError(''); }}
              disabled={busy || saving || transcribing}
            >
              Descartar texto y repetir
            </button>
          </div>
        </div>
      )}
      <small>El audio original no se reemplaza ni se elimina. El modelo Whisper se prepara solo al solicitar la transcripción.</small>
    </section>
  );
}
