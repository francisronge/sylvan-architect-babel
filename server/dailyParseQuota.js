const DAY_MS = 86400000;

/**
 * Per-client count of admitted parse requests for the current UTC day. The
 * counts reset when the day changes. At most `maxClients` clients are counted;
 * a new client beyond that evicts the client whose last admission is oldest,
 * so memory and the work per request stay bounded.
 */
export const createDailyParseQuota = ({ limit, maxClients = 20000, now = Date.now }) => {
  const used = new Map();
  let day;
  const today = () => {
    const current = Math.floor(now() / DAY_MS);
    if (current !== day) {
      day = current;
      used.clear();
    }
    return used;
  };
  return {
    exhausted: (client) => (today().get(client) || 0) >= limit,
    record: (client) => {
      const counts = today();
      const count = (counts.get(client) || 0) + 1;
      // Map order is admission order, so re-inserting keeps the oldest first.
      counts.delete(client);
      if (counts.size >= maxClients) counts.delete(counts.keys().next().value);
      counts.set(client, count);
    },
    get size() {
      return today().size;
    }
  };
};
