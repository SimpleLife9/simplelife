import { useRef, useState } from 'react';
import { createSingleSubmissionGate } from '../domain/capture-pipeline.js';

export function CaptureComposer({ busy = false, onSubmit, onSaveOffline, onOfflineUnavailable }) {
  const [contentOriginal, setContentOriginal] = useState('');
  const submissionGate = useRef(null);

  if (!submissionGate.current) {
    submissionGate.current = createSingleSubmissionGate();
  }

  const handleSubmit = async (event) => {
    event.preventDefault();
    const source = contentOriginal;
    if (!source.trim()) return;

    const offline = globalThis.navigator?.onLine === false;
    if (offline && !onSaveOffline) {
      onOfflineUnavailable?.();
      return;
    }
    const operation = offline ? onSaveOffline : onSubmit;
    const saved = await submissionGate.current(() => operation(source));
    if (saved) setContentOriginal('');
  };

  const handleSaveOffline = async () => {
    const source = contentOriginal;
    if (!source.trim() || !onSaveOffline) return;
    const saved = await submissionGate.current(() => onSaveOffline(source));
    if (saved) setContentOriginal('');
  };

  return (
    <div className="inbox-composer">
      <div className="composer-top">
        <span className="composer-icon">↳</span>
        <div>
          <strong>Sácalo de tu cabeza.</strong>
          <p>Una frase basta. No necesitas organizarla ahora.</p>
        </div>
      </div>
      <form onSubmit={handleSubmit}>
        <textarea
          name="capture"
          rows="4"
          placeholder="Escribe aquí lo que tienes en mente…"
          value={contentOriginal}
          onChange={(event) => setContentOriginal(event.target.value)}
          required
          disabled={busy}
        />
        <div className="composer-bottom">
          <span>✦ El original se conserva sin alteraciones.</span>
          <div className="composer-capture-actions">
            {onSaveOffline && (
              <button type="button" className="capture-action-button" disabled={busy || !contentOriginal.trim()} onClick={handleSaveOffline}>
                Guardar cifrada
              </button>
            )}
            <button className="button button-primary" disabled={busy || !contentOriginal.trim()}>
              {globalThis.navigator?.onLine === false ? 'Guardar offline' : 'Guardar captura'} <span>→</span>
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
