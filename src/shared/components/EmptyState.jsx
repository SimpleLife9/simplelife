export function EmptyState({ title, detail, icon = '✳' }) {
  return <div className="empty-state"><div>{icon}</div><strong>{title}</strong><p>{detail}</p></div>;
}
