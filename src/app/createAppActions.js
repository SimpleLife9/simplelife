export function createAppActions({
  setBusy,
  setError,
  setNotice,
  setRefreshKey,
  schedule = (callback, delay) => setTimeout(callback, delay),
}) {
  const showNotice = (message) => {
    setNotice(message);
    setError('');
    schedule(() => {
      setNotice((current) => current === message ? '' : current);
    }, 3500);
  };

  const showError = (message) => {
    setError(message);
    setNotice('');
  };

  const runAction = async (operation, successMessage, options = {}) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await operation();
      setRefreshKey((key) => key + 1);
      if (successMessage) showNotice(successMessage);
      return true;
    } catch (actionError) {
      if (typeof options.onError === 'function') options.onError(actionError);
      else showError(actionError?.message || 'No se pudo completar la operación.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  return { showNotice, showError, runAction };
}
