import { useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { uuidv7 } from '../../lib/uuidv7.js';
import { useRows } from '../../shared/hooks/useRows.js';
import { SectionTitle } from '../../shared/components/SectionTitle.jsx';
import { EmptyState } from '../../shared/components/EmptyState.jsx';
import { Field } from '../../shared/components/Field.jsx';
import { FormCard } from '../../shared/components/FormCard.jsx';

export function ListsPage({ profile, refreshKey, runAction, busy, setActivePage, setMorePage }) {
  const { rows: lists, loading, localError } = useRows('user_list', profile, refreshKey, (query) => query.is('deleted_at', null).order('created_at', { ascending: false }));
  const { rows: allItems } = useRows('list_item', profile, refreshKey, (query) => query.order('position').order('created_at'));
  const { rows: tasks } = useRows('task', profile, refreshKey, (query) => query.is('deleted_at', null).order('created_at', { ascending: false }));
  const [name, setName] = useState('');
  const [draftItems, setDraftItems] = useState({});
  const [converting, setConverting] = useState(null);
  const [conversionTaskId, setConversionTaskId] = useState(null);
  const [conversionTitle, setConversionTitle] = useState('');
  const [conversionPriority, setConversionPriority] = useState('3');
  const [conversionDueDate, setConversionDueDate] = useState('');

  const createList = async (event) => {
    event.preventDefault();
    if (!name.trim()) return;
    await runAction(async () => {
      const { error: insertError } = await supabase.from('user_list').insert({ id: uuidv7(), owner_user_id: profile.id, created_by_user_id: profile.id, name: name.trim(), status: 'active' });
      if (insertError) throw insertError;
      setName('');
    }, 'Lista creada.');
  };
  const addItem = async (listId) => {
    const content = (draftItems[listId] || '').trim();
    if (!content) return;
    await runAction(async () => {
      const position = allItems.filter((item) => item.list_id === listId).length;
      const { error: insertError } = await supabase.from('list_item').insert({ id: uuidv7(), list_id: listId, content, position, is_checked: false, task_id: null });
      if (insertError) throw insertError;
      setDraftItems((current) => ({ ...current, [listId]: '' }));
    }, 'Elemento añadido.');
  };
  const toggleItem = (item) => runAction(async () => {
    const { error: updateError } = await supabase.from('list_item').update({ is_checked: !item.is_checked }).eq('id', item.id).eq('list_id', item.list_id);
    if (updateError) throw updateError;
  });

  const openConversion = (list, item) => {
    if (item.task_id) return;
    setConverting({ item, listId: list.id, listName: list.name });
    setConversionTaskId(uuidv7());
    setConversionTitle(String(item.content || '').slice(0, 240));
    setConversionPriority('3');
    setConversionDueDate('');
  };
  const closeConversion = () => {
    if (busy) return;
    setConverting(null);
    setConversionTaskId(null);
    setConversionTitle('');
    setConversionPriority('3');
    setConversionDueDate('');
  };

  const ensureTaskRow = async (taskRow) => {
    const { data: existing, error: readError } = await supabase.from('task')
      .select('id').eq('id', taskRow.id).maybeSingle();
    if (readError) throw readError;
    if (existing?.id) return;
    const { data, error } = await supabase.from('task').insert(taskRow).select('id');
    if (error) throw error;
    if (!data?.length) throw new Error('La tarea se creó sin confirmación de lectura. Reintenta desde esta misma ventana para completar el vínculo.');
  };

  const convertItemToTask = async (event) => {
    event.preventDefault();
    if (!converting || !conversionTaskId || !conversionTitle.trim()) return;
    const { item, listId, listName } = converting;
    const taskId = conversionTaskId;
    const sourceText = String(item.content || '');
    const taskRow = {
      id: taskId,
      owner_user_id: profile.id,
      created_by_user_id: profile.id,
      action: conversionTitle.trim(),
      description: sourceText + '\n\nOrigen: elemento de la lista "' + listName + '".',
      status: 'todo',
      priority: Number(conversionPriority),
      due_date: conversionDueDate || null,
      time_zone: 'America/Havana',
    };
    const saved = await runAction(async () => {
      await ensureTaskRow(taskRow);
      const { data, error: updateError } = await supabase.from('list_item')
        .update({ task_id: taskId })
        .eq('id', item.id)
        .eq('list_id', listId)
        .is('task_id', null)
        .select('id');
      if (updateError) throw updateError;
      if (!data?.length) {
        const { data: current, error: readError } = await supabase.from('list_item')
          .select('id, task_id').eq('id', item.id).eq('list_id', listId).maybeSingle();
        if (readError) throw readError;
        if (current?.task_id !== taskId) {
          throw new Error('La tarea se creó, pero el elemento de la lista ya tiene otro vínculo o no pudo actualizarse. Revisa la lista antes de volver a intentarlo.');
        }
      }
    }, 'Tarea creada y vinculada al elemento de la lista.');
    if (saved) closeConversion();
  };

  const openTasks = () => { setMorePage('tasks'); setActivePage('more'); };
  const taskStatusLabels = { todo: 'Pendiente', in_progress: 'En curso', blocked: 'Bloqueada', completed: 'Completada', cancelled: 'Cancelada' };

  return <>
    <div className="management-layout">
      <div className="content-main">
        <SectionTitle detail={lists.length + ' listas'}>Tus listas</SectionTitle>
        {loading ? <p className="muted">Cargando…</p> : localError ? <div className="form-error">{localError}</div> : lists.length ? (
          <div className="lists-grid">{lists.map((list) => {
            const items = allItems.filter((item) => item.list_id === list.id);
            return <div className="list-card" key={list.id}>
              <div className="list-card-head"><span>☷</span><div><h3>{list.name}</h3><small>{items.filter((item) => item.is_checked).length} de {items.length} marcados</small></div></div>
              <div className="list-items">{items.map((item) => {
                const linkedTask = item.task_id ? tasks.find((task) => task.id === item.task_id) : null;
                return <div className="list-item-wrap" key={item.id}>
                  <label className={'list-item ' + (item.is_checked ? 'checked' : '')}>
                    <input type="checkbox" checked={item.is_checked} onChange={() => toggleItem(item)} disabled={busy} />
                    <span>{item.content}</span>
                  </label>
                  <div className="list-item-tools">
                    {item.task_id ? (
                      <>
                        <span className="list-task-link">{linkedTask ? 'Tarea vinculada · ' + (taskStatusLabels[linkedTask.status] || 'Asociada') : 'Tarea vinculada'}</span>
                        <button type="button" className="list-task-action" onClick={openTasks}>Abrir tareas →</button>
                      </>
                    ) : (
                      <button type="button" className="list-task-action" onClick={() => openConversion(list, item)} disabled={busy} aria-label={'Convertir en tarea: ' + item.content}>Convertir en tarea →</button>
                    )}
                  </div>
                </div>;
              })}</div>
              <div className="list-add">
                <input value={draftItems[list.id] || ''} onChange={(event) => setDraftItems((current) => ({ ...current, [list.id]: event.target.value }))} placeholder="Añadir elemento…" onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addItem(list.id); } }} />
                <button type="button" onClick={() => addItem(list.id)} disabled={busy || !(draftItems[list.id] || '').trim()}>+</button>
              </div>
            </div>;
          })}</div>
        ) : <EmptyState title="Sin listas por ahora" detail="Compras, preparativos o cualquier conjunto de elementos que quieras ordenar." icon="☷" />}
      </div>
      <aside className="content-side">
        <FormCard title="Crear una lista" onSubmit={createList} submitLabel="Crear lista" busy={busy}>
          <Field label="Nombre de la lista" name="list" value={name} onChange={(event) => setName(event.target.value)} placeholder="Ej. Compras de la semana" required />
        </FormCard>
        <div className="side-tip"><strong>Una lista no es una tarea.</strong><p>Sus elementos permanecen simples. Cuando decidas convertir uno, se crea una tarea vinculada y el elemento original permanece en la lista.</p></div>
      </aside>
    </div>

    {converting && (
      <div className="task-editor-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) closeConversion(); }} onKeyDown={(event) => { if (event.key === 'Escape' && !busy) closeConversion(); }}>
        <section className="task-editor-dialog" role="dialog" aria-modal="true" aria-labelledby="list-convert-title">
          <div className="task-editor-heading">
            <div><div className="eyebrow">CONSERVA EL ELEMENTO ORIGINAL</div><h2 id="list-convert-title">Convertir en tarea</h2></div>
            <button type="button" className="task-editor-close" onClick={closeConversion} disabled={busy} aria-label="Cerrar conversión">×</button>
          </div>
          <div className="capture-original-preview"><span>ELEMENTO DE LISTA · {converting.listName}</span><p>{converting.item.content}</p></div>
          <form className="task-editor-form" onSubmit={convertItemToTask}>
            <Field label="Título de la tarea" name="conversionTitle" value={conversionTitle} onChange={(event) => setConversionTitle(event.target.value)} required />
            <label className="field"><span>Prioridad</span><select aria-label="Prioridad de la tarea" value={conversionPriority} onChange={(event) => setConversionPriority(event.target.value)} disabled={busy}><option value="1">1 · Muy alta</option><option value="2">2 · Alta</option><option value="3">3 · Normal</option><option value="4">4 · Baja</option><option value="5">5 · Flexible</option></select></label>
            <Field label="Fecha objetivo (opcional)" name="conversionDueDate" type="date" value={conversionDueDate} onChange={(event) => setConversionDueDate(event.target.value)} />
            <p className="task-editor-note">El texto original completo quedará en los detalles de la tarea y el elemento seguirá en esta lista. Si la operación se interrumpe, reintenta desde esta misma ventana para completar el vínculo sin duplicar la tarea.</p>
            <div className="task-editor-actions">
              <button type="button" className="button task-editor-cancel" onClick={closeConversion} disabled={busy}>Cancelar</button>
              <button type="submit" className="button button-primary" disabled={busy || !conversionTitle.trim()}>{busy ? 'Creando tarea…' : 'Crear y vincular tarea'} <span>→</span></button>
            </div>
          </form>
        </section>
      </div>
    )}
  </>;
}
