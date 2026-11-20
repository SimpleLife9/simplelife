import { formatDate, formatDuration } from '../../../lib/date-time.js';

export function TaskRow({ task, onComplete, onReschedule, busy }) {
  return <div className="task-row">
    <button className="task-check" onClick={onComplete} disabled={busy} aria-label={`Completar tarea: ${task.action}`} />
    <div className="task-row-copy">
      <strong>{task.action}</strong>
      <small>{task.due_date ? `Para ${formatDate(task.due_date)}` : 'Sin fecha definida'} {task.estimated_duration_minutes ? `· ${formatDuration(task.estimated_duration_minutes)}` : ''}</small>
    </div>
    {onReschedule && <button type="button" className="task-row-action" onClick={onReschedule} disabled={busy} aria-label={`Pasar a hoy: ${task.action}`}>Pasar a hoy</button>}
    <span className={`priority priority-${task.priority}`}>{task.priority <= 2 ? 'Alta' : task.priority === 3 ? 'Normal' : 'Baja'}</span>
  </div>;
}
