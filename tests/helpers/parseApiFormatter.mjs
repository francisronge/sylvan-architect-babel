/**
 * parseApi.js reads NODE_ENV once, when it loads, so setting NODE_ENV after a
 * static import leaves the development formatter in place. Each runtime gets
 * its own module instance, imported under that runtime's NODE_ENV.
 */
export const loadFormatter = async (nodeEnv) => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = nodeEnv;
  try {
    const url = new URL(`../../server/parseApi.js?node-env=${encodeURIComponent(nodeEnv)}`, import.meta.url);
    return (await import(url.href)).formatApiError;
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
};
