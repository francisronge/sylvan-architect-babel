// Loaded with `node --import` to run a command as CI's merge jobs do, without
// installed packages: any import of an npm package fails. The Replay merge jobs
// in .github/workflows/ci.yml judge their shards' results without `npm ci`, so
// their commands must keep loading only Node.js built-ins and repository files.
import { isBuiltin, registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, next) {
    if (!/^(?:\.|\/|file:|data:)/.test(specifier) && !isBuiltin(specifier)) {
      throw Error(`CI merges shards without installed packages, but ${context.parentURL} imports the package "${specifier}". `
        + 'Keep package imports out of the merge path (for example behind the worker branch), or install dependencies in the merge job.');
    }
    return next(specifier, context);
  }
});
