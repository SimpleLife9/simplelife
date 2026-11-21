export function FormCard({ title, children, onSubmit, submitLabel = 'Guardar', busy = false, className = '' }) {
  return <form className={`form-card ${className}`} onSubmit={onSubmit}><div className="form-card-title">{title}</div>{children}<button className="button button-primary" type="submit" disabled={busy}>{busy ? 'Guardando…' : submitLabel} <span>→</span></button></form>;
}
