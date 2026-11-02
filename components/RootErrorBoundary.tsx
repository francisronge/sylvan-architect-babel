import React from 'react';
import ViewErrorBoundary from './ViewErrorBoundary';

/**
 * Last resort above App: a failure that escapes every view boundary replaces the
 * page with this notice instead of a blank screen. App's own state is gone by
 * then, so retry starts it again; the Tree Bank lives in this browser's storage
 * and is untouched.
 */
const RootErrorBoundary: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ViewErrorBoundary
    title="Babel stopped displaying."
    message="Your Tree Bank is saved in this browser and is unchanged. Restarting reopens Babel; an analysis you had not saved may need to be generated again."
    retryLabel="Restart Babel"
    className="w-full h-screen"
  >
    {children}
  </ViewErrorBoundary>
);

export default RootErrorBoundary;
