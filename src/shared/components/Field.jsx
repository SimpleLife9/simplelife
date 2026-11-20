export function Field({ label, name, type = 'text', placeholder, required = false, autoComplete, minLength, min, max, step, value, onChange, autoFocus = false }) {
  return <label className="field"><span>{label}</span><input name={name} type={type} placeholder={placeholder} required={required} autoComplete={autoComplete} minLength={minLength} min={min} max={max} step={step} value={value} onChange={onChange} autoFocus={autoFocus} /></label>;
}
