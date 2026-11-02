export const card = 'rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800'
export const CL = ['#16a34a', '#3b82f6', '#f59e0b', '#a855f7', '#ef4444', '#14b8a6']
export const NUTS = ['protein', 'fat', 'carbs', 'sugar', 'fiber', 'energy_kcal']
export const NLABEL = {
  protein: 'Protein (g)', fat: 'Lemak (g)', carbs: 'Karbohidrat (g)',
  sugar: 'Gula (g)', fiber: 'Serat (g)', energy_kcal: 'Energi (kcal)',
}

// font abu-abu tengah supaya terbaca di mode terang dan gelap
export const base = (extra = {}) => ({
  paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
  font: { color: '#94a3b8' }, margin: { t: 10, b: 40, l: 50, r: 10 }, ...extra,
})
export const plotProps = { config: { displayModeBar: false }, useResizeHandler: true, style: { width: '100%' } }

export function Stat({ label, value, sub }) {
  return (
    <div className={card}>
      <div className="text-2xl font-bold text-slate-800 dark:text-slate-100">{value}</div>
      <div className="text-sm text-slate-500">{label}</div>
      {sub && <div className="mt-1 text-xs text-slate-400">{sub}</div>}
    </div>
  )
}

export function Section({ title, note, children, right }) {
  return (
    <section className={card}>
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <h2 className="font-semibold text-slate-800 dark:text-slate-100">{title}</h2>
          {note && <p className="mt-1 text-xs text-slate-500">{note}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  )
}

export function Select({ value, onChange, options }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100">
      {options.map((o) => <option key={o} value={o}>{NLABEL[o] || o}</option>)}
    </select>
  )
}

export function Loading({ err }) {
  return err
    ? <div className="text-red-600">Gagal memuat data: {err}</div>
    : <div className="text-slate-500">Memuat...</div>
}