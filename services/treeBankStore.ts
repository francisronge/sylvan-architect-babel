import {
  prepareTreeBankSave,
  validateTreeBankRecord,
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
import { canonicalJson } from "../derivationalDatabase/jsonData.js";
import { loadTreeBankBundleSnapshot } from "../treeBankSnapshot.js";
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
  const stages = v.bundle.analyses[i]?.derivationStages;
  if (stages !== undefined && !Array.isArray(stages))
    throw new Error("Invalid legacy Tree Bank stage count.");
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
/** Request success is provisional until the transaction commits. */
export function completeTreeBankRequest<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  operation: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let result: T;
    let failure: unknown;
    let tx: IDBTransaction | undefined;
    try {
      tx = db.transaction(
        STORE,
        mode,
        mode === "readwrite" ? { durability: "strict" } : undefined,
      );
      tx.oncomplete = () => {
        db.close();
        resolve(result);
      };
      tx.onabort = () => {
        db.close();
        reject(
          failure || tx.error || new Error("Tree Bank transaction aborted."),
        );
      };
      tx.onerror = () => {
        failure ||= tx.error;
      };
      const r = operation(tx.objectStore(STORE));
      r.onsuccess = () => {
        result = r.result;
      };
      r.onerror = () => {
        failure = r.error;
      };
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
    run: (
      tx: IDBTransaction,
      set: (v: T) => void,
      fail: (e: unknown) => void,
    ) => void,
  ): Promise<T> => {
    const db = await open();
    return new Promise((resolve, reject) => {
      let value: T;
      let failure: unknown;
      let tx: IDBTransaction;
      try {
        tx = db.transaction(
          names,
          mode,
          mode === "readwrite" ? { durability: "strict" } : undefined,
        );
        tx.oncomplete = () => {
          db.close();
          resolve(value);
        };
        tx.onabort = () => {
          db.close();
          reject(
            failure || tx.error || new Error("Tree Bank transaction aborted."),
          );
        };
        tx.onerror = () => {
          failure ||= tx.error;
        };
        run(
          tx,
          (v) => {
            value = v;
          },
          (e) => {
            failure ||= e;
            try {
              tx.abort();
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
  };
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
  const listTreeBankEntries = async () => {
    const [works, old] = await Promise.all([
      all("savedWorks"),
      transaction<{ entries: TreeBankEntrySummary[]; issues: TreeBankIssue[] }>(
        [STORE],
        "readonly",
        (tx, set) => {
          const result = {
            entries: [] as TreeBankEntrySummary[],
            issues: [] as TreeBankIssue[],
          };
          const request = tx.objectStore(STORE).openCursor();
          request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) {
              set(result);
              return;
            }
            try {
              result.entries.push(legacySummary(cursor.value));
            } catch (error) {
              result.issues.push({
                id: String(cursor.key),
                message: (error as Error).message,
              });
            }
            cursor.continue();
          };
        },
      ),
    ]);
    const entries: TreeBankEntrySummary[] = [];
    const issues: TreeBankIssue[] = [];
    for (const w of works)
      try {
        await validateTreeBankWork(w);
        entries.push(summary(w));
      } catch (e) {
        issues.push({
          id: String(w?.id || "unknown"),
          message: String((e as Error).message),
        });
      }
    entries.push(...old.entries);
    issues.push(...old.issues);
    entries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return { entries, issues };
  };
  const saveTreeBankEntry = async (input: TreeBankSaveInput) => {
    const prepared = await prepareTreeBankSave(input);
    await validateTreeBankWork(prepared.work);
    for (const r of prepared.records) await validateTreeBankRecord(r);
    if (prepared.preview) await validateTreeBankPreview(prepared.preview);
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
      return {
        entry,
        bundle: loadTreeBankBundleSnapshot(data.old.bundle) as ParseBundle,
        view: "tree" as const,
        replayStep: null,
        abstractionMode: false,
      };
    }
    if (!data.work) throw new Error("Saved Tree Bank entry was not found.");
    await validateTreeBankWork(data.work);
    for (const r of data.records) await validateTreeBankRecord(r);
    const bundle = await restoreTreeBankBundle(data.work, data.records);
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
