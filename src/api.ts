export interface BiomarkerData {
  date: string;
  vitaminD: number;
  ldlCholesterol: number;
}

export interface Alert {
  id: string;
  biomarker: string;
  status: 'low' | 'high' | 'normal';
  message: string;
  timestamp: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface UploadResult {
  success: boolean;
  message: string;
  originalFilename: string;
  uploadedAt: string;
  labDate?: string;
  fileUrl?: string;
  patientToken?: string;
}

export interface HistoryEntry {
  lab_date: string;
  uploaded_at: string;
  original_filename: string;
  file_url: string;
  biomarkers: Array<{ name: string; value: number; unit?: string; flag?: string; research_notes?: string[] }>;
}

// Mutable stores backing the dashboard
let biomarkerDataStore: BiomarkerData[] = [
  { date: '2025-08', vitaminD: 28, ldlCholesterol: 145 },
  { date: '2025-09', vitaminD: 25, ldlCholesterol: 152 },
  { date: '2025-10', vitaminD: 22, ldlCholesterol: 148 },
  { date: '2025-11', vitaminD: 20, ldlCholesterol: 155 },
];

let alertsStore: Alert[] = [
  {
    id: '1',
    biomarker: 'Vitamin D',
    status: 'low',
    message: 'Vitamin D is Low - Consider supplementation',
    timestamp: '2025-11-21',
  },
  {
    id: '2',
    biomarker: 'LDL Cholesterol',
    status: 'high',
    message: 'LDL Cholesterol elevated - Review diet',
    timestamp: '2025-11-20',
  },
];

// Simple pub/sub to notify dashboard of data updates
type DataUpdateCallback = () => void;
const subscribers = new Set<DataUpdateCallback>();
export function subscribeToDataUpdates(callback: DataUpdateCallback) {
  subscribers.add(callback);
  return () => subscribers.delete(callback);
}
function notifyDataUpdated() {
  subscribers.forEach(cb => cb());
}

let lastPatientToken: string | null = null;
function sanitizeToken(token: string): string {
  return token.replace(/[^\w\-:.]/g, '');
}
export function getLastPatientToken(): string | null {
  if (lastPatientToken) return lastPatientToken;
  try {
    const t = localStorage.getItem('patientToken');
    if (t) lastPatientToken = sanitizeToken(t);
    return lastPatientToken;
  } catch {
    return lastPatientToken;
  }
}
function setLastPatientToken(token: string) {
  lastPatientToken = sanitizeToken(token);
  try {
    localStorage.setItem('patientToken', lastPatientToken);
  } catch {}
}

export async function uploadHealthReport(file: File): Promise<UploadResult> {
  // Send the PDF to backend using FormData
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch('http://localhost:8000/analyze', {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`Upload failed with status ${response.status}`);
  }

  const data = await response.json();
  // expected shape: { patient, analysis: { biomarkers: [...] }, status, original_filename, uploaded_at, lab_date, file_url }
  const biomarkers: Array<{ name: string; value: number; unit?: string; flag?: string }> = data?.analysis?.biomarkers || [];

  // Capture and persist patient token for history queries
  const patientToken: string | undefined = data?.patient;
  if (patientToken) {
    setLastPatientToken(patientToken);
  }

  // Update trends store (append latest values for the current month)
  const last = biomarkerDataStore[biomarkerDataStore.length - 1];
  const newEntry: BiomarkerData = {
    date: new Date().toISOString().slice(0, 7),
    vitaminD: last?.vitaminD ?? 0,
    ldlCholesterol: last?.ldlCholesterol ?? 0,
  };

  biomarkers.forEach(b => {
    const name = b.name.toLowerCase();
    if (name.includes('vitamin d')) {
      newEntry.vitaminD = Number(b.value);
    }
    if (name.includes('ldl')) {
      newEntry.ldlCholesterol = Number(b.value);
    }
  });

  biomarkerDataStore = [...biomarkerDataStore, newEntry];

  // Update alerts store based on flags
  const today = new Date().toISOString().split('T')[0];
  biomarkers.forEach(b => {
    const flag = (b.flag || '').toLowerCase();
    if (flag === 'low' || flag === 'high') {
      const status = flag as 'low' | 'high';
      alertsStore = [
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          biomarker: b.name,
          status,
          message:
            status === 'low'
              ? `${b.name} is Low`
              : `${b.name} is High`,
          timestamp: today,
        },
        ...alertsStore,
      ];
    }
  });

  // Notify subscribers (e.g., dashboard) that data changed
  notifyDataUpdated();

  const originalFilename: string = data?.original_filename || file.name;
  const uploadedAt: string = data?.uploaded_at || new Date().toISOString();
  const labDate: string | undefined = data?.lab_date;
  const fileUrl: string | undefined = data?.file_url
    ? `http://localhost:8000${data.file_url}`
    : undefined;

  return {
    success: true,
    message: `Successfully analyzed ${file.name}`,
    originalFilename,
    uploadedAt,
    labDate,
    fileUrl,
    patientToken,
  };
}

export async function getBiomarkerTrends(): Promise<BiomarkerData[]> {
  await new Promise(resolve => setTimeout(resolve, 200));
  return biomarkerDataStore;
}

export async function getAlerts(): Promise<Alert[]> {
  await new Promise(resolve => setTimeout(resolve, 150));
  return alertsStore;
}

export async function getPatientHistory(patientToken: string): Promise<HistoryEntry[]> {
  const response = await fetch(`http://localhost:8000/history/${patientToken}`);
  if (!response.ok) {
    throw new Error(`History fetch failed: ${response.status}`);
  }
  const data = await response.json();
  const history: HistoryEntry[] = data?.history || [];
  // Normalize file_url to absolute URL
  return history.map(h => ({
    ...h,
    file_url: h.file_url?.startsWith('http') ? h.file_url : `http://localhost:8000${h.file_url}`,
  }));
}

export async function sendChatMessage(message: string): Promise<ChatMessage> {
  await new Promise(resolve => setTimeout(resolve, 1000));

  const responses: Record<string, string> = {
    'vitamin d': 'To boost Vitamin D levels, try: fatty fish (salmon, mackerel), fortified dairy products, egg yolks, and mushrooms exposed to sunlight. Consider 15-20 minutes of sun exposure daily and supplementation if levels remain low.',
    cholesterol: 'To manage LDL cholesterol: increase fiber intake (oats, beans, lentils), consume healthy fats (avocados, nuts, olive oil), eat fatty fish rich in omega-3s, and reduce saturated fats. Regular exercise also helps significantly.',
    default:
      'Based on your biomarker data, I recommend focusing on lifestyle interventions. Would you like specific recommendations for any particular biomarker?',
  };

  const messageKey = Object.keys(responses).find(key => message.toLowerCase().includes(key));

  return {
    id: Date.now().toString(),
    role: 'assistant',
    content: responses[messageKey || 'default'],
    timestamp: new Date().toISOString(),
  };
}
