import { useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { uuidv7 } from '../../lib/uuidv7.js';
import { useRows } from '../../shared/hooks/useRows.js';
import { SectionTitle } from '../../shared/components/SectionTitle.jsx';
import { EmptyState } from '../../shared/components/EmptyState.jsx';
import { Field } from '../../shared/components/Field.jsx';
import { TextAreaField } from '../../shared/components/TextAreaField.jsx';
import { FormCard } from '../../shared/components/FormCard.jsx';

export function NotesPage({ profile, refreshKey, runAction, busy }) {
  const { rows, loading, localError } = useRows('note_idea', profile, refreshKey, (query) => query.is('deleted_at', null).order('created_at', { ascending: false }));
  const [kind, setKind] = useState('note');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const addNote = async (event) => {
    event.preventDefault();
    if (!content.trim()) return;
    await runAction(async () => {
      const { error: insertError } = await supabase.from('note_idea').insert({ id: uuidv7(), owner_user_id: profile.id, created_by_user_id: profile.id, kind, title: title.trim() || null, content: content.trim(), status: 'active' });
      if (insertError) throw insertError;
      setTitle(''); setContent('');
    }, kind === 'idea' ? 'Idea guardada.' : 'Nota guardada.');
  };
  return <div className="management-layout"><div className="content-main"><SectionTitle detail={`${rows.length} registros`}>Tu biblioteca</SectionTitle>{loading ? <p className="muted">Cargando…</p> : localError ? <div className="form-error">{localError}</div> : rows.length ? <div className="notes-grid">{rows.map((note) => <article className="note-card" key={note.id}><span className="note-kind">{note.kind === 'idea' ? '✦ IDEA' : '✎ NOTA'}</span><h3>{note.title || (note.kind === 'idea' ? 'Idea sin título' : 'Nota sin título')}</h3><p>{note.content}</p><small>{note.created_at && !Number.isNaN(new Date(note.created_at).getTime()) ? new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeZone: 'America/Havana' }).format(new Date(note.created_at)) : 'Fecha no disponible'}</small></article>)}</div> : <EmptyState title="Tu biblioteca está vacía" detail="Guarda pensamientos e ideas para volver a ellos cuando quieras." icon="✎" />}</div><aside className="content-side"><FormCard title="Nueva nota o idea" onSubmit={addNote} submitLabel="Guardar" busy={busy}><label className="field"><span>Tipo</span><select value={kind} onChange={(event) => setKind(event.target.value)}><option value="note">Nota</option><option value="idea">Idea</option></select></label><Field label="Título (opcional)" name="title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Dale un nombre" /><TextAreaField label="Contenido" name="content" value={content} onChange={(event) => setContent(event.target.value)} placeholder="Escribe lo que quieras conservar…" rows={5} required /></FormCard></aside></div>;
}
