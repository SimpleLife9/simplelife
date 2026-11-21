import { TodayPage } from '../features/today/TodayPage.jsx';
import { InboxPage } from '../features/inbox/InboxPage.jsx';
import { GoalsPage } from '../features/goals/GoalsPage.jsx';
import { ProjectsPage } from '../features/projects/ProjectsPage.jsx';
import { TasksPage } from '../features/tasks/TasksPage.jsx';
import { NotesPage } from '../features/notes/NotesPage.jsx';
import { ListsPage } from '../features/lists/ListsPage.jsx';

export function AppPages({
  activePage,
  morePage,
  profile,
  refreshKey,
  runAction,
  busy,
  setActivePage,
  setMorePage,
}) {
  return (
    <>
      {activePage === 'today' && <TodayPage profile={profile} refreshKey={refreshKey} runAction={runAction} busy={busy} setActivePage={setActivePage} setMorePage={setMorePage} />}
      {activePage === 'inbox' && <InboxPage profile={profile} refreshKey={refreshKey} runAction={runAction} busy={busy} setActivePage={setActivePage} setMorePage={setMorePage} />}
      {activePage === 'goals' && <GoalsPage profile={profile} refreshKey={refreshKey} runAction={runAction} busy={busy} />}
      {activePage === 'projects' && <ProjectsPage profile={profile} refreshKey={refreshKey} runAction={runAction} busy={busy} setActivePage={setActivePage} setMorePage={setMorePage} />}
      {activePage === 'more' && morePage === 'tasks' && <TasksPage profile={profile} refreshKey={refreshKey} runAction={runAction} busy={busy} />}
      {activePage === 'more' && morePage === 'notes' && <NotesPage profile={profile} refreshKey={refreshKey} runAction={runAction} busy={busy} />}
      {activePage === 'more' && morePage === 'lists' && <ListsPage profile={profile} refreshKey={refreshKey} runAction={runAction} busy={busy} setActivePage={setActivePage} setMorePage={setMorePage} />}
    </>
  );
}
