import { ParseApiError } from './babelParser/error.js';
import { normalizeParseBundle } from './babelParser/parseNormalization.js';
import { parseModelJsonDetailed } from './babelParser/modelJson.js';
import { createParseRoutes } from './babelParser/parseRoutes.js';

export { ParseApiError } from './babelParser/error.js';

export const { parseSentenceWithResearchModel } = createParseRoutes({
  ParseApiError,
  normalizeParseBundle,
  parseModelJsonDetailed
});
