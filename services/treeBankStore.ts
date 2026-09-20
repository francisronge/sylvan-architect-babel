const DATABASE = 'sylvan-architect-babel';
const STORE = 'treeBank';

const openDatabase = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  if (typeof indexedDB === 'undefined') {
    reject(new Error('IndexedDB not supported.'));
    return;
  }
  const request = indexedDB.open(DATABASE, 1);
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains(STORE)) {
      request.result.createObjectStore(STORE, { keyPath: 'id' });
    }
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error || new Error('Failed to open Tree Bank database.'));
});

/** A successful request is provisional until its transaction commits. */
export function completeTreeBankRequest<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return new Promise((resolve, reject) => {
    let result: T;
    try {
      const tx = db.transaction(STORE, mode);
      tx.oncomplete = () => { db.close(); resolve(result); };
      tx.onabort = () => { db.close(); reject(tx.error || new Error('Tree Bank transaction aborted.')); };
      tx.onerror = () => { db.close(); reject(tx.error || new Error('Tree Bank transaction failed.')); };
      const request = operation(tx.objectStore(STORE));
      request.onsuccess = () => { result = request.result; };
      request.onerror = () => reject(request.error || new Error('Tree Bank request failed.'));
    } catch (error) {
      db.close();
      reject(error);
    }
  });
}

export async function readTreeBankEntries(): Promise<unknown[]> {
  return completeTreeBankRequest(await openDatabase(), 'readonly', store => store.getAll());
}

export async function saveTreeBankEntry(entry: { id: string }): Promise<void> {
  await completeTreeBankRequest(await openDatabase(), 'readwrite', store => store.put(entry));
}

export async function removeTreeBankEntry(id: string): Promise<void> {
  await completeTreeBankRequest(await openDatabase(), 'readwrite', store => store.delete(id));
}
