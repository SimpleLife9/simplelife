export function ProjectStatusTag({ status, archived = false }) {
  if (archived) return <span className="status-tag status-archived">Archivado</span>;
  const labels = { planning: 'En planificación', active: 'En marcha', paused: 'En pausa', completed: 'Completado', cancelled: 'Cancelado' };
  return <span className={`status-tag status-${status}`}>{labels[status] || status}</span>;
}
