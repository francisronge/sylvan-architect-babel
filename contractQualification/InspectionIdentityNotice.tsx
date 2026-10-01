import React from 'react';
import type { inspectionStageDisplay } from './diagnosticReplay';
import './inspectionIdentity.css';

export function InspectionIdentityNotice({ display }: { display: ReturnType<typeof inspectionStageDisplay> }) {
  if (!display.duplicateIds.length) return null;
  return <details className="inspection-identity-notice">
    <summary>{display.duplicateIds.length} authored IDs occur in multiple positions. All positions are shown.</summary>
    <p>Display positions keep the copies separate. The original record is unchanged. Relations with ambiguous targets are not assigned to either copy.</p>
    <ul>{display.duplicateIds.map(id => <li key={id}>
      <code>{id}</code>: positions {display.identities.filter(item => item.authoredId === id).map(item => item.position).join(', ')}
    </li>)}</ul>
  </details>;
}
