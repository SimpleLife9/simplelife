import { useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { uuidv7 } from '../../lib/uuidv7.js';
import { useRows } from '../../shared/hooks/useRows.js';
import { SectionTitle } from '../../shared/components/SectionTitle.jsx';
import { EmptyState } from '../../shared/components/EmptyState.jsx';
import { Field } from '../../shared/components/Field.jsx';
import { TextAreaField } from '../../shared/components/TextAreaField.jsx';

function isArchived(note) {
  return Boolean(note.archived_at) || note.status === 'archived';
}

export function NotesPage({ profile, refreshKey, runAction, busy }) {
  const { rows, loading, localError } = useRows('note_idea', profile, refreshKey, (query) => query.is('deleted_at', null).order('created_at', { ascending: false }));
  const [kind, setKind] = useState('note');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [kindFilter, setKindFilter] = useState('all');
  const [archiveFilter, setArchiveFilter] = useState('active');
  const [showNewNote, setShowNewNote] = useState(false);
  const [editingNote, setEditingNote] = useState(null);
  const [editKind, setEditKind] = useState('note');
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');

  const filteredRows = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLocaleLowerCase('es');
    return rows.filter((note) => {
      const archived = isArchived(note);
      const matchesKind = kindFilter === 'all' || note.kind === kindFilter;
      const matchesArchive = archiveFilter === 'all'
        || (archiveFilter === 'active' && !archived)
        || (archiveFilter === 'archived' && archived);
      const searchableText = `${note.title || ''}\n${note.content || ''}`.toLocaleLowerCase('es');
      const matchesSearch = !normalizedSearch || searchableText.includes(normalizedSearch);
      return matchesKind && matchesArchive && matchesSearch;
    });
  }, [rows, searchTerm, kindFilter, archiveFilter]);

  const addNote = async (event) => {
    event.preventDefault();
    if (!content.trim()) return;
    await runAction(async () => {
      const { error: insertError } = await supabase.from('note_idea').insert({
        id: uuidv7(),
        owner_user_id: profile.id,
        created_by_user_id: profile.id,
        kind,
        title: title.trim() || null,
        content: content.trim(),
        status: 'active',
      });
      if (insertError) throw insertError;
      setTitle('');
      setContent('');
      setShowNewNote(false);
    }, kind === 'idea' ? 'Idea guardada.' : 'Nota guardada.');
  };

  const closeNewNote = () => {
    if (busy) return;
    setShowNewNote(false);
    setKind('note');
    setTitle('');
    setContent('');
  };

  const openEditor = (note) => {
    setEditingNote(note);
    setEditKind(note.kind || 'note');
    setEditTitle(note.title || '');
    setEditContent(note.content || '');
  };

  const closeEditor = () => {
    if (busy) return;
    setEditingNote(null);
  };

  const saveNote = async (event) => {
    event.preventDefault();
    if (!editingNote || !editContent.trim()) return;
    await runAction(async () => {
      const { data, error: updateError } = await supabase.from('note_idea')
        .update({
          kind: editKind,
          title: editTitle.trim() || null,
          content: editContent.trim(),
        })
        .eq('id', editingNote.id)
        .eq('owner_user_id', profile.id)
        .is('deleted_at', null)
        .select('id');
      if (updateError) throw updateError;
      if (!data?.length) throw new Error('No se pudo actualizar la nota. Puede que ya no exista o no pertenezca a esta cuenta.');
      setEditingNote(null);
    }, 'Nota actualizada.');
  };

  const toggleArchive = (note) => runAction(async () => {
    const archived = !isArchived(note);
    const { data, error: updateError } = await supabase.from('note_idea')
      .update({
        status: archived ? 'archived' : 'active',
        archived_at: archived ? new Date().toISOString() : null,
      })
      .eq('id', note.id)
      .eq('owner_user_id', profile.id)
      .is('deleted_at', null)
      .select('id');
    if (updateError) throw updateError;
    if (!data?.length) throw new Error('No se pudo cambiar el archivo de la nota. Actualiza la vista e inténtalo de nuevo.');
  }, isArchived(note) ? 'Nota restaurada.' : 'Nota archivada.');

  const countDetail = filteredRows.length === rows.length
    ? `${rows.length} registros`
    : `${filteredRows.length} de ${rows.length} registros`;

  return (
    <>
      <div className="management-layout management-layout-single">
        <div className="content-main">
          <div className="section-heading-row">
            <SectionTitle detail={countDetail}>Tu biblioteca</SectionTitle>
            <div className="section-create-actions">
              <button type="button" className="section-create-button" onClick={() => setShowNewNote(true)} disabled={busy}>Nueva nota o idea</button>
            </div>
          </div>
          <div className="notes-toolbar" role="search" aria-label="Buscar y filtrar notas e ideas">
            <label className="notes-toolbar-field notes-search-field" htmlFor="notes-search">
              <span>Buscar</span>
              <input
                id="notes-search"
                type="search"
                aria-label="Buscar notas e ideas"
                placeholder="Título o contenido…"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
              />
            </label>
            <label className="notes-toolbar-field" htmlFor="notes-kind-filter">
              <span>Tipo</span>
              <select
                id="notes-kind-filter"
                aria-label="Filtrar por tipo"
                value={kindFilter}
                onChange={(event) => setKindFilter(event.target.value)}
              >
                <option value="all">Todos</option>
                <option value="note">Notas</option>
                <option value="idea">Ideas</option>
              </select>
            </label>
            <label className="notes-toolbar-field" htmlFor="notes-archive-filter">
              <span>Archivo</span>
              <select
                id="notes-archive-filter"
                aria-label="Filtrar por archivo"
                value={archiveFilter}
                onChange={(event) => setArchiveFilter(event.target.value)}
              >
                <option value="active">Sin archivar</option>
                <option value="archived">Archivadas</option>
                <option value="all">Todas</option>
              </select>
            </label>
          </div>

          {loading ? (
            <p className="muted">Cargando…</p>
          ) : localError ? (
            <div className="form-error">{localError}</div>
          ) : rows.length === 0 ? (
            <EmptyState title="Tu biblioteca está vacía" detail="Guarda pensamientos e ideas para volver a ellos cuando quieras." icon="✎" />
          ) : filteredRows.length ? (
            <div className="notes-grid">
              {filteredRows.map((note) => {
                const archived = isArchived(note);
                const noteLabel = note.title || (note.kind === 'idea' ? 'Idea sin título' : 'Nota sin título');
                return (
                  <article className={`note-card ${archived ? 'note-card-archived' : ''}`} key={note.id}>
                    <div className="note-card-heading">
                      <span className="note-kind">{note.kind === 'idea' ? '✦ IDEA' : '✎ NOTA'}</span>
                      {archived && <span className="note-archive-tag">ARCHIVADA</span>}
                    </div>
                    <h3>{noteLabel}</h3>
                    <p>{note.content}</p>
                    <small>{note.created_at && !Number.isNaN(new Date(note.created_at).getTime()) ? new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeZone: 'America/Havana' }).format(new Date(note.created_at)) : 'Fecha no disponible'}</small>
                    <div className="note-card-actions">
                      <button
                        type="button"
                        className="note-action-button"
                        onClick={() => openEditor(note)}
                        disabled={busy}
                        aria-label={`Editar nota: ${noteLabel}`}
                      >Editar</button>
                      <button
                        type="button"
                        className="note-action-button"
                        onClick={() => toggleArchive(note)}
                        disabled={busy}
                        aria-label={`${archived ? 'Restaurar' : 'Archivar'} nota: ${noteLabel}`}
                      >{archived ? 'Restaurar' : 'Archivar'}</button>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <EmptyState title="Sin resultados" detail="Prueba con otro texto o cambia los filtros de tipo y archivo." icon="⌕" />
          )}
        </div>
      </div>

      {showNewNote && (
        <div
          className="task-editor-overlay"
          onMouseDown={(event) => { if (event.target === event.currentTarget) closeNewNote(); }}
          onKeyDown={(event) => { if (event.key === 'Escape') closeNewNote(); }}
        >
          <section className="task-editor-dialog floating-form-dialog" role="dialog" aria-modal="true" aria-labelledby="note-create-title">
            <div className="task-editor-heading">
              <div><div className="eyebrow">TU BIBLIOTECA</div><h2 id="note-create-title">Nueva nota o idea</h2></div>
              <button type="button" className="task-editor-close" onClick={closeNewNote} disabled={busy} aria-label="Cerrar nueva nota o idea">×</button>
            </div>
            <form className="task-editor-form" onSubmit={addNote}>
              <label className="field">
                <span>Tipo</span>
                <select aria-label="Tipo de nota" value={kind} onChange={(event) => setKind(event.target.value)} disabled={busy}>
                  <option value="note">Nota</option>
                  <option value="idea">Idea</option>
                </select>
              </label>
              <Field label="Título (opcional)" name="title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Dale un nombre" />
              <TextAreaField label="Contenido" name="content" value={content} onChange={(event) => setContent(event.target.value)} placeholder="Escribe lo que quieras conservar…" rows={5} required />
              <div className="task-editor-actions">
                <button type="button" className="button task-editor-cancel" onClick={closeNewNote} disabled={busy}>Cancelar</button>
                <button type="submit" className="button button-primary" disabled={busy || !content.trim()}>{busy ? 'Guardando…' : 'Guardar'} <span>→</span></button>
              </div>
            </form>
          </section>
        </div>
      )}

      {editingNote && (
        <div
          className="task-editor-overlay"
          onMouseDown={(event) => { if (event.target === event.currentTarget) closeEditor(); }}
          onKeyDown={(event) => { if (event.key === 'Escape') closeEditor(); }}
        >
          <section className="task-editor-dialog" role="dialog" aria-modal="true" aria-labelledby="note-editor-title">
            <div className="task-editor-heading">
              <div><div className="eyebrow">TU BIBLIOTECA</div><h2 id="note-editor-title">Editar nota o idea</h2></div>
              <button type="button" className="task-editor-close" onClick={closeEditor} disabled={busy} aria-label="Cerrar edición de nota">×</button>
            </div>
            <form className="task-editor-form" onSubmit={saveNote}>
              <label className="field">
                <span>Tipo</span>
                <select aria-label="Tipo de nota" value={editKind} onChange={(event) => setEditKind(event.target.value)}>
                  <option value="note">Nota</option>
                  <option value="idea">Idea</option>
                </select>
              </label>
              <Field label="Título (opcional)" name="editNoteTitle" value={editTitle} onChange={(event) => setEditTitle(event.target.value)} placeholder="Dale un nombre" />
              <TextAreaField label="Contenido" name="editNoteContent" value={editContent} onChange={(event) => setEditContent(event.target.value)} rows={5} required />
              <div className="task-editor-actions">
                <button type="button" className="button task-editor-cancel" onClick={closeEditor} disabled={busy}>Cancelar</button>
                <button type="submit" className="button button-primary" disabled={busy || !editContent.trim()}>{busy ? 'Guardando…' : 'Guardar cambios'} <span>→</span></button>
              </div>
            </form>
          </section>
        </div>
      )}
    </>
  );
}
