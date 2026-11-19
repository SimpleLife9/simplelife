import { supabase } from './supabase.js';
import { uuidv7 } from './uuidv7.js';

const pending = new Map();

export async function ensureUserProfile(authUser) {
  if (!supabase) throw new Error('Supabase no está configurado.');
  if (!authUser?.id) throw new Error('No hay una sesión autenticada.');

  if (pending.has(authUser.id)) return pending.get(authUser.id);
  const operation = createOrFindProfile(authUser).finally(() => pending.delete(authUser.id));
  pending.set(authUser.id, operation);
  return operation;
}

async function createOrFindProfile(authUser) {
  const { data: existing, error: lookupError } = await supabase
    .from('user_profile')
    .select('id, auth_user_id, display_name, account_status')
    .eq('auth_user_id', authUser.id)
    .maybeSingle();

  if (lookupError) throw lookupError;

  let profile = existing;
  if (!profile) {
    const displayName = authUser.user_metadata?.full_name
      || authUser.user_metadata?.name
      || authUser.email?.split('@')[0]
      || 'Usuario';

    const { data: created, error: createError } = await supabase
      .from('user_profile')
      .insert({
        id: uuidv7(),
        auth_user_id: authUser.id,
        display_name: displayName,
      })
      .select('id, auth_user_id, display_name, account_status')
      .single();

    if (createError?.code === '23505') {
      const { data: raced, error: raceError } = await supabase
        .from('user_profile')
        .select('id, auth_user_id, display_name, account_status')
        .eq('auth_user_id', authUser.id)
        .single();
      if (raceError) throw raceError;
      profile = raced;
    } else if (createError) {
      throw createError;
    } else {
      profile = created;
    }
  }

  const { data: preference, error: preferenceLookupError } = await supabase
    .from('user_preference')
    .select('id, user_id, time_zone, language')
    .eq('user_id', profile.id)
    .maybeSingle();

  if (preferenceLookupError) throw preferenceLookupError;
  if (!preference) {
    const { error: preferenceCreateError } = await supabase
      .from('user_preference')
      .insert({ id: uuidv7(), user_id: profile.id, time_zone: 'America/Havana', language: 'es' });
    if (preferenceCreateError && preferenceCreateError.code !== '23505') throw preferenceCreateError;
  }

  return profile;
}
