import { useState } from 'react';
import { Upload, FileText, CheckCircle, AlertCircle, Download, Calendar } from 'lucide-react';
import { uploadHealthReport } from '../api';

export function UploadStation() {
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<{
    type: 'success' | 'error' | null;
    message: string;
  }>({ type: null, message: '' });
  const [uploads, setUploads] = useState<Array<{ id: string; name: string; uploadedAt: string; labDate?: string; url?: string }>>([]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile && droppedFile.type === 'application/pdf') {
      setFile(droppedFile);
      setUploadStatus({ type: null, message: '' });
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setUploadStatus({ type: null, message: '' });
    }
  };

  const handleAnalyze = async () => {
    if (!file) return;

    setIsLoading(true);
    setUploadStatus({ type: null, message: '' });

    try {
      const result = await uploadHealthReport(file);
      setUploadStatus({
        type: 'success',
        message: result.message,
      });

      // Track uploaded file metadata and enable sequential uploads
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      setUploads(prev => [
        {
          id,
          name: result.originalFilename || file.name,
          uploadedAt: result.uploadedAt,
          labDate: result.labDate,
          url: result.fileUrl,
        },
        ...prev,
      ]);

      // Reset the file selector so next upload can begin immediately
      setFile(null);
    } catch (error) {
      setUploadStatus({
        type: 'error',
        message: 'Failed to analyze report. Please try again.',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
      <h2 className="text-xl font-bold text-green-400 mb-4 flex items-center gap-2">
        <Upload className="w-5 h-5" />
        Upload Station
      </h2>

      <div
        className={`border-2 border-dashed rounded-lg p-8 text-center transition-all ${
          isDragging
            ? 'border-green-400 bg-green-400/10'
            : 'border-slate-700 bg-slate-950/50'
        }`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {file ? (
          <div className="flex items-center justify-center gap-3 text-green-400">
            <FileText className="w-8 h-8" />
            <span className="font-medium">{file.name}</span>
          </div>
        ) : (
          <>
            <Upload className="w-12 h-12 text-slate-600 mx-auto mb-3" />
            <p className="text-slate-400 mb-2">
              Drag & drop your health report (PDF)
            </p>
            <p className="text-slate-600 text-sm mb-4">or</p>
            <label className="inline-block px-4 py-2 bg-slate-800 text-green-400 rounded cursor-pointer hover:bg-slate-700 transition-colors">
              Browse Files
              <input
                type="file"
                accept=".pdf"
                className="hidden"
                onChange={handleFileInput}
              />
            </label>
          </>
        )}
      </div>

      <button
        onClick={handleAnalyze}
        disabled={!file || isLoading}
        className="w-full mt-4 px-6 py-3 bg-green-500 text-black font-bold rounded-lg hover:bg-green-400 disabled:bg-slate-800 disabled:text-slate-600 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
      >
        {isLoading ? (
          <>
            <div className="w-5 h-5 border-2 border-black/20 border-t-black rounded-full animate-spin" />
            Analyzing...
          </>
        ) : (
          'Analyze Report'
        )}
      </button>

      {uploadStatus.type && (
        <div
          className={`mt-4 p-4 rounded-lg flex items-start gap-3 ${
            uploadStatus.type === 'success'
              ? 'bg-green-500/10 border border-green-500/30'
              : 'bg-red-500/10 border border-red-500/30'
          }`}
        >
          {uploadStatus.type === 'success' ? (
            <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
          )}
          <div className="flex-1">
            <p
              className={
                uploadStatus.type === 'success'
                  ? 'text-green-400'
                  : 'text-red-400'
              }
            >
              {uploadStatus.message}
            </p>
          </div>
        </div>
      )}

      {uploads.length > 0 && (
        <div className="mt-6">
          <h3 className="text-lg font-semibold text-slate-200 mb-3">Labs</h3>
          <div className="space-y-2">
            {uploads.map(u => (
              <div key={u.id} className="flex items-center justify-between bg-slate-800/50 border border-slate-700 rounded-lg p-3">
                <div className="flex items-center gap-3 overflow-hidden">
                  <FileText className="w-5 h-5 text-green-400 flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-slate-200 truncate">{u.name}</p>
                    <p className="text-slate-500 text-sm flex items-center gap-1">
                      <Calendar className="w-4 h-4" />
                      {u.labDate ? (
                        <span>Lab Date {new Date(u.labDate).toLocaleDateString()}</span>
                      ) : (
                        <span>Uploaded {new Date(u.uploadedAt).toLocaleString()}</span>
                      )}
                    </p>
                  </div>
                </div>
                {u.url ? (
                  <a
                    href={u.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 px-3 py-1.5 bg-slate-700 text-slate-200 rounded hover:bg-slate-600"
                  >
                    <Download className="w-4 h-4" />
                    Download
                  </a>
                ) : (
                  <button
                    disabled
                    className="inline-flex items-center gap-2 px-3 py-1.5 bg-slate-800 text-slate-600 border border-slate-700 rounded cursor-not-allowed"
                  >
                    <Download className="w-4 h-4" />
                    Unavailable
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
