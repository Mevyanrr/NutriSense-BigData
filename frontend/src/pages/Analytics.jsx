import { useEffect, useMemo, useState } from 'react'
import { get, fmt } from '../api'
import Plot from '../Plot.jsx'
import { Section, Stat, Select, Loading, base, plotProps, CL, NUTS, NLABEL } from '../ui.jsx'

const FEATS = ['protein', 'fat', 'carbs', 'sugar', 'fiber']

export default function Analytics() {
  const [d, setD] = useState(null)
  const [home, setHome] = useState(null)
  const [err, setErr] = useState('')
  const [distN, setDistN] = useState('protein')
  const [catN, setCatN] = useState('protein')

  useEffect(() => {
    get('/api/analytics').then(setD).catch((e) => setErr(String(e)))
    get('/api/home').then(setHome).catch(() => {})
  }, [])

  const catRows = useMemo(() => {
    if (!d) return []
    return [...d.category_stats].sort((a, b) => b[`${catN}_mean`] - a[`${catN}_mean`]).slice(0, 15).reverse()
  }, [d, catN])

  if (!d) return <Loading err={err} />

  const hist = d.distribution_hist.filter((r) => r.nutrient === distN)
  const box = d.distribution_box.find((r) => r.nutrient === distN)
  const prof = d.cluster_profile
  const meta = d.kmeans_meta
  const ev = d.kmeans_evaluation
  const bestK = ev.filter((r) => r.k >= 3).sort((a, b) => b.silhouette - a.silhouette)[0]
  const corrZ = NUTS.map((y) => NUTS.map((x) => d.correlation.find((r) => r.nutrient_x === x && r.nutrient_y === y)?.pearson))
  const ptsBy = (c) => d.pca_points.filter((p) => p.cluster === c)

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-emerald-950 dark:text-emerald-100">Analytics & Machine Learning</h1>

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Produk dianalisis" value={home ? fmt(home.overview.total_foods) : '-'} />
        <Stat label="Kategori" value={home ? fmt(home.overview.total_categories) : '-'} />
        <Stat label="Rata-rata energi" value={home ? `${Math.round(home.overview.avg_energy_kcal)} kcal` : '-'} sub="per 100 g / 100 ml" />
        <Stat label="Cluster (K-Means)" value={meta.k} sub={`Silhouette ${meta.silhouette_final.toFixed(3)}`} />
      </section>

      <Section title="Distribusi nutrisi"
        note="Histogram dipotong di persentil ke-99, jadi batang terakhir menampung semua nilai di atasnya. Whisker box plot = persentil 1 dan 99."
        right={<Select value={distN} onChange={setDistN} options={NUTS} />}>
        <div className="grid gap-4 lg:grid-cols-2">
          <Plot data={[{ type: 'bar', x: hist.map((r) => (r.bin_start + r.bin_end) / 2), y: hist.map((r) => r.count),
            marker: { color: hist.map((r) => (r.is_overflow_bin ? '#f59e0b' : '#16a34a')) } }]}
            layout={base({ height: 280, xaxis: { title: NLABEL[distN] }, yaxis: { title: 'Jumlah produk' } })} {...plotProps} />
          {box && (
            <Plot data={[{ type: 'box', orientation: 'h', y: [NLABEL[distN]], q1: [box.q1], median: [box.median], q3: [box.q3],
              lowerfence: [box.p01], upperfence: [box.p99], marker: { color: '#16a34a' } }]}
              layout={base({ height: 280, margin: { t: 10, b: 40, l: 110, r: 10 } })} {...plotProps} />
          )}
        </div>
      </Section>

      <Section title="Analisis per kategori"
        note="15 kategori dengan rata-rata tertinggi di antara 40 kategori terbesar. Garis galat = simpangan baku (seberapa beragam isi kategori)."
        right={<Select value={catN} onChange={setCatN} options={NUTS} />}>
        <Plot data={[{ type: 'bar', orientation: 'h', x: catRows.map((r) => r[`${catN}_mean`]), y: catRows.map((r) => r.category),
          error_x: { type: 'data', array: catRows.map((r) => r[`${catN}_std`]), color: '#94a3b8' }, marker: { color: '#16a34a' } }]}
          layout={base({ height: 460, margin: { t: 5, b: 40, l: 280, r: 10 }, xaxis: { title: `Rata-rata ${NLABEL[catN]}` } })} {...plotProps} />
      </Section>

      <Section title="Korelasi antar nutrisi"
        note={`Pearson. Energi vs estimasi Atwater (4P + 9L + 4K): r = ${d.atwater.corr_energy_vs_atwater.toFixed(3)}, selisih rata-rata ${d.atwater.mae_kcal.toFixed(1)} kcal. Karena itu energi tidak dipakai sebagai fitur K-Means.`}>
        <Plot data={[{ type: 'heatmap', x: NUTS, y: NUTS, z: corrZ, zmin: -1, zmax: 1, colorscale: 'RdBu', reversescale: true,
          texttemplate: '%{z:.2f}' }]}
          layout={base({ height: 420, margin: { t: 5, b: 70, l: 90, r: 10 } })} {...plotProps} />
      </Section>

      <Section title="K-Means: hasil pengelompokan"
        note={`Fitur: ${meta.features}. Transformasi: ${meta.transform}. Scatter memakai PCA 2D (menjelaskan ${(100 * (meta.pc1_var + meta.pc2_var)).toFixed(1)}% variansi) dari sampel acak ${fmt(d.pca_points.length)} produk.`}>
        <Plot data={prof.map((p) => ({ type: 'scattergl', mode: 'markers', name: p.name,
          x: ptsBy(p.cluster).map((r) => r.pc1), y: ptsBy(p.cluster).map((r) => r.pc2),
          text: ptsBy(p.cluster).map((r) => `${r.description}<br>${r.category}`), hoverinfo: 'text',
          marker: { size: 4, opacity: 0.6, color: CL[p.cluster % CL.length] } }))}
          layout={base({ height: 460, xaxis: { title: 'PC1' }, yaxis: { title: 'PC2' }, legend: { orientation: 'h', y: -0.15 } })} {...plotProps} />

        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <Plot data={[{ type: 'bar', x: prof.map((p) => p.n_foods), y: prof.map((p) => p.name), orientation: 'h',
            marker: { color: prof.map((p) => CL[p.cluster % CL.length]) },
            text: prof.map((p) => `${p.share_pct.toFixed(1)}%`), textposition: 'auto' }]}
            layout={base({ height: 320, margin: { t: 5, b: 40, l: 250, r: 10 }, xaxis: { title: 'Jumlah produk' } })} {...plotProps} />
          <Plot data={[{ type: 'heatmap', x: FEATS.map((f) => NLABEL[f]), y: prof.map((p) => p.name),
            z: prof.map((p) => FEATS.map((f) => p[`${f}_z`])), zmid: 0, colorscale: 'RdBu', reversescale: true, texttemplate: '%{z:.2f}' }]}
            layout={base({ height: 320, margin: { t: 5, b: 70, l: 250, r: 10 } })} {...plotProps} />
        </div>
        <p className="mt-1 text-xs text-slate-500">Heatmap: selisih rata-rata cluster terhadap rata-rata global, dalam satuan simpangan baku. Merah = di atas rata-rata.</p>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm dark:text-slate-200">
            <thead><tr className="text-left text-slate-500">
              <th>Cluster</th><th className="text-right">Produk</th><th className="text-right">Protein</th><th className="text-right">Lemak</th>
              <th className="text-right">Karbo</th><th className="text-right">Gula</th><th className="text-right">Serat</th><th className="text-right">kcal</th>
            </tr></thead>
            <tbody>
              {prof.map((p) => (
                <tr key={p.cluster} className="border-t dark:border-slate-700">
                  <td className="py-1.5">
                    <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full" style={{ background: CL[p.cluster % CL.length] }} />
                    {p.name}{!p.name_verified && <span className="ml-1 text-xs text-amber-600">(nama otomatis)</span>}
                  </td>
                  <td className="text-right">{fmt(p.n_foods)}</td>
                  {['protein', 'fat', 'carbs', 'sugar', 'fiber', 'energy_kcal'].map((f) => (
                    <td key={f} className="text-right">{p[`${f}_mean`].toFixed(1)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-slate-500">Rata-rata per 100 g / 100 ml. Nama cluster ditentukan manual dari angka profil ini, bukan dari pemeriksaan isi produk.</p>
        </div>
      </Section>

      <Section title="Evaluasi model" note={`Pencarian k memakai sampel ${(100 * meta.sample_frac_k_search).toFixed(0)}% data; model akhir dilatih pada seluruh data.`}>
        <div className="grid gap-4 lg:grid-cols-2">
          <Plot data={[{ type: 'scatter', mode: 'lines+markers', x: ev.map((r) => r.k), y: ev.map((r) => r.wsse), line: { color: '#16a34a' } }]}
            layout={base({ height: 280, xaxis: { title: 'k', dtick: 1 }, yaxis: { title: 'WSSE (Elbow)' } })} {...plotProps} />
          <Plot data={[{ type: 'scatter', mode: 'lines+markers', x: ev.map((r) => r.k), y: ev.map((r) => r.silhouette), line: { color: '#3b82f6' },
            marker: { size: ev.map((r) => (r.k === meta.k ? 14 : 7)), color: ev.map((r) => (r.k === meta.k ? '#f59e0b' : '#3b82f6')) } }]}
            layout={base({ height: 280, xaxis: { title: 'k', dtick: 1 }, yaxis: { title: 'Silhouette' } })} {...plotProps} />
        </div>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-600 dark:text-slate-300">
          <li>k terpilih = <b>{meta.k}</b>, Silhouette data penuh = <b>{meta.silhouette_final.toFixed(3)}</b>.</li>
          {bestK && bestK.k !== meta.k && (
            <li>Silhouette tertinggi (k ≥ 3) ada pada k = {bestK.k} ({bestK.silhouette.toFixed(3)}). k = {meta.k} dipilih karena profil clusternya lebih mudah dibedakan dan diinterpretasi, bukan karena skor tertinggi.</li>
          )}
          <li>Kurva Elbow turun landai tanpa tekukan jelas, sehingga tidak menunjukkan k optimal yang tegas. Silhouette berada di kisaran sedang.</li>
          <li>Gula dan serat yang kosong diisi 0 pada tahap ETL, dan ini dapat memengaruhi pembentukan cluster.</li>
        </ul>
      </Section>
    </div>
  )
}