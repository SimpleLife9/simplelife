export function SectionTitle({ children, detail }) {
  return <div className="section-title"><h2>{children}</h2>{detail && <span>{detail}</span>}</div>;
}
