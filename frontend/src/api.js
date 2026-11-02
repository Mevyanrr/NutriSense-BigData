export async function get(path) {
  const r = await fetch(path)
  if (!r.ok) throw new Error(`${path} -> ${r.status}`)
  return r.json()
}
export const fmt = (n) => new Intl.NumberFormat('id-ID').format(Math.round(n))
export const fmtBytes = (b) =>
  b >= 1e9 ? (b / 1e9).toFixed(2) + ' GB' : (b / 1e6).toFixed(1) + ' MB'