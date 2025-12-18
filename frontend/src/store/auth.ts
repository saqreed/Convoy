import { create } from 'zustand';
import { clearToken, sendOtp, verifyOtp } from '../lib/mockApi';

const TOKEN_KEY = 'token';

type AuthState = {
  token: string | null;
  sessionId: string | null;
  loading: boolean;
  error: string | null;
  sendOtpAction: (phone: string) => Promise<void>;
  verifyOtpAction: (code: string) => Promise<void>;
  logout: () => void;
  bootstrap: () => void;
};

export const useAuthStore = create<AuthState>((set, get) => ({
  token: typeof window !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null,
  sessionId: null,
  loading: false,
  error: null,
  sendOtpAction: async (phone: string) => {
    set({ loading: true, error: null });
    try {
      const res = await sendOtp(phone);
      set({ sessionId: res.sessionId });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to send OTP';
      set({ error: message });
      throw e;
    } finally {
      set({ loading: false });
    }
  },
  verifyOtpAction: async (code: string) => {
    const sessionId = get().sessionId;
    if (!sessionId) throw new Error('Session not started');
    set({ loading: true, error: null });
    try {
      const res = await verifyOtp(sessionId, code);
      localStorage.setItem(TOKEN_KEY, res.token);
      set({ token: res.token, sessionId: null });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to verify OTP';
      set({ error: message });
      throw e;
    } finally {
      set({ loading: false });
    }
  },
  logout: () => {
    clearToken();
    set({ token: null, sessionId: null });
  },
  bootstrap: () => {
    const token = typeof window !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null;
    if (token) set({ token });
  }
}));
