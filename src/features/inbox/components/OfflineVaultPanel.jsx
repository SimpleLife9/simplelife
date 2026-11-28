import { useEffect, useState } from 'react';

export function OfflineVaultPanel({
  status,
  passphrase,
  setPassphrase,
  recoveryMode,
  setRecoveryMode,
  recoveryKey,
  setRecoveryKey,
  recoveryCode,
  onDismissRecoveryCode,
  recoveryCodeType = 'created',
  recoveryRotationMode = false,
  setRecoveryRotationMode,
  recoveryRotationPassphrase = '',
  setRecoveryRotationPassphrase,
  onRotateRecoveryKey,
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
  const [recoveryConfirmation, setRecoveryConfirmation] = useState('');

  useEffect(() => {
    setRecoveryConfirmation('');
  }, [recoveryCode]);

  const recoveryKeyMatches = Boolean(recoveryCode)
    && recoveryConfirmation.trim().toLowerCase() === recoveryCode.trim().toLowerCase();

  const copyRecoveryKey = async () => {
    if (!recoveryCode || !globalThis.navigator?.clipboard?.writeText) return;
    await globalThis.navigator.clipboard.writeText(recoveryCode);
  };

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

      {recoveryCode && (
        <div className="offline-vault-recovery" role="alert">
          <strong>{recoveryCodeType === 'rotated' ? 'Guarda tu nueva clave de recuperación' : 'Guarda ahora tu clave de recuperación'}</strong>
          <p>{recoveryCodeType === 'rotated'
            ? 'La clave anterior ya no funciona. Esta nueva clave sustituye a la anterior y solo se muestra una vez.'
            : 'Es la única forma de recuperar esta bóveda si pierdes la frase de desbloqueo. Solo se muestra una vez y no se almacena en el servidor.'}</p>
          <code>{recoveryCode}</code>
          <div className="offline-vault-actions">
            <button type="button" className="capture-action-button" onClick={copyRecoveryKey}>Copiar clave</button>
          </div>
          <label className="offline-vault-passphrase">
            <span>Confirma que guardaste la clave recuperándola de tu gestor seguro</span>
            <input
              aria-label="Confirmar clave de recuperación offline"
              type="password"
              inputMode="text"
              autoComplete="off"
              spellCheck={false}
              minLength={64}
              maxLength={64}
              pattern="[a-fA-F0-9]{64}"
              value={recoveryConfirmation}
              onChange={(event) => setRecoveryConfirmation(event.target.value)}
              placeholder="Pega aquí la clave guardada"
              disabled={busy}
            />
          </label>
          <p>Guárdala primero fuera de este dispositivo. Luego recupérala desde ese lugar y pégala aquí. La comprobación se hace localmente y no envía la clave al servidor.</p>
          <div className="offline-vault-actions">
            <button
              type="button"
              className="capture-action-button"
              disabled={busy || !recoveryKeyMatches}
              onClick={() => {
                setRecoveryConfirmation('');
                onDismissRecoveryCode();
              }}
            >
              Ya la guardé
            </button>
          </div>
        </div>
      )}

      {available && !unlocked && (
        <form className="offline-vault-access" onSubmit={onCreateOrUnlock}>
          {configured && recoveryMode && (
            <label className="offline-vault-passphrase">
              <span>Clave de recuperación (64 caracteres)</span>
              <input
                aria-label="Clave de recuperación offline"
                type="password"
                minLength={64}
                maxLength={64}
                autoComplete="off"
                value={recoveryKey}
                onChange={(event) => setRecoveryKey(event.target.value)}
                required
                disabled={busy}
                placeholder="Pega la clave que guardaste"
              />
            </label>
          )}
          <label className="offline-vault-passphrase">
            <span>{!configured ? 'Crea una frase de desbloqueo' : recoveryMode ? 'Nueva frase de desbloqueo' : 'Frase de desbloqueo'}</span>
            <input
              aria-label={!configured ? 'Nueva frase de desbloqueo offline' : recoveryMode ? 'Nueva frase offline' : 'Frase de desbloqueo offline'}
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
          <button type="submit" className="capture-action-button" disabled={busy || passphrase.length < 14 || (recoveryMode && recoveryKey.length !== 64)}>
            {busy ? 'Preparando…' : !configured ? 'Crear bóveda privada' : recoveryMode ? 'Recuperar y cambiar frase' : 'Desbloquear bóveda'}
          </button>
          {configured && (
            <button
              type="button"
              className="capture-action-button"
              disabled={busy}
              onClick={() => {
                setRecoveryMode(!recoveryMode);
                setRecoveryKey('');
                setPassphrase('');
              }}
            >
              {recoveryMode ? 'Volver al desbloqueo normal' : 'Perdí mi frase de desbloqueo'}
            </button>
          )}
        </form>
      )}

      {unlocked && (
        <div className="offline-vault-actions">
          <span>{queuedCaptures.length} captura(s) cifrada(s) pendiente(s)</span>
          <button type="button" className="capture-action-button" onClick={onSync} disabled={busy || !online || queuedCaptures.length === 0}>
            {busy ? 'Sincronizando…' : 'Sincronizar ahora'}
          </button>
          <button type="button" className="capture-action-button" onClick={onLock} disabled={busy}>Bloquear</button>
          {!recoveryRotationMode && !recoveryCode && (
            <button
              type="button"
              className="capture-action-button"
              disabled={busy}
              onClick={() => setRecoveryRotationMode?.(true)}
            >
              Renovar clave de recuperación
            </button>
          )}
        </div>
      )}

      {unlocked && recoveryRotationMode && !recoveryCode && (
        <form className="offline-vault-access" onSubmit={onRotateRecoveryKey}>
          <label className="offline-vault-passphrase">
            <span>Confirma tu frase actual para renovar la clave</span>
            <input
              aria-label="Frase actual de desbloqueo offline"
              type="password"
              minLength={14}
              autoComplete="off"
              value={recoveryRotationPassphrase}
              onChange={(event) => setRecoveryRotationPassphrase?.(event.target.value)}
              required
              disabled={busy}
              placeholder="Frase de desbloqueo actual"
            />
          </label>
          <div className="offline-vault-actions">
            <button
              type="submit"
              className="capture-action-button"
              disabled={busy || recoveryRotationPassphrase.length < 14}
            >
              {busy ? 'Renovando…' : 'Generar nueva clave de recuperación'}
            </button>
            <button
              type="button"
              className="capture-action-button"
              disabled={busy}
              onClick={() => {
                setRecoveryRotationPassphrase?.('');
                setRecoveryRotationMode?.(false);
              }}
            >
              Cancelar renovación
            </button>
          </div>
          <p>Esta operación se realiza localmente. La clave anterior quedará invalidada y las capturas cifradas no se modifican.</p>
        </form>
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
        La frase y la clave de recuperación no se guardan en el servidor. Sin ninguna de las dos, las capturas locales no se pueden descifrar. Se eliminan del dispositivo solo después de confirmar la sincronización.
      </small>
    </section>
  );
}
