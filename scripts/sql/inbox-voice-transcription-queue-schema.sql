-- Durable, private queue for verified Inbox voice uploads.
-- The provider worker is intentionally not enabled by this migration.
-- No audio retention window is extended by queueing or retries.

CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE private.inbox_voice_transcription_job (
  asset_id uuid PRIMARY KEY
    REFERENCES public.capture_audio_asset(id) ON DELETE CASCADE,
  owner_profile_id uuid NOT NULL
    REFERENCES public.user_profile(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','leased','retryable','succeeded','manual_review','expired')),
  attempt_number smallint NOT NULL DEFAULT 0
    CHECK (attempt_number BETWEEN 0 AND 3),
  next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  lease_token uuid,
  lease_expires_at timestamptz,
  capture_id uuid,
  part_id uuid,
  processing_run_id uuid,
  last_error_code text
    CHECK (last_error_code IS NULL OR last_error_code ~ '^[A-Z0-9_]{1,64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  CHECK ((get_byte(uuid_send(asset_id),6) >> 4)=7
     AND (get_byte(uuid_send(asset_id),8) & 192)=128),
  CHECK ((status='leased') = (lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)),
  CHECK ((lease_token IS NULL) = (lease_expires_at IS NULL)),
  CHECK (
    (status='succeeded'
      AND capture_id IS NOT NULL AND part_id IS NOT NULL
      AND processing_run_id IS NOT NULL AND completed_at IS NOT NULL)
    OR
    (status<>'succeeded'
      AND capture_id IS NULL AND part_id IS NULL
      AND processing_run_id IS NULL AND completed_at IS NULL)
  )
);

CREATE TABLE private.inbox_voice_transcription_attempt (
  id uuid PRIMARY KEY,
  asset_id uuid NOT NULL
    REFERENCES private.inbox_voice_transcription_job(asset_id) ON DELETE CASCADE,
  attempt_number smallint NOT NULL CHECK (attempt_number BETWEEN 1 AND 3),
  lease_token uuid NOT NULL UNIQUE,
  status text NOT NULL
    CHECK (status IN ('leased','request_started','succeeded','retryable','manual_review','expired')),
  provider_id text,
  model_id text,
  adapter_id text,
  inference_region text,
  policy_version text,
  route_evidence jsonb,
  claimed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  request_started_at timestamptz,
  finished_at timestamptz,
  error_code text
    CHECK (error_code IS NULL OR error_code ~ '^[A-Z0-9_]{1,64}$'),
  UNIQUE (asset_id, attempt_number),
  CHECK ((get_byte(uuid_send(id),6) >> 4)=7
     AND (get_byte(uuid_send(id),8) & 192)=128),
  CHECK (
    (status='leased' AND request_started_at IS NULL AND finished_at IS NULL)
    OR
    (status='request_started' AND request_started_at IS NOT NULL AND finished_at IS NULL)
    OR
    (status='succeeded' AND request_started_at IS NOT NULL AND finished_at IS NOT NULL)
    OR
    (status='retryable' AND request_started_at IS NULL AND finished_at IS NOT NULL)
    OR
    (status='manual_review' AND finished_at IS NOT NULL)
    OR
    (status='expired' AND finished_at IS NOT NULL)
  ),
  CHECK (
    request_started_at IS NULL
    OR (
      provider_id IS NOT NULL AND model_id IS NOT NULL
      AND adapter_id IS NOT NULL AND inference_region IS NOT NULL
      AND policy_version IS NOT NULL AND route_evidence IS NOT NULL
      AND jsonb_typeof(route_evidence)='object'
    )
  )
);

CREATE INDEX inbox_voice_transcription_due_idx
  ON private.inbox_voice_transcription_job(next_attempt_at,created_at)
  WHERE status IN ('queued','retryable');
CREATE INDEX inbox_voice_transcription_lease_idx
  ON private.inbox_voice_transcription_job(lease_expires_at,created_at)
  WHERE status='leased';
CREATE INDEX inbox_voice_transcription_attempt_asset_idx
  ON private.inbox_voice_transcription_attempt(asset_id,attempt_number DESC);

ALTER TABLE private.inbox_voice_transcription_job ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.inbox_voice_transcription_attempt ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE
  private.inbox_voice_transcription_job,
  private.inbox_voice_transcription_attempt
  FROM PUBLIC, anon, authenticated, service_role;

-- Upload finalization is the durable enqueue boundary. A lost HTTP response
-- cannot lose the queue entry because the trigger shares the asset transaction.
CREATE OR REPLACE FUNCTION private.enqueue_inbox_voice_transcription_job_on_upload()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $function$
BEGIN
  IF NEW.status='uploaded' AND OLD.status IS DISTINCT FROM NEW.status
     AND NEW.capture_id IS NULL THEN
    INSERT INTO private.inbox_voice_transcription_job(
      asset_id,owner_profile_id,status,next_attempt_at
    ) VALUES (
      NEW.id,NEW.owner_user_id,
      CASE
        WHEN NEW.retention_until IS NOT NULL
          AND NEW.retention_until > clock_timestamp() THEN 'queued'
        ELSE 'expired'
      END,
      clock_timestamp()
    )
    ON CONFLICT (asset_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$function$;
ALTER FUNCTION private.enqueue_inbox_voice_transcription_job_on_upload() OWNER TO postgres;
REVOKE ALL PRIVILEGES ON FUNCTION private.enqueue_inbox_voice_transcription_job_on_upload()
  FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS capture_audio_asset_enqueue_voice_job ON public.capture_audio_asset;
CREATE TRIGGER capture_audio_asset_enqueue_voice_job
AFTER UPDATE OF status ON public.capture_audio_asset
FOR EACH ROW
WHEN (NEW.status='uploaded' AND OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION private.enqueue_inbox_voice_transcription_job_on_upload();

-- Existing uploads become queue-visible without altering their seven-day TTL.
INSERT INTO private.inbox_voice_transcription_job(
  asset_id,owner_profile_id,status,next_attempt_at
)
SELECT aa.id,aa.owner_user_id,
  CASE
    WHEN aa.retention_until IS NOT NULL
      AND aa.retention_until > clock_timestamp() THEN 'queued'
    ELSE 'expired'
  END,
  clock_timestamp()
FROM public.capture_audio_asset aa
WHERE aa.status='uploaded' AND aa.capture_id IS NULL
ON CONFLICT (asset_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.claim_inbox_voice_transcription_job(
  p_attempt_id uuid,
  p_lease_token uuid,
  p_lease_seconds integer DEFAULT 120
)
RETURNS TABLE(
  asset_id uuid, owner_profile_id uuid, bucket_id text, object_path text,
  mime_type text, file_size_bytes integer, sha256_hex text,
  attempt_number integer, lease_token uuid, lease_expires_at timestamptz,
  retention_until timestamptz
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $function$
DECLARE
  v_stale record;
  v_job private.inbox_voice_transcription_job%ROWTYPE;
  v_asset public.capture_audio_asset%ROWTYPE;
  v_next_status text;
  v_error_code text;
  v_new_attempt integer;
  v_expires_at timestamptz;
BEGIN
  IF p_attempt_id IS NULL
     OR (get_byte(uuid_send(p_attempt_id),6) >> 4) <> 7
     OR (get_byte(uuid_send(p_attempt_id),8) & 192) <> 128
     OR p_lease_token IS NULL
     OR p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 30 AND 600 THEN
    RAISE EXCEPTION 'Voice queue claim arguments are invalid' USING ERRCODE='22023';
  END IF;

  -- An expired lease is retryable only if the provider request was never
  -- marked started. Once started, the outcome may be billable and is ambiguous.
  FOR v_stale IN
    SELECT j.asset_id,j.lease_token,j.attempt_number,a.request_started_at,
      aa.status AS asset_status,aa.retention_until,aa.capture_id
    FROM private.inbox_voice_transcription_job j
    JOIN private.inbox_voice_transcription_attempt a
      ON a.asset_id=j.asset_id AND a.lease_token=j.lease_token
    JOIN public.capture_audio_asset aa ON aa.id=j.asset_id
    WHERE j.status='leased' AND j.lease_expires_at <= clock_timestamp()
    ORDER BY j.lease_expires_at,j.asset_id
    FOR UPDATE OF j SKIP LOCKED
  LOOP
    v_next_status := CASE
      WHEN v_stale.request_started_at IS NOT NULL THEN 'manual_review'
      WHEN v_stale.asset_status<>'uploaded'
        OR v_stale.retention_until IS NULL
        OR v_stale.retention_until<=clock_timestamp()
        OR v_stale.capture_id IS NOT NULL THEN 'expired'
      WHEN v_stale.attempt_number>=3 THEN 'manual_review'
      ELSE 'retryable'
    END;
    v_error_code := CASE v_next_status
      WHEN 'manual_review' THEN
        CASE WHEN v_stale.request_started_at IS NOT NULL
          THEN 'AMBIGUOUS_PROVIDER_OUTCOME' ELSE 'MAX_ATTEMPTS_EXCEEDED' END
      WHEN 'expired' THEN 'AUDIO_RETENTION_EXPIRED'
      ELSE 'LEASE_EXPIRED_BEFORE_REQUEST'
    END;
    UPDATE private.inbox_voice_transcription_attempt AS a
    SET status=v_next_status,finished_at=clock_timestamp(),error_code=v_error_code
    WHERE a.asset_id=v_stale.asset_id AND a.lease_token=v_stale.lease_token
      AND a.finished_at IS NULL;
    UPDATE private.inbox_voice_transcription_job AS j
    SET status=v_next_status,lease_token=NULL,lease_expires_at=NULL,
        last_error_code=v_error_code,updated_at=clock_timestamp()
    WHERE j.asset_id=v_stale.asset_id AND j.status='leased'
      AND j.lease_token=v_stale.lease_token;
  END LOOP;

  -- Retention expiry or a changed asset state makes queued work terminal.
  FOR v_stale IN
    SELECT j.asset_id,j.attempt_number
    FROM private.inbox_voice_transcription_job j
    JOIN public.capture_audio_asset aa ON aa.id=j.asset_id
    WHERE j.status IN ('queued','retryable')
      AND (
        aa.status<>'uploaded' OR aa.capture_id IS NOT NULL
        OR aa.retention_until IS NULL OR aa.retention_until<=clock_timestamp()
      )
    FOR UPDATE OF j SKIP LOCKED
  LOOP
    UPDATE private.inbox_voice_transcription_attempt AS a
    SET status='expired',finished_at=clock_timestamp(),error_code='AUDIO_RETENTION_EXPIRED'
    WHERE a.asset_id=v_stale.asset_id AND a.attempt_number=v_stale.attempt_number
      AND a.finished_at IS NULL;
    UPDATE private.inbox_voice_transcription_job AS j
    SET status='expired',lease_token=NULL,lease_expires_at=NULL,
        last_error_code='AUDIO_RETENTION_EXPIRED',updated_at=clock_timestamp()
    WHERE j.asset_id=v_stale.asset_id;
  END LOOP;

  -- Bound retries. Reaching the limit requires manual review; it never loops.
  FOR v_stale IN
    SELECT j.asset_id,j.attempt_number
    FROM private.inbox_voice_transcription_job AS j
    WHERE j.status IN ('queued','retryable') AND j.attempt_number>=3
    FOR UPDATE OF j SKIP LOCKED
  LOOP
    UPDATE private.inbox_voice_transcription_attempt AS a
    SET status='manual_review',finished_at=clock_timestamp(),
        error_code='MAX_ATTEMPTS_EXCEEDED'
    WHERE a.asset_id=v_stale.asset_id AND a.attempt_number=v_stale.attempt_number
      AND a.finished_at IS NULL;
    UPDATE private.inbox_voice_transcription_job AS j
    SET status='manual_review',last_error_code='MAX_ATTEMPTS_EXCEEDED',
        updated_at=clock_timestamp()
    WHERE j.asset_id=v_stale.asset_id;
  END LOOP;

  SELECT j.* INTO v_job
  FROM private.inbox_voice_transcription_job j
  JOIN public.capture_audio_asset aa ON aa.id=j.asset_id
  WHERE j.status IN ('queued','retryable')
    AND j.next_attempt_at<=clock_timestamp()
    AND j.attempt_number<3
    AND aa.status='uploaded'
    AND aa.capture_id IS NULL
    AND aa.retention_until>clock_timestamp()
  ORDER BY j.next_attempt_at,j.created_at,j.asset_id
  LIMIT 1
  FOR UPDATE OF j SKIP LOCKED;

  IF NOT FOUND THEN RETURN; END IF;

  SELECT * INTO v_asset
  FROM public.capture_audio_asset aa
  WHERE aa.id=v_job.asset_id
  FOR UPDATE;

  v_new_attempt := v_job.attempt_number+1;
  v_expires_at := clock_timestamp()+make_interval(secs=>p_lease_seconds);

  UPDATE private.inbox_voice_transcription_job AS j
  SET status='leased',attempt_number=v_new_attempt,
      lease_token=p_lease_token,lease_expires_at=v_expires_at,
      last_error_code=NULL,updated_at=clock_timestamp()
  WHERE j.asset_id=v_job.asset_id;

  INSERT INTO private.inbox_voice_transcription_attempt(
    id,asset_id,attempt_number,lease_token,status
  ) VALUES (
    p_attempt_id,v_job.asset_id,v_new_attempt,p_lease_token,'leased'
  );

  RETURN QUERY SELECT v_asset.id,v_asset.owner_user_id,v_asset.bucket_id,
    v_asset.object_path,v_asset.mime_type,v_asset.file_size_bytes,v_asset.sha256_hex,
    v_new_attempt,p_lease_token,v_expires_at,v_asset.retention_until;
END;
$function$;
ALTER FUNCTION public.claim_inbox_voice_transcription_job(uuid,uuid,integer) OWNER TO postgres;
REVOKE ALL PRIVILEGES ON FUNCTION public.claim_inbox_voice_transcription_job(uuid,uuid,integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_inbox_voice_transcription_job(uuid,uuid,integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.mark_inbox_voice_transcription_request_started(
  p_asset_id uuid,
  p_lease_token uuid,
  p_provider_id text,
  p_model_id text,
  p_adapter_id text,
  p_inference_region text,
  p_policy_version text,
  p_route_evidence jsonb
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $function$
DECLARE
  v_job private.inbox_voice_transcription_job%ROWTYPE;
  v_rows integer;
  v_evidence record;
BEGIN
  IF p_asset_id IS NULL OR p_lease_token IS NULL
     OR p_provider_id IS NULL OR p_provider_id !~ '^[a-z0-9][a-z0-9._-]{0,63}$'
     OR p_model_id IS NULL OR p_model_id !~ '^[A-Za-z0-9@._:/-]{1,128}$'
     OR p_adapter_id IS NULL OR p_adapter_id !~ '^[a-z0-9][a-z0-9._-]{0,63}$'
     OR p_inference_region IS NULL
     OR p_inference_region !~ '^[A-Za-z0-9._-]{1,64}$'
     OR lower(p_inference_region) IN ('global','unknown','unspecified','unverified')
     OR p_policy_version IS DISTINCT FROM 'inbox-speech-route-policy-v1'
     OR p_route_evidence IS NULL OR jsonb_typeof(p_route_evidence)<>'object'
     OR jsonb_object_length(p_route_evidence)<>9
     OR NOT (p_route_evidence ?& ARRAY[
       'capability','provider','model','adapter','account',
       'legalEligibility','region','privacy','quota'
     ]) THEN
    RAISE EXCEPTION 'Verified speech route evidence is incomplete' USING ERRCODE='22023';
  END IF;

  FOR v_evidence IN SELECT key,value FROM jsonb_each_text(p_route_evidence)
  LOOP
    IF v_evidence.value !~ '^[A-Za-z0-9._:/-]{1,160}$' THEN
      RAISE EXCEPTION 'Speech route evidence identifier is invalid' USING ERRCODE='22023';
    END IF;
  END LOOP;

  SELECT * INTO v_job
  FROM private.inbox_voice_transcription_job
  WHERE asset_id=p_asset_id
  FOR UPDATE;
  IF NOT FOUND OR v_job.status<>'leased'
     OR v_job.lease_token IS DISTINCT FROM p_lease_token
     OR v_job.lease_expires_at IS NULL
     OR v_job.lease_expires_at<=clock_timestamp() THEN
    RETURN false;
  END IF;

  UPDATE private.inbox_voice_transcription_attempt
  SET status='request_started',provider_id=p_provider_id,model_id=p_model_id,
      adapter_id=p_adapter_id,inference_region=p_inference_region,
      policy_version=p_policy_version,route_evidence=p_route_evidence,
      request_started_at=clock_timestamp()
  WHERE asset_id=p_asset_id AND lease_token=p_lease_token
    AND status='leased' AND request_started_at IS NULL AND finished_at IS NULL;
  GET DIAGNOSTICS v_rows=ROW_COUNT;
  IF v_rows<>1 THEN RETURN false; END IF;

  UPDATE private.inbox_voice_transcription_job
  SET updated_at=clock_timestamp()
  WHERE asset_id=p_asset_id AND lease_token=p_lease_token;
  RETURN true;
END;
$function$;
ALTER FUNCTION public.mark_inbox_voice_transcription_request_started(uuid,uuid,text,text,text,text,text,jsonb)
  OWNER TO postgres;
REVOKE ALL PRIVILEGES ON FUNCTION
  public.mark_inbox_voice_transcription_request_started(uuid,uuid,text,text,text,text,text,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  public.mark_inbox_voice_transcription_request_started(uuid,uuid,text,text,text,text,text,jsonb)
  TO service_role;

CREATE OR REPLACE FUNCTION public.fail_inbox_voice_transcription_job(
  p_asset_id uuid,
  p_lease_token uuid,
  p_error_code text,
  p_retry_after_seconds integer DEFAULT 300
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $function$
DECLARE
  v_job private.inbox_voice_transcription_job%ROWTYPE;
  v_attempt private.inbox_voice_transcription_attempt%ROWTYPE;
  v_asset public.capture_audio_asset%ROWTYPE;
  v_next_status text;
BEGIN
  IF p_asset_id IS NULL OR p_lease_token IS NULL
     OR p_error_code IS NULL OR p_error_code !~ '^[A-Z0-9_]{1,64}$'
     OR p_retry_after_seconds IS NULL OR p_retry_after_seconds NOT BETWEEN 0 AND 86400 THEN
    RAISE EXCEPTION 'Voice queue failure arguments are invalid' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_job
  FROM private.inbox_voice_transcription_job
  WHERE asset_id=p_asset_id
  FOR UPDATE;
  IF NOT FOUND OR v_job.status<>'leased'
     OR v_job.lease_token IS DISTINCT FROM p_lease_token
     OR v_job.lease_expires_at IS NULL
     OR v_job.lease_expires_at<=clock_timestamp() THEN
    RETURN 'stale';
  END IF;

  SELECT * INTO v_attempt
  FROM private.inbox_voice_transcription_attempt
  WHERE asset_id=p_asset_id AND lease_token=p_lease_token
  FOR UPDATE;
  IF NOT FOUND OR v_attempt.finished_at IS NOT NULL THEN RETURN 'stale'; END IF;

  SELECT * INTO v_asset
  FROM public.capture_audio_asset
  WHERE id=p_asset_id
  FOR UPDATE;

  v_next_status := CASE
    WHEN v_attempt.request_started_at IS NOT NULL THEN 'manual_review'
    WHEN v_asset.id IS NULL OR v_asset.status<>'uploaded'
      OR v_asset.capture_id IS NOT NULL OR v_asset.retention_until IS NULL
      OR v_asset.retention_until<=clock_timestamp() THEN 'expired'
    WHEN v_job.attempt_number<3 THEN 'retryable'
    ELSE 'manual_review'
  END;

  UPDATE private.inbox_voice_transcription_attempt
  SET status=v_next_status,finished_at=clock_timestamp(),error_code=p_error_code
  WHERE asset_id=p_asset_id AND lease_token=p_lease_token;

  UPDATE private.inbox_voice_transcription_job
  SET status=v_next_status,
      next_attempt_at=CASE WHEN v_next_status='retryable'
        THEN clock_timestamp()+make_interval(secs=>p_retry_after_seconds)
        ELSE next_attempt_at END,
      lease_token=NULL,lease_expires_at=NULL,
      last_error_code=p_error_code,updated_at=clock_timestamp()
  WHERE asset_id=p_asset_id;
  RETURN v_next_status;
END;
$function$;
ALTER FUNCTION public.fail_inbox_voice_transcription_job(uuid,uuid,text,integer) OWNER TO postgres;
REVOKE ALL PRIVILEGES ON FUNCTION public.fail_inbox_voice_transcription_job(uuid,uuid,text,integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fail_inbox_voice_transcription_job(uuid,uuid,text,integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.complete_inbox_voice_transcription_job(
  p_asset_id uuid,
  p_lease_token uuid,
  p_capture_id uuid,
  p_part_id uuid,
  p_processing_run_id uuid,
  p_transcript_text text,
  p_provider_id text,
  p_model_id text,
  p_inference_region text
)
RETURNS TABLE(capture_id uuid,part_id uuid,processing_run_id uuid,replayed boolean)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $function$
DECLARE
  v_job private.inbox_voice_transcription_job%ROWTYPE;
  v_attempt private.inbox_voice_transcription_attempt%ROWTYPE;
  v_asset public.capture_audio_asset%ROWTYPE;
  v_provider_matches boolean;
BEGIN
  IF p_asset_id IS NULL OR p_lease_token IS NULL
     OR p_capture_id IS NULL OR p_part_id IS NULL OR p_processing_run_id IS NULL
     OR (get_byte(uuid_send(p_asset_id),6) >> 4)<>7
     OR (get_byte(uuid_send(p_asset_id),8) & 192)<>128
     OR (get_byte(uuid_send(p_capture_id),6) >> 4)<>7
     OR (get_byte(uuid_send(p_capture_id),8) & 192)<>128
     OR (get_byte(uuid_send(p_part_id),6) >> 4)<>7
     OR (get_byte(uuid_send(p_part_id),8) & 192)<>128
     OR (get_byte(uuid_send(p_processing_run_id),6) >> 4)<>7
     OR (get_byte(uuid_send(p_processing_run_id),8) & 192)<>128
     OR p_transcript_text IS NULL OR length(btrim(p_transcript_text))=0
     OR length(p_transcript_text)>20000
     OR p_provider_id IS NULL OR p_provider_id !~ '^[a-z0-9][a-z0-9._-]{0,63}$'
     OR p_model_id IS NULL OR p_model_id !~ '^[A-Za-z0-9@._:/-]{1,128}$'
     OR p_inference_region IS NULL OR p_inference_region !~ '^[A-Za-z0-9._-]{1,64}$'
     OR lower(p_inference_region) IN ('global','unknown','unspecified','unverified') THEN
    RAISE EXCEPTION 'Voice transcription completion arguments are invalid' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_job
  FROM private.inbox_voice_transcription_job
  WHERE asset_id=p_asset_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'VOICE_JOB_NOT_FOUND' USING ERRCODE='42501';
  END IF;

  -- Same-result replays are safe; conflicting results can never overwrite a
  -- transcript, create another capture, or enqueue a duplicate processing run.
  IF v_job.status='succeeded' THEN
    SELECT * INTO v_asset FROM public.capture_audio_asset WHERE id=p_asset_id;
    IF v_job.capture_id=p_capture_id AND v_job.part_id=p_part_id
       AND v_job.processing_run_id=p_processing_run_id
       AND v_asset.status='transcribed'
       AND v_asset.transcript_text=p_transcript_text
       AND v_asset.transcription_provider=p_provider_id
       AND v_asset.transcription_model=p_model_id
       AND v_asset.transcription_region=p_inference_region THEN
      RETURN QUERY SELECT v_job.capture_id,v_job.part_id,v_job.processing_run_id,true;
      RETURN;
    END IF;
    RAISE EXCEPTION 'VOICE_COMPLETION_IDEMPOTENCY_CONFLICT' USING ERRCODE='55000';
  END IF;

  IF v_job.status<>'leased'
     OR v_job.lease_token IS DISTINCT FROM p_lease_token
     OR v_job.lease_expires_at IS NULL
     OR v_job.lease_expires_at<=clock_timestamp() THEN
    RETURN;
  END IF;

  SELECT * INTO v_attempt
  FROM private.inbox_voice_transcription_attempt
  WHERE asset_id=p_asset_id AND lease_token=p_lease_token
  FOR UPDATE;
  IF NOT FOUND OR v_attempt.status<>'request_started'
     OR v_attempt.request_started_at IS NULL
     OR v_attempt.provider_id IS DISTINCT FROM p_provider_id
     OR v_attempt.model_id IS DISTINCT FROM p_model_id
     OR v_attempt.inference_region IS DISTINCT FROM p_inference_region THEN
    RAISE EXCEPTION 'VOICE_PROVIDER_RESULT_PROVENANCE_MISMATCH' USING ERRCODE='42501';
  END IF;

  SELECT * INTO v_asset
  FROM public.capture_audio_asset
  WHERE id=p_asset_id AND owner_user_id=v_job.owner_profile_id
  FOR UPDATE;
  IF NOT FOUND OR v_asset.status<>'uploaded'
     OR v_asset.capture_id IS NOT NULL
     OR v_asset.retention_until IS NULL
     OR v_asset.retention_until<=clock_timestamp() THEN
    RETURN;
  END IF;

  INSERT INTO public.capture(
    id,owner_user_id,created_by_user_id,input_type,content_original,captured_at,sync_status
  ) VALUES (
    p_capture_id,v_job.owner_profile_id,v_job.owner_profile_id,'voice',
    p_transcript_text,v_asset.created_at,'synced'
  );

  INSERT INTO public.capture_part(id,capture_id,part_index,original_fragment)
  VALUES(p_part_id,p_capture_id,0,p_transcript_text);

  -- This is intentionally one transaction: capture, source part, audio
  -- provenance, and the normal Inbox processing run commit or roll back together.
  INSERT INTO public.processing_run(
    id,capture_id,processor_version,status,attempt_number,
    idempotency_key,result,started_at,next_attempt_at
  ) VALUES (
    p_processing_run_id,p_capture_id,'inbox-proposal-v1','queued',1,
    p_asset_id::text,'{}'::jsonb,NULL,clock_timestamp()
  );

  UPDATE public.capture SET processing_status='queued'
  WHERE id=p_capture_id AND owner_user_id=v_job.owner_profile_id;

  UPDATE public.capture_audio_asset
  SET capture_id=p_capture_id,transcript_text=p_transcript_text,
      transcription_provider=p_provider_id,transcription_model=p_model_id,
      transcription_region=p_inference_region,status='transcribed',
      transcribed_at=clock_timestamp(),retention_until=NULL,updated_at=clock_timestamp()
  WHERE id=p_asset_id AND owner_user_id=v_job.owner_profile_id;

  UPDATE private.inbox_voice_transcription_attempt
  SET status='succeeded',finished_at=clock_timestamp()
  WHERE asset_id=p_asset_id AND lease_token=p_lease_token;

  UPDATE private.inbox_voice_transcription_job
  SET status='succeeded',capture_id=p_capture_id,part_id=p_part_id,
      processing_run_id=p_processing_run_id,completed_at=clock_timestamp(),
      lease_token=NULL,lease_expires_at=NULL,last_error_code=NULL,
      updated_at=clock_timestamp()
  WHERE asset_id=p_asset_id;

  RETURN QUERY SELECT p_capture_id,p_part_id,p_processing_run_id,false;
END;
$function$;
ALTER FUNCTION public.complete_inbox_voice_transcription_job(uuid,uuid,uuid,uuid,uuid,text,text,text,text)
  OWNER TO postgres;
REVOKE ALL PRIVILEGES ON FUNCTION
  public.complete_inbox_voice_transcription_job(uuid,uuid,uuid,uuid,uuid,text,text,text,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  public.complete_inbox_voice_transcription_job(uuid,uuid,uuid,uuid,uuid,text,text,text,text)
  TO service_role;

-- Retire the old transcript-only RPC: it could create a voice capture without
-- the corresponding Inbox processing_run, splitting one user action in two.
REVOKE ALL PRIVILEGES ON FUNCTION
  public.record_inbox_voice_transcription(uuid,uuid,uuid,uuid,text,text,text,text)
  FROM PUBLIC, anon, authenticated, service_role;
