import { useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { uuidv7 } from '../../lib/uuidv7.js';
import { formatDate } from '../../lib/date-time.js';
import { useRows } from '../../shared/hooks/useRows.js';
import { SectionTitle } from '../../shared/components/SectionTitle.jsx';
import { EmptyState } from '../../shared/components/EmptyState.jsx';
import { Field } from '../../shared/components/Field.jsx';
import { StatusTag } from '../../shared/components/StatusTag.jsx';

export function GoalsPage({ profile, refreshKey, runAction, busy }) {
  const { rows: areas, loading, localError } = useRows('life_area', profile, refreshKey, (query) => query.is('deleted_at', null).order('position').order('created_at'));
  const { rows: goals } = useRows('goal', profile, refreshKey, (query) => query.is('deleted_at', null).order('created_at', { ascending: false }));
  const { rows: subgoals } = useRows('subgoal', profile, refreshKey, (query) => query.is('deleted_at', null).order('created_at'));
  const { rows: tasks } = useRows('task', profile, refreshKey, (query) => query.is('deleted_at', null).order('created_at', { ascending: false }));
  const { rows: projects } = useRows('project', profile, refreshKey, (query) => query.is('deleted_at', null));
  const { rows: contributionRelations } = useRows('contribution_relation', profile, refreshKey);
  const [activeView, setActiveView] = useState('areas');
  const [areaTitle, setAreaTitle] = useState('');
  const [areaDescription, setAreaDescription] = useState('');
  const [editingArea, setEditingArea] = useState(null);
  const [selectedArea, setSelectedArea] = useState('');
  const [goalTitle, setGoalTitle] = useState('');
  const [goalReason, setGoalReason] = useState('');
  const [expectedResult, setExpectedResult] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [editingGoal, setEditingGoal] = useState(null);
  const [editingSubgoal, setEditingSubgoal] = useState(null);
  const [subgoalTitle, setSubgoalTitle] = useState('');
  const [subgoalExpectedResult, setSubgoalExpectedResult] = useState('');
  const [subgoalTargetDate, setSubgoalTargetDate] = useState('');
  const [showAreaModal, setShowAreaModal] = useState(false);
  const [showGoalModal, setShowGoalModal] = useState(false);
  const [showSubgoalModal, setShowSubgoalModal] = useState(false);
  const [subgoalGoalFilter, setSubgoalGoalFilter] = useState('all');
  const [newSubgoalGoalId, setNewSubgoalGoalId] = useState('');
  const [newSubgoalTitle, setNewSubgoalTitle] = useState('');
  const [newSubgoalExpectedResult, setNewSubgoalExpectedResult] = useState('');
  const [newSubgoalTargetDate, setNewSubgoalTargetDate] = useState('');

  const closeAreaModal = () => { if (busy) return; setShowAreaModal(false); setEditingArea(null); setAreaTitle(''); setAreaDescription(''); };
  const closeGoalModal = () => { if (busy) return; setShowGoalModal(false); setEditingGoal(null); setSelectedArea(''); setGoalTitle(''); setGoalReason(''); setExpectedResult(''); setTargetDate(''); };
  const closeSubgoalModal = () => {
    if (busy) return;
    setShowSubgoalModal(false); setNewSubgoalGoalId(''); setNewSubgoalTitle(''); setNewSubgoalExpectedResult(''); setNewSubgoalTargetDate('');
  };
  const openAreaEditor = (area) => { setEditingArea(area); setAreaTitle(area.title || ''); setAreaDescription(area.description || ''); setShowAreaModal(true); };
  const openGoalEditor = (goal) => { setEditingGoal(goal); setSelectedArea(goal.life_area_id || ''); setGoalTitle(goal.title || ''); setGoalReason(goal.reason || ''); setExpectedResult(goal.expected_result || ''); setTargetDate(goal.target_date || ''); setShowGoalModal(true); };
  const openSubgoalEditor = (subgoal) => { setEditingSubgoal(subgoal); setSubgoalTitle(subgoal.title || ''); setSubgoalExpectedResult(subgoal.expected_result || ''); setSubgoalTargetDate(subgoal.target_date || ''); };

  const saveArea = async (event) => {
    event.preventDefault();
    const title = areaTitle.trim();
    if (!title) return;
    const saved = await runAction(async () => {
      const payload = { title, description: areaDescription.trim() || null };
      if (editingArea) {
        const { data, error } = await supabase.from('life_area').update(payload).eq('id', editingArea.id).eq('owner_user_id', profile.id).is('deleted_at', null).select('id');
        if (error) throw error;
        if (!data?.length) throw new Error('No se pudo actualizar el área. Actualiza la vista e inténtalo de nuevo.');
      } else {
        const { error } = await supabase.from('life_area').insert({ id: uuidv7(), owner_user_id: profile.id, created_by_user_id: profile.id, title, description: payload.description });
        if (error) throw error;
      }
    }, editingArea ? 'Área actualizada.' : 'Área creada.');
    if (!saved) return;
    closeAreaModal();
  };

  const setAreaStatus = (area) => runAction(async () => {
    const nextStatus = area.status === 'paused' ? 'active' : 'paused';
    const { data, error } = await supabase.from('life_area').update({ status: nextStatus }).eq('id', area.id).eq('owner_user_id', profile.id).is('deleted_at', null).select('id');
    if (error) throw error;
    if (!data?.length) throw new Error('No se pudo cambiar el estado del área.');
  }, area.status === 'paused' ? 'Área reactivada.' : 'Área pausada.');

  const moveArea = (area, direction) => runAction(async () => {
    const currentIndex = areas.findIndex((item) => item.id === area.id);
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= areas.length) return;
    const reordered = [...areas];
    [reordered[currentIndex], reordered[nextIndex]] = [reordered[nextIndex], reordered[currentIndex]];
    // Normalize every position, including rows whose old position was NULL.
    for (let index = 0; index < reordered.length; index += 1) {
      const item = reordered[index];
      const { data, error } = await supabase.from('life_area').update({ position: index })
        .eq('id', item.id).eq('owner_user_id', profile.id).is('deleted_at', null).select('id');
      if (error) throw error;
      if (!data?.length) throw new Error('No se pudo guardar el nuevo orden de las áreas. Actualiza la vista e inténtalo de nuevo.');
    }
  }, direction < 0 ? 'Área movida hacia arriba. Orden guardado.' : 'Área movida hacia abajo. Orden guardado.');

  const saveGoal = async (event) => {
    event.preventDefault();
    if (!selectedArea || !goalTitle.trim()) return;
    const saved = await runAction(async () => {
      const payload = { life_area_id: selectedArea, title: goalTitle.trim(), reason: goalReason.trim() || null, expected_result: expectedResult.trim() || null, target_date: targetDate || null };
      if (editingGoal) {
        const { data, error } = await supabase.from('goal').update(payload).eq('id', editingGoal.id).eq('owner_user_id', profile.id).is('deleted_at', null).select('id');
        if (error) throw error;
        if (!data?.length) throw new Error('No se pudo actualizar la meta. Actualiza la vista e inténtalo de nuevo.');
      } else {
        const { error } = await supabase.from('goal').insert({ id: uuidv7(), owner_user_id: profile.id, created_by_user_id: profile.id, ...payload, status: 'active' });
        if (error) throw error;
      }
    }, editingGoal ? 'Meta actualizada.' : 'Meta creada.');
    if (!saved) return;
    closeGoalModal();
  };

  const setGoalStatus = (goal, status) => runAction(async () => {
    const { data, error } = await supabase.from('goal').update({ status }).eq('id', goal.id).eq('owner_user_id', profile.id).is('deleted_at', null).select('id');
    if (error) throw error;
    if (!data?.length) throw new Error('No se pudo actualizar el estado de la meta.');
  }, status === 'completed' ? 'Meta completada.' : status === 'paused' ? 'Meta pausada.' : status === 'active' ? 'Meta reactivada.' : 'Estado de la meta actualizado.');

  const createSubgoal = async (event) => {
    event.preventDefault();
    if (!newSubgoalGoalId || !newSubgoalTitle.trim()) return;
    const saved = await runAction(async () => {
      const payload = {
        id: uuidv7(), goal_id: newSubgoalGoalId, created_by_user_id: profile.id,
        title: newSubgoalTitle.trim(), expected_result: newSubgoalExpectedResult.trim() || null,
        target_date: newSubgoalTargetDate || null, status: 'active',
      };
      const { error } = await supabase.from('subgoal').insert(payload);
      if (error) throw error;
    }, 'Submeta creada.');
    if (saved) closeSubgoalModal();
  };

  const saveSubgoal = async (event) => {
    event.preventDefault();
    if (!editingSubgoal || !subgoalTitle.trim()) return;
    const saved = await runAction(async () => {
      const payload = { title: subgoalTitle.trim(), expected_result: subgoalExpectedResult.trim() || null, target_date: subgoalTargetDate || null };
      const { data, error } = await supabase.from('subgoal').update(payload).eq('id', editingSubgoal.id).eq('goal_id', editingSubgoal.goal_id).is('deleted_at', null).select('id');
      if (error) throw error;
      if (!data?.length) throw new Error('No se pudo actualizar la submeta.');
    }, 'Submeta actualizada.');
    if (saved) setEditingSubgoal(null);
  };

  const setSubgoalStatus = (subgoal, status) => runAction(async () => {
    const { data, error } = await supabase.from('subgoal').update({ status }).eq('id', subgoal.id).eq('goal_id', subgoal.goal_id).is('deleted_at', null).select('id');
    if (error) throw error;
    if (!data?.length) throw new Error('No se pudo actualizar el estado de la submeta.');
  }, status === 'completed' ? 'Submeta completada.' : status === 'active' ? 'Submeta reactivada.' : status === 'paused' ? 'Submeta pausada.' : 'Estado de la submeta actualizado.');

  const openNewSubgoal = (goalId) => {
    setNewSubgoalGoalId(goalId || (subgoalGoalFilter !== 'all' ? subgoalGoalFilter : (goals[0]?.id || '')));
    setShowSubgoalModal(true);
  };
  const visibleSubgoals = subgoals.filter((subgoal) => subgoalGoalFilter === 'all' || subgoal.goal_id === subgoalGoalFilter);
  const viewHeading = activeView === 'areas' ? 'Tus áreas de vida' : activeView === 'goals' ? 'Tus metas' : 'Tus submetas';

  return <>
    <div className="management-layout management-layout-single">
      <div className="content-main">
        <div className="goals-page-intro">
          <SectionTitle detail={areas.length + ' áreas · ' + goals.length + ' metas · ' + subgoals.length + ' submetas'}>Organiza tu vida</SectionTitle>
        </div>
        <div className="life-view-tabs" role="group" aria-label="Apartados de objetivos">
          <button type="button" className={activeView === 'areas' ? 'life-view-tab active' : 'life-view-tab'} aria-pressed={activeView === 'areas'} onClick={() => setActiveView('areas')}>Áreas</button>
          <button type="button" className={activeView === 'goals' ? 'life-view-tab active' : 'life-view-tab'} aria-pressed={activeView === 'goals'} onClick={() => setActiveView('goals')}>Metas</button>
          <button type="button" className={activeView === 'subgoals' ? 'life-view-tab active' : 'life-view-tab'} aria-pressed={activeView === 'subgoals'} onClick={() => setActiveView('subgoals')}>Submetas</button>
        </div>
        <div className="section-heading-row goals-section-heading">
          <SectionTitle detail={activeView === 'areas' ? 'Ordena y administra los ámbitos importantes de tu vida.' : activeView === 'goals' ? 'Cada meta tiene un resultado, un motivo y una fecha objetivo.' : 'Desglosa cada meta en pasos concretos que puedas completar.'}>{viewHeading}</SectionTitle>
          <div className="section-create-actions">
            {activeView === 'areas' && <button type="button" className="section-create-button" onClick={() => setShowAreaModal(true)}>Nueva Área</button>}
            {activeView === 'goals' && <button type="button" className="section-create-button" onClick={() => setShowGoalModal(true)}>Nueva Meta</button>}
            {activeView === 'subgoals' && <button type="button" className="section-create-button" onClick={() => openNewSubgoal('')} disabled={!goals.length || busy}>Nueva Submeta</button>}
          </div>
        </div>

        {loading && activeView === 'areas' ? <p className="muted">Cargando áreas…</p> : localError && activeView === 'areas' ? <div className="form-error">{localError}</div> : <>
          {activeView === 'areas' && (areas.length ? <div className="area-grid">{areas.map((area, areaIndex) => {
            const areaGoals = goals.filter((goal) => goal.life_area_id === area.id);
            return <div className="area-card" key={area.id}>
              <div className="area-card-top"><span className="area-symbol">◎</span><span className="area-count">Posición {areaIndex + 1} de {areas.length}</span></div>
              <div className="area-heading-edit"><div><h3>{area.title}</h3>{area.description && <p>{area.description}</p>}</div><button type="button" className="task-edit-button" onClick={() => openAreaEditor(area)} aria-label={'Editar área: ' + area.title}>Editar área</button></div>
              <div className="area-area-summary"><strong>{areaGoals.length} {areaGoals.length === 1 ? 'meta asociada' : 'metas asociadas'}</strong><button type="button" className="text-button" onClick={() => { setSubgoalGoalFilter('all'); setActiveView('goals'); }}>Ver todas las metas →</button></div>
              <div className="area-inline-actions"><StatusTag status={area.status || 'active'} /><div className="area-management-actions"><button type="button" className="text-button" disabled={busy || areaIndex === 0} onClick={() => moveArea(area, -1)} aria-label={'Mover área arriba: ' + area.title}>↑ Subir</button><button type="button" className="text-button" disabled={busy || areaIndex === areas.length - 1} onClick={() => moveArea(area, 1)} aria-label={'Mover área abajo: ' + area.title}>↓ Bajar</button><button type="button" className="text-button" disabled={busy} onClick={() => setAreaStatus(area)}>{area.status === 'paused' ? 'Reactivar área' : 'Pausar área'}</button></div></div>
            </div>;
          })}</div> : <EmptyState title="Empieza por tus áreas" detail="Crea ámbitos para ordenar lo que importa en tu vida." />)}

          {activeView === 'goals' && (goals.length ? <div className="goal-catalog-grid">{goals.map((goal, goalIndex) => {
            const area = areas.find((item) => item.id === goal.life_area_id);
            const goalSubgoals = subgoals.filter((subgoal) => subgoal.goal_id === goal.id);
            const goalProjects = contributionRelations.filter((relation) => relation.goal_id === goal.id && relation.project_id && relation.relation_status === 'confirmed').map((relation) => projects.find((project) => project.id === relation.project_id)).filter(Boolean);
            const goalTaskRows = tasks.filter((task) => contributionRelations.some((relation) => relation.task_id === task.id && relation.relation_status === 'confirmed' && (relation.goal_id === goal.id || goalSubgoals.some((subgoal) => relation.subgoal_id === subgoal.id))));
            return <article className="goal-record-card" key={goal.id}>
              <div className="goal-record-heading"><div><span className="record-eyebrow">META {goalIndex + 1}</span><h3>{goal.title}</h3><p>Área: {area?.title || 'Área no disponible'}</p></div><button type="button" className="task-edit-button" onClick={() => openGoalEditor(goal)} aria-label={'Editar meta: ' + goal.title}>Editar meta</button></div>
              <div className="goal-record-details">
                <div><span>Resultado esperado</span><p>{goal.expected_result || 'Aún no definido'}</p></div>
                <div><span>Motivo</span><p>{goal.reason || 'Aún no indicado'}</p></div>
                <div><span>Fecha objetivo</span><p>{goal.target_date ? formatDate(goal.target_date) : 'Sin fecha'}</p></div>
              </div>
              <div className="goal-related-projects"><span>Proyectos vinculados</span>{goalProjects.length ? <div>{goalProjects.map((project) => <span className="goal-related-project-tag" key={project.id}>{project.name}</span>)}</div> : <small>Sin proyectos vinculados</small>}</div>
              <div className="goal-related-tasks"><span>Tareas que contribuyen · {goalTaskRows.length}</span>{goalTaskRows.length ? <div>{goalTaskRows.slice(0, 4).map((task) => <span className="goal-related-task-tag" key={task.id}><strong>{task.action}</strong><small>{task.archived_at ? 'Archivada' : task.status === 'completed' ? 'Completada' : task.status === 'in_progress' ? 'En curso' : task.status === 'blocked' ? 'Bloqueada' : 'Pendiente'}</small></span>)}{goalTaskRows.length > 4 && <small>+{goalTaskRows.length - 4} tareas más</small>}</div> : <small>Sin tareas vinculadas</small>}</div>
              <div className="goal-record-footer">
                <label className="record-status-field"><span>Estado de la meta</span><select aria-label={'Estado de meta: ' + goal.title} value={goal.status || 'active'} disabled={busy} onChange={(event) => setGoalStatus(goal, event.target.value)}><option value="draft">Borrador</option><option value="active">Activa</option><option value="paused">En pausa</option><option value="completed">Completada</option><option value="cancelled">Cancelada</option></select></label>
                <button type="button" className="text-button" onClick={() => { setSubgoalGoalFilter(goal.id); setActiveView('subgoals'); }}>Ver {goalSubgoals.length} submetas →</button>
              </div>
            </article>;
          })}</div> : <EmptyState title="Todavía no tienes metas" detail="Pulsa Nueva Meta para crear la primera y asociarla a un área." />)}

          {activeView === 'subgoals' && (goals.length ? <>
            <div className="subgoal-toolbar">
              <label className="goal-filter-field"><span>Mostrar submetas de</span><select aria-label="Filtrar submetas por meta" value={subgoalGoalFilter} onChange={(event) => setSubgoalGoalFilter(event.target.value)}><option value="all">Todas las metas</option>{goals.map((goal) => <option key={goal.id} value={goal.id}>{goal.title}</option>)}</select></label>
            </div>
            {visibleSubgoals.length ? <div className="subgoal-catalog-grid">{visibleSubgoals.map((subgoal, subgoalIndex) => {
              const parentGoal = goals.find((goal) => goal.id === subgoal.goal_id);
              const subgoalProjects = contributionRelations.filter((relation) => relation.subgoal_id === subgoal.id && relation.project_id && relation.relation_status === 'confirmed').map((relation) => projects.find((project) => project.id === relation.project_id)).filter(Boolean);
              const subgoalTaskRows = tasks.filter((task) => contributionRelations.some((relation) => relation.task_id === task.id && relation.subgoal_id === subgoal.id && relation.relation_status === 'confirmed'));
              return <article className="subgoal-record-card" key={subgoal.id}>
                <div className="goal-record-heading"><div><span className="record-eyebrow">SUBMETA {subgoalIndex + 1}</span><h3>{subgoal.title}</h3><p>Meta: {parentGoal?.title || 'Meta no disponible'}</p></div><button type="button" className="task-edit-button" onClick={() => openSubgoalEditor(subgoal)} aria-label={'Editar submeta: ' + subgoal.title}>Editar submeta</button></div>
                <div className="goal-record-details">
                  <div><span>Resultado esperado</span><p>{subgoal.expected_result || 'Aún no definido'}</p></div>
                  <div><span>Fecha objetivo</span><p>{subgoal.target_date ? formatDate(subgoal.target_date) : 'Sin fecha'}</p></div>
                </div>
                <div className="goal-related-projects"><span>Proyectos vinculados</span>{subgoalProjects.length ? <div>{subgoalProjects.map((project) => <span className="goal-related-project-tag" key={project.id}>{project.name}</span>)}</div> : <small>Sin proyectos vinculados</small>}</div>
                <div className="goal-related-tasks"><span>Tareas que contribuyen · {subgoalTaskRows.length}</span>{subgoalTaskRows.length ? <div>{subgoalTaskRows.slice(0, 4).map((task) => <span className="goal-related-task-tag" key={task.id}><strong>{task.action}</strong><small>{task.archived_at ? 'Archivada' : task.status === 'completed' ? 'Completada' : task.status === 'in_progress' ? 'En curso' : task.status === 'blocked' ? 'Bloqueada' : 'Pendiente'}</small></span>)}{subgoalTaskRows.length > 4 && <small>+{subgoalTaskRows.length - 4} tareas más</small>}</div> : <small>Sin tareas vinculadas</small>}</div>
                <div className="goal-record-footer"><label className="record-status-field"><span>Estado de la submeta</span><select aria-label={'Estado de submeta: ' + subgoal.title} value={subgoal.status || 'active'} disabled={busy} onChange={(event) => setSubgoalStatus(subgoal, event.target.value)}><option value="draft">Borrador</option><option value="active">Activa</option><option value="paused">En pausa</option><option value="completed">Completada</option><option value="cancelled">Cancelada</option></select></label></div>
              </article>;
            })}</div> : <EmptyState title="Esta meta todavía no tiene submetas" detail="Pulsa Nueva Submeta para desglosarla en acciones concretas." />}
          </> : <EmptyState title="Primero crea una meta" detail="Las submetas siempre pertenecen a una meta existente." />)}
        </>}
      </div>
    </div>

    {showAreaModal && <div className="task-editor-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) closeAreaModal(); }} onKeyDown={(event) => { if (event.key === 'Escape' && !busy) closeAreaModal(); }}>
      <section className="task-editor-dialog floating-form-dialog" role="dialog" aria-modal="true" aria-labelledby="area-editor-title">
        <div className="task-editor-heading"><div><div className="eyebrow">ORGANIZA TU VIDA</div><h2 id="area-editor-title">{editingArea ? 'Editar área' : 'Nueva área'}</h2></div><button type="button" className="task-editor-close" onClick={closeAreaModal} disabled={busy} aria-label="Cerrar área">×</button></div>
        <form className="task-editor-form" onSubmit={saveArea}>
          <Field label="Nombre del área" name="area" value={areaTitle} onChange={(event) => setAreaTitle(event.target.value)} placeholder="Ej. Finanzas, físico, familia…" required />
          <Field label="Descripción (opcional)" name="areaDescription" value={areaDescription} onChange={(event) => setAreaDescription(event.target.value)} placeholder="Qué representa esta área…" />
          <div className="task-editor-actions"><button type="button" className="button task-editor-cancel" onClick={closeAreaModal} disabled={busy}>Cancelar</button><button type="submit" className="button button-primary" disabled={busy || !areaTitle.trim()}>{busy ? 'Guardando…' : editingArea ? 'Guardar cambios' : 'Crear área'} <span>→</span></button></div>
        </form>
      </section>
    </div>}

    {showGoalModal && <div className="task-editor-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) closeGoalModal(); }} onKeyDown={(event) => { if (event.key === 'Escape' && !busy) closeGoalModal(); }}>
      <section className="task-editor-dialog floating-form-dialog" role="dialog" aria-modal="true" aria-labelledby="goal-editor-title">
        <div className="task-editor-heading"><div><div className="eyebrow">DEFINE LO QUE BUSCAS</div><h2 id="goal-editor-title">{editingGoal ? 'Editar meta' : 'Nueva meta'}</h2></div><button type="button" className="task-editor-close" onClick={closeGoalModal} disabled={busy} aria-label="Cerrar meta">×</button></div>
        <form className="task-editor-form" onSubmit={saveGoal}>
          <label className="field"><span>Área de vida</span><select required value={selectedArea} onChange={(event) => setSelectedArea(event.target.value)}><option value="">Selecciona un área</option>{areas.map((area) => <option key={area.id} value={area.id}>{area.title}</option>)}</select></label>
          {areas.length === 0 && <p className="task-editor-note">Primero crea un área de vida para poder asociar esta meta.</p>}
          <Field label="Resultado que buscas" name="goal" value={goalTitle} onChange={(event) => setGoalTitle(event.target.value)} placeholder="Ej. Ahorrar 2.000 €" required />
          <Field label="Resultado esperado (opcional)" name="expectedResult" value={expectedResult} onChange={(event) => setExpectedResult(event.target.value)} placeholder="Cómo sabrás que lo lograste…" />
          <Field label="Motivo (opcional)" name="reason" value={goalReason} onChange={(event) => setGoalReason(event.target.value)} placeholder="¿Por qué es importante?" />
          <Field label="Fecha objetivo (opcional)" name="targetDate" type="date" value={targetDate} onChange={(event) => setTargetDate(event.target.value)} />
          <div className="task-editor-actions"><button type="button" className="button task-editor-cancel" onClick={closeGoalModal} disabled={busy}>Cancelar</button><button type="submit" className="button button-primary" disabled={busy || areas.length === 0 || !selectedArea || !goalTitle.trim()}>{busy ? 'Guardando…' : editingGoal ? 'Guardar cambios' : 'Crear meta'} <span>→</span></button></div>
        </form>
      </section>
    </div>}

    {showSubgoalModal && <div className="task-editor-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) closeSubgoalModal(); }} onKeyDown={(event) => { if (event.key === 'Escape' && !busy) closeSubgoalModal(); }}>
      <section className="task-editor-dialog floating-form-dialog" role="dialog" aria-modal="true" aria-labelledby="new-subgoal-title">
        <div className="task-editor-heading"><div><div className="eyebrow">CONVIERTE LA META EN PASOS</div><h2 id="new-subgoal-title">Nueva submeta</h2></div><button type="button" className="task-editor-close" onClick={closeSubgoalModal} disabled={busy} aria-label="Cerrar nueva submeta">×</button></div>
        <form className="task-editor-form" onSubmit={createSubgoal}>
          <label className="field"><span>Meta a la que pertenece</span><select aria-label="Meta a la que pertenece" required value={newSubgoalGoalId} onChange={(event) => setNewSubgoalGoalId(event.target.value)}><option value="">Selecciona una meta</option>{goals.map((goal) => <option key={goal.id} value={goal.id}>{goal.title}</option>)}</select></label>
          <Field label="Nombre de la submeta" name="newSubgoalTitle" value={newSubgoalTitle} onChange={(event) => setNewSubgoalTitle(event.target.value)} placeholder="Ej. Ahorrar una cantidad fija cada mes" required />
          <Field label="Resultado esperado (opcional)" name="newSubgoalExpected" value={newSubgoalExpectedResult} onChange={(event) => setNewSubgoalExpectedResult(event.target.value)} />
          <Field label="Fecha objetivo (opcional)" name="newSubgoalTargetDate" type="date" value={newSubgoalTargetDate} onChange={(event) => setNewSubgoalTargetDate(event.target.value)} />
          <div className="task-editor-actions"><button type="button" className="button task-editor-cancel" onClick={closeSubgoalModal} disabled={busy}>Cancelar</button><button type="submit" className="button button-primary" disabled={busy || !newSubgoalGoalId || !newSubgoalTitle.trim()}>{busy ? 'Guardando…' : 'Crear submeta'} <span>→</span></button></div>
        </form>
      </section>
    </div>}

    {editingSubgoal && <div className="task-editor-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setEditingSubgoal(null); }} onKeyDown={(event) => { if (event.key === 'Escape' && !busy) setEditingSubgoal(null); }}>
      <section className="task-editor-dialog floating-form-dialog" role="dialog" aria-modal="true" aria-labelledby="subgoal-editor-title">
        <div className="task-editor-heading"><div><div className="eyebrow">DESGLOSA TU META</div><h2 id="subgoal-editor-title">Editar submeta</h2></div><button type="button" className="task-editor-close" onClick={() => setEditingSubgoal(null)} disabled={busy} aria-label="Cerrar submeta">×</button></div>
        <form className="task-editor-form" onSubmit={saveSubgoal}>
          <Field label="Nombre de la submeta" name="subgoalTitle" value={subgoalTitle} onChange={(event) => setSubgoalTitle(event.target.value)} required />
          <Field label="Resultado esperado (opcional)" name="subgoalExpectedResult" value={subgoalExpectedResult} onChange={(event) => setSubgoalExpectedResult(event.target.value)} />
          <Field label="Fecha objetivo (opcional)" name="subgoalTargetDate" type="date" value={subgoalTargetDate} onChange={(event) => setSubgoalTargetDate(event.target.value)} />
          <div className="task-editor-actions"><button type="button" className="button task-editor-cancel" onClick={() => setEditingSubgoal(null)} disabled={busy}>Cancelar</button><button type="submit" className="button button-primary" disabled={busy || !subgoalTitle.trim()}>Guardar cambios <span>→</span></button></div>
        </form>
      </section>
    </div>}
  </>;
}
