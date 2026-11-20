export function StatusTag({ status }) {
  const labels = { draft: 'Borrador', planning: 'En planificación', todo: 'Pendiente', in_progress: 'En curso', blocked: 'Bloqueada', active: 'Activa', paused: 'En pausa', completed: 'Completada', cancelled: 'Cancelada' };
  return <span className={`status-tag status-${status}`}>{labels[status] || status}</span>;
}
