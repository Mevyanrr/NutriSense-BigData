import os
import warnings
from functools import lru_cache
from pathlib import Path

import duckdb
import pandas as pd
import requests
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

warnings.filterwarnings("ignore")
ROOT = Path(os.getenv("NS_ROOT", r"D:\BigData-ProjekAkhir"))
RES = ROOT / "results"
FOODS = (ROOT / "data" / "foods.parquet").as_posix() + "/*.parquet"
ASSIGN = (RES / "cluster_assignments.parquet").as_posix() + "/*.parquet"

NIFI_URL = os.getenv("NIFI_URL", "https://localhost:8443")
NIFI_USER = os.getenv("NIFI_USER", "")
NIFI_PASS = os.getenv("NIFI_PASS", "")
NIFI_PG_ID = os.getenv("NIFI_PG_ID", "")          # ID process group NutriSense Ingestion
WEBHDFS = os.getenv("WEBHDFS", "http://localhost:9870/webhdfs/v1")

# Nama manual dari profil angka k=6 (BELUM diverifikasi ke kategori produk).
# Dicocokkan lewat energi rata-rata; kalau tidak cocok, nama otomatis dipakai.
NAMES = {
    0: ("Padat energi, tinggi serat & lemak", 464),
    1: ("Manis berlemak", 333),
    2: ("Tinggi protein & lemak, rendah karbo", 304),
    3: ("Rendah energi", 49),
    4: ("Dominan gula, nyaris tanpa lemak/protein", 197),
    5: ("Karbo kompleks, gula rendah", 264),
}

app = FastAPI(title="NutriSense API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@lru_cache(maxsize=None)
def table(name: str) -> pd.DataFrame:
    p = RES / f"{name}.parquet"
    if not p.exists():
        raise HTTPException(500, f"Hasil '{name}' tidak ditemukan di {RES}")
    return pd.read_parquet(p)


def rec(df: pd.DataFrame):
    return __import__("json").loads(df.to_json(orient="records"))


def cluster_names() -> dict:
    out = {}
    for _, r in table("cluster_profile").iterrows():
        cid = int(r["cluster"])
        nm, exp = NAMES.get(cid, (None, None))
        ok = nm is not None and abs(float(r["energy_kcal_mean"]) - exp) <= 15
        out[cid] = {"name": nm if ok else r["cluster_name"], "name_verified": bool(ok)}
    return out


@app.get("/api/health")
def health():
    return {"ok": True, "results_dir": str(RES), "exists": RES.exists()}


@app.get("/api/home")
def home():
    ov = rec(table("overview"))[0]
    es = dict(table("etl_summary").values)
    cats = table("category_stats").sort_values("n_foods", ascending=False).head(10)
    return {
        "overview": ov,
        "macro_share": rec(table("macro_share")),
        "top_categories": rec(cats[["category", "n_foods"]]),
        "etl": es,
    }


@app.get("/api/ingestion/summary")
def ingestion_summary():
    return {"etl": dict(table("etl_summary").values)}


@app.get("/api/ingestion/hdfs")
def hdfs_files():
    try:
        r = requests.get(f"{WEBHDFS}/nutrisense/raw", params={"op": "LISTSTATUS"}, timeout=5)
        r.raise_for_status()
        files = r.json()["FileStatuses"]["FileStatus"]
        return [{"name": f["pathSuffix"], "bytes": f["length"]} for f in files]
    except Exception as e:
        raise HTTPException(502, f"WebHDFS tidak terjangkau: {e}")


def nifi_token():
    r = requests.post(f"{NIFI_URL}/nifi-api/access/token",
                      data={"username": NIFI_USER, "password": NIFI_PASS}, verify=False, timeout=10)
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.text}"}


@app.get("/api/ingestion/nifi")
def nifi_status():
    if not (NIFI_USER and NIFI_PASS and NIFI_PG_ID):
        raise HTTPException(503, "Set NIFI_USER, NIFI_PASS, NIFI_PG_ID dulu")
    try:
        h = nifi_token()
        r = requests.get(f"{NIFI_URL}/nifi-api/flow/process-groups/{NIFI_PG_ID}/status",
                         headers=h, verify=False, timeout=10)
        r.raise_for_status()
        s = r.json()["processGroupStatus"]["aggregateSnapshot"]
        return {"name": s["name"], "flowFilesIn": s["flowFilesIn"], "flowFilesOut": s["flowFilesOut"],
                "bytesIn": s["bytesIn"], "bytesOut": s["bytesOut"], "queued": s["queued"]}
    except requests.RequestException as e:
        raise HTTPException(502, f"NiFi tidak terjangkau: {e}")


@app.get("/api/analytics")
def analytics():
    names = cluster_names()
    prof = table("cluster_profile").copy()
    prof["name"] = prof["cluster"].map(lambda c: names[int(c)]["name"])
    prof["name_verified"] = prof["cluster"].map(lambda c: names[int(c)]["name_verified"])
    pts = table("cluster_pca_points").copy()
    pts["cluster_name"] = pts["cluster"].map(lambda c: names[int(c)]["name"])
    cat = table("category_stats").sort_values("n_foods", ascending=False)
    return {
        "category_stats": rec(cat.head(40)),
        "distribution_box": rec(table("distribution_box")),
        "distribution_hist": rec(table("distribution_hist")),
        "correlation": rec(table("correlation")),
        "atwater": rec(table("atwater_check"))[0],
        "kmeans_evaluation": rec(table("kmeans_evaluation")),
        "kmeans_meta": rec(table("kmeans_meta"))[0],
        "cluster_profile": rec(prof),
        "pca_points": rec(pts),
    }


@app.get("/api/clusters/{cid}/categories")
def cluster_categories(cid: int, limit: int = 10):
    d = table("category_cluster").copy()
    d["pct_in_category"] = 100 * d["count"] / d.groupby("category")["count"].transform("sum")
    d = d[d["cluster"] == cid].sort_values("count", ascending=False).head(limit)
    return rec(d)


@app.get("/api/insights")
def insights():
    return {
        "insights": rec(table("insights")),
        "top_foods": rec(table("top_foods")),
        "cluster_profile": analytics()["cluster_profile"],
    }


@app.get("/api/search")
def search(q: str = Query(..., min_length=2), limit: int = 25):
    names = cluster_names()
    con = duckdb.connect()
    df = con.execute(f"""
        SELECT f.fdc_id, f.description, f.brand_owner, f.category,
               f.protein, f.fat, f.carbs, f.sugar, f.fiber, f.energy_kcal, a.cluster
        FROM read_parquet('{FOODS}') f
        LEFT JOIN read_parquet('{ASSIGN}') a USING (fdc_id)
        WHERE f.description ILIKE ? LIMIT ?""", [f"%{q}%", min(limit, 100)]).df()
    df["cluster_name"] = df["cluster"].map(lambda c: names.get(int(c), {}).get("name") if pd.notna(c) else None)
    return rec(df)