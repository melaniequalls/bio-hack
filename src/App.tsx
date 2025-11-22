import { Activity } from 'lucide-react';
import { UploadStation } from './components/UploadStation';
import { TrendsDashboard } from './components/TrendsDashboard';
import { DoctorAIChat } from './components/DoctorAIChat';

function App() {
  return (
    <div className="min-h-screen bg-black text-white">
      <header className="border-b border-slate-800 bg-slate-950/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-500/10 rounded-lg">
              <Activity className="w-6 h-6 text-green-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-green-400">
                Bio-Hacker Health Dashboard
              </h1>
              <p className="text-slate-500 text-sm">
                Advanced biomarker tracking & AI-powered insights
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <UploadStation />
            <TrendsDashboard />
          </div>

          <div className="lg:col-span-1">
            <div className="lg:sticky lg:top-24 h-[600px] lg:h-[calc(100vh-8rem)]">
              <DoctorAIChat />
            </div>
          </div>
        </div>
      </main>

      <footer className="border-t border-slate-800 mt-12">
        <div className="container mx-auto px-4 py-6 text-center text-slate-600 text-sm">
          Bio-Hacker Dashboard - For informational purposes only. Consult with
          healthcare professionals.
        </div>
      </footer>
    </div>
  );
}

export default App;
