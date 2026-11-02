from pyspark.sql import functions as F

from config import *
from config import get_spark

spark = get_spark("nutrisense-test")
df = spark.read.csv(f"{RAW}/nutrient.csv", header=True, escape='"')
df.show(5, truncate=False)
print("Jumlah baris nutrient.csv:", df.count())
print("Nutrisi target:")
df.filter(F.col("nutrient_nbr").cast("double").isin([float(k) for k in TARGET_NUTRIENTS])) \
  .show(truncate=False)
spark.stop()