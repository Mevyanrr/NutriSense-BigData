import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { get, fmt, fmtBytes } from '../api'
import Plot from '../Plot.jsx'

const card = 'rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800'
const COL = { protein: '#16a34a', fat: '#3b82f6', carbs: '#f59e0b' }
const LABEL = { protein: 'Protein', fat: 'Lemak', carbs: 'Karbohidrat' }

function Stat({ label, value, sub }) {
  return (
    <div className={card}>
      <div className="text-2xl font-bold text-slate-800 dark:text-slate-100">{value}</div>
      <div className="text-sm text-slate-500">{label}</div>
      {sub && <div className="mt-1 text-xs text-slate-400">{sub}</div>}
    </div>
  )
}

export default function Home() {
  const [home, setHome] = useState(null)
  const [files, setFiles] = useState([])
  const [ins, setIns] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    get('/api/home').then(setHome).catch((e) => setErr(String(e)))
    get('/api/ingestion/hdfs').then(setFiles).catch(() => setFiles([]))
    get('/api/insights').then((d) => setIns(d.insights)).catch(() => setIns(null))
  }, [])

  if (err) return <div className="text-red-600">Gagal memuat data: {err}</div>
  if (!home) return <div className="text-slate-500">Memuat...</div>

  const ov = home.overview
  const size = files.reduce((s, f) => s + f.bytes, 0)
  const macro = home.macro_share
  const cats = [...home.top_categories].reverse()
  const keyInsight = ins?.find((i) => i.key === 'top_category')

  return (
    <div className="space-y-5">
      <section className="rounded-3xl bg-gradient-to-r from-emerald-100 to-emerald-50 p-8 dark:from-emerald-950 dark:to-slate-800">
        <h1 className="text-4xl font-bold text-emerald-950 dark:text-emerald-100">Welcome to NutriSense!</h1>
        <p className="mt-3 max-w-xl text-slate-700 dark:text-slate-300">
          Explore, analyze, and discover insights from the <b>USDA FoodData Central</b> (Branded Foods) dataset using Big Data and Machine Learning.
        </p>
        <Link to="/ingestion" className="mt-5 inline-block rounded-xl bg-emerald-900 px-5 py-2 text-sm font-medium text-white">
          Get Started →
        </Link>
      </section>

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Food Items" value={fmt(ov.total_foods)} sub="setelah pembersihan" />
        <Stat label="Food Categories" value={fmt(ov.total_categories)} />
        <Stat label="Nutrient Types" value={`6 / ${fmt(ov.nutrient_types_total)}`} sub="dianalisis / total di USDA" />
        <Stat label="Dataset Size (raw)" value={size ? fmtBytes(size) : '-'} sub="4 file CSV di HDFS" />
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <div className={card + ' lg:col-span-2'}>
          <h2 className="mb-2 font-semibold dark:text-slate-100">Nutrition Overview</h2>
          <div className="flex flex-wrap items-center gap-6">
            <Plot
              data={[{ type: 'pie', hole: 0.62, sort: false, textinfo: 'none',
                labels: macro.map((m) => LABEL[m.nutrient]), values: macro.map((m) => m.share_pct),
                marker: { colors: macro.map((m) => COL[m.nutrient]) } }]}
              layout={{ width: 220, height: 220, margin: { t: 5, b: 5, l: 5, r: 5 }, showlegend: false,
                paper_bgcolor: 'rgba(0,0,0,0)' }}
              config={{ displayModeBar: false }} />
            <div className="space-y-2 text-sm dark:text-slate-200">
              {macro.map((m) => (
                <div key={m.nutrient} className="flex items-center gap-3">
                  <span className="h-3 w-3 rounded-full" style={{ background: COL[m.nutrient] }} />
                  <span className="w-28">{LABEL[m.nutrient]}</span>
                  <span className="font-medium">{m.share_pct.toFixed(1)}%</span>
                  <span className="text-xs text-slate-400">({m.avg_g_per_100g.toFixed(1)} g/100 g)</span>
                </div>
              ))}
              <div className="text-xs text-slate-400">Porsi rata-rata dari total protein + lemak + karbohidrat</div>
            </div>
            <div className="ml-auto text-sm dark:text-slate-200">
              <div className="text-slate-500">Rata-rata energi</div>
              <div className="text-2xl font-bold">{Math.round(ov.avg_energy_kcal)} kcal</div>
              <div className="text-xs text-slate-400">per 100 g / 100 ml</div>
            </div>
          </div>
        </div>
        <div className={card}>
          <h2 className="mb-3 font-semibold dark:text-slate-100">Quick Actions</h2>
          <div className="flex flex-col gap-2 text-sm">
            <Link to="/ingestion" className="rounded-xl bg-emerald-900 px-4 py-3 text-white">Lihat status ingestion →</Link>
            <Link to="/analytics" className="rounded-xl bg-emerald-100 px-4 py-3 text-emerald-900">Explore Food Data →</Link>
            <Link to="/analytics" className="rounded-xl bg-emerald-100 px-4 py-3 text-emerald-900">View ML Analysis →</Link>
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <div className={card + ' lg:col-span-2'}>
          <h2 className="mb-2 font-semibold dark:text-slate-100">Kategori dengan produk terbanyak</h2>
          <Plot
            data={[{ type: 'bar', orientation: 'h', x: cats.map((c) => c.n_foods), y: cats.map((c) => c.category),
              marker: { color: '#16a34a' } }]}
            layout={{ height: 360, margin: { t: 5, b: 35, l: 260, r: 10 }, paper_bgcolor: 'rgba(0,0,0,0)',
              plot_bgcolor: 'rgba(0,0,0,0)', xaxis: { title: 'Jumlah produk' } }}
            config={{ displayModeBar: false }} style={{ width: '100%' }} useResizeHandler />
        </div>
        <div className="rounded-2xl bg-emerald-50 p-5 dark:bg-slate-800">
          <h2 className="mb-2 font-semibold text-emerald-900 dark:text-emerald-200">Key Insight</h2>
          <p className="text-sm text-slate-700 dark:text-slate-300">{keyInsight ? keyInsight.text : 'Insight belum tersedia.'}</p>
          <Link to="/insights" className="mt-4 inline-block rounded-lg bg-emerald-900 px-4 py-2 text-xs text-white">Learn More →</Link>
        </div>
      </section>
    </div>
  )
}