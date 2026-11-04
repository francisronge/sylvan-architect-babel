import { useEffect, useRef, useState } from 'react';
import {
  listTreeBankEntries, saveTreeBankEntry, loadTreeBankEntry, removeTreeBankEntry,
  setTreeBankEntryKept, subscribeTreeBankChanges, type TreeBankEntrySummary, type TreeBankSaveInput
} from '../services/treeBankStore.ts';

const compareTreeBankEntries = (a: TreeBankEntrySummary, b: TreeBankEntrySummary): number =>
  b.updatedAt.localeCompare(a.updatedAt);

const treeBankFailureMessage = (error: unknown, fallback: string): string => {
  if (error instanceof DOMException && error.name === 'QuotaExceededError') {
    return 'Browser storage is full. This save did not complete; your analysis is still open.';
  }
  return error instanceof Error ? `${fallback} ${error.message}` : fallback;
};

const createTreeBankId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `tree-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

type SavedTreeBankEntry = Awaited<ReturnType<typeof loadTreeBankEntry>>;
type CurrentTreeBankSave = Omit<TreeBankSaveInput, 'id' | 'createdAt' | 'updatedAt'>;

/** Own the browser-local save lifecycle; accepting a loaded workspace stays with App. */
export function useTreeBank() {
  const treeBankSaveSuccessTimeoutRef = useRef<number | null>(null);
  const [treeBankEntries, setTreeBankEntries] = useState<TreeBankEntrySummary[]>([]);
  // Only the first listing replaces the library with a loading state. Later
  // refreshes (focus, saves, deletions, other tabs) update the cards in place.
  const [treeBankLoaded, setTreeBankLoaded] = useState(false);
  const [treeBankError, setTreeBankError] = useState<string | null>(null);
  const [treeBankSaveSuccess, setTreeBankSaveSuccess] = useState(false);
  const [treeBankSaving, setTreeBankSaving] = useState(false);
  const [treeBankOpening, setTreeBankOpening] = useState(false);
  const [entryPendingDelete, setEntryPendingDelete] = useState<TreeBankEntrySummary | null>(null);
  useEffect(() => {
    let cancelled = false;
    let revision = 0;
    const refresh = async () => {
      const currentRevision = ++revision;
      try {
        const { entries, issues } = await listTreeBankEntries();
        if (!cancelled && currentRevision === revision) {
          setTreeBankEntries(entries);
          setTreeBankError(issues.length
            ? `${issues.length} saved ${issues.length === 1 ? 'entry could' : 'entries could'} not be read. Their data is preserved; other saves remain available.`
            : null);
        }
      } catch (error) {
        if (!cancelled && currentRevision === revision) {
          setTreeBankError(treeBankFailureMessage(error, 'Tree Bank could not be loaded.'));
        }
      } finally {
        if (!cancelled && currentRevision === revision) setTreeBankLoaded(true);
      }
    };
    void refresh();
    const unsubscribe = subscribeTreeBankChanges(() => { void refresh(); });
    return () => { cancelled = true; unsubscribe(); };
  }, []);

  useEffect(() => () => {
    if (treeBankSaveSuccessTimeoutRef.current !== null) window.clearTimeout(treeBankSaveSuccessTimeoutRef.current);
  }, []);

  /** Save a new entry; resolves to its summary, or null when it was not saved. */
  const save = async (input: CurrentTreeBankSave): Promise<TreeBankEntrySummary | null> => {
    if (treeBankSaving) return null;
    const now = new Date().toISOString();
    const entry = { ...input, id: createTreeBankId(), createdAt: now, updatedAt: now };
    setTreeBankSaveSuccess(false);
    setTreeBankError(null);
    setTreeBankSaving(true);
    try {
      const saved = await saveTreeBankEntry(entry);
      setTreeBankEntries(current => [saved, ...current.filter(item => item.id !== saved.id)].sort(compareTreeBankEntries));
      setTreeBankSaveSuccess(true);
      setTreeBankError(null);
      if (treeBankSaveSuccessTimeoutRef.current !== null) {
        window.clearTimeout(treeBankSaveSuccessTimeoutRef.current);
      }
      treeBankSaveSuccessTimeoutRef.current = window.setTimeout(() => {
        setTreeBankSaveSuccess(false);
        treeBankSaveSuccessTimeoutRef.current = null;
      }, 2200);
      return saved;
    } catch (err) {
      console.error('Tree Bank save failed', err);
      setTreeBankError(treeBankFailureMessage(err, 'Unable to save this tree to Tree Bank.'));
      return null;
    } finally {
      setTreeBankSaving(false);
    }
  };

  /** Star or unstar a saved entry; resolves to whether the change was stored. */
  const setKept = async (id: string, kept: boolean): Promise<boolean> => {
    try {
      const updated = await setTreeBankEntryKept(id, kept);
      setTreeBankEntries(current => current.map(entry => entry.id === id ? updated : entry));
      setTreeBankError(null);
      return true;
    } catch (err) {
      console.error('Tree Bank star failed', err);
      setTreeBankError(treeBankFailureMessage(err, kept ? 'Unable to star this tree.' : 'Unable to unstar this tree.'));
      return false;
    }
  };

  const open = async (id: string, accept: (saved: SavedTreeBankEntry) => void) => {
    if (treeBankOpening) return;
    setTreeBankOpening(true);
    try {
      const saved = await loadTreeBankEntry(id);
      accept(saved);
      setTreeBankError(null);
    } catch (error) {
      setTreeBankError(treeBankFailureMessage(error, 'This saved entry could not be opened. Its data has been preserved.'));
    } finally {
      setTreeBankOpening(false);
    }
  };

  const deletePending = async () => {
    if (!entryPendingDelete) return;
    try {
      await removeTreeBankEntry(entryPendingDelete.id);
      setTreeBankEntries((current) => current.filter((entry) => entry.id !== entryPendingDelete.id));
      setTreeBankError(null);
      setEntryPendingDelete(null);
    } catch (err) {
      console.error('Tree Bank delete failed', err);
      setTreeBankError(treeBankFailureMessage(err, 'Unable to delete this saved tree.'));
    }
  };

  return {
    entries: treeBankEntries, loading: !treeBankLoaded, error: treeBankError,
    saveSuccess: treeBankSaveSuccess, saving: treeBankSaving, opening: treeBankOpening,
    pendingDelete: entryPendingDelete, setPendingDelete: setEntryPendingDelete,
    save, setKept, open, deletePending
  };
}
