const USER_MESSAGES = Object.freeze({
  PRIVATE_OFFLINE_PASSPHRASE_INVALID: 'Contraseña incorrecta. Inténtalo de nuevo.',
  PRIVATE_OFFLINE_RECOVERY_KEY_INVALID: 'Clave de recuperación incorrecta. Comprueba la clave e inténtalo de nuevo.',
  PASSPHRASE_MUST_HAVE_AT_LEAST_14_CHARACTERS: 'La contraseña debe tener al menos 14 caracteres.',
  PRIVATE_OFFLINE_VAULT_VERSION_UNSUPPORTED: 'Esta bóveda no es compatible con esta versión de SimpleLife. Actualiza la aplicación antes de continuar.',
});

export function getOfflineVaultUserMessage(error) {
  const code = typeof error === 'string' ? error : error?.message;
  return USER_MESSAGES[code] || 'No se pudo desbloquear la bóveda. Inténtalo de nuevo.';
}
