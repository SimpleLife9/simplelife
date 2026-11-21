export const NAV = [
  { id: 'today', label: 'Hoy', icon: '☀️' },
  { id: 'inbox', label: 'Inbox', icon: '↳' },
  { id: 'goals', label: 'Objetivos', icon: '◎' },
  { id: 'projects', label: 'Proyectos', icon: '▤' },
  { id: 'more', label: 'Más', icon: '•••' },
];

export function getPageTitle(activePage, morePage) {
  return activePage === 'today'
    ? 'Hoy'
    : activePage === 'inbox'
      ? 'Inbox'
      : activePage === 'goals'
        ? 'Objetivos'
        : activePage === 'projects'
          ? 'Proyectos'
          : morePage === 'tasks' ? 'Tareas' : morePage === 'notes' ? 'Notas e ideas' : 'Listas';
}

export function getPageDescription(activePage, morePage) {
  if (activePage === 'inbox') return 'Captura primero. Organiza después.';
  if (activePage === 'goals') return 'Conecta lo que quieres con la vida que estás construyendo.';
  if (activePage === 'projects') return 'Resultados concretos, organizados en proyectos.';
  if (morePage === 'tasks') return 'Acciones claras, con prioridad y contexto.';
  if (morePage === 'notes') return 'Un lugar para conservar ideas y pensamientos.';
  return 'Elementos sencillos que puedes organizar y compartir más adelante.';
}
