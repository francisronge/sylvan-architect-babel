import {
  prepareTreeBankSave,
  validateTreeBankWork,
  validateTreeBankPreview,
  restoreTreeBankBundle,
} from "./treeBankRecords.ts";
import type {
  TreeBankSaveInput,
  TreeBankWork,
  TreeBankRecord,
} from "./treeBankRecords.ts";
import type { ParseBundle } from "../types.ts";
import { canonicalJson, copyJsonData } from "../derivationalDatabase/jsonData.js";
import { loadTreeBankBundleSnapshot } from "../treeBankSnapshot.js";
import { assertBundleDisplayable } from "./analysisDisplay.ts";
export type { TreeBankSaveInput } from "./treeBankRecords.ts";
export interface TreeBankEntrySummary {
  id: string;
  sentence: string;
  framework: "xbar" | "minimalism";
  activeParseIndex: number;
  createdAt: string;
  updatedAt: string;
  analysisCount: number;
  stageCount: number;
  previewId?: string;
  legacy: boolean;
}
export interface TreeBankIssue {
  id: string;
  message: string;
}
const DATABASE = "sylvan-architect-babel";
const STORE = "treeBank";
const summary = (w: TreeBankWork): TreeBankEntrySummary => ({
  id: w.id,
  sentence: w.sentence,
  framework: w.framework,
  activeParseIndex: w.activeParseIndex,
  createdAt: w.createdAt,
  updatedAt: w.updatedAt,
  analysisCount: w.analysisIds.length,
  stageCount: w.stageCounts[w.activeParseIndex] ?? 0,
  previewId: w.previewId,
  legacy: false,
});
const isObject = (value: unknown) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
function legacySummary(v: any): TreeBankEntrySummary {
  if (
    !v ||
    typeof v.id !== "string" ||
    typeof v.sentence !== "string" ||
    !["xbar", "minimalism"].includes(v.framework) ||
    !Array.isArray(v.bundle?.analyses) ||
    !v.bundle.analyses.length
  )
    throw new Error("Invalid legacy Tree Bank entry.");
  // Version-1 bundles predate record validation; any analysis can be selected.
  for (const analysis of v.bundle.analyses) {
    if (!isObject(analysis))
      throw new Error("Invalid legacy Tree Bank analysis.");
    const stages = analysis.derivationStages;
    if (
      stages !== undefined &&
      (!Array.isArray(stages) || !stages.every(isObject))
    )
      throw new Error("Invalid legacy Tree Bank derivation stages.");
  }
  const i =
    Number.isInteger(v.activeParseIndex) &&
    v.activeParseIndex >= 0 &&
    v.activeParseIndex < v.bundle.analyses.length
      ? v.activeParseIndex
      : 0;
  for (const field of ["createdAt", "updatedAt"]) {
    if (
      v[field] !== undefined &&
      (typeof v[field] !== "string" || !Number.isFinite(Date.parse(v[field])))
    ) {
      throw new Error(`Invalid legacy Tree Bank ${field}.`);
    }
  }
  const stages = v.bundle.analyses[i].derivationStages;
  return {
    id: v.id,
    sentence: v.sentence,
    framework: v.framework,
    activeParseIndex: i,
    createdAt: v.createdAt || v.updatedAt || "",
    updatedAt: v.updatedAt || v.createdAt || "",
    analysisCount: v.bundle.analyses.length,
    stageCount: stages?.length ?? 0,
    previewId: v.treeSnapshotDataUrl ? v.id : undefined,
    legacy: true,
  };
}
type ListedEntry = { entry: TreeBankEntrySummary } | { issue: TreeBankIssue };
/** Exact JSON bytes of a stored wrapper; undefined when it is not JSON data. */
const jsonBytes = (value: unknown): string | undefined => {
  try {
    return canonicalJson(copyJsonData(value));
  } catch {
    return undefined;
  }
};
type TreeBankTransaction<T> = (
  tx: IDBTransaction,
  set: (value: T) => void,
  fail: (error: unknown) => void,
) => void;

/** Request success is provisional until the transaction commits. */
export function completeTreeBankTransaction<T>(
  db: IDBDatabase,
  names: string[],
  mode: IDBTransactionMode,
  run: TreeBankTransaction<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let value: T;
    let failure: unknown;
    let tx: IDBTransaction | undefined;
    try {
      const transaction = db.transaction(
        names,
        mode,
        mode === "readwrite" ? { durability: "strict" } : undefined,
      );
      tx = transaction;
      transaction.oncomplete = () => {
        db.close();
        resolve(value);
      };
      transaction.onabort = () => {
        db.close();
        reject(
          failure || transaction.error || new Error("Tree Bank transaction aborted."),
        );
      };
      transaction.onerror = () => {
        failure ||= transaction.error;
      };
      run(
        transaction,
        (v) => {
          value = v;
        },
        (e) => {
          failure ||= e;
          try {
            transaction.abort();
          } catch {}
        },
      );
    } catch (e) {
      failure = e;
      if (tx) {
        try {
          tx.abort();
          return;
        } catch {}
      }
      db.close();
      reject(e);
    }
  });
}
export function createTreeBankStore(
  factory: IDBFactory | undefined = globalThis.indexedDB,
  databaseName = DATABASE,
) {
  const listeners = new Set<() => void>();
  let channel: BroadcastChannel | undefined;
  const notificationError = (error: unknown) => {
    console.error("Tree Bank change notification failed.", error);
  };
  const emit = () => {
    for (const fn of listeners) {
      try {
        fn();
      } catch (error) {
        notificationError(error);
      }
    }
  };
  const changed = () => {
    emit();
    let sender: BroadcastChannel | undefined;
    try {
      if (channel) channel.postMessage("changed");
      else if (
        typeof window !== "undefined" &&
        typeof BroadcastChannel !== "undefined"
      ) {
        sender = new BroadcastChannel(databaseName);
        sender.postMessage("changed");
      }
    } catch (error) {
      notificationError(error);
    } finally {
      try {
        sender?.close();
      } catch (error) {
        notificationError(error);
      }
    }
  };
  const open = (): Promise<IDBDatabase> =>
    new Promise((resolve, reject) => {
      if (!factory) {
        reject(new Error("IndexedDB is unavailable."));
        return;
      }
      const r = factory.open(databaseName, 2);
      let blocked = false;
      r.onblocked = () => {
        blocked = true;
        reject(
          new Error(
            "Tree Bank upgrade is blocked by another tab. Close older Babel tabs and retry.",
          ),
        );
      };
      r.onerror = () =>
        reject(r.error || new Error("Failed to open Tree Bank."));
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains(STORE))
          db.createObjectStore(STORE, { keyPath: "id" });
        for (const name of ["records", "savedWorks", "previews"])
          if (!db.objectStoreNames.contains(name)) {
            const s = db.createObjectStore(name, { keyPath: "id" });
            if (name === "savedWorks") s.createIndex("updatedAt", "updatedAt");
          }
      };
      r.onsuccess = () => {
        if (blocked) {
          r.result.close();
          return;
        }
        r.result.onversionchange = () => r.result.close();
        resolve(r.result);
      };
    });
  const transaction = async <T>(
    names: string[],
    mode: IDBTransactionMode,
    run: TreeBankTransaction<T>,
  ): Promise<T> => completeTreeBankTransaction(await open(), names, mode, run);
  const all = (name: string) =>
    transaction<any[]>([name], "readonly", (tx, set) => {
      const r = tx.objectStore(name).getAll();
      r.onsuccess = () => set(r.result);
    });
  const get = (name: string, id: string) =>
    transaction<any>([name], "readonly", (tx, set) => {
      const r = tx.objectStore(name).get(id);
      r.onsuccess = () => set(r.result);
    });
  // Listing reruns on every focus and change notification. Wrappers are only
  // ever added or deleted, and version-1 entries only deleted, so a refresh
  // validates only wrapper bytes it has not already checked and reads only
  // version-1 entries it has not already summarized.
  let listedWorks = new Map<string, ListedEntry>();
  let listedLegacy = new Map<IDBValidKey, ListedEntry>();
  const listWork = async (w: any): Promise<ListedEntry> => {
    try {
      return { entry: summary(await validateTreeBankWork(w)) };
    } catch (e) {
      return {
        issue: {
          id: String(w?.id || "unknown"),
          message: String((e as Error).message),
        },
      };
    }
  };
  const listLegacy = (key: IDBValidKey, value: unknown): ListedEntry => {
    try {
      return { entry: legacySummary(value) };
    } catch (error) {
      return {
        issue: { id: String(key), message: (error as Error).message },
      };
    }
  };
  const listTreeBankEntries = async () => {
    const knownWorks = listedWorks;
    const knownLegacy = listedLegacy;
    const [works, old] = await Promise.all([
      all("savedWorks"),
      transaction<{ keys: IDBValidKey[]; unread: Map<IDBValidKey, unknown> }>(
        [STORE],
        "readonly",
        (tx, set) => {
          const store = tx.objectStore(STORE);
          const request = store.getAllKeys();
          request.onsuccess = () => {
            const unread = new Map<IDBValidKey, unknown>();
            set({ keys: request.result, unread });
            for (const key of request.result) {
              if (knownLegacy.has(key)) continue;
              const value = store.get(key);
              value.onsuccess = () => unread.set(key, value.result);
            }
          };
        },
      ),
    ]);
    const nextWorks = new Map<string, ListedEntry>();
    const listed = await Promise.all(
      works.map(async (w) => {
        const bytes = jsonBytes(w);
        const result =
          (bytes !== undefined && knownWorks.get(bytes)) || (await listWork(w));
        if (bytes !== undefined) nextWorks.set(bytes, result);
        return result;
      }),
    );
    const nextLegacy = new Map<IDBValidKey, ListedEntry>();
    for (const key of old.keys) {
      const result =
        knownLegacy.get(key) ?? listLegacy(key, old.unread.get(key));
      nextLegacy.set(key, result);
      listed.push(result);
    }
    listedWorks = nextWorks;
    listedLegacy = nextLegacy;
    const entries: TreeBankEntrySummary[] = [];
    const issues: TreeBankIssue[] = [];
    for (const result of listed)
      if ("entry" in result) entries.push(result.entry);
      else issues.push(result.issue);
    entries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return { entries, issues };
  };
  const saveTreeBankEntry = async (input: TreeBankSaveInput) => {
    const prepared = await prepareTreeBankSave(input);
    await transaction<void>(
      ["records", "savedWorks", "previews", STORE],
      "readwrite",
      (tx, set, fail) => {
        const old = tx.objectStore(STORE).get(prepared.work.id);
        old.onsuccess = () => {
          if (old.result) fail(new Error("Saved work ID already exists."));
        };
        const s = tx.objectStore("records");
        for (const record of prepared.records) {
          const r = s.get(record.id);
          r.onsuccess = () => {
            try {
              if (r.result) {
                if (canonicalJson(r.result) !== canonicalJson(record))
                  fail(new Error("Immutable content collision."));
              } else s.add(record);
            } catch (e) {
              fail(e);
            }
          };
        }
        tx.objectStore("savedWorks").add(prepared.work);
        if (prepared.preview) {
          const previews = tx.objectStore("previews");
          const q = previews.get(prepared.preview.id);
          q.onsuccess = () => {
            try {
              if (q.result) {
                if (canonicalJson(q.result) !== canonicalJson(prepared.preview))
                  fail(new Error("Immutable preview collision."));
              } else previews.add(prepared.preview);
            } catch (e) {
              fail(e);
            }
          };
        }
        set(undefined);
      },
    );
    changed();
    return summary(prepared.work);
  };
  const loadTreeBankEntry = async (id: string) => {
    const data = await transaction<any>(
      ["records", "savedWorks", STORE],
      "readonly",
      (tx, set) => {
        const r = tx.objectStore("savedWorks").get(id);
        r.onsuccess = () => {
          if (!r.result) {
            const old = tx.objectStore(STORE).get(id);
            old.onsuccess = () => set({ old: old.result });
            return;
          }
          const work = r.result;
          if (
            !Array.isArray(work.analysisIds) ||
            work.analysisIds.some((key: unknown) => typeof key !== "string") ||
            typeof work.contextId !== "string"
          ) {
            set({ work, records: [] });
            return;
          }
          const records: TreeBankRecord[] = [];
          const ids = [
            ...new Set<string>([...work.analysisIds, work.contextId]),
          ];
          set({ work, records });
          for (const key of ids) {
            const q = tx.objectStore("records").get(key);
            q.onsuccess = () => records.push(q.result);
          }
        };
      },
    );
    if (data.old) {
      const entry = legacySummary(data.old);
      const bundle = loadTreeBankBundleSnapshot(data.old.bundle) as ParseBundle;
      assertBundleDisplayable(bundle, entry.sentence);
      return {
        entry,
        bundle,
        view: "tree" as const,
        replayStep: null,
        abstractionMode: false,
      };
    }
    if (!data.work) throw new Error("Saved Tree Bank entry was not found.");
    const bundle = await restoreTreeBankBundle(data.work, data.records);
    assertBundleDisplayable(bundle, data.work.sentence);
    return {
      entry: summary(data.work),
      bundle,
      view: data.work.view,
      replayStep: data.work.replayStep,
      abstractionMode: data.work.abstractionMode,
    };
  };
  const removeTreeBankEntry = async (id: string) => {
    await transaction<void>(
      ["records", "savedWorks", "previews", STORE],
      "readwrite",
      (tx, set) => {
        const s = tx.objectStore("savedWorks");
        const r = s.get(id);
        r.onsuccess = () => {
          const work = r.result;
          if (!work) {
            tx.objectStore(STORE).delete(id);
            return;
          }
          const others = s.getAll();
          others.onsuccess = () => {
            const remaining = others.result.filter((w) => w.id !== id);
            s.delete(id);
            if (
              typeof work.previewId === "string" &&
              !remaining.some((w) => w.previewId === work.previewId)
            )
              tx.objectStore("previews").delete(work.previewId);
            // Malformed wrappers cannot prove that a content record is unreferenced.
            if (
              remaining.every(
                (w) =>
                  Array.isArray(w.analysisIds) &&
                  w.analysisIds.every(
                    (key: unknown) => typeof key === "string",
                  ) &&
                  typeof w.contextId === "string",
              ) &&
              Array.isArray(work.analysisIds) &&
              work.analysisIds.every(
                (key: unknown) => typeof key === "string",
              ) &&
              typeof work.contextId === "string"
            ) {
              const used = new Set(
                remaining.flatMap((w) => [...w.analysisIds, w.contextId]),
              );
              for (const key of [...work.analysisIds, work.contextId])
                if (!used.has(key)) tx.objectStore("records").delete(key);
            }
          };
        };
        set(undefined);
      },
    );
    changed();
  };
  const readTreeBankPreview = async (id: string) => {
    const p = await get("previews", id);
    if (p) {
      await validateTreeBankPreview(p);
      return p.dataUrl as string;
    }
    const old = await get(STORE, id);
    return typeof old?.treeSnapshotDataUrl === "string" &&
      old.treeSnapshotDataUrl.startsWith("data:image/")
      ? old.treeSnapshotDataUrl
      : undefined;
  };
  const subscribeTreeBankChanges = (fn: () => void) => {
    listeners.add(fn);
    if (listeners.size === 1) {
      if (
        typeof window !== "undefined" &&
        typeof BroadcastChannel !== "undefined"
      ) {
        try {
          channel = new BroadcastChannel(databaseName);
          channel.onmessage = emit;
        } catch (error) {
          notificationError(error);
        }
      }
      globalThis.window?.addEventListener("focus", emit);
    }
    return () => {
      listeners.delete(fn);
      if (!listeners.size) {
        channel?.close();
        channel = undefined;
        globalThis.window?.removeEventListener("focus", emit);
      }
    };
  };
  return {
    listTreeBankEntries,
    saveTreeBankEntry,
    loadTreeBankEntry,
    removeTreeBankEntry,
    readTreeBankPreview,
    subscribeTreeBankChanges,
  };
}
const store = createTreeBankStore();
export const {
  listTreeBankEntries,
  saveTreeBankEntry,
  loadTreeBankEntry,
  removeTreeBankEntry,
  readTreeBankPreview,
  subscribeTreeBankChanges,
} = store;
