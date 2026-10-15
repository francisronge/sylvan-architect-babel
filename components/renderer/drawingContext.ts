import type * as d3 from 'd3';
import type { createRelationLayers } from './relationLayers.ts';
import type { createRelationMeasurements } from './relationMeasurements.ts';
import type { acceptedRelationDrawingKey, createRelationOwnership, decorateRelationElement, relationLayerKey } from './relationOwnership.ts';
import type { createTreeMeasurements } from './treeMeasurements.ts';

export type DrawingLayer = d3.Selection<SVGGElement, unknown, null, undefined>;
export type RelationEmphasis = 'active' | 'quiet' | null;
export type TreeMeasurements = ReturnType<typeof createTreeMeasurements>;
export type RelationLayers = ReturnType<typeof createRelationLayers>;
export interface ClaimDrawing extends ReturnType<typeof createRelationOwnership> {
  relationLayerKey: typeof relationLayerKey;
  acceptedRelationDrawingKey: typeof acceptedRelationDrawingKey;
  decorateRelationElement: typeof decorateRelationElement;
}

export type RelationMeasurements = ReturnType<typeof createRelationMeasurements>;
