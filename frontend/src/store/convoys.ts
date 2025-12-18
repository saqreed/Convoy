import { create } from 'zustand';
import type { Convoy, ConvoyDetail, ConvoyWithInvite, LocationPoint } from '../types';
import { createConvoy, getConvoy, joinConvoy, listConvoys } from '../lib/mockApi';

type ConvoyState = {
  items: Convoy[];
  current: ConvoyDetail | null;
  loading: boolean;
  error: string | null;
  loadAll: () => Promise<void>;
  loadOne: (id: string) => Promise<void>;
  createOne: (payload: { title: string; startTime?: string; route: LocationPoint[]; privacy: 'invite' | 'open' }) => Promise<ConvoyWithInvite>;
  joinOne: (id: string, code: string) => Promise<void>;
};

export const useConvoyStore = create<ConvoyState>((set) => ({
  items: [],
  current: null,
  loading: false,
  error: null,
  loadAll: async () => {
    set({ loading: true, error: null });
    try {
      const convoys = await listConvoys();
      set({ items: convoys });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to load convoys';
      set({ error: message });
    } finally {
      set({ loading: false });
    }
  },
  loadOne: async (id: string) => {
    set({ loading: true, error: null, current: null });
    try {
      const convoy = await getConvoy(id);
      set({ current: convoy });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to load convoy';
      set({ error: message });
    } finally {
      set({ loading: false });
    }
  },
  createOne: async (payload) => {
    set({ loading: true, error: null });
    try {
      const convoy = await createConvoy(payload);
      set((state) => ({ items: [convoy, ...state.items] }));
      return convoy;
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to create convoy';
      set({ error: message });
      throw e;
    } finally {
      set({ loading: false });
    }
  },
  joinOne: async (id: string, code: string) => {
    set({ loading: true, error: null });
    try {
      await joinConvoy(id, code);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to join convoy';
      set({ error: message });
      throw e;
    } finally {
      set({ loading: false });
    }
  }
}));
