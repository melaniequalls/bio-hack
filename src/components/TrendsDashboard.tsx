import { useEffect, useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { TrendingUp, AlertTriangle, Clock } from 'lucide-react';
import {
  getBiomarkerTrends,
  getAlerts,
  BiomarkerData,
  Alert,
  subscribeToDataUpdates,
  getPatientHistory,
  getLastPatientToken,
  HistoryEntry,
} from '../api';

export function TrendsDashboard() {
  const [biomarkerData, setBiomarkerData] = useState<BiomarkerData[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);

  function historyToTrends(entries: HistoryEntry[]): BiomarkerData[] {
    const points: BiomarkerData[] = entries
      .map(e => {
        const vitD = e.biomarkers.find(b => b.name.toLowerCase().includes('vitamin d'));
        const ldl = e.biomarkers.find(b => b.name.toLowerCase().includes('ldl'));
        return {
          date: (e.lab_date || e.uploaded_at || '').slice(0, 7) || new Date(e.uploaded_at).toISOString().slice(0, 7),
          vitaminD: vitD ? Number(vitD.value) : 0,
          ldlCholesterol: ldl ? Number(ldl.value) : 0,
        } as BiomarkerData;
      })
      // Filter out empty points
      .filter(p => p.date && (p.vitaminD !== 0 || p.ldlCholesterol !== 0));

    // Sort by date ascending
    points.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    return points;
  }

  useEffect(() => {
    async function fetchData() {
      setIsLoading(true);
      setHistoryError(null);

      const token = getLastPatientToken();
      try {
        const [trends, alertsData] = await Promise.all([
          getBiomarkerTrends(),
          getAlerts(),
        ]);
        setAlerts(alertsData);

        // If we have a patient token, load real history trends from backend
        if (token) {
          try {
            const fullHistory = await getPatientHistory(token);
            setHistory(fullHistory);
            const derived = historyToTrends(fullHistory);
            setBiomarkerData(derived.length > 0 ? derived : trends);
          } catch (e: any) {
            setHistoryError(e?.message || 'Unable to load history');
            setHistory([]);
            setBiomarkerData(trends);
          }
        } else {
          // Fallback to local demo trends
          setBiomarkerData(trends);
          setHistory([]);
        }
      } finally {
        setIsLoading(false);
      }
    }

    // initial load
    fetchData();

    // refresh when new data arrives from upload
    const unsubscribe = subscribeToDataUpdates(() => {
      fetchData();
    });

    return () => {
      unsubscribe();
    };
  }, []);

  if (isLoading) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
        <div className="flex items-center justify-center h-64">
          <div className="w-8 h-8 border-2 border-green-400/20 border-t-green-400 rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-6 space-y-8">
      <div>
        <h2 className="text-xl font-bold text-green-400 mb-6 flex items-center gap-2">
          <TrendingUp className="w-5 h-5" />
          Key Biomarkers
        </h2>

        <div className="mb-2">
          {historyError && (
            <div className="text-sm text-yellow-400">{historyError}</div>
          )}
        </div>

        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={biomarkerData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis
              dataKey="date"
              stroke="#64748b"
              style={{ fontSize: '12px' }}
            />
            <YAxis stroke="#64748b" style={{ fontSize: '12px' }} />
            <Tooltip
              contentStyle={{
                backgroundColor: '#0f172a',
                border: '1px solid #334155',
                borderRadius: '8px',
                color: '#e2e8f0',
              }}
            />
            <Legend
              wrapperStyle={{ color: '#e2e8f0' }}
              iconType="line"
            />
            <Line
              type="monotone"
              dataKey="vitaminD"
              stroke="#22c55e"
              strokeWidth={2}
              name="Vitamin D (ng/mL)"
              dot={{ fill: '#22c55e', r: 4 }}
            />
            <Line
              type="monotone"
              dataKey="ldlCholesterol"
              stroke="#ef4444"
              strokeWidth={2}
              name="LDL Cholesterol (mg/dL)"
              dot={{ fill: '#ef4444', r: 4 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div>
        <h3 className="text-lg font-semibold text-green-400 mb-4 flex items-center gap-2">
          <Clock className="w-5 h-5" />
          History
        </h3>
        {history.length === 0 ? (
          <p className="text-slate-500 text-sm">No history available yet. Upload a lab report to populate your trends.</p>
        ) : (
          <div className="space-y-3">
            {history.map((h, idx) => (
              <div key={`${h.uploaded_at}-${idx}`} className="p-4 rounded-lg border border-slate-700 bg-slate-800/30">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-slate-200 font-medium">{h.original_filename}</p>
                    <p className="text-slate-500 text-sm mt-1">Lab Date: {new Date(h.lab_date).toLocaleDateString()} • Uploaded: {new Date(h.uploaded_at).toLocaleString()}</p>
                  </div>
                  {h.file_url && (
                    <a
                      href={h.file_url}
                      target="_blank"
                      rel="noreferrer"
                      className="px-3 py-1 bg-slate-800 text-green-400 rounded hover:bg-slate-700 border border-slate-700"
                    >
                      View PDF
                    </a>
                  )}
                </div>
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {h.biomarkers.slice(0, 6).map((b, i) => (
                    <div key={`${b.name}-${i}`} className="flex items-center justify-between bg-slate-900/40 rounded px-3 py-2">
                      <span className="text-slate-300 text-sm">{b.name}</span>
                      <span className="text-slate-400 text-sm">{b.value} {b.unit || ''}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h3 className="text-lg font-semibold text-green-400 mb-4 flex items-center gap-2">
          <AlertTriangle className="w-5 h-5" />
          Alerts
        </h3>
        <div className="space-y-3">
          {alerts.map(alert => (
            <div
              key={alert.id}
              className={`p-4 rounded-lg border ${
                alert.status === 'low'
                  ? 'bg-yellow-500/10 border-yellow-500/30'
                  : alert.status === 'high'
                  ? 'bg-red-500/10 border-red-500/30'
                  : 'bg-green-500/10 border-green-500/30'
              }`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p
                    className={`font-medium ${
                      alert.status === 'low'
                        ? 'text-yellow-400'
                        : alert.status === 'high'
                        ? 'text-red-400'
                        : 'text-green-400'
                    }`}
                  >
                    {alert.message}
                  </p>
                  <p className="text-slate-500 text-sm mt-1">
                    {alert.timestamp}
                  </p>
                </div>
                <span
                  className={`px-2 py-1 rounded text-xs font-bold uppercase ${
                    alert.status === 'low'
                      ? 'bg-yellow-500/20 text-yellow-400'
                      : alert.status === 'high'
                      ? 'bg-red-500/20 text-red-400'
                      : 'bg-green-500/20 text-green-400'
                  }`}
                >
                  {alert.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
