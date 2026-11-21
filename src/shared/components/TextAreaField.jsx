export function TextAreaField({ label, name, placeholder, required = false, rows = 3, value, onChange }) {
  return <label className="field"><span>{label}</span><textarea name={name} placeholder={placeholder} required={required} rows={rows} value={value} onChange={onChange} /></label>;
}
