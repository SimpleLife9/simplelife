import { useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { uuidv7 } from '../../lib/uuidv7.js';
import { formatDate } from '../../lib/date-time.js';
import { useRows } from '../../shared/hooks/useRows.js';
import { SectionTitle } from '../../shared/components/SectionTitle.jsx';
import { EmptyState } from '../../shared/components/EmptyState.jsx';
import { Field } from '../../shared/components/Field.jsx';
import { TextAreaField } from '../../shared/components/TextAreaField.jsx';
import { StatusTag } from '../../shared/components/StatusTag.jsx';
import { ProjectStatusTag } from '../../shared/components/ProjectStatusTag.jsx';

export function ProjectsPage({ profile, refreshKey, runAction, busy, setActivePage, setMorePage }) {
  const { rows: projects, loading, localError } = useRows('project', profile, refreshKey, (query) => query.is('deleted_at', null).order('created_at', { ascending: false }));
  const { rows: links } = useRows('task_project_link', profile, refreshKey);
  const { rows: tasks } = useRows('task', profile, refreshKey, (query) => query.is('deleted_at', null));
  const { rows: goals } = useRows('goal', profile, refreshKey, (query) => query.is('deleted_at', null));
  const { rows: subgoals } = useRows('subgoal', profile, refreshKey, (query) => query.is('deleted_at', null));
  const { rows: contributionRelations } = useRows('contribution_relation', profile, refreshKey);
  const [name, setName] = useState('');
  const [purpose, setPurpose] = useState('');
  const [startDate, setStartDate] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [lifecycleFilter, setLifecycleFilter] = useState('active');
  const [sortBy, setSortBy] = useState('recent');
  const [editingProject, setEditingProject] = useState(null);
  const [editName, setEditName] = useState('');
  const [editPurpose, setEditPurpose] = useState('');
  const [editStartDate, setEditStartDate] = useState('');
  const [editTargetDate, setEditTargetDate] = useState('');
  const [editStatus, setEditStatus] = useState('planning');
  const [selectedProject, setSelectedProject] = useState(null);
  const [showRelationForm, setShowRelationForm] = useState(false);
  const [relationTarget, setRelationTarget] = useState('');
  const [showNewProject, setShowNewProject] = useState(false);
  const closeNewProject = () => {
    if (busy) return;
    setShowNewProject(false);
    setName(''); setPurpose(''); setStartDate(''); setTargetDate('');
  };

  const visibleProjects = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('es');
    const filtered = projects.filter((project) => {
      const lifecycleMatches = lifecycleFilter === 'all'
        || (lifecycleFilter === 'active' && !project.archived_at)
        || (lifecycleFilter === 'archived' && Boolean(project.archived_at));
      // Work-state filters apply only to projects that are not archived.
      const statusMatches = statusFilter === 'all' || (!project.archived_at && project.status === statusFilter);
      const searchMatches = !term || `${project.name || ''} ${project.purpose || ''}`.toLocaleLowerCase('es').includes(term);
      return lifecycleMatches && statusMatches && searchMatches;
    });
    const compareTarget = (a, b) => {
      if (!a.target_date && !b.target_date) return 0;
      if (!a.target_date) return 1;
      if (!b.target_date) return -1;
      return String(a.target_date).localeCompare(String(b.target_date));
    };
    filtered.sort((a, b) => {
      if (sortBy === 'name') return String(a.name || '').localeCompare(String(b.name || ''), 'es');
      if (sortBy === 'target') return compareTarget(a, b) || String(a.name || '').localeCompare(String(b.name || ''), 'es');
      return String(b.created_at || '').localeCompare(String(a.created_at || ''));
    });
    return filtered;
  }, [projects, search, statusFilter, lifecycleFilter, sortBy]);

  const openEditor = (project) => {
    setEditingProject(project);
    setEditName(project.name || '');
    setEditPurpose(project.purpose || '');
    setEditStartDate(project.start_date || '');
    setEditTargetDate(project.target_date || '');
    setEditStatus(project.status || 'planning');
  };

  const addProject = async (event) => {
    event.preventDefault();
    if (!name.trim()) return;
    if (startDate && targetDate && startDate > targetDate) {
      await runAction(async () => { throw new Error('La fecha de inicio no puede ser posterior a la fecha objetivo.'); });
      return;
    }
    await runAction(async () => {
      const { error: insertError } = await supabase.from('project').insert({
        id: uuidv7(), owner_user_id: profile.id, created_by_user_id: profile.id,
        name: name.trim(), purpose: purpose.trim() || null,
        start_date: startDate || null, target_date: targetDate || null, status: 'active',
      });
      if (insertError) throw insertError;
      setName(''); setPurpose(''); setStartDate(''); setTargetDate('');
      setShowNewProject(false);
    }, 'Proyecto creado.');
  };

  const saveProject = async (event) => {
    event.preventDefault();
    if (!editingProject || !editName.trim()) return;
    if (editStartDate && editTargetDate && editStartDate > editTargetDate) {
      await runAction(async () => { throw new Error('La fecha de inicio no puede ser posterior a la fecha objetivo.'); });
      return;
    }
    await runAction(async () => {
      const projectUpdates = {
        name: editName.trim(),
        purpose: editPurpose.trim() || null,
        start_date: editStartDate || null,
        target_date: editTargetDate || null,
      };
      // Preserve work status while archived; it becomes editable again after restoration.
      if (!editingProject.archived_at) projectUpdates.status = editStatus;
      const { data, error: updateError } = await supabase.from('project').update(projectUpdates)
        .eq('id', editingProject.id).eq('owner_user_id', profile.id).is('deleted_at', null).select('id');
      if (updateError) throw updateError;
      if (!data?.length) throw new Error('No se pudo actualizar el proyecto. Puede que ya no exista o no pertenezca a esta cuenta.');
      setEditingProject(null);
    }, 'Proyecto actualizado.');
  };

  const toggleArchive = (project) => runAction(async () => {
    const archive = !project.archived_at;
    const { data, error: updateError } = await supabase.from('project')
      .update({ archived_at: archive ? new Date().toISOString() : null })
      .eq('id', project.id)
      .eq('owner_user_id', profile.id)
      .is('deleted_at', null)
      .select('id');
    if (updateError) throw updateError;
    if (!data?.length) throw new Error('No se pudo cambiar el archivo del proyecto. Actualiza la vista e inténtalo de nuevo.');
  }, project.archived_at ? 'Proyecto restaurado.' : 'Proyecto archivado.');

  const projectRelations = selectedProject
    ? contributionRelations.filter((relation) => relation.project_id === selectedProject.id && relation.relation_status === 'confirmed')
    : [];
  const relationTargetIsLinked = (() => {
    if (!relationTarget || !selectedProject) return false;
    const [kind, id] = relationTarget.split(':');
    return contributionRelations.some((relation) => relation.project_id === selectedProject.id
      && relation.relation_status === 'confirmed'
      && (kind === 'goal' ? relation.goal_id === id && !relation.subgoal_id : relation.subgoal_id === id && !relation.goal_id));
  })();

  const saveProjectRelation = async (event) => {
    event.preventDefault();
    if (!selectedProject || selectedProject.archived_at || !relationTarget) return;
    const [kind, targetId] = relationTarget.split(':');
    if (!['goal', 'subgoal'].includes(kind) || !targetId) return;
    const targetField = kind === 'goal' ? 'goal_id' : 'subgoal_id';
    const otherField = kind === 'goal' ? 'subgoal_id' : 'goal_id';
    const existing = contributionRelations.find((relation) => relation.project_id === selectedProject.id
      && relation[targetField] === targetId && !relation[otherField]);
    const saved = await runAction(async () => {
      if (existing) {
        if (existing.relation_status === 'confirmed') throw new Error('Este elemento ya está vinculado a este proyecto.');
        const { data, error } = await supabase.from('contribution_relation').update({ relation_status: 'confirmed' })
          .eq('id', existing.id).eq('project_id', selectedProject.id).select('id');
        if (error) throw error;
        if (!data?.length) throw new Error('No se pudo restaurar el vínculo. Actualiza la vista e inténtalo de nuevo.');
      } else {
        const payload = {
          id: uuidv7(), project_id: selectedProject.id, [targetField]: targetId,
          relation_status: 'confirmed', created_by_user_id: profile.id,
        };
        const { data, error } = await supabase.from('contribution_relation').insert(payload).select('id');
        if (error) throw error;
        if (!data?.length) throw new Error('No se pudo crear el vínculo entre el proyecto y el objetivo.');
      }
    }, existing ? 'Vínculo restaurado.' : kind === 'goal' ? 'Meta vinculada al proyecto.' : 'Submeta vinculada al proyecto.');
    if (saved) { setShowRelationForm(false); setRelationTarget(''); }
  };

  const removeProjectRelation = (relation) => runAction(async () => {
    const { data, error } = await supabase.from('contribution_relation').update({ relation_status: 'removed' })
      .eq('id', relation.id).eq('project_id', selectedProject.id).select('id');
    if (error) throw error;
    if (!data?.length) throw new Error('No se pudo desvincular el objetivo. Actualiza la vista e inténtalo de nuevo.');
  }, relation.goal_id ? 'Meta desvinculada del proyecto.' : 'Submeta desvinculada del proyecto.');

  const projectTaskRows = selectedProject
    ? tasks.filter((task) => links.some((link) => link.project_id === selectedProject.id && link.task_id === task.id))
      .sort((a, b) => String(a.due_date || '9999-12-31').localeCompare(String(b.due_date || '9999-12-31')))
    : [];
  const taskCounts = {
    total: projectTaskRows.length,
    completed: projectTaskRows.filter((task) => task.status === 'completed').length,
    blocked: projectTaskRows.filter((task) => task.status === 'blocked').length,
    active: projectTaskRows.filter((task) => ['todo', 'in_progress'].includes(task.status)).length,
  };

  return <>
    <div className="management-layout management-layout-single">
      <div className="content-main">
        <div className="section-heading-row">
          <SectionTitle detail={`${visibleProjects.length} de ${projects.length} proyectos`}>
            {lifecycleFilter === 'archived' ? 'Proyectos archivados' : lifecycleFilter === 'all' ? 'Todos los proyectos' : 'Proyectos sin archivar'}
          </SectionTitle>
          <div className="section-create-actions"><button type="button" className="section-create-button" onClick={() => setShowNewProject(true)}>Nuevo Proyecto</button></div>
        </div>
        <div className="project-toolbar" aria-label="Buscar y organizar proyectos">
          <label className="project-toolbar-field project-search-field">
            <span>Buscar</span>
            <input aria-label="Buscar proyectos" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nombre o propósito…" />
          </label>
          <label className="project-toolbar-field">
            <span>Estado de trabajo</span>
            <select aria-label="Filtrar por estado de trabajo" value={statusFilter} disabled={lifecycleFilter === 'archived'} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="all">Todos</option>
              <option value="planning">Planificación</option>
              <option value="active">En marcha</option>
              <option value="paused">En pausa</option>
              <option value="completed">Completados</option>
              <option value="cancelled">Cancelados</option>
            </select>
          </label>
          <label className="project-toolbar-field">
            <span>Archivo</span>
            <select aria-label="Filtrar proyectos por archivo" value={lifecycleFilter} onChange={(event) => { const nextValue = event.target.value; setLifecycleFilter(nextValue); if (nextValue === 'archived') setStatusFilter('all'); }}>
              <option value="active">Sin archivar</option>
              <option value="archived">Archivados</option>
              <option value="all">Todos</option>
            </select>
          </label>
          <label className="project-toolbar-field">
            <span>Ordenar</span>
            <select aria-label="Ordenar proyectos" value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
              <option value="recent">Más recientes</option>
              <option value="name">Nombre</option>
              <option value="target">Fecha objetivo</option>
            </select>
          </label>
        </div>
        {loading ? <p className="muted">Cargando…</p> : localError ? <div className="form-error">{localError}</div> : visibleProjects.length ? (
          <div className="project-grid">
            {visibleProjects.map((project) => {
              const count = tasks.filter((task) => links.some((link) => link.project_id === project.id && link.task_id === task.id)).length;
              return <article className={`project-card ${project.archived_at ? 'project-card-archived' : ''}`} key={project.id}>
                <button type="button" className="project-open-button" onClick={() => setSelectedProject(project)} aria-label={`Ver proyecto: ${project.name}`}>
                  <div className="project-cover"><span>✳</span><small>{project.target_date ? `Hasta ${formatDate(project.target_date)}` : 'Sin fecha objetivo'}</small></div>
                  <div className="project-body"><ProjectStatusTag status={project.status} archived={Boolean(project.archived_at)} /><h3>{project.name}</h3><p>{project.purpose || 'Un espacio para convertir una intención en acciones concretas.'}</p><div className="project-foot"><span>{count} tareas vinculadas</span><span>Ver proyecto ↗</span></div></div>
                </button>
                <div className="project-card-actions">
                  <button type="button" className="project-action-button" onClick={() => openEditor(project)} disabled={busy} aria-label={`Editar proyecto: ${project.name}`}>Editar</button>
                  <button type="button" className="project-action-button" onClick={() => toggleArchive(project)} disabled={busy} aria-label={`${project.archived_at ? 'Restaurar' : 'Archivar'} proyecto: ${project.name}`}>{project.archived_at ? 'Restaurar' : 'Archivar'}</button>
                </div>
              </article>;
            })}
          </div>
        ) : projects.length ? <EmptyState title="No hay coincidencias" detail="Prueba otra búsqueda o cambia los filtros de proyectos." icon="⌕" /> : <EmptyState title="Todavía no hay proyectos" detail="Crea uno para organizar tareas alrededor de un resultado concreto." icon="▤" />}
      </div>
    </div>

    {showNewProject && (
      <div className="task-editor-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) closeNewProject(); }} onKeyDown={(event) => { if (event.key === 'Escape' && !busy) closeNewProject(); }}>
        <section className="task-editor-dialog floating-form-dialog" role="dialog" aria-modal="true" aria-labelledby="project-create-title">
          <div className="task-editor-heading">
            <div><div className="eyebrow">CONVIERTE UNA INTENCIÓN EN ACCIONES</div><h2 id="project-create-title">Nuevo proyecto</h2></div>
            <button type="button" className="task-editor-close" onClick={closeNewProject} disabled={busy} aria-label="Cerrar nuevo proyecto">×</button>
          </div>
          <form className="task-editor-form" onSubmit={addProject}>
            <Field label="Nombre" name="project" value={name} onChange={(event) => setName(event.target.value)} placeholder="Ej. Lanzar mi negocio" required autoFocus />
            <TextAreaField label="Propósito (opcional)" name="purpose" value={purpose} onChange={(event) => setPurpose(event.target.value)} placeholder="¿Qué quieres conseguir?" rows={3} />
            <Field label="Fecha de inicio (opcional)" name="start" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
            <Field label="Fecha objetivo (opcional)" name="target" type="date" value={targetDate} onChange={(event) => setTargetDate(event.target.value)} />
            <p className="project-form-note">La fecha objetivo debe ser igual o posterior al inicio.</p>
            <div className="task-editor-actions">
              <button type="button" className="button task-editor-cancel" onClick={closeNewProject} disabled={busy}>Cancelar</button>
              <button type="submit" className="button button-primary" disabled={busy || !name.trim()}>{busy ? 'Guardando…' : 'Crear proyecto'} <span>→</span></button>
            </div>
          </form>
        </section>
      </div>
    )}

    {editingProject && (
      <div className="task-editor-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setEditingProject(null); }}>
        <section className="task-editor-dialog" role="dialog" aria-modal="true" aria-labelledby="project-editor-title">
          <div className="task-editor-heading">
            <div><div className="eyebrow">ACTUALIZA TU PLAN</div><h2 id="project-editor-title">Editar proyecto</h2></div>
            <button type="button" className="task-editor-close" onClick={() => setEditingProject(null)} disabled={busy} aria-label="Cerrar edición del proyecto">×</button>
          </div>
          <form className="task-editor-form" onSubmit={saveProject}>
            <Field label="Nombre del proyecto" name="editProjectName" value={editName} onChange={(event) => setEditName(event.target.value)} required />
            <TextAreaField label="Propósito (opcional)" name="editProjectPurpose" value={editPurpose} onChange={(event) => setEditPurpose(event.target.value)} rows={3} />
            <Field label="Fecha de inicio (opcional)" name="editProjectStart" type="date" value={editStartDate} onChange={(event) => setEditStartDate(event.target.value)} />
            <Field label="Fecha objetivo (opcional)" name="editProjectTarget" type="date" value={editTargetDate} onChange={(event) => setEditTargetDate(event.target.value)} />
            {!editingProject.archived_at
              ? <label className="field"><span>Estado de trabajo</span><select aria-label="Estado de trabajo" value={editStatus} onChange={(event) => setEditStatus(event.target.value)}>
                  <option value="planning">En planificación</option><option value="active">En marcha</option><option value="paused">En pausa</option><option value="completed">Completado</option><option value="cancelled">Cancelado</option>
                </select></label>
              : <p className="task-editor-note">Este proyecto está archivado. Su estado de trabajo se conserva y volverá a estar disponible al restaurarlo.</p>}
            <p className="task-editor-note">Editar el proyecto no cambia sus tareas vinculadas ni elimina relaciones.</p>
            <div className="task-editor-actions"><button type="button" className="button task-editor-cancel" onClick={() => setEditingProject(null)} disabled={busy}>Cancelar</button><button type="submit" className="button button-primary" disabled={busy || !editName.trim()}>{busy ? 'Guardando…' : 'Guardar cambios'} <span>→</span></button></div>
          </form>
        </section>
      </div>
    )}

    {selectedProject && (
      <div className="task-editor-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedProject(null); }}>
        <section className="task-editor-dialog project-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="project-detail-title">
          <div className="task-editor-heading">
            <div><div className="eyebrow">DETALLE DEL PROYECTO</div><h2 id="project-detail-title">{selectedProject.name}</h2></div>
            <button type="button" className="task-editor-close" onClick={() => setSelectedProject(null)} aria-label="Cerrar detalle del proyecto">×</button>
          </div>
          <div className="project-detail-meta"><ProjectStatusTag status={selectedProject.status} archived={Boolean(selectedProject.archived_at)} /><span>{selectedProject.start_date ? `Inicio: ${formatDate(selectedProject.start_date)}` : 'Sin fecha de inicio'}</span><span>{selectedProject.target_date ? `Objetivo: ${formatDate(selectedProject.target_date)}` : 'Sin fecha objetivo'}</span></div>
          {selectedProject.purpose && <p className="project-detail-purpose">{selectedProject.purpose}</p>}
          <div className="project-task-summary"><div><strong>{taskCounts.total}</strong><small>Tareas vinculadas</small></div><div><strong>{taskCounts.active}</strong><small>Abiertas</small></div><div><strong>{taskCounts.completed}</strong><small>Completadas</small></div><div><strong>{taskCounts.blocked}</strong><small>Bloqueadas</small></div></div>
          <div className="project-detail-section project-goal-link-section">
            <div className="project-relation-heading"><strong>Metas y submetas vinculadas</strong><button type="button" className="text-button" disabled={Boolean(selectedProject.archived_at) || busy} onClick={() => setShowRelationForm((visible) => !visible)}>{showRelationForm ? 'Cancelar' : 'Vincular meta o submeta'}</button></div>
            {projectRelations.length ? <div className="project-relation-list">{projectRelations.map((relation) => {
              const goal = relation.goal_id ? goals.find((row) => row.id === relation.goal_id) : null;
              const subgoal = relation.subgoal_id ? subgoals.find((row) => row.id === relation.subgoal_id) : null;
              const parentGoal = subgoal ? goals.find((row) => row.id === subgoal.goal_id) : null;
              const label = goal ? 'Meta' : 'Submeta';
              const title = goal?.title || subgoal?.title || 'Objetivo no disponible';
              return <div className="project-relation-row" key={relation.id}>
                <div><span>{label}</span><strong>{title}</strong>{parentGoal && <small>Meta: {parentGoal.title}</small>}</div>
                <button type="button" className="text-button" disabled={busy || Boolean(selectedProject.archived_at)} onClick={() => removeProjectRelation(relation)} aria-label={'Desvincular ' + label.toLowerCase() + ': ' + title}>Desvincular</button>
              </div>;
            })}</div> : <p className="muted">Este proyecto todavía no está vinculado a ninguna meta o submeta.</p>}
            {showRelationForm && <form className="project-relation-form" onSubmit={saveProjectRelation}>
              <label className="field"><span>Meta o submeta</span><select aria-label="Seleccionar meta o submeta" required value={relationTarget} onChange={(event) => setRelationTarget(event.target.value)}>
                <option value="">Selecciona un objetivo</option>
                <optgroup label="Metas">{goals.map((goal) => <option key={goal.id} value={'goal:' + goal.id}>{goal.title}</option>)}</optgroup>
                <optgroup label="Submetas">{subgoals.map((subgoal) => {
                  const parentGoal = goals.find((goal) => goal.id === subgoal.goal_id);
                  return <option key={subgoal.id} value={'subgoal:' + subgoal.id}>{subgoal.title} — {parentGoal?.title || 'Meta'}</option>;
                })}</optgroup>
              </select></label>
              {relationTargetIsLinked && <p className="task-editor-note">Este objetivo ya está vinculado a este proyecto.</p>}
              <button type="submit" className="button button-primary" disabled={busy || !relationTarget || relationTargetIsLinked}>Vincular relación <span>→</span></button>
            </form>}
          </div>
          <div className="project-detail-section"><strong>Tareas del proyecto</strong>
            {projectTaskRows.length ? <div className="project-detail-task-list">{projectTaskRows.map((task) => {
              const taskLink = links.find((link) => link.task_id === task.id && link.project_id === selectedProject.id);
              return <div className="project-detail-task" key={task.id}><div><b>{task.action}</b><small>{task.due_date ? `Fecha: ${formatDate(task.due_date)}` : 'Sin fecha'}</small><small className="project-task-role">{taskLink?.relation_role === 'primary' ? 'Proyecto principal de esta tarea' : 'Proyecto adicional de esta tarea'}</small></div><StatusTag status={task.status} /></div>;
            })}</div> : <p className="muted">Todavía no hay tareas vinculadas a este proyecto.</p>}
          </div>
          <div className="task-editor-actions"><button type="button" className="button task-editor-cancel" onClick={() => setSelectedProject(null)}>Cerrar</button><button type="button" className="button button-primary" onClick={() => { setSelectedProject(null); setActivePage('more'); setMorePage('tasks'); }}>Ir a Tareas <span>→</span></button></div>
        </section>
      </div>
    )}
  </>;
}
