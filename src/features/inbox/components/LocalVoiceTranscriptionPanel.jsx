import { useRef, useState } from 'react';
import { getLocalVoiceTestFileError, transcribeLocalVoiceFile } from '../domain/local-voice-transcription.js';

export function LocalVoiceTranscriptionPanel({ busy = false }) {
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [transcribing, setTranscribing] = useState(false);
  const [status, setStatus] = useState('');
  const [result, setResult] = useState('');
  const [error, setError] = useState('');

  const handleFileChange = (event) => {
    const selected = event.target.files?.[0] || null;
    setFile(selected);
    setError('');
    setResult('');
    setStatus(selected
      ? 'Audio seleccionado: ' + selected.name + ' (' + Math.ceil(selected.size / 1024) + ' KiB). Sigue únicamente en este dispositivo.'
      : '');
  };

  const handleTranscribe = async () => {
    const validationError = getLocalVoiceTestFileError(file);
    if (validationError) {
      setError(validationError);
      return;
    }
    setTranscribing(true);
    setError('');
    setResult('');
    setStatus('Preparando la transcripción local en este dispositivo…');
    try {
      const transcription = await transcribeLocalVoiceFile(file, {
        onStatus: setStatus,
      });
      setResult(transcription.text || 'No se detectó voz reconocible en el audio.');
      setStatus(
        'Prueba completada en este dispositivo · '
        + transcription.durationSeconds.toFixed(1)
        + ' s de audio. El archivo no se guardó ni se envió.',
      );
    } catch (failure) {
      setError(failure?.message || 'No se pudo completar la transcripción local.');
      setStatus('La prueba no se completó. No se hizo fallback remoto.');
    } finally {
      setTranscribing(false);
    }
  };

  return (
    <section
      className="inbox-local-stt-panel"
      aria-label="Prueba de transcripción local"
      data-testid="inbox-local-stt-panel"
    >
      <div className="inbox-local-stt-copy">
        <h3>Prueba de transcripción local</h3>
        <p>
          Comprueba Whisper.cpp con un audio sintético o público. Se procesa en este dispositivo:
          no se sube, no se guarda y no crea una captura. No uses tus grabaciones privadas.
        </p>
      </div>
      <div className="inbox-local-stt-controls">
        <input
          ref={inputRef}
          id="inbox-local-stt-audio"
          className="inbox-local-stt-input"
          type="file"
          accept="audio/*"
          aria-label="Audio sintético o público de prueba"
          onChange={handleFileChange}
          disabled={busy || transcribing}
        />
        <button
          type="button"
          className="capture-action-button"
          onClick={() => inputRef.current?.click()}
          disabled={busy || transcribing}
        >
          Elegir audio de prueba
        </button>
        <button
          type="button"
          className="capture-action-button inbox-local-stt-primary"
          onClick={handleTranscribe}
          disabled={!file || busy || transcribing}
        >
          {transcribing ? 'Transcribiendo localmente…' : 'Transcribir en este dispositivo'}
        </button>
      </div>
      {file && <p className="inbox-local-stt-selected">Archivo seleccionado: {file.name}</p>}
      {status && <p className="inbox-local-stt-status" role="status">{status}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {result && (
        <div className="inbox-local-stt-result" aria-live="polite">
          <strong>Texto reconocido</strong>
          <p>{result}</p>
        </div>
      )}
      <small>La descarga del motor y del modelo comienza solo al pulsar «Transcribir en este dispositivo». No se envía audio a Supabase ni al worker de voz.</small>
    </section>
  );
}
