export const OFFLINE_SHELL_CACHE_NAME = 'simplelife-shell-v8';

export function getOfflineShellStatusMessage(state, isOnline) {
  // Never cover the working app while the device has connectivity. Readiness
  // is important for offline use, but it must not obstruct normal navigation.
  if (isOnline) return null;

  if (state === 'preparing') {
    return 'La preparación sin conexión aún no ha terminado. Conéctate una vez para completar la descarga.';
  }

  if (state === 'unavailable') {
    return 'No se pudo comprobar el modo sin conexión. Conéctate una vez para completar la preparación.';
  }

  // A completed or still-running check should not cover the application.
  return null;
}
