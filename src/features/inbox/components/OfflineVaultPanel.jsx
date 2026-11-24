export function OfflineVaultPanel({
  status,
  passphrase,
  setPassphrase,
  busy,
  error,
  notice,
  queuedCaptures,
  online,
  onCreateOrUnlock,
  onLock,
  onSync,
}) {
  const configured = status?.configured === true;
  const unlocked = status?.unlocked === true;
  const available = status?.available !== false;

  return (
    <section className="offline-vault-panel" aria-label="Bóveda offline privada">
      <div className="offline-vault-heading">
        <div>
          <strong>Modo sin conexión privado</strong>
          <p>Las capturas locales se cifran antes de guardarse en este dispositivo.</p>
        </div>
        <span className={'offline-vault-state' + (unlocked ? ' is-unlocked' : '')}>
          {unlocked ? 'Desbloqueada' : configured ? 'Bloqueada' : 'Sin configurar'}
        </span>
      </div>

      {!available && <p className="form-error" role="alert">Este navegador no ofrece IndexedDB y WebCrypto; no se guardarán datos offline.</p>}

      {available && !unlocked && (
        <form className="offline-vault-access" onSubmit={onCreateOrUnlock}>
          <label className="offline-vault-passphrase">
            <span>{configured ? 'Frase de recuperación' : 'Crea una frase de recuperación'}</span>
            <input
              aria-label={configured ? 'Frase de recuperación offline' : 'Nueva frase de recuperación offline'}
              type="password"
              minLength={14}
              autoComplete="off"
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
              required
              disabled={busy}
              placeholder="Mínimo 14 caracteres"
            />
          </label>
          <button type="submit" className="capture-action-button" disabled={busy || passphrase.length < 14}>
            {busy ? 'Preparando…' : configured ? 'Desbloquear bóveda' : 'Crear bóveda privada'}
          </button>
        </form>
      )}

      {unlocked && (
        <div className="offline-vault-actions">
          <span>{queuedCaptures.length} captura(s) cifrada(s) pendiente(s)</span>
          <button type="button" className="capture-action-button" onClick={onSync} disabled={busy || !online || queuedCaptures.length === 0}>
            {busy ? 'Sincronizando…' : 'Sincronizar ahora'}
          </button>
          <button type="button" className="capture-action-button" onClick={onLock} disabled={busy}>Bloquear</button>
        </div>
      )}

      {unlocked && queuedCaptures.length > 0 && (
        <div className="offline-vault-queue" aria-label="Capturas offline pendientes">
          {queuedCaptures.map((capture) => (
            <p key={capture.captureId}>{capture.contentOriginal}</p>
          ))}
        </div>
      )}

      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="offline-vault-notice" role="status">{notice}</p>}
      <small className="offline-vault-privacy">
        La frase nunca se guarda. Sin ella, el contenido pendiente no se puede recuperar. Las capturas solo se eliminan del dispositivo después de que el servidor confirme la sincronización.
      </small>
    </section>
  );
}
