import { useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { uuidv7 } from '../../lib/uuidv7.js';
import { useRows } from '../../shared/hooks/useRows.js';
import { SectionTitle } from '../../shared/components/SectionTitle.jsx';
import { EmptyState } from '../../shared/components/EmptyState.jsx';
import { Field } from '../../shared/components/Field.jsx';
import { TextAreaField } from '../../shared/components/TextAreaField.jsx';

function isArchived(list) {
  return Boolean(list.archived_at) || list.status === 'archived';
}

export function ListsPage({ profile, refreshKey, runAction, busy, setActivePage, setMorePage }) {
  const { rows: lists, loading, localError } = useRows('user_list', profile, refreshKey, (query) => query.is('deleted_at', null).order('created_at', { ascending: false }));
  const { rows: allItems, loading: itemsLoading, localError: itemsError } = useRows('list_item', profile, refreshKey, (query) => query.order('position').order('created_at'));
  const { rows: tasks } = useRows('task', profile, refreshKey, (query) => query.is('deleted_at', null).order('created_at', { ascending: false }));
  const [name, setName] = useState('');
  const [purpose, setPurpose] = useState('');
  const [draftItems, setDraftItems] = useState({});
  const [searchTerm, setSearchTerm] = useState('');
  const [archiveFilter, setArchiveFilter] = useState('active');
  const [showNewList, setShowNewList] = useState(false);
  const [editingList, setEditingList] = useState(null);
  const [editListName, setEditListName] = useState('');
  const [editListPurpose, setEditListPurpose] = useState('');
  const [editingItem, setEditingItem] = useState(null);
  const [editItemContent, setEditItemContent] = useState('');
  const [converting, setConverting] = useState(null);
  const [conversionTaskId, setConversionTaskId] = useState(null);
  const [conversionTitle, setConversionTitle] = useState('');
  const [conversionPriority, setConversionPriority] = useState('3');
  const [conversionDueDate, setConversionDueDate] = useState('');

  const visibleLists = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLocaleLowerCase('es');
    return lists.filter((list) => {
      const archived = isArchived(list);
      const matchesArchive = archiveFilter === 'all'
        || (archiveFilter === 'active' && !archived)
        || (archiveFilter === 'archived' && archived);
      const matchesSearch = !normalizedSearch
        || `${list.name || ''}\n${list.purpose || ''}`.toLocaleLowerCase('es').includes(normalizedSearch);
      return matchesArchive && matchesSearch;
    });
  }, [lists, searchTerm, archiveFilter]);

  const createList = async (event) => {
    event.preventDefault();
    if (!name.trim()) return;
    await runAction(async () => {
      const { error: insertError } = await supabase.from('user_list').insert({
        id: uuidv7(),
        owner_user_id: profile.id,
        created_by_user_id: profile.id,
        name: name.trim(),
        purpose: purpose.trim() || null,
        status: 'active',
      });
      if (insertError) throw insertError;
      setName('');
      setPurpose('');
      setShowNewList(false);
    }, 'Lista creada.');
  };

  const closeNewList = () => {
    if (busy) return;
    setShowNewList(false);
    setName('');
    setPurpose('');
  };

  const addItem = async (listId) => {
    const content = (draftItems[listId] || '').trim();
    if (!content) return;
    await runAction(async () => {
      const currentItems = allItems.filter((item) => item.list_id === listId);
      const position = currentItems.length ? Math.max(...currentItems.map((item) => Number(item.position) || 0)) + 1 : 0;
      const { error: insertError } = await supabase.from('list_item').insert({
        id: uuidv7(),
        list_id: listId,
        content,
        position,
        is_checked: false,
        task_id: null,
      });
      if (insertError) throw insertError;
      setDraftItems((current) => ({ ...current, [listId]: '' }));
    }, 'Elemento añadido.');
  };

  const toggleItem = (item) => runAction(async () => {
    const { data, error: updateError } = await supabase.from('list_item')
      .update({ is_checked: !item.is_checked })
      .eq('id', item.id)
      .eq('list_id', item.list_id)
      .select('id');
    if (updateError) throw updateError;
    if (!data?.length) throw new Error('No se pudo actualizar el elemento de la lista.');
  });

  const openListEditor = (list) => {
    setEditingList(list);
    setEditListName(list.name || '');
    setEditListPurpose(list.purpose || '');
  };
  const closeListEditor = () => {
    if (!busy) setEditingList(null);
  };
  const saveList = async (event) => {
    event.preventDefault();
    if (!editingList || !editListName.trim()) return;
    await runAction(async () => {
      const { data, error: updateError } = await supabase.from('user_list')
        .update({ name: editListName.trim(), purpose: editListPurpose.trim() || null })
        .eq('id', editingList.id)
        .eq('owner_user_id', profile.id)
        .is('deleted_at', null)
        .select('id');
      if (updateError) throw updateError;
      if (!data?.length) throw new Error('No se pudo actualizar la lista. Puede que ya no exista o no pertenezca a esta cuenta.');
      setEditingList(null);
    }, 'Lista actualizada.');
  };

  const toggleListArchive = (list) => runAction(async () => {
    const archived = !isArchived(list);
    const { data, error: updateError } = await supabase.from('user_list')
      .update({ status: archived ? 'archived' : 'active', archived_at: archived ? new Date().toISOString() : null })
      .eq('id', list.id)
      .eq('owner_user_id', profile.id)
      .is('deleted_at', null)
      .select('id');
    if (updateError) throw updateError;
    if (!data?.length) throw new Error('No se pudo cambiar el archivo de la lista.');
  }, isArchived(list) ? 'Lista restaurada.' : 'Lista archivada.');

  const openItemEditor = (item) => {
    setEditingItem(item);
    setEditItemContent(item.content || '');
  };
  const closeItemEditor = () => {
    if (!busy) setEditingItem(null);
  };
  const saveItem = async (event) => {
    event.preventDefault();
    if (!editingItem || !editItemContent.trim()) return;
    await runAction(async () => {
      const { data, error: updateError } = await supabase.from('list_item')
        .update({ content: editItemContent.trim() })
        .eq('id', editingItem.id)
        .eq('list_id', editingItem.list_id)
        .select('id');
      if (updateError) throw updateError;
      if (!data?.length) throw new Error('No se pudo actualizar el elemento de la lista.');
      setEditingItem(null);
    }, 'Elemento actualizado.');
  };

  const moveItem = (listId, item, direction) => {
    const items = allItems.filter((row) => row.list_id === listId)
      .sort((a, b) => (Number(a.position) || 0) - (Number(b.position) || 0)
        || String(a.created_at || '').localeCompare(String(b.created_at || '')));
    const index = items.findIndex((row) => row.id === item.id);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= items.length) return;
    const neighbor = items[targetIndex];
    const itemPosition = Number(item.position) || 0;
    const neighborPosition = Number(neighbor.position) || 0;

    return runAction(async () => {
      const first = await supabase.from('list_item')
        .update({ position: itemPosition })
        .eq('id', neighbor.id)
        .eq('list_id', listId)
        .select('id');
      if (first.error) throw first.error;
      if (!first.data?.length) throw new Error('No se pudo mover el elemento seleccionado.');

      const second = await supabase.from('list_item')
        .update({ position: neighborPosition })
        .eq('id', item.id)
        .eq('list_id', listId)
        .select('id');
      if (second.error || !second.data?.length) {
        // Best-effort compensation: restore the neighbor's original position if the swap is interrupted.
        await supabase.from('list_item')
          .update({ position: neighborPosition })
          .eq('id', neighbor.id)
          .eq('list_id', listId);
        if (second.error) throw second.error;
        throw new Error('No se pudo completar el cambio de orden. Actualiza la lista e inténtalo de nuevo.');
      }
    }, 'Orden de elementos actualizado.');
  };

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
  const countDetail = visibleLists.length === lists.length
    ? `${lists.length} listas`
    : `${visibleLists.length} de ${lists.length} listas`;

  return <>
    <div className="management-layout management-layout-single">
      <div className="content-main">
        <div className="section-heading-row">
          <SectionTitle detail={countDetail}>Tus listas</SectionTitle>
          <div className="section-create-actions">
            <button type="button" className="section-create-button" onClick={() => setShowNewList(true)} disabled={busy}>Nueva lista</button>
          </div>
        </div>
        <div className="lists-toolbar" role="search" aria-label="Buscar y filtrar listas">
          <label className="lists-toolbar-field" htmlFor="lists-search">
            <span>Buscar</span>
            <input id="lists-search" type="search" aria-label="Buscar listas" placeholder="Nombre o propósito…" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} />
          </label>
          <label className="lists-toolbar-field" htmlFor="lists-archive-filter">
            <span>Archivo</span>
            <select id="lists-archive-filter" aria-label="Filtrar listas por archivo" value={archiveFilter} onChange={(event) => setArchiveFilter(event.target.value)}>
              <option value="active">Sin archivar</option>
              <option value="archived">Archivadas</option>
              <option value="all">Todas</option>
            </select>
          </label>
        </div>
        {loading || itemsLoading ? <p className="muted">Cargando…</p> : (localError || itemsError) ? <div className="form-error">{localError || itemsError}</div> : lists.length ? (
          visibleLists.length ? (
            <div className="lists-grid">{visibleLists.map((list) => {
              const items = allItems.filter((item) => item.list_id === list.id)
                .sort((a, b) => (Number(a.position) || 0) - (Number(b.position) || 0)
                  || String(a.created_at || '').localeCompare(String(b.created_at || '')));
              const archived = isArchived(list);
              return <div className={`list-card ${archived ? 'list-card-archived' : ''}`} key={list.id}>
                <div className="list-card-head">
                  <span>☷</span>
                  <div className="list-card-title">
                    <h3>{list.name}</h3>
                    <small>{items.filter((item) => item.is_checked).length} de {items.length} marcados</small>
                    {list.purpose && <p>{list.purpose}</p>}
                    {archived && <em className="list-archive-tag">ARCHIVADA</em>}
                  </div>
                  <div className="list-card-actions">
                    <button type="button" className="list-management-action" onClick={() => openListEditor(list)} disabled={busy || archived} aria-label={`Editar lista: ${list.name}`}>Editar</button>
                    <button type="button" className="list-management-action" onClick={() => toggleListArchive(list)} disabled={busy} aria-label={`${archived ? 'Restaurar' : 'Archivar'} lista: ${list.name}`}>{archived ? 'Restaurar' : 'Archivar'}</button>
                  </div>
                </div>
                <div className="list-items">{items.map((item, itemIndex) => {
                  const linkedTask = item.task_id ? tasks.find((task) => task.id === item.task_id) : null;
                  return <div className="list-item-wrap" key={item.id}>
                    <label className={'list-item ' + (item.is_checked ? 'checked' : '')}>
                      <input type="checkbox" checked={item.is_checked} onChange={() => toggleItem(item)} disabled={busy || archived} />
                      <span>{item.content}</span>
                    </label>
                    <div className="list-item-tools">
                      <button type="button" className="list-task-action" onClick={() => openItemEditor(item)} disabled={busy || archived} aria-label={`Editar elemento: ${item.content}`}>Editar</button>
                      <button type="button" className="list-order-action" onClick={() => moveItem(list.id, item, -1)} disabled={busy || archived || itemIndex === 0} aria-label={`Mover arriba: ${item.content}`}>↑</button>
                      <button type="button" className="list-order-action" onClick={() => moveItem(list.id, item, 1)} disabled={busy || archived || itemIndex === items.length - 1} aria-label={`Mover abajo: ${item.content}`}>↓</button>
                      {item.task_id ? (
                        <>
                          <span className="list-task-link">{linkedTask ? 'Tarea vinculada · ' + (taskStatusLabels[linkedTask.status] || 'Asociada') : 'Tarea vinculada'}</span>
                          <button type="button" className="list-task-action" onClick={openTasks}>Abrir tareas →</button>
                        </>
                      ) : (
                        <button type="button" className="list-task-action" onClick={() => openConversion(list, item)} disabled={busy || archived} aria-label={'Convertir en tarea: ' + item.content}>Convertir en tarea →</button>
                      )}
                    </div>
                  </div>;
                })}</div>
                <div className="list-add">
                  <input disabled={busy || archived} value={draftItems[list.id] || ''} onChange={(event) => setDraftItems((current) => ({ ...current, [list.id]: event.target.value }))} placeholder="Añadir elemento…" onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addItem(list.id); } }} />
                  <button type="button" onClick={() => addItem(list.id)} disabled={busy || archived || !(draftItems[list.id] || '').trim()}>+</button>
                </div>
              </div>;
            })}</div>
          ) : <EmptyState title="Sin resultados" detail="Cambia el texto de búsqueda o el filtro de archivo." icon="⌕" />
        ) : <EmptyState title="Sin listas por ahora" detail="Compras, preparativos o cualquier conjunto de elementos que quieras ordenar." icon="☷" />}
      </div>
    </div>

    {showNewList && (
      <div className="task-editor-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) closeNewList(); }} onKeyDown={(event) => { if (event.key === 'Escape') closeNewList(); }}>
        <section className="task-editor-dialog floating-form-dialog" role="dialog" aria-modal="true" aria-labelledby="list-create-title">
          <div className="task-editor-heading">
            <div><div className="eyebrow">TUS LISTAS</div><h2 id="list-create-title">Crear una lista</h2></div>
            <button type="button" className="task-editor-close" onClick={closeNewList} disabled={busy} aria-label="Cerrar nueva lista">×</button>
          </div>
          <form className="task-editor-form" onSubmit={createList}>
            <Field label="Nombre de la lista" name="list" value={name} onChange={(event) => setName(event.target.value)} placeholder="Ej. Compras de la semana" required autoFocus />
            <TextAreaField label="Propósito (opcional)" name="purpose" value={purpose} onChange={(event) => setPurpose(event.target.value)} placeholder="¿Para qué usarás esta lista?" rows={3} />
            <div className="task-editor-actions">
              <button type="button" className="button task-editor-cancel" onClick={closeNewList} disabled={busy}>Cancelar</button>
              <button type="submit" className="button button-primary" disabled={busy || !name.trim()}>{busy ? 'Creando…' : 'Crear lista'} <span>→</span></button>
            </div>
          </form>
        </section>
      </div>
    )}

    {editingList && (
      <div className="task-editor-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) closeListEditor(); }} onKeyDown={(event) => { if (event.key === 'Escape') closeListEditor(); }}>
        <section className="task-editor-dialog" role="dialog" aria-modal="true" aria-labelledby="list-editor-title">
          <div className="task-editor-heading"><div><div className="eyebrow">TUS LISTAS</div><h2 id="list-editor-title">Editar lista</h2></div><button type="button" className="task-editor-close" onClick={closeListEditor} disabled={busy} aria-label="Cerrar edición de lista">×</button></div>
          <form className="task-editor-form" onSubmit={saveList}>
            <Field label="Nombre de la lista" name="editListName" value={editListName} onChange={(event) => setEditListName(event.target.value)} required />
            <TextAreaField label="Propósito (opcional)" name="editListPurpose" value={editListPurpose} onChange={(event) => setEditListPurpose(event.target.value)} rows={3} />
            <div className="task-editor-actions"><button type="button" className="button task-editor-cancel" onClick={closeListEditor} disabled={busy}>Cancelar</button><button type="submit" className="button button-primary" disabled={busy || !editListName.trim()}>{busy ? 'Guardando…' : 'Guardar cambios'} <span>→</span></button></div>
          </form>
        </section>
      </div>
    )}

    {editingItem && (
      <div className="task-editor-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) closeItemEditor(); }} onKeyDown={(event) => { if (event.key === 'Escape') closeItemEditor(); }}>
        <section className="task-editor-dialog" role="dialog" aria-modal="true" aria-labelledby="list-item-editor-title">
          <div className="task-editor-heading"><div><div className="eyebrow">ELEMENTO DE LISTA</div><h2 id="list-item-editor-title">Editar elemento</h2></div><button type="button" className="task-editor-close" onClick={closeItemEditor} disabled={busy} aria-label="Cerrar edición de elemento">×</button></div>
          <form className="task-editor-form" onSubmit={saveItem}>
            <TextAreaField label="Contenido del elemento" name="editListItemContent" value={editItemContent} onChange={(event) => setEditItemContent(event.target.value)} rows={4} required />
            <div className="task-editor-actions"><button type="button" className="button task-editor-cancel" onClick={closeItemEditor} disabled={busy}>Cancelar</button><button type="submit" className="button button-primary" disabled={busy || !editItemContent.trim()}>{busy ? 'Guardando…' : 'Guardar cambios'} <span>→</span></button></div>
          </form>
        </section>
      </div>
    )}

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
