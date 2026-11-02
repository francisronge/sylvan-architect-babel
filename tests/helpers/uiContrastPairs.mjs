// Every text and control color of the app's own interface (not the tree
// renderer), with the background it is painted on. `snippet` is the class text
// in `file` that sets the color, so the table cannot drift from the code.
// Backgrounds use the lightest point of the page gradient, so a pair that passes
// here passes everywhere on the page. Disabled controls are exempt (WCAG 1.4.3)
// and are not listed. `min` is 4.5 for text, 3 for large text (24px, or 18.66px
// bold) and for icons that alone identify a control (WCAG 1.4.11).

const SHELL = ['#03100c', 'rgba(16,185,129,0.1)', 'rgba(16,185,129,0.05)', 'rgba(6,95,70,0.07)', 'rgba(16,185,129,0.03)'];
const HEADER = [...SHELL, 'black/60'];
const GLASS = [...SHELL, 'black/60'];
const PANEL_STRIP = [...GLASS, 'black/30'];
const FOOTER = [...SHELL, 'black/80'];
const NOTES_CARD = [...SHELL, 'rgba(2,8,6,0.6)', 'black/60'];
const REPLAY_PANEL = ['#04140e', 'rgba(2,8,6,0.96)'];
const TREE = ['#04140e'];
const FAILURE = [...GLASS, 'rose-500/10'];
const DIALOG = [...SHELL, 'black/80', 'black/60'];
// The model menu paints its accent at 0x1f/255 alpha behind accent-colored text.
const accent = color => ({ fg: `[${color}]`, bg: [...HEADER, `[${color}]/[${(0x1f / 255).toFixed(4)}]`] });

const TEXT = 4.5, LARGE = 3, ICON = 3;

export const UI_CONTRAST_PAIRS = [
  // Header
  { where: 'Header subtitle "Generative Grammar Arboretum"', file: 'App.tsx', snippet: 'text-emerald-500/80 leading-none', fg: 'emerald-500/80', bg: HEADER, min: TEXT },
  { where: 'Framework button, Minimalist', file: 'App.tsx', snippet: "'bg-purple-500/20 border-purple-500/40 text-purple-400'", fg: 'purple-400', bg: [...HEADER, 'purple-500/20'], min: TEXT },
  { where: 'Framework button, X-bar', file: 'App.tsx', snippet: "'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'", fg: 'emerald-400', bg: [...HEADER, 'emerald-500/10'], min: TEXT },
  { where: 'Constituent Glyphing, off', file: 'App.tsx', snippet: "'bg-white/5 border-white/10 text-white/50 hover:text-emerald-400", fg: 'white/50', bg: [...HEADER, 'white/5'], min: TEXT },
  { where: 'Constituent Glyphing, on', file: 'App.tsx', snippet: "'bg-amber-500/20 border-amber-500/40 text-amber-400'", fg: 'amber-400', bg: [...HEADER, 'amber-500/20'], min: TEXT },
  { where: 'Save to Tree Bank / Tree Bank / Fullscreen buttons', file: 'App.tsx', snippet: 'border-white/10 bg-white/5 text-white/50 hover:text-emerald-400', fg: 'white/50', bg: [...HEADER, 'white/5'], min: TEXT },
  { where: 'Save / Tree Bank buttons, active or saved', file: 'App.tsx', snippet: "'bg-emerald-500/20 border-emerald-500 text-emerald-300'", fg: 'emerald-300', bg: [...HEADER, 'emerald-500/20'], min: TEXT },
  { where: 'Tree Bank Library label', file: 'App.tsx', snippet: 'bg-emerald-950/20 text-emerald-300/90', fg: 'emerald-300/90', bg: [...HEADER, 'emerald-950/20'], min: TEXT },
  ...[['openai:gpt-6.1-sol', '#f6bf69'], ['openai:gpt-6-astra', '#eef59a'], ['anthropic:claude-opus-5', '#d8ac86'],
    ['anthropic:claude-fable-5-1', '#93baf3'], ['moonshot:kimi-k3', '#8ebfba'], ['xai:grok-4.6', '#d7dce2']]
    .flatMap(([id, color]) => [
      { where: `Model menu, ${id}`, file: 'App.tsx', snippet: `'${id}': '${color}'`, ...accent(color), min: TEXT },
      { where: `Model menu option, ${id}`, file: 'App.tsx', snippet: 'className="bg-[#061810]" style={{ color: MODEL_ACCENT_COLORS[model.id] }}', fg: `[${color}]`, bg: ['#061810'], min: TEXT }
    ]),
  { where: 'Effort menu, None', file: 'App.tsx', snippet: "none: 'border-white/20 bg-white/5 text-white/70'", fg: 'white/70', bg: [...HEADER, 'white/5'], min: TEXT },
  { where: 'Effort menu, Minimal', file: 'App.tsx', snippet: 'bg-slate-500/10 text-slate-200', fg: 'slate-200', bg: [...HEADER, 'slate-500/10'], min: TEXT },
  { where: 'Effort menu, Low', file: 'App.tsx', snippet: 'bg-cyan-950/20 text-cyan-200', fg: 'cyan-200', bg: [...HEADER, 'cyan-950/20'], min: TEXT },
  { where: 'Effort menu, Medium', file: 'App.tsx', snippet: 'bg-teal-500/15 text-teal-200', fg: 'teal-200', bg: [...HEADER, 'teal-500/15'], min: TEXT },
  { where: 'Effort menu, High', file: 'App.tsx', snippet: 'bg-[#b7791f]/24 text-[#f3c777]', fg: '[#f3c777]', bg: [...HEADER, '[#b7791f]/24'], min: TEXT },
  { where: 'Effort menu, XHigh', file: 'App.tsx', snippet: 'bg-orange-500/20 text-orange-200', fg: 'orange-200', bg: [...HEADER, 'orange-500/20'], min: TEXT },
  { where: 'Effort menu, Max / Ultra', file: 'App.tsx', snippet: 'bg-[#7f1d1d]/36 text-[#fecaca]', fg: '[#fecaca]', bg: [...HEADER, '[#7f1d1d]/36'], min: TEXT },
  { where: 'Fullscreen and Tree Bank error banners', file: 'App.tsx', snippet: 'bg-[#261114] px-4 py-3 text-rose-200', fg: 'rose-200', bg: ['#261114'], min: TEXT },

  // Workspace
  { where: 'Parse selector, unselected', file: 'App.tsx', snippet: "'text-white/60 hover:text-emerald-300'", fg: 'white/60', bg: [...SHELL, 'black/50'], min: TEXT },
  { where: 'Parse selector / view tab, selected', file: 'App.tsx', snippet: "'moss-gradient text-white border border-emerald-400/50'", fg: 'white', bg: ['#065f46'], min: TEXT },
  { where: 'Loading: "Deep Parsing … Structures"', file: 'App.tsx', snippet: 'text-emerald-500/75 font-black uppercase text-[9px]', fg: 'emerald-500/75', bg: [...SHELL, 'rgba(2,8,6,0.95)'], min: TEXT },
  { where: 'Empty workspace: "Cast a thought…"', file: 'App.tsx', snippet: 'text-emerald-500/85 font-black uppercase text-[9px] md:text-[10px] tracking-[0.5em] md:tracking-[0.8em]', fg: 'emerald-500/85', bg: SHELL, min: TEXT },
  { where: 'View tabs, unselected icon', file: 'App.tsx', snippet: "'glass-dark text-emerald-600/70 border-white/5", fg: 'emerald-600/70', bg: GLASS, min: ICON },
  { where: 'View tab name on hover', file: 'App.tsx', snippet: 'bg-black/90 backdrop-blur-xl text-[10px] font-black uppercase tracking-[0.3em] text-emerald-400', fg: 'emerald-400', bg: [...SHELL, 'black/90'], min: TEXT },

  // Sentence console
  { where: 'Console title "Arboretum Link"', file: 'App.tsx', snippet: 'tracking-[0.4em] text-emerald-500/80">Arboretum Link', fg: 'emerald-500/80', bg: PANEL_STRIP, min: TEXT },
  { where: 'Console collapse and hide icons', file: 'App.tsx', snippet: 'rounded-xl transition-colors text-emerald-500/60', fg: 'emerald-500/60', bg: PANEL_STRIP, min: ICON },
  { where: 'Sentence text', file: 'App.tsx', snippet: 'text-emerald-50 serif italic', fg: 'emerald-50', bg: [...GLASS, 'black/40'], min: TEXT },
  { where: 'Sentence placeholder', file: 'App.tsx', snippet: 'placeholder:text-emerald-500/75', fg: 'emerald-500/75', bg: [...GLASS, 'black/40'], min: TEXT },
  { where: 'Collapsed console: sentence', file: 'App.tsx', snippet: 'text-emerald-50/50 serif italic', fg: 'emerald-50/50', bg: GLASS, min: TEXT },
  { where: 'Collapsed console: "Expand Arbor Control"', file: 'App.tsx', snippet: 'text-emerald-500/75 uppercase tracking-[0.4em]', fg: 'emerald-500/75', bg: GLASS, min: TEXT },
  { where: 'External API Key Required (console)', file: 'App.tsx', snippet: 'bg-amber-500/10 border border-amber-500/20 text-[10px] font-black uppercase tracking-widest text-amber-200', fg: 'amber-200', bg: [...GLASS, 'amber-500/10'], min: TEXT },

  // Footer
  { where: 'Footer: "rooted in …"', file: 'App.tsx', snippet: 'tracking-normal text-emerald-500/75', fg: 'emerald-500/75', bg: FOOTER, min: TEXT },
  { where: 'Footer: External API Key Required', file: 'App.tsx', snippet: 'text-amber-400/80', fg: 'amber-400/80', bg: FOOTER, min: TEXT },

  // View failure notice
  { where: 'View failure title and Retry', file: 'components/ViewErrorBoundary.tsx', snippet: 'p-6 text-emerald-200', fg: 'emerald-200', bg: SHELL, min: TEXT },
  { where: 'View failure message', file: 'components/ViewErrorBoundary.tsx', snippet: 'text-sm text-emerald-100/70', fg: 'emerald-100/70', bg: SHELL, min: TEXT },
  { where: 'View failure details', file: 'components/ViewErrorBoundary.tsx', snippet: 'text-sm text-emerald-100/60', fg: 'emerald-100/60', bg: SHELL, min: TEXT },

  // Generation failure panel
  { where: 'Failure panel text', file: 'components/FailurePanel.tsx', snippet: 'px-4 py-3 text-xs text-rose-300', fg: 'rose-300', bg: FAILURE, min: TEXT },
  { where: 'Failure message', file: 'components/FailurePanel.tsx', snippet: 'serif italic text-rose-200', fg: 'rose-200', bg: FAILURE, min: TEXT },
  { where: 'Failure field names (Class, Rule …)', file: 'components/FailurePanel.tsx', snippet: 'text-rose-400/80', fg: 'rose-400/80', bg: FAILURE, min: TEXT },
  { where: 'Failure raw output', file: 'components/FailurePanel.tsx', snippet: 'text-rose-100/80', fg: 'rose-100/80', bg: [...FAILURE, 'black/20'], min: TEXT },
  { where: 'Failure download buttons', file: 'components/FailurePanel.tsx', snippet: 'bg-rose-500/15 px-3 py-2 font-black uppercase tracking-widest text-[9px] text-rose-100', fg: 'rose-100', bg: [...FAILURE, 'rose-500/15'], min: TEXT },
  { where: 'Failure dismiss icon', file: 'components/FailurePanel.tsx', snippet: 'p-1.5 text-rose-300/70', fg: 'rose-300/70', bg: FAILURE, min: ICON },
  { where: 'Failed output inspection text', file: 'components/FailurePanel.tsx', snippet: 'bg-[#06130e] p-4 text-emerald-100', fg: 'emerald-100', bg: ['#06130e'], min: TEXT },
  { where: 'Failed output inspection warnings', file: 'components/FailedOutputInspection.tsx', snippet: 'text-xs text-amber-200', fg: 'amber-200', bg: ['#06130e'], min: TEXT },

  // Replay panel and header
  { where: 'Replay Prev/Next buttons and icon', file: 'components/ReplayPanel.tsx', snippet: 'tracking-[0.2em] text-white/70', fg: 'white/70', bg: REPLAY_PANEL, min: TEXT },
  { where: 'Replay Play button', file: 'components/ReplayPanel.tsx', snippet: 'bg-emerald-500/10 text-[10px] font-black uppercase tracking-[0.2em] text-emerald-300', fg: 'emerald-300', bg: [...REPLAY_PANEL, 'emerald-500/10'], min: TEXT },
  { where: 'Replay step counter', file: 'components/ReplayPanel.tsx', snippet: 'text-emerald-400/80', fg: 'emerald-400/80', bg: REPLAY_PANEL, min: TEXT },
  { where: 'Replay detail labels', file: 'components/ReplayPanel.tsx', snippet: 'text-emerald-300/90', fg: 'emerald-300/90', bg: REPLAY_PANEL, min: TEXT },
  { where: 'Replay detail text', file: 'components/ReplayPanel.tsx', snippet: 'text-white/88', fg: 'white/88', bg: REPLAY_PANEL, min: TEXT },
  { where: 'Replay header title', file: 'components/TreeVisualizer.tsx', snippet: 'text-[10px] font-black text-emerald-500 uppercase', fg: 'emerald-500', opacity: 0.75, bg: TREE, min: TEXT },
  { where: 'Replay header step line', file: 'components/TreeVisualizer.tsx', snippet: 'text-[9px] font-black text-emerald-500 uppercase', fg: 'emerald-500', opacity: 0.75, bg: TREE, min: TEXT },
  { where: 'Replay layout message', file: 'components/TreeVisualizer.tsx', snippet: 'text-center text-emerald-100', fg: 'emerald-100', bg: [...TREE, 'rgba(3,19,14,0.9)'], min: TEXT },

  // Tree Bank
  { where: 'Tree Bank eyebrow "Saved Workspace"', file: 'components/TreeBankView.tsx', snippet: 'tracking-[0.5em] text-emerald-500/75', fg: 'emerald-500/75', bg: GLASS, min: TEXT },
  { where: 'Tree Bank intro', file: 'components/TreeBankView.tsx', snippet: 'text-emerald-50/70 mt-3', fg: 'emerald-50/70', bg: GLASS, min: TEXT },
  { where: 'Tree Bank count', file: 'components/TreeBankView.tsx', snippet: 'uppercase tracking-widest text-emerald-400/80', fg: 'emerald-400/80', bg: GLASS, min: TEXT },
  { where: 'Tree Bank loading', file: 'components/TreeBankView.tsx', snippet: 'text-emerald-200/80', fg: 'emerald-200/80', bg: GLASS, min: TEXT },
  { where: 'Tree Bank empty message', file: 'components/TreeBankView.tsx', snippet: 'text-emerald-50/60 max-w-xl', fg: 'emerald-50/60', bg: GLASS, min: TEXT },
  { where: 'Saved tree framework label', file: 'components/TreeBankView.tsx', snippet: 'tracking-[0.35em] text-emerald-400/70', fg: 'emerald-400/70', bg: GLASS, min: TEXT },
  { where: 'Saved tree date', file: 'components/TreeBankView.tsx', snippet: 'font-black text-emerald-500/75 shrink-0', fg: 'emerald-500/75', bg: GLASS, min: TEXT },
  { where: 'Saved tree parse chip', file: 'components/TreeBankView.tsx', snippet: 'text-emerald-300/80 bg-emerald-500/10', fg: 'emerald-300/80', bg: [...GLASS, 'emerald-500/10'], min: TEXT },
  { where: 'Saved tree view chip / Cancel', file: 'components/TreeBankView.tsx', snippet: 'border-white/15 text-white/70 bg-white/5', fg: 'white/70', bg: [...GLASS, 'white/5'], min: TEXT },
  { where: 'Saved tree Open / Load more', file: 'components/TreeBankView.tsx', snippet: 'bg-emerald-500/15 text-emerald-300', fg: 'emerald-300', bg: [...GLASS, 'emerald-500/15'], min: TEXT },
  { where: 'Saved tree Delete', file: 'components/TreeBankView.tsx', snippet: 'bg-rose-500/10 text-rose-300', fg: 'rose-300', bg: [...GLASS, 'rose-500/10'], min: TEXT },
  { where: 'Tree Bank "Showing …"', file: 'components/TreeBankView.tsx', snippet: 'tracking-[0.2em] text-emerald-500/85', fg: 'emerald-500/85', bg: SHELL, min: TEXT },
  { where: 'Saved tree without preview', file: 'components/TreeBankPreview.tsx', snippet: 'text-emerald-400/65', fg: 'emerald-400/65', bg: ['#020806'], min: TEXT },
  { where: 'Delete dialog text', file: 'components/TreeBankView.tsx', snippet: 'text-emerald-50/80 leading-relaxed', fg: 'emerald-50/80', bg: DIALOG, min: TEXT },
  { where: 'Delete dialog Delete', file: 'components/TreeBankView.tsx', snippet: 'bg-rose-500/20 text-rose-200', fg: 'rose-200', bg: [...DIALOG, 'rose-500/20'], min: TEXT },

  // Notes
  { where: 'Notes paragraphs', file: 'components/DerivationNotesView.tsx', snippet: 'text-emerald-50/90 leading-relaxed', fg: 'emerald-50/90', bg: NOTES_CARD, min: TEXT },
  { where: 'Notes "Final Tree · Miles Shang Notation"', file: 'components/DerivationNotesView.tsx', snippet: 'tracking-widest text-emerald-500/75', fg: 'emerald-500/75', bg: NOTES_CARD, min: TEXT },
  { where: 'Notes Open in / Copy buttons', file: 'components/DerivationNotesView.tsx', snippet: 'bg-white/5 border-white/10 text-white/45 hover:text-emerald-400', fg: 'white/45', bg: [...NOTES_CARD, 'white/5'], min: TEXT },
  { where: 'Notes copied state', file: 'components/DerivationNotesView.tsx', snippet: "'bg-emerald-500/20 border-emerald-500 text-emerald-400'", fg: 'emerald-400', bg: [...NOTES_CARD, 'black/40', 'emerald-500/20'], min: TEXT },
  { where: 'Notes "Canopy Code"', file: 'components/DerivationNotesView.tsx', snippet: 'tracking-[0.3em] text-emerald-400/80', fg: 'emerald-400/80', bg: [...NOTES_CARD, 'black/40'], min: TEXT },
  { where: 'Notes bracketing', file: 'components/DerivationNotesView.tsx', snippet: 'text-emerald-400 mono', fg: 'emerald-400', opacity: 0.9, bg: [...NOTES_CARD, 'black/40'], min: TEXT },
  { where: 'Notes clipboard error', file: 'components/DerivationNotesView.tsx', snippet: 'mb-4 text-sm text-rose-300', fg: 'rose-300', bg: [...NOTES_CARD, 'black/40'], min: TEXT }
];
