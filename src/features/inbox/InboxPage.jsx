import { useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { uuidv7 } from '../../lib/uuidv7.js';
import { useRows } from '../../shared/hooks/useRows.js';
import { SectionTitle } from '../../shared/components/SectionTitle.jsx';
import { EmptyState } from '../../shared/components/EmptyState.jsx';
import { CaptureComposer } from './components/CaptureComposer.jsx';
import { persistTextCapture } from './data/capture-repository.js';

function normalizeCaptureForDuplicate(value) {
  return String(value || "").normalize("NFKC").toLocaleLowerCase("es")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}

export function InboxPage({ profile, refreshKey, runAction, busy, setActivePage, setMorePage }) {
  const { rows, loading, localError } = useRows('capture', profile, refreshKey, (query) => query
    .order('captured_at', { ascending: false }).limit(250));
  const { rows: captureParts } = useRows('capture_part', profile, refreshKey, (query) => query.order('part_index'));
  const { rows: captureLinks } = useRows('capture_link', profile, refreshKey);
  const { rows: processingRuns } = useRows('processing_run', profile, refreshKey, (query) => query.order('created_at', { ascending: false }).limit(100));
  const { rows: lists } = useRows('user_list', profile, refreshKey, (query) => query
    .is('deleted_at', null).is('archived_at', null).eq('status', 'active').order('name'));
  const { rows: listItems } = useRows('list_item', profile, refreshKey, (query) => query.order('position').order('created_at'));

  const [captureSearch, setCaptureSearch] = useState('');
  const [attentionFilter, setAttentionFilter] = useState('needs_review');
  const [selectedCapture, setSelectedCapture] = useState(null);
  const [selectedPart, setSelectedPart] = useState(null);
  const [destinationType, setDestinationType] = useState('task');
  const [taskTitle, setTaskTitle] = useState('');
  const [taskPriority, setTaskPriority] = useState('3');
  const [taskDueDate, setTaskDueDate] = useState('');
  const [noteTitle, setNoteTitle] = useState('');
  const [listMode, setListMode] = useState('new');
  const [selectedListId, setSelectedListId] = useState('');
  const [newListName, setNewListName] = useState('');
  const [listItemText, setListItemText] = useState('');
  const [operationIds, setOperationIds] = useState(null);

  const getCaptureParts = (captureId) => captureParts.filter((part) => part.capture_id === captureId).sort((a, b) => a.part_index - b.part_index);
  const getCapturePart = (captureId) => getCaptureParts(captureId)[0];
  const getConfirmedLink = (captureId, partId = null) => {
    const part = partId ? getCaptureParts(captureId).find((item) => item.id === partId) : getCapturePart(captureId);
    return part ? captureLinks.find((link) => link.capture_part_id === part.id && link.link_status === 'confirmed') : null;
  };
  const captureIsOrganized = (captureId) => {
    const parts = getCaptureParts(captureId);
    return parts.length > 0 && parts.every((part) => Boolean(getConfirmedLink(captureId, part.id)));
  };
  const getLinkKind = (link) => {
    if (link?.task_id) return 'task';
    if (link?.note_idea_id) return 'note_idea';
    if (link?.user_list_id || link?.list_item_id) return 'list';
    if (link?.goal_id || link?.subgoal_id) return 'goal_subgoal';
    if (link?.project_id) return 'project';
    return 'unknown';
  };
  const activeRows = rows.filter((capture) => !capture.deleted_at);
  const organizedCount = activeRows.filter((capture) => captureIsOrganized(capture.id)).length;
  const pendingCount = activeRows.filter((capture) => capture.attention_status === 'needs_review' && !captureIsOrganized(capture.id)).length;

  const visibleCaptures = useMemo(() => {
    const term = captureSearch.trim().toLocaleLowerCase('es');
    return rows.filter((capture) => {
      const parts = captureParts.filter((item) => item.capture_id === capture.id);
      const organized = parts.length > 0 && parts.every((part) => captureLinks.some((link) => link.capture_part_id === part.id && link.link_status === 'confirmed'));
      const statusMatches = attentionFilter === 'trash'
        ? Boolean(capture.deleted_at)
        : !capture.deleted_at && (attentionFilter === 'all'
          || (attentionFilter === 'needs_review' && capture.attention_status === 'needs_review' && !organized)
          || (attentionFilter === 'reviewed' && capture.attention_status === 'reviewed' && !organized)
          || (attentionFilter === 'organized' && organized)
          || (attentionFilter === 'archived' && capture.attention_status === 'archived'));
      const searchMatches = !term || String(capture.content_original || '').toLocaleLowerCase('es').includes(term);
      return statusMatches && searchMatches;
    });
  }, [rows, captureParts, captureLinks, captureSearch, attentionFilter]);

  const updateAttention = (capture, nextStatus) => runAction(async () => {
    const { data, error } = await supabase.from('capture')
      .update({ attention_status: nextStatus })
      .eq('id', capture.id)
      .eq('owner_user_id', profile.id)
      .select('id');
    if (error) throw error;
    if (!data?.length) throw new Error('No se pudo actualizar la captura. Puede que ya no exista o no pertenezca a esta cuenta.');
  }, nextStatus === 'reviewed'
    ? 'Captura marcada como revisada.'
    : nextStatus === 'archived'
      ? 'Captura archivada.'
      : 'Captura devuelta a pendientes.');

  const trashCapture = (capture) => runAction(async () => {
    const { data, error } = await supabase.rpc('trash_inbox_capture', {
      p_capture_id: capture.id, p_audit_id: uuidv7(),
    });
    if (error) throw error;
    if (data !== true) throw new Error('No se pudo enviar la captura a la papelera.');
  }, 'Captura movida a la papelera. Se conservará durante 30 días antes de poder purgarse.');

  const restoreTrashedCapture = (capture) => runAction(async () => {
    const { data, error } = await supabase.rpc('restore_inbox_capture', {
      p_capture_id: capture.id, p_audit_id: uuidv7(),
    });
    if (error) throw error;
    if (data !== true) throw new Error('La captura ya no puede recuperarse o no pertenece a esta cuenta.');
  }, 'Captura restaurada desde la papelera.');

  const discardPartSuggestion = (part) => runAction(async () => {
    const { data, error } = await supabase.rpc('review_inbox_capture_part', {
      p_capture_part_id: part.id,
      p_category: part.category,
      p_interpretation: 'Sugerencia descartada manualmente por el propietario.',
      p_review_status: 'rejected',
      p_audit_id: uuidv7(),
    });
    if (error) throw error;
    if (data !== true) throw new Error('No se pudo registrar el rechazo de esta sugerencia.');
  }, 'Sugerencia descartada y decisión registrada en auditoría.');

  const queueAndProcess = async (captureId) => {
    const queued = await supabase.functions.invoke('inbox-processing-queue', {
      body: { captureId }, headers: { 'Idempotency-Key': uuidv7() },
    });
    if (queued.error) throw queued.error;
    if (!queued.data?.runId) throw new Error('No se recibió el identificador del procesamiento.');
    const processed = await supabase.functions.invoke('inbox-processing-process', { body: { runId: queued.data.runId } });
    if (processed.error) throw processed.error;
    if (processed.data?.status === 'not_claimable') throw new Error('El trabajo sigue en cola; vuelve a intentarlo.');
  };

  const processCapture = (capture) => runAction(
    () => queueAndProcess(capture.id),
    'Propuestas preparadas. Revisa cada fragmento; no se creó ningún destino automáticamente.',
  );

  const submit = async (contentOriginal) => runAction(async () => {
    const saved = await persistTextCapture({
      supabase, ownerUserId: profile.id, contentOriginal, createId: uuidv7,
    });
    // A processing outage never invalidates a successfully saved capture.
    try { await queueAndProcess(saved.captureId); } catch { /* retry remains available from the Inbox row */ }
  }, 'Captura guardada.');
  const openOrganizer = (capture, part = getCapturePart(capture.id)) => {
    setSelectedCapture(capture);
    setSelectedPart(part || { id: uuidv7(), capture_id: capture.id, part_index: 0, original_fragment: capture.content_original });
    setDestinationType('task');
    setTaskTitle(String(part?.original_fragment || capture.content_original || '').slice(0, 240));
    setTaskPriority('3');
    setTaskDueDate('');
    setNoteTitle('');
    setListMode('new');
    setSelectedListId(lists[0]?.id || '');
    setNewListName(String(part?.original_fragment || capture.content_original || '').slice(0, 200));
    setListItemText(String(part?.original_fragment || capture.content_original || '').slice(0, 500));
    setOperationIds({ partId: part?.id || uuidv7(), targetId: uuidv7(), itemId: uuidv7(), linkId: uuidv7() });
  };

  const closeOrganizer = () => {
    if (busy) return;
    setSelectedCapture(null);
    setSelectedPart(null);
    setOperationIds(null);
  };

  const resetTargetIds = () => setOperationIds((current) => current
    ? { ...current, targetId: uuidv7(), itemId: uuidv7(), linkId: uuidv7() }
    : current);

  const ensureRow = async (table, row) => {
    const { data: existing, error: readError } = await supabase.from(table)
      .select('id').eq('id', row.id).maybeSingle();
    if (readError) throw readError;
    if (existing?.id) return;
    const { data, error } = await supabase.from(table).insert(row).select('id');
    if (error) throw error;
    if (!data?.length) throw new Error('No se pudo guardar el elemento en ' + table + '.');
  };

  const saveOrganization = async (event) => {
    event.preventDefault();
    if (!selectedCapture || !selectedPart || !operationIds || getConfirmedLink(selectedCapture.id, selectedPart.id)) return;
    const sourceText = String(selectedPart.original_fragment || selectedCapture.content_original || '');
    if (!sourceText.trim()) return;
    if (destinationType === 'task' && !taskTitle.trim()) return;
    if (destinationType === 'list' && listMode === 'new' && !newListName.trim()) return;
    if (destinationType === 'list' && listMode === 'existing' && !selectedListId) return;
    if (destinationType === 'list' && !listItemText.trim()) return;

    const ids = operationIds;
    const selectedList = lists.find((list) => list.id === selectedListId);
    const category = destinationType === 'task' ? 'task'
      : destinationType === 'note' || destinationType === 'idea' ? 'note_idea' : 'list';
    const interpretation = destinationType === 'task' ? 'Clasificación manual confirmada: tarea.'
      : destinationType === 'note' ? 'Clasificación manual confirmada: nota.'
        : destinationType === 'idea' ? 'Clasificación manual confirmada: idea.'
          : 'Clasificación manual confirmada: lista.';
    const successMessage = destinationType === 'task' ? 'Captura organizada como tarea.'
      : destinationType === 'note' ? 'Captura guardada como nota.'
        : destinationType === 'idea' ? 'Captura guardada como idea.'
          : 'Captura añadida a una lista.';

    const saved = await runAction(async () => {
      const partId = selectedPart?.id || ids.partId;
      await ensureRow('capture_part', {
        id: partId, capture_id: selectedCapture.id, part_index: 0, original_fragment: sourceText,
      });

      let linkTarget = {};
      if (destinationType === 'task') {
        await ensureRow('task', {
          id: ids.targetId, owner_user_id: profile.id, created_by_user_id: profile.id,
          action: taskTitle.trim(), description: sourceText, status: 'todo',
          priority: Number(taskPriority), due_date: taskDueDate || null, time_zone: 'America/Havana',
        });
        linkTarget = { task_id: ids.targetId };
      } else if (destinationType === 'note' || destinationType === 'idea') {
        await ensureRow('note_idea', {
          id: ids.targetId, owner_user_id: profile.id, created_by_user_id: profile.id,
          kind: destinationType, title: noteTitle.trim() || null, content: sourceText, status: 'active',
        });
        linkTarget = { note_idea_id: ids.targetId };
      } else if (destinationType === 'list' && listMode === 'new') {
        await ensureRow('user_list', {
          id: ids.targetId, owner_user_id: profile.id, created_by_user_id: profile.id,
          name: newListName.trim(), purpose: 'Creada desde una captura del Inbox.', status: 'active',
        });
        await ensureRow('list_item', {
          id: ids.itemId, list_id: ids.targetId, content: listItemText.trim(), position: 0, is_checked: false,
        });
        linkTarget = { list_item_id: ids.itemId };
      } else if (destinationType === 'list' && listMode === 'existing' && selectedList) {
        await ensureRow('list_item', {
          id: ids.targetId, list_id: selectedList.id, content: listItemText.trim(),
          position: listItems.filter((item) => item.list_id === selectedList.id).length, is_checked: false,
        });
        linkTarget = { list_item_id: ids.targetId };
      } else {
        throw new Error('Selecciona una lista válida para continuar.');
      }

      await ensureRow('capture_link', {
        id: ids.linkId, capture_part_id: partId, ...linkTarget, link_status: 'confirmed',
      });

      const { data: partUpdate, error: partError } = await supabase.rpc('review_inbox_capture_part', {
        p_capture_part_id: partId, p_category: category, p_interpretation: interpretation,
        p_review_status: 'accepted', p_audit_id: uuidv7(),
      });
      if (partError) throw partError;
      if (partUpdate !== true) throw new Error('El elemento fue creado, pero no se pudo confirmar su clasificación. Reintenta esta misma operación.');

      const allParts = getCaptureParts(selectedCapture.id);
      const allPartsConfirmed = allParts.length > 0 && allParts.every((part) => part.id === partId
        || captureLinks.some((link) => link.capture_part_id === part.id && link.link_status === 'confirmed'));
      const { data: captureUpdate, error: captureError } = await supabase.from('capture')
        .update({ attention_status: allPartsConfirmed ? 'reviewed' : 'needs_review' })
        .eq('id', selectedCapture.id).eq('owner_user_id', profile.id).select('id');
      if (captureError) throw captureError;
      if (!captureUpdate?.length) throw new Error('El elemento quedó creado, pero no se pudo actualizar el estado de su captura.');
    }, successMessage);

    if (saved) closeOrganizer();
  };

  const attentionLabels = { needs_review: 'Pendiente de revisión', reviewed: 'Revisada', archived: 'Archivada' };
  const typeLabels = { task: 'Tarea', note_idea: 'Nota o idea', list: 'Lista' };
  const openOrganizedTarget = (link) => {
    const kind = getLinkKind(link);
    if (kind === 'task') { setMorePage('tasks'); setActivePage('more'); }
    else if (kind === 'note_idea') { setMorePage('notes'); setActivePage('more'); }
    else if (kind === 'list') { setMorePage('lists'); setActivePage('more'); }
  };

  return <div className="inbox-layout">
    <CaptureComposer busy={busy} onSubmit={submit} />
    <div className="inbox-list-wrap">
      <SectionTitle detail={visibleCaptures.length + ' de ' + rows.length + ' capturas · ' + pendingCount + ' por organizar · ' + organizedCount + ' organizadas'}>Capturado recientemente</SectionTitle>
      <div className="capture-toolbar" aria-label="Buscar y revisar capturas">
        <label className="capture-toolbar-field capture-search-field">
          <span>Buscar</span>
          <input aria-label="Buscar capturas" type="search" value={captureSearch} onChange={(event) => setCaptureSearch(event.target.value)} placeholder="Buscar en el contenido original…" />
        </label>
        <label className="capture-toolbar-field">
          <span>Revisión</span>
          <select aria-label="Filtrar capturas por revisión" value={attentionFilter} onChange={(event) => setAttentionFilter(event.target.value)}>
            <option value="needs_review">Por organizar</option><option value="organized">Organizadas</option>
            <option value="reviewed">Revisadas sin organizar</option><option value="archived">Archivadas</option><option value="trash">Papelera</option><option value="all">Todas</option>
          </select>
        </label>
      </div>
      {loading ? <p className="muted">Cargando…</p> : localError ? <div className="form-error">{localError}</div> : rows.length ? visibleCaptures.length ? (
        <div className="capture-list">{visibleCaptures.map((capture) => {
          const parts = getCaptureParts(capture.id);
          const part = parts[0];
          const confirmedLink = getConfirmedLink(capture.id);
          const processingRun = processingRuns.find((run) => run.capture_id === capture.id);
          const proposals = processingRun?.result?.proposals || [];
          const linkKind = getLinkKind(confirmedLink);
          const label = part?.category === 'task' ? 'Tarea'
            : part?.category === 'note_idea' ? 'Nota o idea'
              : part?.category === 'list' ? 'Lista' : typeLabels[linkKind] || 'Elemento';
          const normalizedSource = normalizeCaptureForDuplicate(capture.content_original);
          const possibleDuplicate = !capture.deleted_at && normalizedSource.length > 3 && rows.some((candidate) =>
            candidate.id !== capture.id && !candidate.deleted_at
            && normalizeCaptureForDuplicate(candidate.content_original) === normalizedSource);
          const rowClass = 'capture-row ' + (capture.deleted_at ? 'capture-row-archived' : confirmedLink ? 'capture-row-organized' : 'capture-row-' + capture.attention_status);
          return <div className={rowClass} key={capture.id}>
            <span className="capture-bullet">{confirmedLink ? '✓' : '✳'}</span>
            <div className="capture-row-content">
              <p>{capture.content_original}</p>
              <small>{new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Havana' }).format(new Date(capture.captured_at))}</small>
              {possibleDuplicate && <span className="capture-status capture-status-archived">Posible duplicado normalizado · revisar antes de combinar</span>}
              {parts.map((capturePart) => {
                const proposal = proposals.find((item) => item.partIndex === capturePart.part_index) || proposals[capturePart.part_index];
                const partLink = getConfirmedLink(capture.id, capturePart.id);
                const categoryLabels = { task: 'Tarea', event: 'Evento', request: 'Solicitud', habit: 'Hábito', goal_subgoal: 'Meta', project: 'Proyecto', note_idea: 'Nota / idea', list: 'Lista' };
                return <div className="capture-part-review" key={capturePart.id}>
                  <div className="capture-part-heading"><strong>{categoryLabels[capturePart.category] || 'Fragmento'}</strong>
                    {proposal && <span className="capture-part-confidence">Afinidad heurística: {Math.round(proposal.confidence * 100)}%{proposal.requiresClarification ? ' · necesita aclaración' : ''}</span>}
                    {capturePart.review_status === 'accepted' || capturePart.review_status === 'edited' ? <span className="capture-part-confirmed">Confirmado</span> : null}
                  </div>
                  {capturePart.original_fragment !== capture.content_original && <p>{capturePart.original_fragment}</p>}
                  {partLink ? <span className="muted">Destino vinculado y trazable.</span> : <>
                    <button type="button" className="capture-action-button" disabled={busy || capture.attention_status === 'archived' || Boolean(capture.deleted_at)} onClick={() => openOrganizer(capture, capturePart)}>Revisar y confirmar destino</button>
                    {capturePart.review_status === 'unreviewed' && !capture.deleted_at && <button type="button" className="capture-action-button capture-archive-button" disabled={busy} onClick={() => discardPartSuggestion(capturePart)}>Descartar sugerencia</button>}
                    {capturePart.review_status === 'rejected' && <span className="muted">Sugerencia descartada por el propietario.</span>}
                  </>}
                </div>;
              })}
              <div className="capture-row-actions">
                {confirmedLink
                  ? <span className="capture-status capture-status-organized">Organizada · {label}{capture.attention_status === 'archived' ? ' · Archivada' : ''}</span>
                  : <span className={'capture-status capture-status-' + capture.attention_status}>{attentionLabels[capture.attention_status] || 'Pendiente de revisión'}</span>}
                {capture.deleted_at ? <button type="button" className="capture-action-button" disabled={busy} onClick={() => restoreTrashedCapture(capture)}>Restaurar desde papelera</button> : <>
                {capture.processing_status !== 'processed' && capture.attention_status !== 'archived' ? <button type="button" className="capture-action-button" disabled={busy} onClick={() => processCapture(capture)}>{capture.processing_status === 'queued' || capture.processing_status === 'processing' ? 'Reintentar procesamiento' : 'Generar sugerencias'}</button> : null}
                {confirmedLink ? (
                  <>
                    <button type="button" className="capture-action-button" onClick={() => openOrganizedTarget(confirmedLink)}>Abrir {linkKind === 'task' ? 'tareas' : linkKind === 'note_idea' ? 'notas e ideas' : 'listas'} →</button>
                    <button type="button" className="capture-action-button capture-archive-button" disabled={busy} onClick={() => updateAttention(capture, capture.attention_status === 'archived' ? 'needs_review' : 'archived')} aria-label={capture.attention_status === 'archived' ? 'Restaurar captura: ' + capture.content_original : 'Archivar captura: ' + capture.content_original}>{capture.attention_status === 'archived' ? 'Restaurar' : 'Archivar'}</button>
                  </>
                ) : capture.attention_status !== 'archived' ? (
                  <>
                    <button type="button" className="capture-action-button" disabled={busy} onClick={() => openOrganizer(capture)} aria-label={'Organizar captura: ' + capture.content_original}>Organizar</button>
                    <button type="button" className="capture-action-button" disabled={busy} onClick={() => updateAttention(capture, capture.attention_status === 'reviewed' ? 'needs_review' : 'reviewed')} aria-label={capture.attention_status === 'reviewed' ? 'Volver a pendientes: ' + capture.content_original : 'Marcar revisada: ' + capture.content_original}>{capture.attention_status === 'reviewed' ? 'Volver a pendientes' : 'Marcar revisada'}</button>
                    <button type="button" className="capture-action-button capture-archive-button" disabled={busy} onClick={() => updateAttention(capture, 'archived')} aria-label={'Archivar captura: ' + capture.content_original}>Archivar</button>
                  </>
                ) : <button type="button" className="capture-action-button" disabled={busy} onClick={() => updateAttention(capture, 'needs_review')} aria-label={'Restaurar captura: ' + capture.content_original}>Restaurar</button>}
                <button type="button" className="capture-action-button capture-archive-button" disabled={busy} onClick={() => trashCapture(capture)}>Enviar a papelera</button>
                </>}
              </div>
            </div>
          </div>;
        })}</div>
      ) : <EmptyState title="No hay coincidencias" detail="Cambia la búsqueda o el filtro para encontrar otras capturas." icon="⌕" />
      : <EmptyState title="El Inbox está vacío" detail="Empieza escribiendo cualquier cosa que no quieras olvidar." /> }
    </div>
    <div className="honest-note"><span>ⓘ</span><p>Las sugerencias actuales se generan con reglas locales deterministas (no con un modelo de IA) y son solo orientativas. Cada fragmento conserva el texto original; ningún destino se crea sin tu confirmación. Voz y sincronización offline privada permanecen desactivadas hasta aprobar y verificar su almacenamiento, proveedor, cifrado y recuperación.</p></div>

    {selectedCapture && (
      <div className="task-editor-overlay capture-organizer-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) closeOrganizer(); }}>
        <section className="task-editor-dialog capture-organizer-dialog" role="dialog" aria-modal="true" aria-labelledby="capture-organizer-title">
          <div className="task-editor-heading">
            <div><div className="eyebrow">ORGANIZACIÓN MANUAL</div><h2 id="capture-organizer-title">Organizar captura</h2></div>
            <button type="button" className="task-editor-close" onClick={closeOrganizer} aria-label="Cerrar organizador">×</button>
          </div>
          <div className="capture-original-preview"><span>CAPTURA ORIGINAL · NO SE MODIFICA</span><p>{selectedCapture.content_original}</p></div>
          <form className="capture-organizer-form" onSubmit={saveOrganization}>
            <label className="field"><span>Tipo de destino</span><select aria-label="Tipo de destino" value={destinationType} disabled={busy} onChange={(event) => { setDestinationType(event.target.value); resetTargetIds(); }}>
              <option value="task">Tarea</option><option value="note">Nota</option><option value="idea">Idea</option><option value="list">Lista</option>
            </select></label>
            {destinationType === 'task' && <>
              <label className="field"><span>Título de la tarea</span><input aria-label="Título de la tarea" maxLength={240} value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} required disabled={busy} /></label>
              <div className="capture-organizer-two-col">
                <label className="field"><span>Prioridad</span><select aria-label="Prioridad de la tarea" value={taskPriority} onChange={(event) => setTaskPriority(event.target.value)} disabled={busy}><option value="1">Muy alta</option><option value="2">Alta</option><option value="3">Normal</option><option value="4">Baja</option><option value="5">Flexible</option></select></label>
                <label className="field"><span>Fecha objetivo (opcional)</span><input aria-label="Fecha objetivo" type="date" value={taskDueDate} onChange={(event) => setTaskDueDate(event.target.value)} disabled={busy} /></label>
              </div>
              <p className="capture-organizer-help">El texto completo de la captura quedará guardado en la descripción de la tarea.</p>
            </>}
            {(destinationType === 'note' || destinationType === 'idea') && <label className="field"><span>Título (opcional)</span><input aria-label="Título (opcional)" maxLength={200} value={noteTitle} onChange={(event) => setNoteTitle(event.target.value)} placeholder="Dale un nombre" disabled={busy} /></label>}
            {destinationType === 'list' && <>
              <label className="field"><span>Acción de lista</span><select aria-label="Acción de lista" value={listMode} onChange={(event) => { setListMode(event.target.value); resetTargetIds(); }} disabled={busy}>
                <option value="new">Crear una nueva lista</option><option value="existing" disabled={!lists.length}>Añadir a una lista existente</option>
              </select></label>
              {listMode === 'new' ? <>
                <label className="field"><span>Nombre de la nueva lista</span><input aria-label="Nombre de la nueva lista" maxLength={200} value={newListName} onChange={(event) => setNewListName(event.target.value)} required disabled={busy} /></label>
                <label className="field"><span>Texto del primer elemento (máximo 500 caracteres)</span><textarea aria-label="Texto del primer elemento" maxLength={500} rows={3} value={listItemText} onChange={(event) => setListItemText(event.target.value)} required disabled={busy} /></label>
                <p className="capture-organizer-help">La captura se añadirá como primer elemento de la lista nueva. El original completo seguirá conservado en Inbox.</p>
              </> : <>
                <label className="field"><span>Lista existente</span><select aria-label="Lista existente" value={selectedListId} onChange={(event) => setSelectedListId(event.target.value)} required disabled={busy}><option value="">Selecciona una lista</option>{lists.map((list) => <option key={list.id} value={list.id}>{list.name}</option>)}</select></label>
                <label className="field"><span>Texto del elemento (máximo 500 caracteres)</span><textarea aria-label="Texto del elemento" maxLength={500} rows={3} value={listItemText} onChange={(event) => setListItemText(event.target.value)} required disabled={busy} /></label>
              </>}
            </>}
            <div className="capture-organizer-actions"><button type="button" className="capture-action-button" onClick={closeOrganizer} disabled={busy}>Cancelar</button><button type="submit" className="button button-primary" disabled={busy || !operationIds}>{busy ? 'Organizando…' : 'Confirmar y organizar'} <span>→</span></button></div>
          </form>
        </section>
      </div>
    )}
  </div>;
}
