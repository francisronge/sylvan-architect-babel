import React from 'react';
import { Brain, Zap } from 'lucide-react';
import type { ModelSelection, ReasoningEffort } from '../hooks/useModelSelection';

const MODEL_ACCENT_COLORS: Record<string, string> = {
  'openai:gpt-6.1-sol': '#f6bf69',
  'openai:gpt-6-astra': '#eef59a',
  'openai:gpt-6-sol': '#f6bf69',
  'anthropic:claude-opus-5': '#d8ac86',
  'anthropic:claude-fable-5-1': '#93baf3',
  'moonshot:kimi-k3': '#8ebfba',
  'xai:grok-4.6': '#d7dce2'
};

const REASONING_EFFORT_LABELS: Record<ReasoningEffort, string> = {
  none: 'None',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'XHigh',
  max: 'Max',
  ultra: 'Ultra'
};

const REASONING_PILL_STYLES: Record<ReasoningEffort, string> = {
  none: 'border-white/20 bg-white/5 text-white/70',
  minimal: 'border-slate-500/35 bg-slate-500/10 text-slate-200 shadow-[0_0_16px_rgba(148,163,184,0.12)]',
  low: 'border-cyan-700/35 bg-cyan-950/20 text-cyan-200 shadow-[0_0_16px_rgba(8,145,178,0.14)]',
  medium: 'border-teal-500/45 bg-teal-500/15 text-teal-200 shadow-[0_0_16px_rgba(20,184,166,0.16)]',
  high: 'border-[#b7791f]/55 bg-[#b7791f]/24 text-[#f3c777] shadow-[0_0_18px_rgba(183,121,31,0.22)]',
  xhigh: 'border-orange-500/60 bg-orange-500/20 text-orange-200 shadow-[0_0_20px_rgba(249,115,22,0.22)]',
  max: 'border-[#dc2626]/70 bg-[#7f1d1d]/36 text-[#fecaca] shadow-[0_0_22px_rgba(220,38,38,0.28)]',
  ultra: 'border-[#dc2626]/70 bg-[#7f1d1d]/36 text-[#fecaca] shadow-[0_0_22px_rgba(220,38,38,0.28)]'
};

const formatModelLabel = (modelUsed: string | undefined, models: ModelSelection['options']): string => {
  const model = String(modelUsed || '').trim();
  if (!model) return 'Model unavailable';
  const catalogModel = models.find((entry) => entry.providerModel === model);
  if (catalogModel) return catalogModel.label;
  if (/^gpt/i.test(model)) return model.toUpperCase();
  if (/^claude/i.test(model)) return model.replace(/^claude/i, 'Claude');
  if (model === 'gemini-3.1-pro-preview') return 'Gemini 3.1 Pro';
  if (model === 'gemini-3-pro-preview') return 'Gemini 3 Pro';
  return model.replace(/^gemini-/i, 'Gemini ').replace(/-preview$/i, '');
};

interface ModelControlsProps {
  models: ModelSelection;
  /** The provider model of the analysis on screen, named in the hover title. */
  lastModelUsed: string | undefined;
  disabled: boolean;
}

/** The research header's model and effort menus for the next request. */
const ModelControls: React.FC<ModelControlsProps> = ({ models, lastModelUsed, disabled }) => {
  const { options, modelRoute, selectedModel, activeReasoningEffort, effortControl, selectModel, setReasoningEffort } = models;
  const accent = MODEL_ACCENT_COLORS[modelRoute];
  return (
    <div
      className="flex flex-wrap xl:contents items-center gap-2"
      title={
        lastModelUsed
          ? `Selected model: ${selectedModel.label}. Last parse used: ${formatModelLabel(lastModelUsed, options)}.`
          : 'Choose parsing model'
      }
    >
      <label
        className="flex xl:grow items-center gap-2 px-3 py-2 rounded-lg border"
        style={{
          color: accent,
          backgroundColor: `${accent}1f`,
          borderColor: `${accent}80`,
          boxShadow: `0 0 16px ${accent}22`
        }}
      >
        <Zap size={10} className="fill-current" />
        <select
          aria-label="Generation model"
          value={modelRoute}
          disabled={disabled}
          onChange={(event) => selectModel(event.target.value)}
          className="w-40 xl:grow bg-transparent text-[11px] font-bold focus:outline-current disabled:opacity-50"
        >
          {options.map((model) => (
            <option key={model.id} value={model.id} className="bg-[#061810]" style={{ color: MODEL_ACCENT_COLORS[model.id] }}>
              {model.label}
            </option>
          ))}
        </select>
      </label>
      <label className={`flex xl:grow items-center gap-2 px-3 py-2 rounded-lg border ${REASONING_PILL_STYLES[activeReasoningEffort]}`} title={effortControl.label}>
        <Brain size={10} className="fill-current" />
        <select
          aria-label={effortControl.label}
          value={activeReasoningEffort}
          disabled={disabled}
          onChange={(event) => setReasoningEffort(event.target.value as ReasoningEffort)}
          className="w-24 xl:grow bg-transparent text-[11px] font-bold focus:outline-current disabled:opacity-50"
        >
          {(effortControl.values as ReasoningEffort[]).map((effort) => <option key={effort} value={effort} className="bg-[#061810]">{REASONING_EFFORT_LABELS[effort]}</option>)}
        </select>
      </label>
    </div>
  );
};

export default ModelControls;
