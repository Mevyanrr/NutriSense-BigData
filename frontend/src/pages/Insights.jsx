import { useEffect, useState } from 'react'
import { get, fmt } from '../api'
import Plot from '../Plot.jsx'
import { Section, Select, Loading, card, base, plotProps, CL, NLABEL } from '../ui.jsx'

const FEATS = ['protein', 'fat', 'carbs', 'sugar', 'fiber']

function save(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = Object.assign(document.createElement('a'), { href: url, download: name })
  a.click()
  URL.revokeObjectURL(url)
}

export default function Insights() {
  const [d, setD] = useState(null)
  const [err, setErr] = useState('')
  const [nut, setNut] = useState('protein')
  const [cid, setCid] = useState(null)
  const [cats, setCats] = useState([])

  useEffect(() => { get('/api/insights').then(setD).catch((e) => setErr(String(e))) }, [])
  useEffect(() => {
    if (cid === null) return
    get(`/api/clusters/${cid}/categories?limit=8`).then(setCats).catch(() => setCats([]))
  }, [cid])

  if (!d) return <Loading err={err} />
  const prof = d.cluster_profile
  const top = d.top_foods.filter((t) => t.nutrient === nut).slice(0, 10)

  const csv = () => {
    const cols = ['cluster', 'name', 'n_foods', 'share_pct', 'protein_mean', 'fat_mean', 'carbs_mean', 'sugar_mean', 'fiber_mean', 'energy_kcal_mean']
    const rows = prof.map((p) => cols.map((c) => JSON.stringify(p[c] ?? '')).join(','))
    save('cluster_profile.csv', [cols.join(','), ...rows].join('\n'), 'text/csv')
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-emerald-950 dark:text-emerald-100">Insights & Findings</h1>
        <div className="flex gap-2 text-sm">
          <button onClick={() => save('insights.json', JSON.stringify(d.insights, null, 2), 'application/json')}
            className="rounded-lg bg-emerald-900 px-3 py-1.5 text-white">Export insight (JSON)</button>
          <button onClick={csv} className="rounded-lg bg-emerald-100 px-3 py-1.5 text-emerald-900">Export cluster (CSV)</button>
        </div>
      </div>

      <section>
        <p className="mb-2 text-xs text-slate-500">Semua insight dihasilkan otomatis dari perhitungan data, bukan ditulis manual.</p>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {d.insights.map((i) => (
            <div key={i.key} className="rounded-2xl bg-emerald-50 p-5 dark:bg-slate-800">
              <div className="mb-1 text-sm font-semibold text-emerald-900 dark:text-emerald-200">{i.title}</div>
              <p className="text-sm text-slate-700 dark:text-slate-300">{i.text}</p>
            </div>
          ))}
        </div>
      </section>

      <Section title="Ringkasan cluster" note="Klik sebuah cluster untuk melihat kategori produk yang paling banyak masuk ke dalamnya.">
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {prof.map((p) => (
            <button key={p.cluster} onClick={() => setCid(p.cluster)}
              className={`rounded-xl border p-4 text-left text-sm dark:text-slate-200 ${cid === p.cluster ? 'border-emerald-600 ring-2 ring-emerald-500' : 'border-slate-200 dark:border-slate-700'}`}>
              <div className="flex items-center gap-2 font-semibold">
                <span className="h-3 w-3 rounded-full" style={{ background: CL[p.cluster % CL.length] }} />{p.name}
              </div>
              <div className="mt-1 text-xs text-slate-500">{fmt(p.n_foods)} produk ({p.share_pct.toFixed(1)}%) · {Math.round(p.energy_kcal_mean)} kcal</div>
              <div className="mt-2 text-xs">P {p.protein_mean.toFixed(1)} · L {p.fat_mean.toFixed(1)} · K {p.carbs_mean.toFixed(1)} · Gula {p.sugar_mean.toFixed(1)} · Serat {p.fiber_mean.toFixed(1)}</div>
              {!p.name_verified && <div className="mt-1 text-xs text-amber-600">nama otomatis, belum dicocokkan</div>}
            </button>
          ))}
        </div>
        {cid !== null && (
          <div className="mt-4">
            <div className="mb-1 text-sm font-medium dark:text-slate-100">Kategori terbanyak di cluster {cid}</div>
            <table className="w-full text-sm dark:text-slate-200">
              <thead><tr className="text-left text-slate-500"><th>Kategori</th><th className="text-right">Produk di cluster</th><th className="text-right">% dari kategori itu</th></tr></thead>
              <tbody>
                {cats.map((c) => (
                  <tr key={c.category} className="border-t dark:border-slate-700">
                    <td className="py-1">{c.category}</td><td className="text-right">{fmt(c.count)}</td><td className="text-right">{c.pct_in_category.toFixed(0)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Perbandingan nutrisi antar cluster" note="Rata-rata per 100 g / 100 ml.">
        <Plot data={prof.map((p) => ({ type: 'bar', name: p.name, x: FEATS.map((f) => NLABEL[f]), y: FEATS.map((f) => p[`${f}_mean`]),
          marker: { color: CL[p.cluster % CL.length] } }))}
          layout={base({ height: 360, barmode: 'group', legend: { orientation: 'h', y: -0.25 } })} {...plotProps} />
      </Section>

      <Section title="Produk dengan nilai nutrisi tertinggi"
        note="Nilai maksimum per 100 g sering dicapai produk murni (minyak, bubuk, suplemen), jadi baca sebagai ekstrem data, bukan rekomendasi."
        right={<Select value={nut} onChange={setNut} options={['protein', 'fat', 'carbs', 'sugar', 'fiber', 'energy_kcal']} />}>
        <table className="w-full text-sm dark:text-slate-200">
          <thead><tr className="text-left text-slate-500"><th>#</th><th>Produk</th><th>Merek</th><th>Kategori</th><th className="text-right">{NLABEL[nut]}</th></tr></thead>
          <tbody>
            {top.map((t, i) => (
              <tr key={t.fdc_id} className="border-t dark:border-slate-700">
                <td className="py-1">{i + 1}</td><td>{t.description}</td><td className="text-slate-500">{t.brand_owner}</td>
                <td className="text-slate-500">{t.category}</td><td className="text-right font-medium">{t.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <div className={card + ' text-sm text-slate-600 dark:text-slate-300'}>
        <div className="mb-1 font-semibold text-slate-800 dark:text-slate-100">Batasan hasil</div>
        <ul className="list-disc space-y-1 pl-5">
          <li>Pengelompokan menunjukkan kemiripan komposisi nutrisi, bukan penilaian sehat atau tidak sehat.</li>
          <li>Dataset hanya produk Branded (kemasan), bukan bahan mentah seperti sayur atau daging segar.</li>
          <li>Nilai gula dan serat yang kosong diisi 0, sehingga dapat menggeser cluster.</li>
          <li>Minuman dicatat per 100 ml dan makanan per 100 g, lalu dianalisis bersama.</li>
          <li>Aplikasi ini bukan alat diagnosis atau pengganti ahli gizi.</li>
        </ul>
      </div>
    </div>
  )
}