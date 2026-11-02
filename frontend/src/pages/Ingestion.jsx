import { useEffect, useState } from 'react'
import { get, fmt, fmtBytes } from '../api'
import Plot from '../Plot.jsx'
import { Section, Stat, Loading, base, plotProps } from '../ui.jsx'

const STEPS = [
  ['CSV USDA', 'folder lokal'],
  ['Apache NiFi', 'GetFile → PutHDFS'],
  ['HDFS /raw', '4 file CSV'],
  ['Spark ETL', 'validasi, pivot, join'],
  ['Parquet /curated', 'foods.parquet'],
  ['Analitik & K-Means', 'Spark SQL, MLlib'],
  ['HDFS /results', 'Parquet hasil'],
  ['FastAPI + React', 'dashboard'],
]

export default function Ingestion() {
  const [etl, setEtl] = useState(null)
  const [files, setFiles] = useState(null)
  const [filesErr, setFilesErr] = useState('')
  const [nifi, setNifi] = useState(null)
  const [nifiErr, setNifiErr] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => {
    get('/api/ingestion/summary').then((d) => setEtl(d.etl)).catch((e) => setErr(String(e)))
    get('/api/ingestion/hdfs').then(setFiles).catch((e) => setFilesErr(String(e)))
    get('/api/ingestion/nifi').then(setNifi).catch((e) => setNifiErr(String(e)))
  }, [])

  if (!etl) return <Loading err={err} />
  const n = (k) => Number(etl[k])
  const total = files ? files.reduce((s, f) => s + f.bytes, 0) : 0
  const funnel = [
    ['Produk dengan nutrisi + kategori', n('joined_n0')],
    ['Setelah buang data inti kosong', n('after_dropna_n1')],
    ['Setelah filter nilai wajar', n('after_range_filter_n2')],
    ['Final dianalisis', n('final_n3')],
  ].reverse()
  const recentPct = (100 * n('records_on_or_after_cutoff')) / n('food_rows')

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-emerald-950 dark:text-emerald-100">Data Ingestion</h1>

      <Section title="Alur data" note="Dari CSV mentah sampai dashboard.">
        <div className="flex flex-wrap items-stretch gap-2 text-sm">
          {STEPS.map(([a, b], i) => (
            <div key={a} className="flex items-center gap-2">
              <div className="rounded-xl bg-emerald-50 px-3 py-2 dark:bg-slate-700">
                <div className="font-medium text-emerald-900 dark:text-emerald-200">{a}</div>
                <div className="text-xs text-slate-500">{b}</div>
              </div>
              {i < STEPS.length - 1 && <span className="text-slate-400">→</span>}
            </div>
          ))}
        </div>
      </Section>

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="File di HDFS /raw" value={files ? files.length : '-'} sub={files ? fmtBytes(total) : filesErr ? 'WebHDFS tidak terjangkau' : ''} />
        <Stat label="Baris food" value={fmt(n('food_rows'))} />
        <Stat label="Baris food_nutrient" value={fmt(n('food_nutrient_rows'))} />
        <Stat label="Jenis nutrisi" value={`6 / ${fmt(n('nutrient_types_total'))}`} sub="dianalisis / total di USDA" />
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="File di HDFS (/nutrisense/raw)" note="Dibaca langsung dari WebHDFS.">
          {files ? (
            <table className="w-full text-sm dark:text-slate-200">
              <thead><tr className="text-left text-slate-500"><th>File</th><th className="text-right">Ukuran (byte)</th><th className="text-right">Ukuran</th></tr></thead>
              <tbody>
                {files.map((f) => (
                  <tr key={f.name} className="border-t dark:border-slate-700">
                    <td className="py-1">{f.name}</td>
                    <td className="text-right">{fmt(f.bytes)}</td>
                    <td className="text-right">{fmtBytes(f.bytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <div className="text-sm text-amber-600">{filesErr || 'Memuat...'}</div>}
        </Section>

        <Section title="Status NiFi" note="Process group NutriSense Ingestion. Angka mencerminkan jendela waktu singkat terakhir, jadi 0 wajar bila flow sudah berhenti.">
          {nifi ? (
            <div className="grid grid-cols-2 gap-2 text-sm dark:text-slate-200">
              <div>Group: <b>{nifi.name}</b></div>
              <div>Antrean: <b>{nifi.queued}</b></div>
              <div>FlowFile masuk: <b>{fmt(nifi.flowFilesIn)}</b></div>
              <div>FlowFile keluar: <b>{fmt(nifi.flowFilesOut)}</b></div>
              <div>Byte masuk: <b>{fmtBytes(nifi.bytesIn)}</b></div>
              <div>Byte keluar: <b>{fmtBytes(nifi.bytesOut)}</b></div>
            </div>
          ) : <div className="text-sm text-amber-600">{nifiErr ? `NiFi belum terhubung (${nifiErr}). Cek NIFI_USER, NIFI_PASS, NIFI_PG_ID.` : 'Memuat...'}</div>}
        </Section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Hasil validasi data mentah">
          <table className="w-full text-sm dark:text-slate-200">
            <tbody>
              {[
                ['fdc_id duplikat di food', fmt(n('food_duplicate_ids'))],
                ['fdc_id yatim di food_nutrient', fmt(n('orphan_fdc_id'))],
                ['Nilai nutrisi negatif', fmt(n('food_nutrient_negative'))],
                ['Nilai nutrisi kosong (amount null)', fmt(n('food_nutrient_null_amount'))],
                ['Rentang publication_date', `${etl.pub_date_min} s/d ${etl.pub_date_max}`],
                [`Record bertanggal ≥ ${etl.date_cutoff}`, `${fmt(n('records_on_or_after_cutoff'))} (${recentPct.toFixed(2)}%)`],
              ].map(([a, b]) => (
                <tr key={a} className="border-t first:border-0 dark:border-slate-700">
                  <td className="py-1.5">{a}</td><td className="text-right font-medium">{b}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">
            Dataset berasal dari rilis 18 Desember 2025, tetapi tanggal publikasi per produk tersebar sejak 2019.
            Hanya sebagian kecil produk yang bertanggal dalam satu tahun terakhir.
          </p>
        </Section>

        <Section title="Dari mentah ke data analisis" note="Jumlah produk di tiap tahap pembersihan.">
          <Plot data={[{ type: 'bar', orientation: 'h', x: funnel.map((f) => f[1]), y: funnel.map((f) => f[0]),
            marker: { color: '#16a34a' }, text: funnel.map((f) => fmt(f[1])), textposition: 'auto' }]}
            layout={base({ height: 260, margin: { t: 5, b: 30, l: 230, r: 10 } })} {...plotProps} />
        </Section>
      </div>
    </div>
  )
}