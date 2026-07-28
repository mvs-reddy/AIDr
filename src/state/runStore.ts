/**
 * Live workflow run state. One run at a time by design — concurrent cloud calls
 * would make the consent receipt ambiguous.
 */
import { create } from 'zustand';
import type { RunStatus, WorkflowKind, WorkflowRun } from '../domain/models';
import { runsRepo } from '../services/persistence/db';

interface RunState {
  active: { workflow: WorkflowKind; status: RunStatus; streamed: string } | null;
  history: WorkflowRun[];
  error: string | null;

  begin: (workflow: WorkflowKind) => void;
  setStatus: (status: RunStatus) => void;
  appendDelta: (text: string) => void;
  complete: (run: WorkflowRun) => Promise<void>;
  failWith: (message: string) => void;
  clear: () => void;
  loadHistory: () => Promise<void>;
}

export const useRuns = create<RunState>((set) => ({
  active: null,
  history: [],
  error: null,

  begin: (workflow) => set({ active: { workflow, status: 'collectingInput', streamed: '' }, error: null }),
  setStatus: (status) => set((s) => (s.active ? { active: { ...s.active, status } } : s)),
  appendDelta: (text) =>
    set((s) => (s.active ? { active: { ...s.active, streamed: s.active.streamed + text } } : s)),

  complete: async (run) => {
    await runsRepo.save({ ...run, status: 'saved' });
    set((s) => ({ active: null, history: [{ ...run, status: 'saved' }, ...s.history] }));
  },

  failWith: (message) => set({ active: null, error: message }),
  clear: () => set({ active: null, error: null }),
  loadHistory: async () => set({ history: await runsRepo.list() }),
}));
