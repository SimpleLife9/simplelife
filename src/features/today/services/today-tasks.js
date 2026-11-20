export async function completeTodayTask(client, task, ownerId) {
  const { error: updateError } = await client.from('task')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      completion_outcome: 'complete',
    })
    .eq('id', task.id)
    .eq('owner_user_id', ownerId);
  if (updateError) throw updateError;
}

export async function rescheduleTodayTask(client, task, ownerId, dueDate) {
  const { data, error: updateError } = await client.from('task')
    .update({ due_date: dueDate })
    .eq('id', task.id)
    .eq('owner_user_id', ownerId)
    .select('id');
  if (updateError) throw updateError;
  if (!data?.length) {
    throw new Error('No se pudo mover la tarea a hoy. Puede que ya no exista o no pertenezca a esta cuenta.');
  }
}
