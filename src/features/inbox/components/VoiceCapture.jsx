import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../../lib/supabase.js';
import { uuidv7 } from '../../../lib/uuidv7.js';

import { canAppendAudioChunk, MAX_AUDIO_BYTES } from '../domain/voice-capture-policy.js';
const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4',
  'audio/wav',
];

function toHex(buffer) {
  return [...new Uint8Array(buffer)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function fileExtension(mimeType) {
  if (mimeType.includes('ogg')) return 'ogg';
  if (mimeType.includes('mp4')) return 'm4a';
  if (mimeType.includes('wav')) return 'wav';
  if (mimeType.includes('mpeg')) return 'mp3';
  return 'webm';
}

export function VoiceCapture({ profile, busy = false, runAction }) {
  const [recording, setRecording] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const recordedBytesRef = useRef(0);
  const audioLimitExceededRef = useRef(false);
  const recordingFailedRef = useRef(false);

  const supported = Boolean(
    globalThis.navigator?.mediaDevices?.getUserMedia
      && globalThis.MediaRecorder
      && globalThis.crypto?.subtle
      && supabase,
  );

  useEffect(() => () => {
    const recorder = recorderRef.current;
    if (recorder) {
      // Leaving the Inbox cancels the unfinished recording; it must not trigger
      // an unexpected upload from the recorder's asynchronous stop event.
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.onerror = null;
      try {
        if (recorder.state && recorder.state !== 'inactive') recorder.stop();
      } catch { /* release microphone tracks below */ }
    }
    recorderRef.current = null;
    chunksRef.current = [];
    recordedBytesRef.current = 0;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const savePrivateAudio = async (blob) => {
    if (!profile?.id || !supabase) throw new Error('VOICE_CAPTURE_REQUIRES_SIGNED_IN_OWNER');
    if (!blob.size || blob.size > MAX_AUDIO_BYTES) {
      throw new Error('La grabación supera el límite privado de 25 MiB.');
    }

    const mimeType = (blob.type || 'audio/webm').split(';')[0].toLowerCase();
    if (!['audio/webm','audio/ogg','audio/mp4','audio/wav','audio/mpeg'].includes(mimeType)) {
      throw new Error('El formato de audio del navegador no está permitido.');
    }

    const assetId = uuidv7();
    const objectPath = profile.id + '/' + assetId + '/source.' + fileExtension(mimeType);
    const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    const sha256Hex = toHex(digest);

    const { error: metadataError } = await supabase.from('capture_audio_asset').insert({
      id: assetId,
      owner_user_id: profile.id,
      created_by_user_id: profile.id,
      bucket_id: 'inbox-voice-private',
      object_path: objectPath,
      mime_type: mimeType,
      file_size_bytes: blob.size,
      sha256_hex: sha256Hex,
      status: 'uploading',
    });
    if (metadataError) throw metadataError;

    const { error: uploadError } = await supabase.storage
      .from('inbox-voice-private')
      .upload(objectPath, blob, { contentType: mimeType, upsert: false, cacheControl: '0' });
    if (uploadError) throw uploadError;

    const { data, error: finalizeError } = await supabase.functions.invoke('inbox-voice-finalize', {
      body: { assetId },
    });
    if (finalizeError) throw finalizeError;
    if (data?.verified !== true || data?.assetId !== assetId) {
      throw new Error('VOICE_UPLOAD_FINALIZATION_NOT_CONFIRMED');
    }
    return assetId;
  };

  const handleStop = () => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;
    recorder.stop();
    setRecording(false);
  };

  const handleStart = async () => {
    setError('');
    setNotice('');
    if (!supported) {
      setError('Este navegador no permite grabar audio de forma compatible.');
      return;
    }
    if (!profile?.id || busy || uploading) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = MIME_CANDIDATES.find((candidate) => MediaRecorder.isTypeSupported(candidate));
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      chunksRef.current = [];
      recordedBytesRef.current = 0;
      audioLimitExceededRef.current = false;
      recordingFailedRef.current = false;
      recorder.ondataavailable = (event) => {
        if (!event.data?.size || audioLimitExceededRef.current || recordingFailedRef.current) return;
        if (!canAppendAudioChunk(recordedBytesRef.current, event.data.size)) {
          audioLimitExceededRef.current = true;
          chunksRef.current = [];
          recordedBytesRef.current = 0;
          setError('La grabación superó el límite de 25 MiB y se descartó. Inicia una nueva grabación.');
          setRecording(false);
          try {
            if (recorder.state !== 'inactive') recorder.stop();
          } catch { /* best effort */ }
          return;
        }
        recordedBytesRef.current += event.data.size;
        chunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        recordingFailedRef.current = true;
        chunksRef.current = [];
        recordedBytesRef.current = 0;
        setError('La grabación se interrumpió. El audio parcial se descartó.');
        setRecording(false);
        try {
          if (recorder.state !== 'inactive') recorder.stop();
        } catch { /* best effort */ }
      };
      recorder.onstop = () => {
        const limitExceeded = audioLimitExceededRef.current;
        const recordingFailed = recordingFailedRef.current;
        audioLimitExceededRef.current = false;
        recordingFailedRef.current = false;
        const recordedChunks = chunksRef.current;
        chunksRef.current = [];
        recordedBytesRef.current = 0;
        const audioType = recorder.mimeType || recordedChunks[0]?.type || mimeType || 'audio/webm';
        const blob = new Blob(recordedChunks, { type: audioType });
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        recorderRef.current = null;
        if (limitExceeded) {
          setError('La grabación superó el límite de 25 MiB y se descartó. Inicia una nueva grabación.');
          return;
        }
        if (recordingFailed) {
          setError('La grabación se interrumpió. El audio parcial se descartó.');
          return;
        }
        if (!blob.size) {
          setError('La grabación quedó vacía; vuelve a intentarlo.');
          return;
        }
        setUploading(true);
        const operation = async () => {
          const assetId = await savePrivateAudio(blob);
          setNotice('Audio original guardado en almacenamiento privado. La transcripción permanece pendiente hasta configurar un proveedor aprobado.');
          return assetId;
        };
        const save = async () => {
          if (runAction) {
            const succeeded = await runAction(operation, 'Audio guardado de forma privada.');
            if (!succeeded) setError('No se pudo guardar el audio privado. El registro permanece en estado temporal y expirará automáticamente.');
            return;
          }
          await operation();
        };
        void save()
          .catch((uploadFailure) => setError(uploadFailure?.message || 'No se pudo guardar el audio privado.'))
          .finally(() => setUploading(false));
      };
      recorder.start(1000);
      recorderRef.current = recorder;
      setRecording(true);
    } catch (startError) {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setRecording(false);
      setError(startError?.name === 'NotAllowedError'
        ? 'El navegador denegó el permiso del micrófono.'
        : startError?.message || 'No se pudo iniciar el micrófono.');
    }
  };

  return (
    <section className="voice-capture-panel" aria-label="Captura de voz privada">
      <div className="voice-capture-copy">
        <strong>Captura por voz</strong>
        <p>La grabación se sube a un bucket privado, vinculada a tu perfil. No se publica ni se envía a un modelo automáticamente.</p>
      </div>
      <div className="voice-capture-actions">
        {!recording ? (
          <button type="button" className="capture-action-button" onClick={handleStart} disabled={!supported || busy || uploading}>
            {uploading ? 'Guardando audio…' : 'Grabar audio'}
          </button>
        ) : (
          <button type="button" className="capture-action-button capture-archive-button" onClick={handleStop}>
            Detener y guardar
          </button>
        )}
        {recording && <span className="voice-recording-indicator">Grabando…</span>}
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="offline-vault-notice" role="status">{notice}</p>}
      <small>Formato privado · máximo 25 MiB · los audios no vinculados caducan en 7 días.</small>
    </section>
  );
}
