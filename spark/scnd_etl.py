from pyspark import StorageLevel
from pyspark.sql import functions as F
from config import *

spark = get_spark("nutrisense-etl")


def rd(name, multi=False):
    return spark.read.csv(f"{RAW}/{name}.csv", header=True, escape='"', multiLine=multi)


# Membaca (semua string, lalu cast eksplisit)
food = rd("food").select(
    F.col("fdc_id").cast("int").alias("fdc_id"),
    F.col("description"),
    F.to_date("publication_date").alias("publication_date"))

branded = rd("branded_food", multi=True).select(
    F.col("fdc_id").cast("int").alias("fdc_id"),
    F.trim("branded_food_category").alias("category"),
    F.col("brand_owner"))

nutrient = rd("nutrient").select(
    F.col("id").cast("int").alias("nutrient_id"),
    F.col("name"), F.col("unit_name"),
    F.col("nutrient_nbr").cast("double").alias("nutrient_nbr"))

fn = rd("food_nutrient").select(
    F.col("fdc_id").cast("int").alias("fdc_id"),
    F.col("nutrient_id").cast("int").alias("nutrient_id"),
    F.col("amount").cast("double").alias("amount"))

# Validasi data mentah
print("\n=== VALIDASI DATA MENTAH ===")
cut = F.lit(DATE_CUTOFF).cast("date")
fs = food.agg(
    F.count("*").alias("n"),
    F.countDistinct("fdc_id").alias("uniq"),
    F.sum(F.col("fdc_id").isNull().cast("int")).alias("null_id"),
    F.min("publication_date").alias("min_d"),
    F.max("publication_date").alias("max_d"),
    F.sum((F.col("publication_date") >= cut).cast("int")).alias("n_recent")).first()
print(f"food: {fs.n} baris | fdc_id unik {fs.uniq} | fdc_id null {fs.null_id}")
print(f"publication_date: {fs.min_d} s/d {fs.max_d} | >= {DATE_CUTOFF}: {fs.n_recent}")

bs = branded.agg(
    F.count("*").alias("n"),
    F.sum(F.col("fdc_id").isNull().cast("int")).alias("null_id"),
    F.sum(F.col("category").isNull().cast("int")).alias("null_cat")).first()
print(f"branded_food: {bs.n} baris | fdc_id null {bs.null_id} | kategori null {bs.null_cat}")

fns = fn.agg(
    F.count("*").alias("n"),
    F.sum(F.col("fdc_id").isNull().cast("int")).alias("null_id"),
    F.sum(F.col("amount").isNull().cast("int")).alias("null_amt"),
    F.sum((F.col("amount") < 0).cast("int")).alias("neg")).first()
print(f"food_nutrient: {fns.n} baris | fdc_id null {fns.null_id} | "
      f"amount null {fns.null_amt} | amount negatif {fns.neg}")

orphans = fn.select("fdc_id").distinct().join(food, "fdc_id", "left_anti").count()
print(f"fdc_id di food_nutrient yang tidak ada di food (yatim): {orphans}")
print("CATATAN: fdc_id null > 0 pada food/branded_food berarti CSV salah terbaca (cek kutip/baris baru).")

# Nutrisi target
print("\n=== NUTRISI TARGET (harus 6 baris, energi KCAL) ===")
nbrs = [float(k) for k in TARGET_NUTRIENTS]
nt = nutrient.filter(F.col("nutrient_nbr").isin(nbrs))
nt.orderBy("nutrient_nbr").show(truncate=False)
if nt.count() != len(TARGET_NUTRIENTS):
    print("PERINGATAN: jumlah nutrisi target tidak 6. Periksa tabel di atas sebelum lanjut.")

# Pivot long -> wide
j = fn.join(F.broadcast(nt.select("nutrient_id", "nutrient_nbr")), "nutrient_id")
aggs = [F.max(F.when(F.col("nutrient_nbr") == F.lit(float(k)), F.col("amount"))).alias(v)
        for k, v in TARGET_NUTRIENTS.items()]
wide = j.groupBy("fdc_id").agg(*aggs)

# Join + kualitas
joined = (wide.join(food, "fdc_id").join(branded, "fdc_id")
          .filter(F.col("category").isNotNull() & (F.col("category") != ""))
          .withColumn("sugar_reported", F.col("sugar").isNotNull())
          .withColumn("fiber_reported", F.col("fiber").isNotNull())
          .persist(StorageLevel.MEMORY_AND_DISK))
n0 = joined.count()

core = ["protein", "fat", "carbs", "energy_kcal"]
s1 = joined.dropna(subset=core)
n1 = s1.count()

s2 = (s1.fillna({"sugar": 0.0, "fiber": 0.0})
      .filter(F.col("protein").between(0, 100) & F.col("fat").between(0, 100) &
              F.col("carbs").between(0, 100) & F.col("sugar").between(0, 100) &
              F.col("fiber").between(0, 100) & F.col("energy_kcal").between(0, 900) &
              ((F.col("protein") + F.col("fat") + F.col("carbs")) <= 105)))
n2 = s2.count()

final = s2.withColumn("is_recent", F.col("publication_date") >= cut)
if FILTER_BY_RECORD_DATE:
    final = final.filter(F.col("is_recent"))
final = final.select("fdc_id", "description", "category", "brand_owner", "publication_date",
                     "protein", "fat", "carbs", "energy_kcal", "sugar", "fiber",
                     "sugar_reported", "fiber_reported", "is_recent").persist(StorageLevel.MEMORY_AND_DISK)
n3 = final.count()
n_cat = final.select("category").distinct().count()

print("\n=== RINGKASAN KUALITAS ===")
print(f"Produk punya >=1 nutrisi target + kategori : {n0}")
print(f"Setelah buang baris tanpa protein/lemak/karbo/energi: {n1}  (dibuang {n0 - n1})")
print(f"Setelah filter nilai wajar                 : {n2}  (dibuang {n1 - n2})")
print(f"Final (FILTER_BY_RECORD_DATE={FILTER_BY_RECORD_DATE})            : {n3}")
print(f"Jumlah kategori final                      : {n_cat}")

final.write.mode("overwrite").parquet(f"{CURATED}/foods.parquet")
print(f"[saved] {CURATED}/foods.parquet")

# Simpan ringkasan untuk halaman Data Ingestion
rows = [
    ("food_rows", str(fs.n)), ("branded_rows", str(bs.n)), ("food_nutrient_rows", str(fns.n)),
    ("nutrient_types_total", str(nutrient.count())),
    ("food_duplicate_ids", str(fs.n - fs.uniq)),
    ("food_nutrient_negative", str(fns.neg)), ("food_nutrient_null_amount", str(fns.null_amt)),
    ("orphan_fdc_id", str(orphans)),
    ("pub_date_min", str(fs.min_d)), ("pub_date_max", str(fs.max_d)),
    ("date_cutoff", DATE_CUTOFF), ("records_on_or_after_cutoff", str(fs.n_recent)),
    ("joined_n0", str(n0)), ("after_dropna_n1", str(n1)),
    ("after_range_filter_n2", str(n2)), ("final_n3", str(n3)), ("final_categories", str(n_cat)),
]
spark.createDataFrame(rows, ["metric", "value"]).coalesce(1).write.mode("overwrite") \
    .parquet(f"{RESULTS}/etl_summary.parquet")
print("[saved] etl_summary.parquet")
spark.stop()