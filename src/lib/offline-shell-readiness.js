export const OFFLINE_SHELL_CACHE_NAME = 'simplelife-shell-v7';

export function getOfflineShellStatusMessage(state, isOnline) {
  if (state === 'preparing') {
    return isOnline
      ? 'Preparando el acceso sin conexión…'
      : 'La preparación sin conexión aún no ha terminado. Conéctate una vez para completar la descarga.';
  }

  if (state === 'unavailable') {
    return isOnline
      ? 'No se pudo comprobar el modo sin conexión. Mantén la conexión mientras lo revisamos.'
      : 'No se pudo comprobar el modo sin conexión. Conéctate una vez para completar la preparación.';
  }

  // A completed or still-running check should not cover the application.
  return null;
}
