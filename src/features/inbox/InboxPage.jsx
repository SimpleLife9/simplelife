import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { uuidv7 } from '../../lib/uuidv7.js';
import { SectionTitle } from '../../shared/components/SectionTitle.jsx';
import { EmptyState } from '../../shared/components/EmptyState.jsx';
import { useRows } from '../../shared/hooks/useRows.js';
import { CaptureComposer } from './components/CaptureComposer.jsx';
import { OfflineVaultPanel } from './components/OfflineVaultPanel.jsx';
import { VoiceCapture } from './components/VoiceCapture.jsx';
import { createIndexedDbOfflineStorage, createOfflineCaptureVault } from './offline/private-offline-vault.js';
import { getOfflineVaultUserMessage } from './offline/offline-vault-errors.js';
import { CapturePartPersistenceError, persistTextCapture } from './data/capture-repository.js';
import { getSuggestedDestinationType, isInboxDestinationReady } from './domain/capture-pipeline.js';

function normalizeCaptureForDuplicate(value) {
  return String(value || "").normalize("NFKC").toLocaleLowerCase("es")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}

export function InboxPage({ profile, refreshKey, runAction, busy, setActivePage, setMorePage }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [localError, setLocalError] = useState('');
  const [captureRecoveryError, setCaptureRecoveryError] = useState('');
  const [processingErrorsByCapture, setProcessingErrorsByCapture] = useState({});
  const activeOwnerId = profile?.id || null;
  const offlineVaultRef = useRef({ ownerId: null, vault: null });
  if (offlineVaultRef.current.ownerId !== activeOwnerId) {
    // Lock the prior owner's in-memory key before changing the IndexedDB namespace.
    offlineVaultRef.current.vault?.lock();
    let vault = null;
    if (activeOwnerId) {
      try {
        vault = createOfflineCaptureVault({
          storage: createIndexedDbOfflineStorage(
            globalThis.indexedDB,
            'simplelife-private-offline-v1-' + activeOwnerId,
          ),
        });
      } catch { /* private offline storage may be unavailable in this browser */ }
    }
    offlineVaultRef.current = { ownerId: activeOwnerId, vault };
  }
  const offlineVault = offlineVaultRef.current.vault;
  const [offlineVaultStatus, setOfflineVaultStatus] = useState({
    configured: false, unlocked: false, queuedCount: 0, available: true, loading: true,
  });
  const [offlineStateOwnerId, setOfflineStateOwnerId] = useState(activeOwnerId);
  // Never render a previous account's decrypted queue/status during an account switch.
  const offlineStateMatchesOwner = offlineStateOwnerId === activeOwnerId;
  const visibleOfflineVaultStatus = offlineStateMatchesOwner
    ? offlineVaultStatus
    : { configured: false, unlocked: false, queuedCount: 0, available: Boolean(offlineVault), loading: true };
  const [offlineQueuedCaptures, setOfflineQueuedCaptures] = useState([]);
  const visibleOfflineQueuedCaptures = offlineStateMatchesOwner ? offlineQueuedCaptures : [];
  const [offlinePassphrase, setOfflinePassphrase] = useState('');
  const [offlineRecoveryMode, setOfflineRecoveryMode] = useState(false);
  const [offlineRecoveryKey, setOfflineRecoveryKey] = useState('');
  const [offlineRecoveryCode, setOfflineRecoveryCode] = useState('');
  const [offlineRecoveryCodeType, setOfflineRecoveryCodeType] = useState('created');
  const [offlineRecoveryRotationMode, setOfflineRecoveryRotationMode] = useState(false);
  const [offlineRecoveryRotationPassphrase, setOfflineRecoveryRotationPassphrase] = useState('');
  const [offlineVaultBusy, setOfflineVaultBusy] = useState(false);
  const [offlineVaultError, setOfflineVaultError] = useState('');
  const [offlineVaultNotice, setOfflineVaultNotice] = useState('');
  const [offlineOnline, setOfflineOnline] = useState(globalThis.navigator?.onLine !== false);

  const refreshOfflineVaultState = async () => {
    if (!offlineVault) {
      setOfflineVaultStatus({
        configured: false, unlocked: false, queuedCount: 0, available: false, loading: false,
      });
      setOfflineQueuedCaptures([]);
      setOfflineStateOwnerId(activeOwnerId);
      return;
    }
    try {
      const status = await offlineVault.getStatus();
      const queued = status.unlocked ? await offlineVault.listQueuedCaptures() : [];
      setOfflineVaultStatus({ ...status, available: true, loading: false });
      setOfflineQueuedCaptures(queued);
      setOfflineStateOwnerId(activeOwnerId);
    } catch {
      setOfflineVaultStatus({
        configured: false, unlocked: false, queuedCount: 0, available: false, loading: false,
      });
      setOfflineQueuedCaptures([]);
      setOfflineStateOwnerId(activeOwnerId);
    }
  };

  useEffect(() => {
    // Lock private content whenever the PWA is backgrounded or the tab is hidden.
    const onVisibilityChange = () => {
      if (globalThis.document?.visibilityState !== 'hidden') return;
      offlineVault?.lock();
      setOfflinePassphrase('');
      setOfflineRecoveryKey('');
      setOfflineRecoveryMode(false);
      setOfflineRecoveryRotationMode(false);
      setOfflineRecoveryRotationPassphrase('');
      setOfflineQueuedCaptures([]);
      setOfflineVaultStatus((current) => ({ ...current, unlocked: false, queuedCount: 0 }));
      setOfflineVaultNotice('Bóveda bloqueada automáticamente al salir de la aplicación.');
    };
    globalThis.document?.addEventListener('visibilitychange', onVisibilityChange);
    return () => globalThis.document?.removeEventListener('visibilitychange', onVisibilityChange);
  }, [offlineVault]);

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      if (!offlineVault) {
        if (alive) {
          setOfflineVaultStatus({
            configured: false, unlocked: false, queuedCount: 0, available: false, loading: false,
          });
          setOfflineQueuedCaptures([]);
          setOfflineStateOwnerId(activeOwnerId);
          setOfflineStateOwnerId(activeOwnerId);
        }
        return;
      }
      try {
        const status = await offlineVault.getStatus();
        const queued = status.unlocked ? await offlineVault.listQueuedCaptures() : [];
        if (alive) {
          setOfflineVaultStatus({ ...status, available: true, loading: false });
          setOfflineQueuedCaptures(queued);
          setOfflineStateOwnerId(activeOwnerId);
        }
      } catch {
        if (alive) {
          setOfflineVaultStatus({
            configured: false, unlocked: false, queuedCount: 0, available: false, loading: false,
          });
          setOfflineQueuedCaptures([]);
        }
      }
    };
    const onOnline = () => setOfflineOnline(true);
    const onOffline = () => setOfflineOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    void refresh();
    return () => {
      alive = false;
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [profile?.id, offlineVault]);

  const activateOfflineVault = async (event) => {
    event.preventDefault();
    if (!offlineVault || offlineVaultBusy) return;
    setOfflineVaultBusy(true);
    setOfflineVaultError('');
    setOfflineVaultNotice('');
    try {
      if (visibleOfflineVaultStatus.configured && offlineRecoveryMode) {
        await offlineVault.recoverWithRecoveryKey(offlineRecoveryKey, offlinePassphrase);
        setOfflineVaultNotice('Bóveda recuperada. La frase de desbloqueo se ha actualizado.');
      } else if (visibleOfflineVaultStatus.configured) {
        await offlineVault.unlock(offlinePassphrase);
        setOfflineVaultNotice('Bóveda privada desbloqueada en memoria.');
      } else {
        const created = await offlineVault.create(offlinePassphrase);
        setOfflineRecoveryCodeType('created');
        setOfflineRecoveryCode(created.recoveryKey);
        setOfflineVaultNotice('Bóveda creada. Guarda ahora la clave de recuperación que aparece abajo.');
      }
      setOfflinePassphrase('');
      setOfflineRecoveryKey('');
      setOfflineRecoveryMode(false);
      await refreshOfflineVaultState();
    } catch (error) {
      setOfflineVaultError(getOfflineVaultUserMessage(error));
    } finally {
      setOfflineVaultBusy(false);
    }
  };

  const rotateOfflineRecoveryKey = async (event) => {
    event.preventDefault();
    if (!offlineVault || !visibleOfflineVaultStatus.unlocked || offlineVaultBusy) return;
    setOfflineVaultBusy(true);
    setOfflineVaultError('');
    setOfflineVaultNotice('');
    try {
      const rotated = await offlineVault.rotateRecoveryKey(offlineRecoveryRotationPassphrase);
      setOfflineRecoveryCodeType('rotated');
      setOfflineRecoveryCode(rotated.recoveryKey);
      setOfflineRecoveryRotationPassphrase('');
      setOfflineRecoveryRotationMode(false);
      setOfflineVaultNotice('Clave de recuperación renovada. La anterior ya no es válida.');
      await refreshOfflineVaultState();
    } catch (error) {
      setOfflineVaultError(getOfflineVaultUserMessage(error));
    } finally {
      setOfflineVaultBusy(false);
    }
  };

  const lockOfflineVault = () => {
    offlineVault?.lock();
    setOfflinePassphrase('');
    setOfflineRecoveryRotationMode(false);
    setOfflineRecoveryRotationPassphrase('');
    setOfflineQueuedCaptures([]);
    setOfflineVaultError('');
    setOfflineVaultNotice('Bóveda bloqueada. El contenido local permanece cifrado.');
    setOfflineRecoveryMode(false);
    setOfflineRecoveryKey('');
    void refreshOfflineVaultState();
  };

  const saveOfflineCapture = async (contentOriginal) => {
    if (!offlineVault || !offlineStateMatchesOwner || !visibleOfflineVaultStatus.unlocked) {
      setOfflineVaultError('Desbloquea primero la bóveda offline para guardar texto cifrado en este dispositivo.');
      return false;
    }
    setOfflineVaultBusy(true);
    setOfflineVaultError('');
    try {
      await offlineVault.saveTextCapture({ contentOriginal });
      await refreshOfflineVaultState();
      setOfflineVaultNotice('Captura cifrada guardada solo en este dispositivo. Se sincronizará cuando recuperes conexión.');
      return true;
    } catch (error) {
      setOfflineVaultError(error?.message || 'No se pudo guardar la captura cifrada.');
      return false;
    } finally {
      setOfflineVaultBusy(false);
    }
  };

  const syncOfflineCaptures = () => runAction(async () => {
    if (!offlineOnline || profile?.offlineOnly === true) throw new Error('El perfil aún está en modo local. Reconecta y espera a que SimpleLife verifique tu cuenta antes de sincronizar.');
    if (!offlineVault || !offlineStateMatchesOwner || !visibleOfflineVaultStatus.unlocked) throw new Error('Desbloquea la bóveda offline antes de sincronizar.');
    const result = await offlineVault.syncPending(async (capture) => {
      const { data, error } = await supabase.rpc('sync_inbox_offline_text_capture', {
        p_capture_id: capture.captureId,
        p_part_id: capture.partId,
        p_content_original: capture.contentOriginal,
        p_captured_at: capture.capturedAt,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      if (!row || row.capture_id !== capture.captureId || !row.part_id) {
        throw new Error('OFFLINE_SYNC_RECEIPT_INVALID');
      }
      return { synced: true, replayed: row.replayed === true };
    });
    await refreshOfflineVaultState();
    if (result.failed > 0) {
      throw new Error(result.synced + ' captura(s) sincronizada(s); ' + result.failed + ' permanecen cifradas para reintentar.');
    }
    return result;
  }, 'Capturas offline sincronizadas.');

  const [pageOffset, setPageOffset] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [duplicateCaptureIds, setDuplicateCaptureIds] = useState([]);
  const [duplicateCheckError, setDuplicateCheckError] = useState('');
  const captureQueryGenerationRef = useRef(0);
  const duplicateRequestGenerationRef = useRef(0);
  const { rows: captureParts } = useRows('capture_part', profile, refreshKey, (query) => query.order('part_index'));
  const { rows: voiceAssets } = useRows('capture_audio_asset', profile, refreshKey, (query) => query.order('created_at', { ascending: false }).limit(50));
  const { rows: captureLinks } = useRows('capture_link', profile, refreshKey);
  const { rows: processingRuns } = useRows('processing_run', profile, refreshKey, (query) => query.order('created_at', { ascending: false }).limit(100));
  const { rows: lists } = useRows('user_list', profile, refreshKey, (query) => query
    .is('deleted_at', null).is('archived_at', null).eq('status', 'active').order('name'));
  const { rows: listItems } = useRows('list_item', profile, refreshKey, (query) => query.order('position').order('created_at'));
  const { rows: goals } = useRows('goal', profile, refreshKey, (query) => query
    .is('deleted_at', null).is('archived_at', null).order('title'));
  const { rows: subgoals } = useRows('subgoal', profile, refreshKey, (query) => query
    .is('deleted_at', null).is('archived_at', null).order('title'));
  const { rows: projects } = useRows('project', profile, refreshKey, (query) => query
    .is('deleted_at', null).is('archived_at', null).order('name'));

  const [captureSearch, setCaptureSearch] = useState('');
  const [attentionFilter, setAttentionFilter] = useState('needs_review');
  const reviewHistoryRequestRef = useRef(0);
  const proposalMetadataRequestRef = useRef(0);
  const [proposalMetadataLoading, setProposalMetadataLoading] = useState(false);
  const [proposalMetadataError, setProposalMetadataError] = useState('');
  const [reviewHistoryPartId, setReviewHistoryPartId] = useState(null);
  const [reviewHistoryRows, setReviewHistoryRows] = useState([]);
  const [reviewHistoryLoading, setReviewHistoryLoading] = useState(false);
  const [reviewHistoryError, setReviewHistoryError] = useState('');

  const buildCaptureQuery = (offset) => {
    let query = supabase.from('capture').select('*', { count: 'exact' })
      .order('captured_at', { ascending: false }).order('id', { ascending: false })
      .range(offset, offset + 99);
    if (attentionFilter === 'trash') query = query.not('deleted_at', 'is', null);
    else query = query.is('deleted_at', null);
    if (attentionFilter === 'needs_review' || attentionFilter === 'reviewed' || attentionFilter === 'archived') {
      query = query.eq('attention_status', attentionFilter);
    }
    const term = captureSearch.trim();
    if (term) query = query.textSearch('search_document', term, { config: 'simple', type: 'websearch' });
    return query;
  };

  const refreshDuplicateMatches = async (captureRows, isAlive = () => true) => {
    const requestGeneration = ++duplicateRequestGenerationRef.current;
    const isCurrent = () => isAlive() && requestGeneration === duplicateRequestGenerationRef.current;
    const ids = captureRows.map((capture) => capture.id);
    if (!ids.length) {
      if (isCurrent()) {
        setDuplicateCaptureIds([]);
        setDuplicateCheckError('');
      }
      return;
    }
    const duplicateRows = [];
    for (let offset = 0; offset < ids.length; offset += 200) {
      if (!isCurrent()) return;
      let result;
      try {
        result = await supabase.rpc('find_inbox_duplicate_captures', {
          p_capture_ids: ids.slice(offset, offset + 200),
        });
      } catch {
        result = { data: null, error: true };
      }
      if (!isCurrent()) return;
      if (result.error) {
        setDuplicateCaptureIds([]);
        setDuplicateCheckError('No se pudo verificar duplicados en todo el archivo. La lista sigue disponible, pero no marques coincidencias como únicas.');
        return;
      }
      duplicateRows.push(...(result.data || []));
    }
    if (isCurrent()) {
      setDuplicateCheckError('');
      setDuplicateCaptureIds(duplicateRows.map((row) => row.capture_id));
    }
  };

  useEffect(() => {
    let alive = true;
    const queryGeneration = ++captureQueryGenerationRef.current;
    duplicateRequestGenerationRef.current += 1;
    const isCurrentQuery = () => alive && queryGeneration === captureQueryGenerationRef.current;
    setRows([]);
    setPageOffset(0);
    setTotalCount(0);
    setHasMore(false);
    setDuplicateCaptureIds([]);
    setDuplicateCheckError('');
    setLoading(true);
    setLoadingMore(false);
    setLocalError('');
    const timer = setTimeout(async () => {
      try {
        if (globalThis.navigator?.onLine === false || profile?.offlineOnly === true) {
          if (isCurrentQuery()) {
            setLocalError(profile?.offlineOnly === true
              ? 'Verificando la identidad de tu cuenta. Mientras tanto, puedes usar la bóveda local; el archivo sincronizado se cargará al confirmar el perfil.'
              : 'Sin conexión: el archivo sincronizado no está disponible. Desbloquea la bóveda para consultar las capturas locales de este dispositivo.');
          }
          return;
        }
        const { data, error, count } = await buildCaptureQuery(0);
        if (error) throw error;
        if (!isCurrentQuery()) return;
        const loaded = data || [];
        setRows(loaded);
        setPageOffset(loaded.length);
        setTotalCount(count ?? loaded.length);
        setHasMore((count ?? loaded.length) > loaded.length);
        await refreshDuplicateMatches(loaded, isCurrentQuery);
      } catch (error) {
        if (isCurrentQuery()) setLocalError(error?.message || 'No se pudieron cargar las capturas.');
      } finally {
        if (isCurrentQuery()) setLoading(false);
      }
    }, captureSearch.trim() ? 250 : 0);
    return () => {
      alive = false;
      if (captureQueryGenerationRef.current === queryGeneration) {
        captureQueryGenerationRef.current += 1;
      }
      duplicateRequestGenerationRef.current += 1;
      clearTimeout(timer);
    };
  }, [profile?.id, profile?.offlineOnly, refreshKey, captureSearch, attentionFilter, offlineOnline]);

  const loadMoreCaptures = async () => {
    if (loadingMore || loading || !hasMore) return;
    const queryGeneration = captureQueryGenerationRef.current;
    const isCurrentQuery = () => queryGeneration === captureQueryGenerationRef.current;
    setLoadingMore(true);
    setLocalError('');
    try {
      const { data, error, count } = await buildCaptureQuery(pageOffset);
      if (!isCurrentQuery()) return;
      if (error) throw error;
      const nextRows = data || [];
      const merged = [...rows, ...nextRows];
      setRows(merged);
      setPageOffset(pageOffset + nextRows.length);
      setTotalCount(count ?? totalCount);
      setHasMore((count ?? totalCount) > pageOffset + nextRows.length);
      await refreshDuplicateMatches(merged, isCurrentQuery);
    } catch (error) {
      if (isCurrentQuery()) setLocalError(error?.message || 'No se pudieron cargar más capturas.');
    } finally {
      if (isCurrentQuery()) setLoadingMore(false);
    }
  };
  const [selectedCapture, setSelectedCapture] = useState(null);
  const [selectedPart, setSelectedPart] = useState(null);
  const [destinationType, setDestinationType] = useState('task');
  const [selectedDestinationId, setSelectedDestinationId] = useState('');
  const [clarificationRequired, setClarificationRequired] = useState(false);
  const [clarificationPrompt, setClarificationPrompt] = useState('');
  const [manualInterpretation, setManualInterpretation] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const [taskPriority, setTaskPriority] = useState('3');
  const [taskDueDate, setTaskDueDate] = useState('');
  const [eventTitle, setEventTitle] = useState('');
  const [eventDate, setEventDate] = useState('');
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
    if (link?.calendar_event_id) return 'event';
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

  const visibleCaptures = useMemo(() => rows.filter((capture) => {
    const parts = captureParts.filter((item) => item.capture_id === capture.id);
    const organized = parts.length > 0 && parts.every((part) => captureLinks.some((link) => link.capture_part_id === part.id && link.link_status === 'confirmed'));
    return attentionFilter === 'trash'
      ? Boolean(capture.deleted_at)
      : !capture.deleted_at && (attentionFilter === 'all'
        || (attentionFilter === 'needs_review' && capture.attention_status === 'needs_review' && !organized)
        || (attentionFilter === 'reviewed' && capture.attention_status === 'reviewed' && !organized)
        || (attentionFilter === 'organized' && organized)
        || (attentionFilter === 'archived' && capture.attention_status === 'archived'));
  }), [rows, captureParts, captureLinks, attentionFilter]);

  const updateAttention = (capture, nextStatus) => runAction(async () => {
    const { data, error } = await supabase.rpc('set_inbox_capture_attention_status', {
      p_capture_id: capture.id,
      p_attention_status: nextStatus,
      p_audit_id: uuidv7(),
    });
    if (error) throw error;
    if (data !== true) throw new Error('No se pudo actualizar la captura. Puede que ya no exista o no pertenezca a esta cuenta.');
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

  const toggleReviewHistory = async (part) => {
    const requestToken = ++reviewHistoryRequestRef.current;
    if (reviewHistoryPartId === part.id) {
      setReviewHistoryPartId(null);
      setReviewHistoryRows([]);
      setReviewHistoryError('');
      setReviewHistoryLoading(false);
      return;
    }
    setReviewHistoryPartId(part.id);
    setReviewHistoryRows([]);
    setReviewHistoryError('');
    setReviewHistoryLoading(true);
    try {
      const { data, error } = await supabase.from('audit_event')
        .select('id,occurred_at,details')
        .eq('entity_type', 'capture_part')
        .eq('entity_id', part.id)
        .eq('action', 'capture.part_reviewed')
        .order('occurred_at', { ascending: false })
        .limit(30);
      if (error) throw error;
      if (requestToken === reviewHistoryRequestRef.current) setReviewHistoryRows(data || []);
    } catch (error) {
      if (requestToken === reviewHistoryRequestRef.current) {
        setReviewHistoryError(error?.message || 'No se pudo cargar el historial de revisión.');
      }
    } finally {
      if (requestToken === reviewHistoryRequestRef.current) setReviewHistoryLoading(false);
    }
  };

  const queueAndProcess = async (captureId) => {
    const queued = await supabase.functions.invoke('inbox-processing-queue', {
      body: { captureId, idempotencyKey: uuidv7() },
    });
    if (queued.error) throw queued.error;
    if (!queued.data?.runId) throw new Error('No se recibió el identificador del procesamiento.');
    const processed = await supabase.functions.invoke('inbox-processing-process', { body: { runId: queued.data.runId } });
    if (processed.error) throw processed.error;
    if (processed.data?.status === 'not_claimable') throw new Error('El trabajo sigue en cola; vuelve a intentarlo.');
  };

  const processCapture = (capture) => {
    setProcessingErrorsByCapture((current) => {
      const next = { ...current };
      delete next[capture.id];
      return next;
    });
    return runAction(
      () => queueAndProcess(capture.id),
      'Propuestas preparadas. Revisa cada fragmento; no se creó ningún destino automáticamente.',
      {
        onError: (error) => {
          const message = String(error?.message || '');
          const userMessage = /Failed to send a request to the Edge Function|Failed to fetch|NetworkError|Load failed/i.test(message)
            ? 'No se pudo conectar con el servicio de procesamiento. Comprueba la conexión y vuelve a intentarlo.'
            : (message || 'Ocurrió un error inesperado al preparar las sugerencias.');
          setProcessingErrorsByCapture((current) => ({ ...current, [capture.id]: userMessage }));
        },
      },
    );
  };

  const submit = async (contentOriginal) => runAction(async () => {
    let captureId;
    let initialPartFailed = false;
    setCaptureRecoveryError('');
    try {
      const saved = await persistTextCapture({
        supabase, ownerUserId: profile.id, contentOriginal, createId: uuidv7,
      });
      captureId = saved.captureId;
    } catch (error) {
      if (!(error instanceof CapturePartPersistenceError)) throw error;
      // The source capture is already durable. Treat it as saved so the composer
      // clears and a second submit cannot create a duplicate capture.
      captureId = error.captureId;
      initialPartFailed = true;
    }

    // A processing outage never invalidates a successfully saved source capture.
    let processingSucceeded = false;
    try {
      await queueAndProcess(captureId);
      processingSucceeded = true;
    } catch { /* retry remains available from the Inbox row */ }

    if (initialPartFailed && !processingSucceeded) {
      setCaptureRecoveryError('El texto ya está guardado. Falló la preparación inicial del fragmento y tampoco se pudo procesar automáticamente. No lo vuelvas a enviar: recupera esta misma captura con “Organizar” o “Generar sugerencias”.');
    }
  }, 'Captura guardada.');
  const openOrganizer = async (capture, part = getCapturePart(capture.id)) => {
    try {
      if (!part) {
        if (capture.processing_status === 'processed') {
          throw new Error('Esta captura ya fue procesada, pero faltan sus fragmentos. No se reconstruirá una propuesta procesada sin recuperar primero su historial.');
        }
        const candidate = {
          id: uuidv7(),
          capture_id: capture.id,
          part_index: 0,
          original_fragment: capture.content_original,
        };
        // A previous capture may have been saved before its initial part insert failed.
        // Recreate that first part from the immutable source, then read the row back under RLS.
        const { error: recoveryInsertError } = await supabase.from('capture_part').insert(candidate);
        // Another tab/session may win the unique (capture_id, part_index) insert.
        // Re-read under RLS even after a conflict and reuse only the exact source row.
        const { data: recoveredParts, error: recoveryError } = await supabase.from('capture_part')
          .select('*')
          .eq('capture_id', capture.id)
          .order('part_index')
          .limit(1);
        if (recoveryError) throw recoveryError;
        part = Array.isArray(recoveredParts) ? recoveredParts[0] : recoveredParts;
        if (!part) {
          if (recoveryInsertError) throw recoveryInsertError;
          throw new Error('No se pudo recuperar el fragmento inicial de esta captura.');
        }
        if (part.part_index !== 0 || part.original_fragment !== capture.content_original) {
          throw new Error('El fragmento inicial existente no coincide con el texto original. La captura permanece intacta y requiere revisión.'); 
        }
      }
    } catch (error) {
      setCaptureRecoveryError(error?.message || 'No se pudo recuperar la captura original.');
      return;
    }
    setCaptureRecoveryError('');
    setSelectedCapture(capture);
    setSelectedPart(part);
    const source = String(part?.original_fragment || capture.content_original || '');
    const suggestedDestination = getSuggestedDestinationType(part?.category);
    const requestToken = ++proposalMetadataRequestRef.current;
    const isProcessed = capture.processing_status === 'processed';
    setProposalMetadataLoading(isProcessed);
    setProposalMetadataError('');
    setClarificationRequired(false);
    setClarificationPrompt('');
    setManualInterpretation('');
    setDestinationType(suggestedDestination);
    const suggestedTargets = suggestedDestination === 'goal' ? goals
      : suggestedDestination === 'subgoal' ? subgoals
        : suggestedDestination === 'project' ? projects : [];
    setSelectedDestinationId(suggestedTargets[0]?.id || '');
    setTaskTitle(source.slice(0, 240));
    setTaskPriority('3');
    setTaskDueDate('');
    setEventTitle(source.slice(0, 200));
    setEventDate('');
    setNoteTitle('');
    setListMode('new');
    setSelectedListId(lists[0]?.id || '');
    setNewListName(String(part?.original_fragment || capture.content_original || '').slice(0, 200));
    setListItemText(String(part?.original_fragment || capture.content_original || '').slice(0, 500));
    setOperationIds({ partId: part?.id || uuidv7(), targetId: uuidv7(), itemId: uuidv7(), linkId: uuidv7() });

    if (isProcessed) {
      void (async () => {
        try {
          const { data, error } = await supabase.from('processing_run')
            .select('result')
            .eq('capture_id', capture.id)
            .order('created_at', { ascending: false })
            .limit(1);
          if (error) throw error;
          const latestRun = Array.isArray(data) ? data[0] : null;
          const proposals = latestRun?.result?.proposals;
          const proposal = Array.isArray(proposals)
            ? proposals.find((item) => item.partIndex === (part?.part_index ?? 0))
            : null;
          if (!proposal) {
            throw new Error('No se encontró la propuesta de esta parte en el historial de procesamiento.');
          }
          if (requestToken !== proposalMetadataRequestRef.current) return;
          setClarificationRequired(Boolean(proposal.requiresClarification));
          setClarificationPrompt(proposal.clarificationPrompt || 'La sugerencia es ambigua. Explica brevemente qué significa.');
        } catch (error) {
          if (requestToken === proposalMetadataRequestRef.current) {
            setClarificationRequired(true);
            setClarificationPrompt('No se pudo recuperar la aclaración de esta propuesta. Explica qué significa antes de confirmar.');
            setProposalMetadataError(error?.message || 'No se pudieron verificar los metadatos de procesamiento.');
          }
        } finally {
          if (requestToken === proposalMetadataRequestRef.current) setProposalMetadataLoading(false);
        }
      })();
    }
  };

  const closeOrganizer = () => {
    if (busy) return;
    proposalMetadataRequestRef.current += 1;
    setProposalMetadataLoading(false);
    setProposalMetadataError('');
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
    if (!isInboxDestinationReady(destinationType) || proposalMetadataLoading) return;
    if (clarificationRequired && !manualInterpretation.trim()) return;
    if (!selectedCapture || !selectedPart || !operationIds || getConfirmedLink(selectedCapture.id, selectedPart.id)) return;
    const sourceText = String(selectedPart.original_fragment || selectedCapture.content_original || '');
    if (!sourceText.trim()) return;
    if (destinationType === 'task' && !taskTitle.trim()) return;
    if (['goal', 'subgoal', 'project'].includes(destinationType) && !selectedDestinationId) return;
    if (destinationType === 'event' && (!eventTitle.trim() || !eventDate)) return;
    if (destinationType === 'list' && listMode === 'new' && !newListName.trim()) return;
    if (destinationType === 'list' && listMode === 'existing' && !selectedListId) return;
    if (destinationType === 'list' && !listItemText.trim()) return;

    const ids = operationIds;
    const selectedList = lists.find((list) => list.id === selectedListId);
    const selectedGoal = destinationType === 'goal' ? goals.find((goal) => goal.id === selectedDestinationId) : null;
    const selectedSubgoal = destinationType === 'subgoal' ? subgoals.find((subgoal) => subgoal.id === selectedDestinationId) : null;
    const selectedProject = destinationType === 'project' ? projects.find((project) => project.id === selectedDestinationId) : null;
    const category = destinationType === 'task' ? 'task'
      : destinationType === 'event' ? 'event'
        : destinationType === 'goal' || destinationType === 'subgoal' ? 'goal_subgoal'
          : destinationType === 'project' ? 'project'
            : destinationType === 'note' || destinationType === 'idea' ? 'note_idea' : 'list';
    const interpretation = destinationType === 'task' ? 'Clasificación manual confirmada: tarea.'
      : destinationType === 'event' ? 'Clasificación manual confirmada: evento de Agenda.'
        : destinationType === 'goal' ? 'Clasificación manual confirmada: meta existente.'
          : destinationType === 'subgoal' ? 'Clasificación manual confirmada: submeta existente.'
            : destinationType === 'project' ? 'Clasificación manual confirmada: proyecto existente.'
              : destinationType === 'note' ? 'Clasificación manual confirmada: nota.'
                : destinationType === 'idea' ? 'Clasificación manual confirmada: idea.'
                  : 'Clasificación manual confirmada: lista.';
    const resolvedInterpretation = manualInterpretation.trim() || interpretation;
    const successMessage = destinationType === 'task' ? 'Captura organizada como tarea.'
      : destinationType === 'event' ? 'Evento creado en Agenda y vinculado al Inbox.'
        : destinationType === 'goal' ? 'Captura vinculada a la meta existente.'
          : destinationType === 'subgoal' ? 'Captura vinculada a la submeta existente.'
            : destinationType === 'project' ? 'Captura vinculada al proyecto existente.'
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
      } else if (destinationType === 'event') {
        const [year, month, day] = eventDate.split('-').map(Number);
        const endDateExclusive = new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
        const { data: eventData, error: eventError } = await supabase.functions.invoke('agenda-event-create', {
          body: { event: {
            title: eventTitle.trim(), temporalKind: 'all_day',
            startDate: eventDate, endDateExclusive,
          } },
          headers: { 'Idempotency-Key': ids.targetId },
        });
        if (eventError) throw eventError;
        if (!eventData?.eventId) throw new Error('Agenda no devolvió el identificador del evento.');
        linkTarget = { calendar_event_id: eventData.eventId };
      } else if (destinationType === 'goal' && selectedGoal) {
        linkTarget = { goal_id: selectedGoal.id };
      } else if (destinationType === 'subgoal' && selectedSubgoal) {
        linkTarget = { subgoal_id: selectedSubgoal.id };
      } else if (destinationType === 'project' && selectedProject) {
        linkTarget = { project_id: selectedProject.id };
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
        p_capture_part_id: partId, p_category: category, p_interpretation: resolvedInterpretation,
        p_review_status: 'accepted', p_audit_id: uuidv7(),
      });
      if (partError) throw partError;
      if (partUpdate !== true) throw new Error('El elemento fue creado, pero no se pudo confirmar su clasificación. Reintenta esta misma operación.');

      const storedParts = getCaptureParts(selectedCapture.id);
      // A just-recovered initial part is not in the hook's current snapshot yet.
      const allParts = storedParts.some((part) => part.id === partId)
        ? storedParts
        : [...storedParts, selectedPart];
      const allPartsConfirmed = allParts.length > 0 && allParts.every((part) => part.id === partId
        || captureLinks.some((link) => link.capture_part_id === part.id && link.link_status === 'confirmed'));
      const { data: captureUpdate, error: captureError } = await supabase.rpc('set_inbox_capture_attention_status', {
        p_capture_id: selectedCapture.id,
        p_attention_status: allPartsConfirmed ? 'reviewed' : 'needs_review',
        p_audit_id: uuidv7(),
      });
      if (captureError) throw captureError;
      if (captureUpdate !== true) throw new Error('El elemento quedó creado, pero no se pudo actualizar el estado de su captura.');
    }, successMessage);

    if (saved) closeOrganizer();
  };

  const attentionLabels = { needs_review: 'Pendiente de revisión', reviewed: 'Revisada', archived: 'Archivada' };
  const typeLabels = { task: 'Tarea', note_idea: 'Nota o idea', list: 'Lista', event: 'Evento', goal_subgoal: 'Meta / submeta', project: 'Proyecto' };
  const openOrganizedTarget = (link) => {
    const kind = getLinkKind(link);
    if (kind === 'task') { setMorePage('tasks'); setActivePage('more'); }
    else if (kind === 'note_idea') { setMorePage('notes'); setActivePage('more'); }
    else if (kind === 'list') { setMorePage('lists'); setActivePage('more'); }
    else if (kind === 'event') { setActivePage('agenda'); setMorePage(null); }
    else if (kind === 'goal_subgoal') { setActivePage('goals'); setMorePage(null); }
    else if (kind === 'project') { setActivePage('projects'); setMorePage(null); }
  };

  return <div className="inbox-layout">
    <OfflineVaultPanel
      status={{ ...visibleOfflineVaultStatus, available: visibleOfflineVaultStatus.available && Boolean(offlineVault), online: offlineOnline }}
      passphrase={offlinePassphrase}
      setPassphrase={setOfflinePassphrase}
      recoveryMode={offlineRecoveryMode}
      setRecoveryMode={setOfflineRecoveryMode}
      recoveryKey={offlineRecoveryKey}
      setRecoveryKey={setOfflineRecoveryKey}
      recoveryCode={offlineRecoveryCode}
      recoveryCodeType={offlineRecoveryCodeType}
      onDismissRecoveryCode={() => {
        setOfflineRecoveryCode('');
        setOfflineRecoveryCodeType('created');
      }}
      recoveryRotationMode={offlineRecoveryRotationMode}
      setRecoveryRotationMode={setOfflineRecoveryRotationMode}
      recoveryRotationPassphrase={offlineRecoveryRotationPassphrase}
      setRecoveryRotationPassphrase={setOfflineRecoveryRotationPassphrase}
      onRotateRecoveryKey={rotateOfflineRecoveryKey}
      busy={offlineVaultBusy}
      error={offlineVaultError}
      notice={offlineVaultNotice}
      queuedCaptures={visibleOfflineQueuedCaptures}
      online={offlineOnline && profile?.offlineOnly !== true}
      onCreateOrUnlock={activateOfflineVault}
      onLock={lockOfflineVault}
      onSync={syncOfflineCaptures}
    />
    <CaptureComposer
      busy={busy || offlineVaultBusy}
      offlineOnly={profile?.offlineOnly === true}
      onSubmit={submit}
      onSaveOffline={visibleOfflineVaultStatus.unlocked && offlineStateMatchesOwner ? saveOfflineCapture : undefined}
      onOfflineUnavailable={() => setOfflineVaultError('No hay conexión. Para guardar sin conexión, crea o desbloquea la bóveda privada primero.')}
    />
    <VoiceCapture profile={profile} busy={busy || offlineVaultBusy || profile?.offlineOnly === true} runAction={runAction} />
    {voiceAssets.filter((asset) => !asset.capture_id).length > 0 && (
      <section className="voice-asset-list" aria-label="Audios privados pendientes">
        <strong>Audios privados pendientes</strong>
        {voiceAssets.filter((asset) => !asset.capture_id).map((asset) => (
          <div className="voice-asset-row" key={asset.id}>
            <span>Audio original · {asset.status === 'uploaded' ? 'esperando transcripción' : asset.status === 'failed' ? 'falló la preparación' : 'preparándose'}</span>
            {asset.retention_until && <small>Retención temporal hasta {new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(asset.retention_until))}</small>}
          </div>
        ))}
      </section>
    )}
    <div className="inbox-list-wrap">
      <SectionTitle detail={visibleCaptures.length + ' visibles · ' + rows.length + ' cargadas de ' + totalCount + ' coincidencias en el archivo'}>Capturado recientemente</SectionTitle>
      {captureRecoveryError && <div className="form-error" role="alert">{captureRecoveryError}</div>}
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
      {loading ? <p className="muted">Cargando…</p> : localError ? <div className="form-error">{localError}</div> : totalCount > 0 ? visibleCaptures.length ? (
        <div className="capture-list">{visibleCaptures.map((capture) => {
          const parts = getCaptureParts(capture.id);
          const part = parts[0];
          // A processed/manual-reviewed fragment must never be sent back through
          // the whole-capture processor, which correctly refuses to overwrite it.
          const canProcessCapture = parts.length === 0
            || parts.every((capturePart) => capturePart.review_status === 'unreviewed');
          const confirmedLink = getConfirmedLink(capture.id);
          const processingRun = processingRuns.find((run) => run.capture_id === capture.id);
          const proposals = processingRun?.result?.proposals || [];
          const linkKind = getLinkKind(confirmedLink);
          const label = part?.category === 'task' ? 'Tarea'
            : part?.category === 'note_idea' ? 'Nota o idea'
              : part?.category === 'list' ? 'Lista' : typeLabels[linkKind] || 'Elemento';
          const normalizedSource = normalizeCaptureForDuplicate(capture.content_original);
          const possibleDuplicate = !capture.deleted_at && normalizedSource.length > 3
            && duplicateCaptureIds.includes(capture.id);
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
                  {capturePart.review_status !== 'unreviewed' && <div className="capture-part-history">
                    <button type="button" className="capture-action-button" disabled={busy || reviewHistoryLoading && reviewHistoryPartId !== capturePart.id} onClick={() => toggleReviewHistory(capturePart)}>
                      {reviewHistoryPartId === capturePart.id ? 'Ocultar historial' : 'Ver historial'}
                    </button>
                    {reviewHistoryPartId === capturePart.id && <div className="capture-history-list" aria-live="polite">
                      {reviewHistoryLoading ? <p className="muted">Cargando historial…</p>
                        : reviewHistoryError ? <p className="form-error">{reviewHistoryError}</p>
                          : reviewHistoryRows.length ? reviewHistoryRows.map((entry) => {
                            const details = entry.details || {};
                            const categoryLabels = { task: 'Tarea', event: 'Evento', request: 'Solicitud', habit: 'Hábito', goal_subgoal: 'Meta / submeta', project: 'Proyecto', note_idea: 'Nota / idea', list: 'Lista' };
                            return <div className="capture-history-entry" key={entry.id}>
                              <small>{new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Havana' }).format(new Date(entry.occurred_at))}</small>
                              <strong>{categoryLabels[details.category_before] || 'Sin categoría'} → {categoryLabels[details.category_after] || 'Sin categoría'}</strong>
                              {details.interpretation_before != null && <p>Antes: {details.interpretation_before}</p>}
                              {details.interpretation_after != null && <p>Después: {details.interpretation_after}</p>}
                              <span>{details.review_status_before || '—'} → {details.review_status_after || '—'}</span>
                            </div>;
                          }) : <p className="muted">No hay cambios de revisión registrados.</p>}
                    </div>}
                  </div>}
                  {capturePart.original_fragment !== capture.content_original && <p>{capturePart.original_fragment}</p>}
                  {partLink ? <span className="muted">Destino vinculado y trazable.</span> : <>
                    <button type="button" className="capture-action-button" disabled={busy || capture.attention_status === 'archived' || Boolean(capture.deleted_at)} onClick={() => openOrganizer(capture, capturePart)}>Revisar y confirmar destino</button>
                    {capture.processing_status === 'processed' && capturePart.review_status === 'unreviewed' && !capture.deleted_at && <button type="button" className="capture-action-button capture-archive-button" disabled={busy} onClick={() => discardPartSuggestion(capturePart)}>Descartar sugerencia</button>}
                    {capturePart.review_status === 'rejected' && <span className="muted">Sugerencia descartada por el propietario.</span>}
                  </>}
                </div>;
              })}
              <div className="capture-row-actions">
                {confirmedLink
                  ? <span className="capture-status capture-status-organized">Organizada · {label}{capture.attention_status === 'archived' ? ' · Archivada' : ''}</span>
                  : <span className={'capture-status capture-status-' + capture.attention_status}>{attentionLabels[capture.attention_status] || 'Pendiente de revisión'}</span>}
                {capture.deleted_at ? <button type="button" className="capture-action-button" disabled={busy} onClick={() => restoreTrashedCapture(capture)}>Restaurar desde papelera</button> : <>
                {capture.processing_status !== 'processed' && capture.attention_status !== 'archived' && canProcessCapture ? <button type="button" className="capture-action-button" disabled={busy} onClick={() => processCapture(capture)}>{capture.processing_status === 'queued' || capture.processing_status === 'processing' ? 'Reintentar procesamiento' : 'Generar sugerencias'}</button> : null}
                {confirmedLink ? (
                  <>
                    <button type="button" className="capture-action-button" onClick={() => openOrganizedTarget(confirmedLink)}>{'Abrir ' + ({ event: 'Agenda', task: 'tareas', note_idea: 'notas e ideas', list: 'listas', goal_subgoal: 'metas', project: 'proyectos' }[linkKind] || 'destino')} →</button>
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
              {processingErrorsByCapture[capture.id] && (
                <div className="form-error capture-processing-error" role="alert" aria-live="assertive">
                  No se pudieron generar las sugerencias. {processingErrorsByCapture[capture.id]} Tu captura original sigue guardada.
                </div>
              )}
            </div>
          </div>;
        })}</div>
      ) : <EmptyState title="No hay coincidencias" detail="Cambia la búsqueda o el filtro para encontrar otras capturas." icon="⌕" />
      : captureSearch.trim() || attentionFilter !== 'needs_review'
        ? <EmptyState title="No hay coincidencias" detail="Cambia la búsqueda o el filtro para encontrar otras capturas." icon="⌕" />
        : <EmptyState title="El Inbox está vacío" detail="Empieza escribiendo cualquier cosa que no quieras olvidar." /> }
      {hasMore && <div className="capture-pagination">
        <button type="button" className="capture-action-button" disabled={loadingMore || loading} onClick={loadMoreCaptures}>
          {loadingMore ? 'Cargando…' : 'Cargar más capturas'}
        </button>
      </div>}
      {duplicateCheckError && <p className="form-error" role="status">{duplicateCheckError}</p>}
    </div>
    <div className="honest-note"><span>ⓘ</span><p>Las sugerencias actuales se generan con reglas locales deterministas (no con un modelo de IA) y son orientativas. Cada fragmento conserva el texto original; ningún destino se crea sin tu confirmación. Las grabaciones de voz se guardan en almacenamiento privado asociado a tu cuenta, pero todavía no se transcriben ni se envían a un modelo. El modo sin conexión cifra las capturas en este dispositivo; guarda tu clave de recuperación fuera del dispositivo y desbloquea la bóveda para consultar o sincronizar la cola al reconectar.</p></div>

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
              <option value="task">Tarea</option><option value="event">Evento de Agenda</option><option value="goal">Meta existente</option><option value="subgoal">Submeta existente</option><option value="project">Proyecto existente</option><option value="note">Nota</option><option value="idea">Idea</option><option value="list">Lista</option>
              <option value="request">Solicitud · destino pendiente (Fase 7)</option><option value="habit">Hábito · destino pendiente (Fase 4)</option>
            </select></label>
            {destinationType === 'request' && <p className="capture-organizer-help" role="status">La clasificación se conserva como Solicitud. Su flujo de destino aún no existe; no se creará una tarea ni otro registro por sustitución. Puedes elegir otro tipo solo si deseas convertirla manualmente.</p>}
            {destinationType === 'habit' && <p className="capture-organizer-help" role="status">La clasificación se conserva como Hábito. El sistema de hábitos aún no está implementado; no se creará una tarea ni otro registro por sustitución. Puedes elegir otro tipo solo si deseas convertirla manualmente.</p>}
            <label className="field"><span>{clarificationRequired ? 'Aclaración necesaria para continuar' : 'Interpretación / aclaración (opcional)'}</span>
              <textarea aria-label="Aclaración / interpretación" maxLength={1000} rows={3} value={manualInterpretation} onChange={(event) => setManualInterpretation(event.target.value)} placeholder={clarificationRequired ? clarificationPrompt : 'Describe brevemente qué significa o qué quieres hacer con esta captura…'} required={clarificationRequired} disabled={busy} />
            </label>
            {proposalMetadataLoading && <p className="capture-organizer-help" role="status">Verificando si la sugerencia necesita aclaración…</p>}
            {proposalMetadataError && <p className="form-error" role="alert">{proposalMetadataError} Se exige una aclaración manual para continuar.</p>}
            {clarificationRequired && <p className="capture-organizer-help" role="status">{clarificationPrompt} Añade una aclaración antes de confirmar; el texto original no cambiará.</p>}
            {destinationType === 'task' && <>
              <label className="field"><span>Título de la tarea</span><input aria-label="Título de la tarea" maxLength={240} value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} required disabled={busy} /></label>
              <div className="capture-organizer-two-col">
                <label className="field"><span>Prioridad</span><select aria-label="Prioridad de la tarea" value={taskPriority} onChange={(event) => setTaskPriority(event.target.value)} disabled={busy}><option value="1">Muy alta</option><option value="2">Alta</option><option value="3">Normal</option><option value="4">Baja</option><option value="5">Flexible</option></select></label>
                <label className="field"><span>Fecha objetivo (opcional)</span><input aria-label="Fecha objetivo" type="date" value={taskDueDate} onChange={(event) => setTaskDueDate(event.target.value)} disabled={busy} /></label>
              </div>
              <p className="capture-organizer-help">El texto completo de la captura quedará guardado en la descripción de la tarea.</p>
            </>}
            {destinationType === 'event' && <>
              <label className="field"><span>Nombre del evento</span><input aria-label="Nombre del evento" maxLength={200} value={eventTitle} onChange={(event) => setEventTitle(event.target.value)} required disabled={busy} /></label>
              <label className="field"><span>Fecha del evento</span><input aria-label="Fecha del evento" type="date" value={eventDate} onChange={(event) => setEventDate(event.target.value)} required disabled={busy} /></label>
              <p className="capture-organizer-help">El evento se crea en Agenda como compromiso de día completo. La creación respeta los conflictos de tiempo protegido y usa una clave de idempotencia estable para evitar duplicados si reintentas.</p>
            </>}
            {destinationType === 'goal' && <label className="field"><span>Meta existente</span><select aria-label="Meta existente" value={selectedDestinationId} onChange={(event) => setSelectedDestinationId(event.target.value)} required disabled={busy}><option value="">Selecciona una meta</option>{goals.map((goal) => <option key={goal.id} value={goal.id}>{goal.title}</option>)}</select></label>}
            {destinationType === 'subgoal' && <label className="field"><span>Submeta existente</span><select aria-label="Submeta existente" value={selectedDestinationId} onChange={(event) => setSelectedDestinationId(event.target.value)} required disabled={busy}><option value="">Selecciona una submeta</option>{subgoals.map((subgoal) => { const parent = goals.find((goal) => goal.id === subgoal.goal_id); return <option key={subgoal.id} value={subgoal.id}>{(parent?.title ? parent.title + ' · ' : '') + subgoal.title}</option>; })}</select></label>}
            {destinationType === 'project' && <label className="field"><span>Proyecto existente</span><select aria-label="Proyecto existente" value={selectedDestinationId} onChange={(event) => setSelectedDestinationId(event.target.value)} required disabled={busy}><option value="">Selecciona un proyecto</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>}
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
            <div className="capture-organizer-actions"><button type="button" className="capture-action-button" onClick={closeOrganizer} disabled={busy}>Cancelar</button><button type="submit" className="button button-primary" disabled={busy || proposalMetadataLoading || !operationIds || !isInboxDestinationReady(destinationType) || (clarificationRequired && !manualInterpretation.trim())}>{busy ? 'Organizando…' : isInboxDestinationReady(destinationType) ? 'Confirmar y organizar' : 'Destino aún no disponible'} <span>→</span></button></div>
          </form>
        </section>
      </div>
    )}
  </div>;
}
