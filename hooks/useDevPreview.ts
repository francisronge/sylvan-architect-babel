/// <reference types="vite/client" />
import { useEffect, useMemo, useState } from 'react';
import type { ParseBundle } from '../types.ts';
import { collectPronouncedTerminalSequence } from '../replay/pronouncedTerminals.ts';
import { finalForestForAnalysis } from '../replay/finalForest.ts';

type ReplayTarget = number | 'last' | null;

export interface DevAnalysisOptions {
  sentence?: string;
  framework?: 'xbar' | 'minimalism';
  modelRoute?: string;
  reasoningEffort?: string;
}

export interface SavedPreview {
  bundle: ParseBundle;
  sentence: string;
  framework: 'xbar' | 'minimalism';
  modelRoute: string;
  reasoningEffort: string;
  captureMode: boolean;
}

interface PreviewWindow extends Window {
  __BABEL_DEV_SET_ANALYSIS__?: (bundle: ParseBundle, options?: DevAnalysisOptions) => void;
  __BABEL_DEV_SET_INPUT_VISIBILITY__?: (visible: boolean) => void;
  __BABEL_DEV_SET_CAPTURE_MODE__?: (enabled: boolean) => void;
  __BABEL_DEV_GET_REPLAY_STEP_COUNT__?: () => number;
  __BABEL_DEV_SET_REPLAY_STEP__?: (step: number) => void;
  __BABEL_DEV_GET_REPLAY_STEP_PAYLOAD__?: (index: number) => unknown;
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? value as Record<string, unknown> : {};

const unwrapBundle = (value: unknown): ParseBundle | null => {
  const candidate = record(value);
  for (const option of [candidate.response, candidate.result, candidate]) {
    if (Array.isArray(record(option).analyses)) return option as ParseBundle;
  }
  return null;
};

/** Keep preview loading and its browser bridge separate from the live workspace. */
function useDevPreviewBridge({
  analysisBundle,
  onAnalysis,
  onPreview,
  onInputVisibility,
  onError
}: {
  analysisBundle: ParseBundle | null;
  onAnalysis: (bundle: ParseBundle, options: DevAnalysisOptions) => void;
  onPreview: (preview: SavedPreview) => void;
  onInputVisibility: (visible: boolean) => void;
  onError: (error: { message: string }) => void;
}) {
  const [captureMode, setCaptureMode] = useState(false);
  const config = useMemo(() => {
    if (typeof window === 'undefined') return null;
    const params = new URLSearchParams(window.location.search);
    const bundlePath = String(params.get('devBundle') || '').trim();
    if (!bundlePath) return null;
    const rawReplayStep = String(params.get('devReplayStep') || '').trim().toLowerCase();
    const replayStep: ReplayTarget = rawReplayStep === 'last'
      ? 'last'
      : (rawReplayStep !== '' && Number.isInteger(Number(rawReplayStep)) && Number(rawReplayStep) >= 0
        ? Number(rawReplayStep) : null);
    return {
      bundlePath, replayStep,
      captureMode: ['1', 'true', 'yes'].includes(String(params.get('devCapture') || '').toLowerCase())
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const target = window as PreviewWindow;
    target.__BABEL_DEV_SET_ANALYSIS__ = (bundle, options = {}) => onAnalysis(bundle, options);
    target.__BABEL_DEV_SET_INPUT_VISIBILITY__ = visible => onInputVisibility(Boolean(visible));
    target.__BABEL_DEV_SET_CAPTURE_MODE__ = enabled => setCaptureMode(Boolean(enabled));
    return () => {
      delete target.__BABEL_DEV_SET_ANALYSIS__;
      delete target.__BABEL_DEV_SET_INPUT_VISIBILITY__;
      delete target.__BABEL_DEV_SET_CAPTURE_MODE__;
    };
  }, [onAnalysis, onInputVisibility]);

  useEffect(() => {
    if (!config) return;
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch(config.bundlePath, { cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const saved = await response.json();
        const bundle = unwrapBundle(saved);
        if (!bundle || !Array.isArray(bundle.analyses) || bundle.analyses.length === 0) {
          throw new Error('Saved bundle does not contain analyses.');
        }
        if (cancelled) return;
        const savedRecord = record(saved);
        const request = record(savedRecord.request);
        const firstAnalysis = bundle.analyses[0];
        const hasRealizations = bundle.analyses.some(analysis =>
          analysis.derivationStages?.some(stage => stage.realizations?.length));
        const suppliedSentence = String(request.sentence || savedRecord.sentence || bundle.sentence || '').trim();
        if (hasRealizations && !suppliedSentence) throw new Error('Saved realization analyses require their original input sentence.');
        const pronouncedSentence = hasRealizations ? ''
          : collectPronouncedTerminalSequence(finalForestForAnalysis(firstAnalysis)).join(' ');
        onPreview({
          bundle,
          sentence: suppliedSentence || pronouncedSentence || 'Sentence unavailable',
          framework: request.framework === 'minimalism'
            ? 'minimalism'
            : (request.framework === 'xbar' ? 'xbar' : firstAnalysis?.provenance?.framework === 'minimalism' ? 'minimalism' : 'xbar'),
          modelRoute: String(request.modelId || bundle.requestedModelId || '').trim(),
          reasoningEffort: String(request.reasoningEffort || bundle.requestedReasoningEffort || '').trim(),
          captureMode: config.captureMode
        });
        setCaptureMode(config.captureMode);
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error || 'Unknown error');
        onError({ message: `Unable to load preview bundle: ${message}` });
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [config, onPreview, onError]);

  useEffect(() => {
    if (!config || config.replayStep === null || typeof window === 'undefined' || !analysisBundle) return;
    const replayTarget = config.replayStep;
    let attempts = 0;
    const target = window as PreviewWindow;
    const timer = window.setInterval(() => {
      const getReplayCount = target.__BABEL_DEV_GET_REPLAY_STEP_COUNT__;
      const setReplayStep = target.__BABEL_DEV_SET_REPLAY_STEP__;
      if (typeof getReplayCount !== 'function' || typeof setReplayStep !== 'function') {
        attempts += 1;
        if (attempts > 40) window.clearInterval(timer);
        return;
      }
      const replayCount = Number(getReplayCount()) || 0;
      if (replayCount <= 0) {
        attempts += 1;
        if (attempts > 40) window.clearInterval(timer);
        return;
      }
      setReplayStep(replayTarget === 'last' ? replayCount - 1 : Math.min(Math.max(replayTarget, 0), replayCount - 1));
      window.clearInterval(timer);
    }, 180);
    return () => { window.clearInterval(timer); };
  }, [analysisBundle, config]);

  return captureMode;
}

/** Let capture tools select and read Replay steps of the mounted tree. */
function useReplayStepBridge<Step>(
  playbackSteps: readonly Step[],
  setActiveStepIndex: (index: number) => void,
  setIsAutoPlaying: (playing: boolean) => void
) {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const target = window as PreviewWindow;
    const bounded = (index: number) => {
      const requested = Number(index);
      return Number.isFinite(requested)
        ? Math.max(0, Math.min(Math.trunc(requested), Math.max(playbackSteps.length - 1, 0)))
        : 0;
    };
    target.__BABEL_DEV_SET_REPLAY_STEP__ = nextStep => {
      setIsAutoPlaying(false);
      setActiveStepIndex(bounded(nextStep));
    };
    target.__BABEL_DEV_GET_REPLAY_STEP_COUNT__ = () => playbackSteps.length;
    target.__BABEL_DEV_GET_REPLAY_STEP_PAYLOAD__ = index => playbackSteps[bounded(index)] || null;
    return () => {
      delete target.__BABEL_DEV_SET_REPLAY_STEP__;
      delete target.__BABEL_DEV_GET_REPLAY_STEP_COUNT__;
      delete target.__BABEL_DEV_GET_REPLAY_STEP_PAYLOAD__;
    };
  }, [playbackSteps, setActiveStepIndex, setIsAutoPlaying]);
}

/**
 * The `devBundle` query and `window.__BABEL_DEV_*__` setters load an analysis
 * without parser or record validation, so they exist only under the Vite dev
 * server that local capture and review tools run. Vite fixes this flag at build
 * time; production bundles omit the bridge and report no capture mode.
 */
export const useDevPreview: typeof useDevPreviewBridge = import.meta.env?.DEV === true
  ? useDevPreviewBridge
  : () => false;

/** Development-only, like `useDevPreview`; production keeps Replay step selection in the UI. */
export const useReplayStepDevBridge: typeof useReplayStepBridge = import.meta.env?.DEV === true
  ? useReplayStepBridge
  : () => {};
