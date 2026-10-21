import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { build } from 'vite';

const root = path.resolve(import.meta.dirname, '..');

// Vite derives import.meta.env.DEV from NODE_ENV when a build starts.
const buildPreviewHook = async (nodeEnv) => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = nodeEnv;
  try {
    const result = await build({
      root, configFile: false, envDir: false, logLevel: 'silent',
      build: {
        write: false, minify: true,
        lib: { entry: path.join(root, 'hooks/useDevPreview.ts'), formats: ['es'], fileName: 'useDevPreview' },
        rollupOptions: { external: id => /^react(\/|$)/.test(id) }
      }
    });
    return (Array.isArray(result) ? result : [result]).flatMap(output => output.output)
      .map(chunk => chunk.code || '').join('\n');
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
};

test('production builds omit the unvalidated preview import path that development keeps', async () => {
  const development = await buildPreviewHook('development');
  for (const marker of ['devBundle', '__BABEL_DEV_SET_ANALYSIS__', 'fetch(']) {
    assert.ok(development.includes(marker), `development keeps ${marker} for local capture tools`);
  }
  const production = await buildPreviewHook('production');
  for (const marker of ['devBundle', '__BABEL_DEV_SET_ANALYSIS__', '__BABEL_DEV_SET_TAB__', 'fetch(']) {
    assert.equal(production.includes(marker), false, `production must not contain ${marker}`);
  }
});
