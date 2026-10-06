// IndexedDB helpers. Stores: sessions, items (items indexed by sessionId). Screenshots live in items as Blobs.
const DB = (() => {
  let dbp;
  const open = () => dbp ||= new Promise((ok, fail) => {
    const r = indexedDB.open("uifeedback", 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore("sessions", { keyPath: "id" });
      r.result.createObjectStore("items", { keyPath: "id" }).createIndex("sessionId", "sessionId");
    };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => fail(r.error);
  });

  // fn gets the transaction and may return a request; its result is returned once the transaction commits.
  const run = async (stores, mode, fn) => {
    const db = await open();
    return new Promise((ok, fail) => {
      const t = db.transaction(stores, mode);
      const req = fn(t);
      t.oncomplete = () => ok(req && req.result);
      t.onerror = t.onabort = () => fail(t.error);
    });
  };

  return {
    allSessions: () => run("sessions", "readonly", (t) => t.objectStore("sessions").getAll()),
    putSession: (s) => run("sessions", "readwrite", (t) => t.objectStore("sessions").put(s)),
    sessionItems: (sid) => run("items", "readonly", (t) => t.objectStore("items").index("sessionId").getAll(sid)),
    putItem: (i) => run("items", "readwrite", (t) => t.objectStore("items").put(i)),
    deleteItem: (id) => run("items", "readwrite", (t) => t.objectStore("items").delete(id)),
    // Deleting a session also deletes its items (and so their screenshots).
    deleteSession: (id) => run(["sessions", "items"], "readwrite", (t) => {
      t.objectStore("sessions").delete(id);
      const items = t.objectStore("items");
      items.index("sessionId").openKeyCursor(IDBKeyRange.only(id)).onsuccess = (e) => {
        const c = e.target.result;
        if (c) { items.delete(c.primaryKey); c.continue(); }
      };
    }),
  };
})();
