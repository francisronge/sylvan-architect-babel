import assert from "node:assert/strict";
import test from "node:test";
import { completeTreeBankRequest } from "../services/treeBankStore.ts";

function database() {
  const request = { result: "saved-id" };
  const tx = { objectStore: () => ({ put: () => request }) };
  let closed = false;
  const db = {
    transaction: () => tx,
    close: () => {
      closed = true;
    },
  };
  return { db, tx, request, closed: () => closed };
}

test("Tree Bank waits for commit after a successful write request", async () => {
  const state = database();
  let resolved = false;
  const promise = completeTreeBankRequest(state.db, "readwrite", (store) =>
    store.put({ id: "one" }),
  );
  promise.then(() => {
    resolved = true;
  });
  state.request.onsuccess();
  await Promise.resolve();
  assert.equal(resolved, false);
  state.tx.oncomplete();
  assert.equal(await promise, "saved-id");
  assert.equal(state.closed(), true);
});

test("Tree Bank rejects a transaction aborted after request success", async () => {
  const state = database();
  const promise = completeTreeBankRequest(state.db, "readwrite", (store) =>
    store.put({ id: "one" }),
  );
  state.request.onsuccess();
  state.tx.onabort();
  await assert.rejects(promise, /transaction aborted/);
  assert.equal(state.closed(), true);
});

test("Tree Bank preserves storage errors and closes after abort", async () => {
  const state = database();
  const promise = completeTreeBankRequest(state.db, "readwrite", (store) =>
    store.put({ id: "one" }),
  );
  state.request.error = new Error("Quota exceeded");
  state.request.onerror();
  state.tx.onabort();
  await assert.rejects(promise, /Quota exceeded/);
  assert.equal(state.closed(), true);
});

test("Tree Bank closes when starting the operation throws", async () => {
  const state = database();
  await assert.rejects(
    completeTreeBankRequest(state.db, "readwrite", () => {
      throw new Error("DataCloneError");
    }),
    /DataCloneError/,
  );
  assert.equal(state.closed(), true);
});

import { IDBFactory } from "fake-indexeddb";
import { createTreeBankStore } from "../services/treeBankStore.ts";
import { prepareTreeBankSave } from "../services/treeBankRecords.ts";
const input = (id = "one") => ({
  id,
  sentence: "雪 🌳",
  framework: "minimalism",
  activeParseIndex: 0,
  createdAt: "2026-10-06T00:00:00.000Z",
  updatedAt: "2026-10-06T00:00:00.000Z",
  view: "derivation",
  replayStep: 2,
  abstractionMode: true,
  bundle: {
    sentence: "雪 🌳",
    ambiguityDetected: false,
    analyses: [{ tree: { id: "a", label: "雪" }, derivationStages: [] }],
  },
  treeSnapshotDataUrl: "data:image/png;base64,YQ==",
});
async function raw(factory, run, version = 2) {
  const db = await new Promise((resolve, reject) => {
    const r = factory.open("test", version);
    r.onupgradeneeded = () => {
      if (version === 1)
        r.result.createObjectStore("treeBank", { keyPath: "id" });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  try {
    return await run(db);
  } finally {
    db.close();
  }
}
function mutation(db, names, run) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(names, "readwrite");
    tx.oncomplete = resolve;
    tx.onabort = () => reject(tx.error);
    run(tx);
  });
}

test("real transactions preserve large Unicode alternatives, views, and shared immutable records", async () => {
  const f = new IDBFactory();
  const a = createTreeBankStore(f, "test");
  const b = createTreeBankStore(f, "test");
  const save = input();
  save.bundle.rawModelOutput = "語🌲".repeat(100000);
  save.bundle.analyses.push({
    ...save.bundle.analyses[0],
    provenance: { language: "日本語" },
  });
  await a.saveTreeBankEntry(save);
  await b.saveTreeBankEntry({ ...save, id: "two" });
  const loaded = await b.loadTreeBankEntry("one");
  assert.deepEqual(loaded.bundle, save.bundle);
  assert.equal(loaded.view, "derivation");
  assert.equal(loaded.replayStep, 2);
  assert.equal(loaded.abstractionMode, true);
  assert.equal((await a.listTreeBankEntries()).entries.length, 2);
  await a.removeTreeBankEntry("one");
  assert.deepEqual((await b.loadTreeBankEntry("two")).bundle, save.bundle);
  assert.equal(
    await b.readTreeBankPreview(
      (await b.listTreeBankEntries()).entries[0].previewId,
    ),
    save.treeSnapshotDataUrl,
  );
  await b.removeTreeBankEntry("two");
  await raw(f, async (db) => {
    for (const n of ["records", "savedWorks", "previews"]) {
      const count = await new Promise((resolve) => {
        const r = db.transaction(n).objectStore(n).count();
        r.onsuccess = () => resolve(r.result);
      });
      assert.equal(count, 0);
    }
  });
});

test("duplicate wrapper abort rolls back newly introduced records", async () => {
  const f = new IDBFactory();
  const s = createTreeBankStore(f, "test");
  await s.saveTreeBankEntry(input());
  const newer = input();
  newer.bundle.analyses[0].tree.label = "changed";
  await assert.rejects(s.saveTreeBankEntry(newer));
  assert.deepEqual((await s.loadTreeBankEntry("one")).bundle, input().bundle);
  await raw(
    f,
    (db) =>
      new Promise((resolve) => {
        const r = db.transaction("records").objectStore("records").count();
        r.onsuccess = () => {
          assert.equal(r.result, 2);
          resolve();
        };
      }),
  );
});

test("immutable collision aborts atomically and preserves corrupt bytes for inspection", async () => {
  const f = new IDBFactory();
  const s = createTreeBankStore(f, "test");
  await s.saveTreeBankEntry(input());
  const prepared = await prepareTreeBankSave(input());
  const corrupt = {
    ...prepared.records[0],
    payload: { tree: { label: "corrupt" } },
  };
  await raw(f, (db) =>
    mutation(db, ["records"], (tx) => tx.objectStore("records").put(corrupt)),
  );
  await assert.rejects(s.saveTreeBankEntry(input("two")), /collision/);
  await assert.rejects(s.loadTreeBankEntry("one"), /integrity/);
  assert.equal((await s.listTreeBankEntries()).entries.length, 1);
  await raw(
    f,
    (db) =>
      new Promise((resolve) => {
        const r = db
          .transaction("records")
          .objectStore("records")
          .get(corrupt.id);
        r.onsuccess = () => {
          assert.deepEqual(r.result, corrupt);
          resolve();
        };
      }),
  );
});

test("missing record rejects open; corrupt wrapper reports an issue without hiding siblings", async () => {
  const f = new IDBFactory();
  const s = createTreeBankStore(f, "test");
  await s.saveTreeBankEntry(input());
  await s.saveTreeBankEntry(input("two"));
  const prepared = await prepareTreeBankSave(input());
  await raw(f, (db) =>
    mutation(db, ["records", "savedWorks"], (tx) => {
      tx.objectStore("records").delete(prepared.records[0].id);
      tx.objectStore("savedWorks").put({
        ...prepared.work,
        id: "bad",
        analysisIds: null,
      });
    }),
  );
  await assert.rejects(s.loadTreeBankEntry("one"));
  await assert.rejects(s.loadTreeBankEntry("bad"));
  const list = await s.listTreeBankEntries();
  assert.equal(list.entries.length, 2);
  assert.equal(list.issues.length, 1);
});

test("v1 upgrade preserves legacy bytes and opens old bundles only on demand", async () => {
  const f = new IDBFactory();
  const old = {
    ...input(),
    treeSnapshotDataUrl: "data:image/png;base64,YQ==",
    extra: "preserve",
  };
  await raw(
    f,
    (db) =>
      mutation(db, ["treeBank"], (tx) => tx.objectStore("treeBank").add(old)),
    1,
  );
  const s = createTreeBankStore(f, "test");
  assert.equal((await s.listTreeBankEntries()).entries[0].legacy, true);
  assert.deepEqual((await s.loadTreeBankEntry("one")).bundle, old.bundle);
  await raw(
    f,
    (db) =>
      new Promise((resolve) => {
        const r = db.transaction("treeBank").objectStore("treeBank").get("one");
        r.onsuccess = () => {
          assert.deepEqual(r.result, old);
          resolve();
        };
      }),
  );
  await s.saveTreeBankEntry(input("new"));
  assert.equal((await s.listTreeBankEntries()).entries.length, 2);
});

test("real provisional success followed by abort never reports commit", async () => {
  const f = new IDBFactory();
  await raw(
    f,
    async (db) => {
      let success = false;
      await assert.rejects(
        completeTreeBankRequest(db, "readwrite", (s) => {
          const r = s.add({ id: "abort" });
          r.addEventListener("success", () => {
            success = true;
            s.transaction.abort();
          });
          return r;
        }),
        /aborted/,
      );
      assert.equal(success, true);
    },
    1,
  );
  await raw(
    f,
    (db) =>
      new Promise((resolve) => {
        const r = db.transaction("treeBank").objectStore("treeBank").count();
        r.onsuccess = () => {
          assert.equal(r.result, 0);
          resolve();
        };
      }),
  );
});

test("unavailable IndexedDB produces an explicit error", async () => {
  const s = createTreeBankStore(undefined, "unavailable");
  await assert.rejects(s.listTreeBankEntries(), /unavailable/);
});

import { IDBObjectStore } from "fake-indexeddb";
test("quota failure after queued content writes rolls back the whole save", async () => {
  const f = new IDBFactory();
  const s = createTreeBankStore(f, "test");
  await s.listTreeBankEntries();
  const original = IDBObjectStore.prototype.add;
  IDBObjectStore.prototype.add = function (value, ...rest) {
    if (this.name === "previews")
      throw new DOMException("Storage quota exceeded", "QuotaExceededError");
    return original.call(this, value, ...rest);
  };
  try {
    await assert.rejects(s.saveTreeBankEntry(input()), /quota/);
  } finally {
    IDBObjectStore.prototype.add = original;
  }
  assert.equal((await s.listTreeBankEntries()).entries.length, 0);
  await raw(
    f,
    (db) =>
      new Promise((resolve) => {
        const r = db.transaction("records").objectStore("records").count();
        r.onsuccess = () => {
          assert.equal(r.result, 0);
          resolve();
        };
      }),
  );
});

test("identical analysis alternatives share one record but restore twice in authored order", async () => {
  const f = new IDBFactory();
  const s = createTreeBankStore(f, "test");
  const value = input();
  value.bundle.analyses.push(structuredClone(value.bundle.analyses[0]));
  await s.saveTreeBankEntry(value);
  assert.deepEqual((await s.loadTreeBankEntry("one")).bundle, value.bundle);
});

test("synchronous operation failure aborts queued helper writes", async () => {
  const f = new IDBFactory();
  await raw(
    f,
    async (db) => {
      await assert.rejects(
        completeTreeBankRequest(db, "readwrite", (store) => {
          store.add({ id: "must-not-commit" });
          throw new Error("Operation failed after queueing");
        }),
        /Operation failed/,
      );
    },
    1,
  );
  await raw(
    f,
    (db) =>
      new Promise((resolve) => {
        const request = db
          .transaction("treeBank")
          .objectStore("treeBank")
          .count();
        request.onsuccess = () => {
          assert.equal(request.result, 0);
          resolve();
        };
      }),
  );
});

test("synchronous save callback failure aborts its queued wrapper write", async () => {
  const f = new IDBFactory();
  const store = createTreeBankStore(f, "test");
  await store.listTreeBankEntries();
  const original = IDBObjectStore.prototype.add;
  IDBObjectStore.prototype.add = function (value, ...rest) {
    const request = original.call(this, value, ...rest);
    if (this.name === "savedWorks") throw new Error("Failed after queued work");
    return request;
  };
  try {
    await assert.rejects(store.saveTreeBankEntry(input()), /queued work/);
  } finally {
    IDBObjectStore.prototype.add = original;
  }
  assert.equal((await store.listTreeBankEntries()).entries.length, 0);
});

test("blocked legacy upgrade reports actionable error then retries after old tab closes", async () => {
  const f = new IDBFactory();
  const old = await new Promise((resolve) => {
    const request = f.open("test", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("treeBank", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
  });
  const store = createTreeBankStore(f, "test");
  try {
    await assert.rejects(store.listTreeBankEntries(), /blocked by another tab/);
  } finally {
    old.close();
  }
  assert.deepEqual(await store.listTreeBankEntries(), {
    entries: [],
    issues: [],
  });
  await store.saveTreeBankEntry(input());
  assert.equal((await store.listTreeBankEntries()).entries.length, 1);
});

test("independent tabs receive committed change notifications and focus fallback", async () => {
  const previousWindow = globalThis.window;
  const fakeWindow = new EventTarget();
  globalThis.window = fakeWindow;
  const f = new IDBFactory();
  const name = "notifications-" + crypto.randomUUID();
  const a = createTreeBankStore(f, name);
  const b = createTreeBankStore(f, name);
  let count = 0;
  let received;
  const notified = new Promise((resolve) => {
    received = resolve;
  });
  const unsubscribe = b.subscribeTreeBankChanges(() => {
    count++;
    received();
  });
  try {
    await a.saveTreeBankEntry(input());
    await notified;
    assert.equal(count, 1);
    assert.equal((await b.listTreeBankEntries()).entries.length, 1);
    fakeWindow.dispatchEvent(new Event("focus"));
    assert.equal(count, 2);
    unsubscribe();
    fakeWindow.dispatchEvent(new Event("focus"));
    assert.equal(count, 2);
  } finally {
    unsubscribe();
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("malformed legacy timestamps and stages report isolated issues beside valid work", async () => {
  const f = new IDBFactory();
  const store = createTreeBankStore(f, "test");
  await store.saveTreeBankEntry(input("good"));
  const legacy = input("bad-date");
  legacy.updatedAt = 123;
  const badStages = input("bad-stages");
  badStages.bundle.analyses[0].derivationStages = { length: "invalid" };
  await raw(f, (db) =>
    mutation(db, ["treeBank"], (tx) => {
      tx.objectStore("treeBank").add(legacy);
      tx.objectStore("treeBank").add(badStages);
    }),
  );
  const listed = await store.listTreeBankEntries();
  assert.deepEqual(
    listed.entries.map((entry) => entry.id),
    ["good"],
  );
  assert.equal(listed.issues.length, 2);
});

test("notification failures cannot turn committed saves into failures", async () => {
  const previousWindow = globalThis.window;
  const previousChannel = globalThis.BroadcastChannel;
  const previousError = console.error;
  globalThis.window = new EventTarget();
  globalThis.BroadcastChannel = class {
    constructor() {
      throw new Error("Channel unavailable");
    }
  };
  const errors = [];
  console.error = (...args) => errors.push(args);
  const f = new IDBFactory();
  const store = createTreeBankStore(f, "test");
  let healthyListener = 0;
  let unsubscribeThrowing;
  let unsubscribeHealthy;
  try {
    unsubscribeThrowing = store.subscribeTreeBankChanges(() => {
      throw new Error("Listener failed");
    });
    unsubscribeHealthy = store.subscribeTreeBankChanges(() => {
      healthyListener++;
    });
    assert.equal((await store.saveTreeBankEntry(input())).id, "one");
    assert.equal((await store.loadTreeBankEntry("one")).entry.id, "one");
    assert.equal(healthyListener, 1);
    assert.ok(errors.length >= 3);
  } finally {
    unsubscribeThrowing?.();
    unsubscribeHealthy?.();
    console.error = previousError;
    globalThis.BroadcastChannel = previousChannel;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});
