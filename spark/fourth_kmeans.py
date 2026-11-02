import pandas as pd
from pyspark import StorageLevel
from pyspark.ml import Pipeline
from pyspark.ml.clustering import KMeans
from pyspark.ml.evaluation import ClusteringEvaluator
from pyspark.ml.feature import PCA, StandardScaler, VectorAssembler
from pyspark.ml.functions import vector_to_array
from pyspark.sql import functions as F
from config import *

#setting
FEATURES = ["protein", "fat", "carbs", "sugar", "fiber"]   # energi sengaja tidak dipakai
K_RANGE = range(2, 11)
MIN_K_SELECT = 3      # silhouette cenderung memilih k=2; pilih terbaik dari k >= nilai ini
FORCE_K = 6        # isi angka untuk memaksa k tertentu
SAMPLE_FRAC = 0.2     # sampel untuk pencarian k
PCA_POINTS = 20000
SEED = 42
MAX_ITER = 50

spark = get_spark("nutrisense-kmeans")
df = spark.read.parquet(f"{CURATED}/foods.parquet")
log_cols = []
for c in FEATURES:
    df = df.withColumn(f"{c}_log", F.log1p(F.col(c)))   # data miring & banyak nol
    log_cols.append(f"{c}_log")

prep = Pipeline(stages=[
    VectorAssembler(inputCols=log_cols, outputCol="raw"),
    StandardScaler(inputCol="raw", outputCol="features", withMean=True, withStd=True)]).fit(df)
data = prep.transform(df).persist(StorageLevel.MEMORY_AND_DISK)
N = data.count()
frac = 1.0 if N <= 100000 else SAMPLE_FRAC
sample = (data if frac >= 1.0 else data.sample(False, frac, SEED)).persist(StorageLevel.MEMORY_AND_DISK)
print(f"Total {N:,} produk | sampel pencarian k: {sample.count():,}")

ev = ClusteringEvaluator(featuresCol="features", predictionCol="cluster",
                         metricName="silhouette", distanceMeasure="squaredEuclidean")

# Elbow + Silhouette 
rows = []
for k in K_RANGE:
    m = KMeans(k=k, seed=SEED, maxIter=MAX_ITER, featuresCol="features", predictionCol="cluster").fit(sample)
    sil = ev.evaluate(m.transform(sample))
    rows.append({"k": k, "wsse": float(m.summary.trainingCost), "silhouette": float(sil)})
    print(f"k={k}  WSSE={rows[-1]['wsse']:.1f}  silhouette={sil:.4f}")
res = pd.DataFrame(rows)

cand = res[res["k"] >= MIN_K_SELECT]
best_k = int(FORCE_K) if FORCE_K else int(cand.loc[cand["silhouette"].idxmax(), "k"])
res["selected"] = res["k"] == best_k
print(f"\nk terpilih = {best_k}")

# Model final (data penuh)
model = KMeans(k=best_k, seed=SEED, maxIter=MAX_ITER,
               featuresCol="features", predictionCol="cluster").fit(data)
preds = model.transform(data).persist(StorageLevel.MEMORY_AND_DISK)
final_sil = float(ev.evaluate(preds))
print(f"Silhouette final (data penuh): {final_sil:.4f}")

# Profil & penamaan cluster
PROFILE = FEATURES + ["energy_kcal"]
prof = (preds.groupBy("cluster")
        .agg(F.count("*").alias("n_foods"), *[F.avg(c).alias(f"{c}_mean") for c in PROFILE])
        .orderBy("cluster").toPandas())
g = df.agg(*[F.avg(c).alias(f"{c}_m") for c in FEATURES],
           *[F.stddev(c).alias(f"{c}_s") for c in FEATURES]).first()
LABEL = {"protein": "Protein", "fat": "Fat", "carbs": "Carbs", "sugar": "Sugar", "fiber": "Fiber"}
names = {}
for i, r in prof.iterrows():
    z = {c: (r[f"{c}_mean"] - g[f"{c}_m"]) / g[f"{c}_s"] for c in FEATURES}
    for c in FEATURES:
        prof.loc[i, f"{c}_z"] = z[c]
    top = sorted([c for c in FEATURES if z[c] > 0.5], key=lambda c: -z[c])[:2]
    nm = ("High " + " & ".join(LABEL[c] for c in top)) if top else "Low Macronutrient"
    names[int(r["cluster"])] = f"C{int(r['cluster'])}: {nm}"
prof["cluster_name"] = prof["cluster"].map(names)
prof["share_pct"] = 100 * prof["n_foods"] / N
print(prof[["cluster_name", "n_foods", "share_pct"]])

# PCA 2D untuk scatter
pca_model = PCA(k=2, inputCol="features", outputCol="pca").fit(data)
var = pca_model.explainedVariance.toArray()
pfrac = min(1.0, PCA_POINTS / N)
pts = pca_model.transform(preds.sample(False, pfrac, SEED)
                          .select("fdc_id", "description", "category", "cluster", "features"))
pts = pts.select("fdc_id", "description", "category", "cluster",
                 vector_to_array("pca")[0].alias("pc1"),
                 vector_to_array("pca")[1].alias("pc2")).toPandas()

# Simpan
save_small(spark, res, "kmeans_evaluation")
save_small(spark, prof, "cluster_profile")
save_small(spark, pts, "cluster_pca_points")
save_small(spark, pd.DataFrame([{
    "k": best_k, "silhouette_final": final_sil, "n_foods": N,
    "features": ",".join(FEATURES), "transform": "log1p + standard scaling",
    "pc1_var": float(var[0]), "pc2_var": float(var[1]), "sample_frac_k_search": frac}]), "kmeans_meta")
save_small(spark, pd.DataFrame(model.clusterCenters(), columns=FEATURES).assign(cluster=range(best_k)),
           "cluster_centers_scaled")

preds.select("fdc_id", "cluster").write.mode("overwrite").parquet(f"{RESULTS}/cluster_assignments.parquet")
preds.groupBy("category", "cluster").count().write.mode("overwrite") \
    .parquet(f"{RESULTS}/category_cluster.parquet")
try:
    model.write().overwrite().save(f"{RESULTS}/kmeans_model")
except Exception as e:
    print("Model tidak tersimpan (tidak fatal):", e)
print("\nSelesai.")
spark.stop()