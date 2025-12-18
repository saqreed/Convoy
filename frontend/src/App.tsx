import { BrowserRouter, Link, Route, Routes, Navigate, useLocation } from 'react-router-dom';
import AuthPage from './pages/AuthPage';
import ConvoysPage from './pages/ConvoysPage';
import CreateConvoyPage from './pages/CreateConvoyPage';
import JoinConvoyPage from './pages/JoinConvoyPage';
import ConvoyDetailPage from './pages/ConvoyDetailPage';
import ProfilePage from './pages/ProfilePage';
import { useAuthStore } from './store/auth';

function NavLink({ to, children }: { to: string; children: React.ReactNode }) {
  const location = useLocation();
  const isActive = location.pathname === to || location.pathname.startsWith(to + '/');
  return (
    <Link
      to={to}
      className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
        isActive
          ? 'bg-indigo-100 text-indigo-700'
          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
      }`}
    >
      {children}
    </Link>
  );
}

function App() {
  const token = useAuthStore((s) => s.token);
  const logout = useAuthStore((s) => s.logout);

  return (
    <BrowserRouter>
      <div className="min-h-screen bg-slate-50">
        <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between h-16">
              <Link to="/" className="flex items-center gap-2">
                <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </div>
                <span className="text-xl font-bold text-slate-900">Convoy</span>
              </Link>
              <nav className="flex items-center gap-1">
                <NavLink to="/convoys">My Convoys</NavLink>
                <NavLink to="/convoys/create">Create</NavLink>
                <NavLink to="/convoys/join">Join</NavLink>
                {token ? (
                  <>
                    <NavLink to="/profile">Profile</NavLink>
                  <button
                    onClick={logout}
                    className="ml-2 px-3 py-2 rounded-lg text-sm font-medium text-slate-600 hover:text-red-600 hover:bg-red-50 transition-colors"
                  >
                    Logout
                  </button>
                  </>
                ) : (
                  <NavLink to="/auth">Login</NavLink>
                )}
              </nav>
            </div>
          </div>
        </header>
        <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Routes>
            <Route path="/" element={<Navigate to="/convoys" replace />} />
            <Route path="/auth" element={<AuthPage />} />
            <Route path="/convoys" element={<ConvoysPage />} />
            <Route path="/convoys/create" element={<CreateConvoyPage />} />
            <Route path="/convoys/join" element={<JoinConvoyPage />} />
            <Route path="/convoys/:id" element={<ConvoyDetailPage />} />
            <Route path="/profile" element={<ProfilePage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default App;
