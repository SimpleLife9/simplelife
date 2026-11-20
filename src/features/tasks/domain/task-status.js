export const isOpenTask = (task) => !['completed', 'cancelled'].includes(task.status);
