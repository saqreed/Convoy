import { useEffect, useMemo, useState } from 'react';
import { useAuthStore } from '../store/auth';
import { getMe, updateMe } from '../lib/mockApi';
import type { User } from '../types';

export default function ProfilePage() {
  const token = useAuthStore((s) => s.token);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);

  const [name, setName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');

  const initials = useMemo(() => {
    const n = (name || user?.name || 'U').trim();
    return n.slice(0, 2).toUpperCase();
  }, [name, user?.name]);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setError(null);
    getMe()
      .then((u) => {
        setUser(u);
        setName(u.name || '');
        setAvatarUrl(u.avatarUrl || '');
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load profile'))
      .finally(() => setLoading(false));
  }, [token]);

  async function onSave() {
    setLoading(true);
    setError(null);
    try {
      const updated = await updateMe({
        name: name.trim() ? name.trim() : undefined,
        avatarUrl: avatarUrl.trim() ? avatarUrl.trim() : null
      });
      setUser(updated);
      setName(updated.name || '');
      setAvatarUrl(updated.avatarUrl || '');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <div className="card">
        <h1 className="text-xl font-semibold text-slate-900">Profile</h1>
        <p className="text-slate-500 mt-2">Login first.</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Profile</h1>
        <p className="text-slate-500 mt-1">Edit your display name and avatar</p>
      </div>

      {error && <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>}

      <div className="card">
        <div className="flex items-center gap-4">
          {avatarUrl ? (
            <img src={avatarUrl} alt="avatar" className="w-16 h-16 rounded-full object-cover border border-slate-200" />
          ) : (
            <div className="w-16 h-16 rounded-full bg-indigo-100 flex items-center justify-center border border-indigo-200">
              <span className="text-indigo-700 font-semibold">{initials}</span>
            </div>
          )}
          <div className="min-w-0">
            <div className="font-semibold text-slate-900 truncate">{user?.name || '—'}</div>
            <div className="text-sm text-slate-500 truncate">{user?.phone || user?.email || ''}</div>
          </div>
        </div>

        <div className="grid gap-4 mt-6">
          <div>
            <label className="label">Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="input" placeholder="Your name" />
          </div>
          <div>
            <label className="label">Avatar URL</label>
            <input
              value={avatarUrl}
              onChange={(e) => setAvatarUrl(e.target.value)}
              className="input"
              placeholder="https://..."
            />
            <div className="text-xs text-slate-500 mt-1">Leave empty to remove avatar.</div>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end">
          <button className="btn-primary" onClick={onSave} disabled={loading}>
            {loading ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
