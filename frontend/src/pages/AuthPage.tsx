import { useState } from 'react';
import { useAuthStore } from '../store/auth';
import { useNavigate } from 'react-router-dom';

export default function AuthPage() {
  const navigate = useNavigate();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const sessionId = useAuthStore((s) => s.sessionId);
  const token = useAuthStore((s) => s.token);
  const loading = useAuthStore((s) => s.loading);
  const error = useAuthStore((s) => s.error);
  const sendOtpAction = useAuthStore((s) => s.sendOtpAction);
  const verifyOtpAction = useAuthStore((s) => s.verifyOtpAction);

  const onSend = () => sendOtpAction(phone);
  const onVerify = async () => {
    await verifyOtpAction(code);
    navigate('/convoys');
  };

  if (token) {
    return (
      <div className="max-w-md mx-auto">
        <div className="card text-center">
          <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-slate-900 mb-2">You're logged in!</h2>
          <p className="text-slate-500 mb-6">You can now create and join convoys.</p>
          <button onClick={() => navigate('/convoys')} className="btn-primary w-full">
            Go to My Convoys
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto">
      <div className="text-center mb-8">
        <h1 className="text-2xl font-bold text-slate-900 mb-2">Welcome to Convoy</h1>
        <p className="text-slate-500">Sign in with your phone number to get started</p>
      </div>

      <div className="card">
        {!sessionId ? (
          <div className="space-y-4">
            <div>
              <label className="label">Phone Number</label>
              <input
                type="tel"
                placeholder="+7 999 123 4567"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="input"
                onKeyDown={(e) => e.key === 'Enter' && phone && onSend()}
              />
            </div>
            <button
              disabled={loading || !phone}
              onClick={onSend}
              className="btn-primary w-full"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Sending...
                </span>
              ) : (
                'Send verification code'
              )}
            </button>
            <p className="text-xs text-slate-400 text-center">
              We'll send you a one-time code to verify your phone
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="bg-indigo-50 text-indigo-700 px-4 py-3 rounded-lg text-sm">
              Code sent! Check the backend console for OTP.
            </div>
            <div>
              <label className="label">Verification Code</label>
              <input
                type="text"
                placeholder="Enter 4-digit code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="input text-center text-2xl tracking-widest"
                maxLength={6}
                onKeyDown={(e) => e.key === 'Enter' && code && onVerify()}
              />
            </div>
            <button
              disabled={loading || !code}
              onClick={onVerify}
              className="btn-primary w-full"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Verifying...
                </span>
              ) : (
                'Verify & Sign In'
              )}
            </button>
          </div>
        )}

        {error && (
          <div className="mt-4 bg-red-50 text-red-700 px-4 py-3 rounded-lg text-sm">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
