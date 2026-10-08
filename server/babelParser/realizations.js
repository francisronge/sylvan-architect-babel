import { createFailure } from './validationErrors.js';
import { createRealizationHelpers } from './realizationContract.js';

export const { validateRealizations, resolveRealizations } = createRealizationHelpers({ createFailure });
