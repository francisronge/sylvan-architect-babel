// Inspect committed storage directly; product load adapters must not hide orphans.
export function readTreeBankSnapshot(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('sylvan-architect-babel');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const names = ['records', 'savedWorks', 'previews', 'treeBank'];
      let transaction;
      try {
        transaction = db.transaction(names, 'readonly');
        const snapshot = {};
        transaction.oncomplete = () => { db.close(); resolve(snapshot); };
        transaction.onabort = () => { db.close(); reject(transaction.error || new Error('Snapshot transaction aborted.')); };
        for (const name of names) {
          const query = transaction.objectStore(name).getAll();
          query.onsuccess = () => { snapshot[name] = query.result; };
        }
      } catch (error) {
        db.close();
        reject(error);
      }
    };
  }));
}
