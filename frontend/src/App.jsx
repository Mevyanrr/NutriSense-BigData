import { useEffect, useState } from "react";
import { NavLink, Route, Routes, useNavigate } from "react-router-dom";
import { get } from "./api";
import Home from "./pages/Home.jsx";
import Ingestion from "./pages/Ingestion.jsx";
import Analytics from "./pages/Analytics.jsx";
import Insights from "./pages/Insights.jsx";

const NAV = [
  ["/", "Home"],
  ["/ingestion", "Data Ingestion"],
  ["/analytics", "Analytics & ML"],
  ["/insights", "Insights"],
];

function Soon({ title }) {
  return (
    <div className="p-8 text-xl text-slate-500">
      {title}: dibuat di tahap berikutnya.
    </div>
  );
}

function Search() {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState([]);
  useEffect(() => {
    if (q.trim().length < 2) {
      setRows([]);
      return;
    }
    const t = setTimeout(
      () =>
        get(`/api/search?q=${encodeURIComponent(q)}&limit=8`)
          .then(setRows)
          .catch(() => setRows([])),
      300,
    );
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="relative w-full max-w-md">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search food..."
        className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
      />
      {rows.length > 0 && (
        <div className="absolute z-20 mt-1 max-h-96 w-full overflow-auto rounded-xl border bg-white shadow-lg dark:border-slate-700 dark:bg-slate-800">
          {rows.map((r) => (
            <div
              key={r.fdc_id}
              className="border-b px-3 py-2 text-sm last:border-0 dark:border-slate-700"
            >
              <div className="font-medium dark:text-slate-100">
                {r.description}
              </div>
              <div className="text-xs text-slate-500">
                {r.category} · P {r.protein} · L {r.fat} · K {r.carbs} ·{" "}
                {r.energy_kcal} kcal
                {r.cluster_name ? ` · ${r.cluster_name}` : ""}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);
  return (
    <div className="flex min-h-screen bg-slate-50 dark:bg-slate-900">
      <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col bg-emerald-900 p-4 text-emerald-50">
        <div className="mb-8 mt-2">
          <div className="text-2xl font-bold">NutriSense</div>
          <div className="text-xs text-emerald-300">
            Food Nutrition Intelligence
          </div>
        </div>
        <nav className="flex flex-col gap-1">
          {NAV.map(([to, label]) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                "rounded-xl px-4 py-3 text-sm font-medium " +
                (isActive
                  ? "bg-emerald-600 text-white"
                  : "hover:bg-emerald-800")
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto rounded-xl border border-emerald-700 p-3 text-xs text-emerald-200">
          Data source: USDA FoodData Central
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="flex items-center justify-between gap-4 px-8 py-4">
          <Search />
          <button
            onClick={() => setDark(!dark)}
            className="rounded-full border px-3 py-1 text-sm dark:border-slate-700 dark:text-slate-100"
          >
            {dark ? "Light" : "Dark"}
          </button>
        </header>
        <main className="px-8 pb-10">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/ingestion" element={<Ingestion />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/insights" element={<Insights />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
