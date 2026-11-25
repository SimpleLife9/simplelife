import { useEffect, useState } from 'react';
import { Brand } from '../shared/components/Brand.jsx';
import { NAV } from './navigation.js';

export function AppShell({
  profile,
  email,
  onSignOut,
  activePage,
  onNavigate,
  morePage,
  onMorePageChange,
  title,
  eyebrow,
  description,
  notice,
  error,
  onClearAlerts,
  children,
}) {
  const [networkAvailable, setNetworkAvailable] = useState(
    () => globalThis.navigator?.onLine !== false,
  );

  useEffect(() => {
    const updateNetworkStatus = () => {
      setNetworkAvailable(globalThis.navigator?.onLine !== false);
    };
    const target = globalThis.window;
    target?.addEventListener('online', updateNetworkStatus);
    target?.addEventListener('offline', updateNetworkStatus);
    updateNetworkStatus();
    return () => {
      target?.removeEventListener('online', updateNetworkStatus);
      target?.removeEventListener('offline', updateNetworkStatus);
    };
  }, []);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <div className="sidebar-label">TU ESPACIO</div>
        <nav className="side-nav" aria-label="Navegación principal">
          {NAV.map((item) => (
            <button key={item.id} className={`nav-item ${activePage === item.id ? 'active' : ''}`} onClick={() => onNavigate(item.id)}>
              <span className="nav-icon">{item.icon}</span><span>{item.label}</span>
              {item.id === 'inbox' && <span className="nav-dot" />}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="privacy-note"><span>◈</span><div><strong>Tu espacio es privado</strong><small>Solo tú puedes ver tus datos.</small></div></div>
          <button className="profile-button" onClick={onSignOut} title="Cerrar sesión">
            <span className="avatar">{(profile?.display_name || email || 'S').slice(0, 1).toUpperCase()}</span>
            <span className="profile-meta"><strong>{profile?.display_name || 'Mi cuenta'}</strong><small>{email}</small></span>
            <span className="profile-exit">↗</span>
          </button>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="mobile-brand"><Brand compact /></div>
          <div className="breadcrumb">Mi vida <span>/</span> <strong>{title}</strong></div>
          <div className="topbar-right"><span className={`connection-state ${networkAvailable ? 'is-online' : 'is-offline'}`} role="status" aria-live="polite" title="Estado de conectividad informado por el navegador; no confirma que los datos estén sincronizados."><i aria-hidden="true" />{networkAvailable ? 'Con conexión' : 'Sin conexión'}</span><button className="mobile-signout" onClick={onSignOut}>Salir</button></div>
        </header>

        <section className="page-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">{eyebrow}</div>
              <h1>{title}</h1>
              <p>{description}</p>
            </div>
          </div>
          {activePage === 'more' && (
            <nav className="more-page-tabs" aria-label="Secciones de Más">
              <button type="button" className={morePage === 'tasks' ? 'selected' : ''} aria-current={morePage === 'tasks' ? 'page' : undefined} onClick={() => onMorePageChange('tasks')}>Tareas</button>
              <button type="button" className={morePage === 'notes' ? 'selected' : ''} aria-current={morePage === 'notes' ? 'page' : undefined} onClick={() => onMorePageChange('notes')}>Notas e ideas</button>
              <button type="button" className={morePage === 'lists' ? 'selected' : ''} aria-current={morePage === 'lists' ? 'page' : undefined} onClick={() => onMorePageChange('lists')}>Listas</button>
            </nav>
          )}

          {(notice || error) && <div className={`alert ${error ? 'alert-error' : 'alert-success'}`}>{error || notice}<button onClick={onClearAlerts}>×</button></div>}

          {children}
        </section>
        <footer className="app-footer"><span>SimpleLife v0.1 · Desarrollo</span><span>Privado por defecto</span></footer>
      </main>
      <nav className="mobile-nav" aria-label="Navegación móvil">
        {NAV.map((item) => (
          <button key={item.id} className={activePage === item.id ? 'active' : ''} onClick={() => onNavigate(item.id)}>
            <span>{item.icon}</span><small>{item.label}</small>
          </button>
        ))}
      </nav>
    </div>
  );
}
