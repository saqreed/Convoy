import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useConvoyStore } from '../store/convoys';

export default function JoinConvoyPage() {
  const navigate = useNavigate();
  const [convoyId, setConvoyId] = useState('');
  const [code, setCode] = useState('');
  const [success, setSuccess] = useState(false);
  const loading = useConvoyStore((s) => s.loading);
  const error = useConvoyStore((s) => s.error);
  const joinOne = useConvoyStore((s) => s.joinOne);

  async function onJoin() {
    setSuccess(false);
    await joinOne(convoyId, code);
    setSuccess(true);
    setTimeout(() => navigate(`/convoys/${convoyId}`), 1000);
  }

  return (
    <div className="max-w-md mx-auto">
      <div className="text-center mb-8">
        <div className="w-16 h-16 bg-indigo-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-slate-900 mb-2">Join a Convoy</h1>
        <p className="text-slate-500">Enter the convoy ID. Invite code is only needed for private convoys.</p>
      </div>

      <div className="card">
        <div className="space-y-4">
          <div>
            <label className="label">Convoy ID</label>
            <input
              value={convoyId}
              onChange={(e) => setConvoyId(e.target.value)}
              className="input"
              placeholder="e.g., abc123-def456-..."
            />
          </div>
          <div>
            <label className="label">Invite Code (optional for open convoys)</label>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="input"
              placeholder="Leave empty if convoy is open"
              onKeyDown={(e) => e.key === 'Enter' && convoyId && onJoin()}
            />
          </div>

          {success && (
            <div className="bg-emerald-50 text-emerald-700 px-4 py-3 rounded-lg text-sm flex items-center gap-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Successfully joined! Redirecting...
            </div>
          )}

          {error && (
            <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          <button
            onClick={onJoin}
            disabled={loading || !convoyId}
            className="btn-primary w-full"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Joining...
              </span>
            ) : (
              'Join Convoy'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
