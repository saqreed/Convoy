import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useConvoyStore } from '../store/convoys';
import { useAuthStore } from '../store/auth';

export default function ConvoysPage() {
  const items = useConvoyStore((s) => s.items);
  const loading = useConvoyStore((s) => s.loading);
  const error = useConvoyStore((s) => s.error);
  const loadAll = useConvoyStore((s) => s.loadAll);
  const token = useAuthStore((s) => s.token);

  useEffect(() => {
    if (token) loadAll();
  }, [loadAll, token]);

  if (!token) {
    return (
      <div className="text-center py-16">
        <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </div>
        <h2 className="text-xl font-semibold text-slate-900 mb-2">Sign in required</h2>
        <p className="text-slate-500 mb-6">Please sign in to view your convoys</p>
        <Link to="/auth" className="btn-primary">Sign In</Link>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">My Convoys</h1>
          <p className="text-slate-500 mt-1">Manage your convoy trips</p>
        </div>
        <div className="flex gap-3">
          <button onClick={loadAll} disabled={loading} className="btn-secondary">
            {loading ? (
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            )}
            Refresh
          </button>
          <Link to="/convoys/create" className="btn-primary">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New Convoy
          </Link>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg text-sm mb-4">
          {error}
        </div>
      )}

      {items.length === 0 && !loading ? (
        <div className="card text-center py-12">
          <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-slate-900 mb-2">No convoys yet</h3>
          <p className="text-slate-500 mb-6">Create your first convoy or join an existing one</p>
          <div className="flex gap-3 justify-center">
            <Link to="/convoys/create" className="btn-primary">Create Convoy</Link>
            <Link to="/convoys/join" className="btn-secondary">Join Convoy</Link>
          </div>
        </div>
      ) : (
        <div className="grid gap-4">
          {items.map((c) => (
            <Link key={c.id} to={`/convoys/${c.id}`} className="card hover:shadow-md transition-shadow group">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                    c.status === 'active' ? 'bg-emerald-100' : c.status === 'planned' ? 'bg-indigo-100' : 'bg-slate-100'
                  }`}>
                    <svg className={`w-5 h-5 ${
                      c.status === 'active' ? 'text-emerald-600' : c.status === 'planned' ? 'text-indigo-600' : 'text-slate-500'
                    }`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-semibold text-slate-900 group-hover:text-indigo-600 transition-colors">{c.title}</h3>
                    <div className="flex items-center gap-3 text-sm text-slate-500 mt-0.5">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        c.status === 'active' ? 'bg-emerald-100 text-emerald-700' : c.status === 'planned' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-600'
                      }`}>
                        {c.status}
                      </span>
                      <span>{new Date(c.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                </div>
                <svg className="w-5 h-5 text-slate-400 group-hover:text-indigo-500 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
