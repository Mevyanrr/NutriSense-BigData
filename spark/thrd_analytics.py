import pandas as pd
from pyspark.ml.feature import VectorAssembler
from pyspark.ml.stat import Correlation
from pyspark.sql import functions as F
from config import *

spark = get_spark("nutrisense-analytics")
df = spark.read.parquet(f"{CURATED}/foods.parquet").persist()
N = df.count()
NUTS = list(TARGET_NUTRIENTS.values())   # protein, fat, carbs, energy_kcal, sugar, fiber
es = dict(load_small(spark, "etl_summary").values)

# Overview + komposisi makro
ov = df.agg(F.count("*").alias("total_foods"),
            F.countDistinct("category").alias("total_categories"),
            *[F.avg(c).alias(f"avg_{c}") for c in NUTS]).toPandas()
ov["nutrient_types_total"] = int(es["nutrient_types_total"])
save_small(spark, ov, "overview")

r = ov.iloc[0]
tot = r["avg_protein"] + r["avg_fat"] + r["avg_carbs"]
share = pd.DataFrame({
    "nutrient": ["protein", "fat", "carbs"],
    "avg_g_per_100g": [r["avg_protein"], r["avg_fat"], r["avg_carbs"]],
    "share_pct": [100 * r["avg_protein"] / tot, 100 * r["avg_fat"] / tot, 100 * r["avg_carbs"] / tot]})
save_small(spark, share, "macro_share")

# Statistik per kategori
aggs = [F.count("*").alias("n_foods")]
for c in NUTS:
    aggs += [F.avg(c).alias(f"{c}_mean"), F.stddev(c).alias(f"{c}_std"),
             F.expr(f"percentile_approx({c}, 0.5)").alias(f"{c}_median")]
cat = df.groupBy("category").agg(*aggs).toPandas().sort_values("n_foods", ascending=False)
save_small(spark, cat, "category_stats")

# Distribusi (histogram + box plot)
QS = [0.0, 0.01, 0.25, 0.5, 0.75, 0.99, 1.0]
NBINS = 30
qres = df.approxQuantile(NUTS, QS, 0.001)
box_rows, hist_rows = [], []
for c, q in zip(NUTS, qres):
    box_rows.append({"nutrient": c, "min": q[0], "p01": q[1], "q1": q[2], "median": q[3],
                     "q3": q[4], "p99": q[5], "max": q[6]})
    hi = q[5] if q[5] > 0 else (q[6] if q[6] > 0 else 1.0)
    step = hi / NBINS
    h = (df.select(F.least(F.floor(F.col(c) / F.lit(step)), F.lit(NBINS - 1)).cast("int").alias("bin"))
         .groupBy("bin").count().toPandas().set_index("bin")["count"].to_dict())
    for b in range(NBINS):
        hist_rows.append({"nutrient": c, "bin_start": b * step, "bin_end": (b + 1) * step,
                          "count": int(h.get(b, 0)), "is_overflow_bin": b == NBINS - 1})
save_small(spark, pd.DataFrame(box_rows), "distribution_box")
save_small(spark, pd.DataFrame(hist_rows), "distribution_hist")

# Korelasi
vec = VectorAssembler(inputCols=NUTS, outputCol="v").transform(df.select(*NUTS))
cm = Correlation.corr(vec, "v", "pearson").head()[0].toArray()
corr_rows = [{"nutrient_x": a, "nutrient_y": b, "pearson": float(cm[i][j])}
             for i, a in enumerate(NUTS) for j, b in enumerate(NUTS)]
save_small(spark, pd.DataFrame(corr_rows), "correlation")

at = df.withColumn("atwater", 4 * F.col("protein") + 9 * F.col("fat") + 4 * F.col("carbs"))
at_corr = at.stat.corr("energy_kcal", "atwater")
at_mae = at.agg(F.avg(F.abs(F.col("energy_kcal") - F.col("atwater")))).first()[0]
save_small(spark, pd.DataFrame([{"corr_energy_vs_atwater": at_corr, "mae_kcal": at_mae}]), "atwater_check")

# Top foods per nutrisi
frames = []
for c in NUTS:
    frames.append(df.orderBy(F.col(c).desc()).limit(10)
                  .select("fdc_id", "description", "brand_owner", "category",
                          F.lit(c).alias("nutrient"), F.col(c).alias("value")).toPandas())
save_small(spark, pd.concat(frames, ignore_index=True), "top_foods")

# Insight otomatis (dari angka di atas)
MIN_CAT = 200
big = cat[cat["n_foods"] >= MIN_CAT]
ins = []


def add(key, title, text):
    ins.append({"key": key, "title": title, "text": text})


top1 = cat.iloc[0]
add("top_category", "Kategori terbesar",
    f"Kategori '{top1['category']}' paling banyak: {int(top1['n_foods']):,} produk "
    f"({100 * top1['n_foods'] / N:.1f}% dari {N:,} produk).")

if len(big) > 0:
    a = big.loc[big["protein_std"].idxmax()]
    add("protein_variance", "Variasi protein terbesar",
        f"Di antara kategori dengan >= {MIN_CAT} produk, '{a['category']}' punya variasi protein terbesar "
        f"(simpangan baku {a['protein_std']:.1f} g/100g, rata-rata {a['protein_mean']:.1f} g).")
    for col, lab in [("protein_mean", "protein"), ("sugar_mean", "gula"), ("fat_mean", "lemak")]:
        b = big.loc[big[col].idxmax()]
        add(f"top_{lab}", f"Rata-rata {lab} tertinggi",
            f"Kategori '{b['category']}' memiliki rata-rata {lab} tertinggi: {b[col]:.1f} g/100g "
            f"(n={int(b['n_foods']):,}).")

ie = NUTS.index("energy_kcal")
others = [(NUTS[j], cm[ie][j]) for j in range(len(NUTS)) if j != ie]
n_best, v_best = max(others, key=lambda t: abs(t[1]))
add("energy_corr", "Korelasi energi",
    f"Energi paling berkorelasi dengan {n_best} (Pearson {v_best:.2f}).")
add("atwater", "Energi vs makronutrien",
    f"Energi tercatat vs estimasi 4*protein + 9*lemak + 4*karbo berkorelasi {at_corr:.3f} "
    f"(selisih absolut rata-rata {at_mae:.1f} kcal), sehingga energi hampir sepenuhnya ditentukan makronutrien.")

rep = df.agg(F.avg(F.col("sugar_reported").cast("int")).alias("s"),
             F.avg(F.col("fiber_reported").cast("int")).alias("f")).first()
add("missing", "Kelengkapan data",
    f"Gula dilaporkan pada {100 * rep['s']:.1f}% produk dan serat pada {100 * rep['f']:.1f}%; "
    f"nilai kosong diisi 0 pada tahap ETL.")

save_small(spark, pd.DataFrame(ins), "insights")
print(f"\nSelesai. {len(ins)} insight dibuat dari {N:,} produk.")
spark.stop()