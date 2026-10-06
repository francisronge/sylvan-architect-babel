import { createFailure } from './validationErrors.js';
import { createRealizationHelpers } from '../../replay/surfaceRealizations.js';

export const { validateRealizations, resolveRealizations } = createRealizationHelpers({ createFailure });
