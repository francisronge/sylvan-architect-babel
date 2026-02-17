import React, { useState, useMemo, useEffect } from 'react';
import { parseSentence } from './services/geminiService';
import { ParseResult, SyntaxNode } from './types';
import TreeVisualizer from './components/TreeVisualizer';
import { 
  BookOpen, 
  RotateCcw, 
  Sparkles,
  TreeDeciduous,
  Sprout,
  AlertTriangle,
  Layers,
  Zap,
  Info,
  Leaf,
  FileText,
  ChevronUp,
  ChevronDown,
  BarChart3,
  FlameKindling,
  Key,
  Triangle,
  EyeOff,
  Maximize2,
  Copy,
  Check,
  ExternalLink,
  Cpu
} from 'lucide-react';

const App: React.FC = () => {
  const [input, setInput] = useState('The farmer eats the pig in the house');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ParseResult | null>(null);
  const [lastInput, setLastInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'tree' | 'growth' | 'pos' | 'notes' | 'stats'>('tree');
  const [isInputExpanded, setIsInputExpanded] = useState(true);
  const [isInputVisible, setIsInputVisible] = useState(true);
  const [needsKey, setNeedsKey] = useState(false);
  const [abstractionMode, setAbstractionMode] = useState(false);
  const [framework, setFramework] = useState<'xbar' | 'minimalism'>('xbar');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const checkKeyStatus = async () => {
      const aistudio = (window as any).aistudio;
      if (aistudio && typeof aistudio.hasSelectedApiKey === 'function') {
        const hasKey = await aistudio.hasSelectedApiKey();
        if (!hasKey) setNeedsKey(true);
      }
    };
    checkKeyStatus();
  }, []);

  const handleOpenKeySelection = async () => {
    const aistudio = (window as any).aistudio;
    if (aistudio && typeof aistudio.openSelectKey === 'function') {
      try {
        await aistudio.openSelectKey();
        setNeedsKey(false);
        setError(null);
        if (loading) handleParse();
      } catch (err) {
        console.error("Key selection failed", err);
      }
    }
  };

  const handleParse = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!input.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const data = await parseSentence(input, framework);
      setResult(data);
      setLastInput(input);
      setActiveTab('tree');
      setNeedsKey(false);
    } catch (err: any) {
      if (err.message === 'API_KEY_EXPIRED' || err.message === 'API_KEY_MISSING' || err.message === 'API_KEY_INVALID') {
        setNeedsKey(true);
        setError("Your API credentials have expired or are missing. Please renew them below.");
      } else {
        setError(err.message || 'Linguistic growth interrupted.');
      }
    } finally {
      setLoading(false);
    }
  };

  const copyBracketed = () => {
    if (result?.bracketedNotation) {
      navigator.clipboard.writeText(result.bracketedNotation);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const stats = useMemo(() => {
    if (!result) return { depth: 0, nodes: 0, complexity: 'N/A' };
    let maxDepth = 0, nodeCount = 0;
    const traverse = (node: SyntaxNode, depth: number) => {
      nodeCount++;
      maxDepth = Math.max(maxDepth, depth);
      if (node.children) node.children.forEach(child => traverse(child, depth + 1));
    };
    traverse(result.tree, 1);
    let complexity = maxDepth > 8 ? 'High-Density' : maxDepth > 5 ? 'Moderate' : 'Low';
    return { depth: maxDepth, nodes: nodeCount, complexity };
  }, [result]);

  return (
    <div className="h-screen flex flex-col overflow-hidden selection:bg-emerald-500 selection:text-white">
      <header className="bg-black/60 backdrop-blur-xl border-b border-white/10 z-40 px-8 py-4 shrink-0 shadow-2xl">
        <div className="max-w-[2000px] mx-auto flex items-center justify-between">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 moss-gradient rounded-xl flex items-center justify-center text-white shadow-[0_0_20px_rgba(6,78,59,0.5)] rotate-3">
                <Sprout size={20} />
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tighter text-white serif leading-tight">Sylvan Architect Babel</h1>
                <p className="text-[7px] font-black uppercase tracking-[0.5em] text-emerald-500/80 leading-none">Generative Grammar Arboretum</p>
              </div>
            </div>

            <div className="h-8 w-px bg-white/10 hidden md:block"></div>

            <div className="flex items-center gap-3">
              <button
                onClick={() => setFramework(framework === 'xbar' ? 'minimalism' : 'xbar')}
                className={`flex items-center gap-2.5 px-4 py-2 rounded-xl border transition-all text-[9px] font-black uppercase tracking-widest shadow-inner group ${
                  framework === 'minimalism' 
                  ? 'bg-purple-500/20 border-purple-500/40 text-purple-400' 
                  : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                }`}
              >
                {framework === 'xbar' ? <Triangle size={12} className="fill-emerald-400" /> : <Cpu size={12} className="text-purple-400" />}
                {framework === 'xbar' ? 'X-Bar Theory' : 'Minimalist Program'}
              </button>

              <button
                onClick={() => setAbstractionMode(!abstractionMode)}
                className={`flex items-center gap-2.5 px-4 py-2 rounded-xl border transition-all text-[9px] font-black uppercase tracking-widest shadow-inner group ${
                  abstractionMode 
                  ? 'bg-amber-500/20 border-amber-500/40 text-amber-400' 
                  : 'bg-white/5 border-white/10 text-white/40 hover:text-emerald-400 hover:border-emerald-500/30'
                }`}
              >
                <Triangle size={12} className={`${abstractionMode ? 'fill-amber-400' : 'group-hover:text-emerald-400'} transition-colors`} />
                Constituent Glyphing
              </button>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="hidden md:flex items-center gap-2 text-[9px] font-black text-emerald-400 bg-emerald-950/40 px-5 py-2.5 rounded-full border border-emerald-900/30 tracking-widest uppercase shadow-inner">
              <Zap size={10} className="fill-emerald-400" />
              Gemini 3 Pro
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 relative flex flex-col overflow-hidden">
        <div className="absolute inset-0 z-0">
          {loading && (
            <div className="absolute inset-0 z-50 bg-[#020806]/95 backdrop-blur-3xl flex flex-col items-center justify-center gap-8 animate-in fade-in duration-700">
              <div className="relative">
                <div className="w-28 h-28 border-[6px] border-emerald-950/50 border-t-emerald-500 rounded-full animate-spin shadow-[0_0_100px_rgba(16,185,129,0.2)]"></div>
                <Leaf className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-emerald-500 animate-pulse" size={38} />
              </div>
              <div className="text-center">
                <p className="text-white font-black serif italic text-2xl mb-1">Synthesizing Neural Roots...</p>
                <p className="text-emerald-500/40 font-black uppercase text-[9px] tracking-[0.7em]">Deep Parsing {framework === 'xbar' ? 'X-Bar' : 'Minimalist'} Structures</p>
              </div>
            </div>
          )}

          {result && (activeTab === 'tree' || activeTab === 'growth') ? (
            <TreeVisualizer 
              data={result.tree} 
              animated={activeTab === 'growth'} 
              abstractionMode={abstractionMode}
            />
          ) : result && (activeTab === 'pos' || activeTab === 'notes' || activeTab === 'stats') ? (
            <div className="w-full h-full flex items-center justify-center p-12 overflow-y-auto bg-[#020806]/60 backdrop-blur-md animate-in fade-in duration-500">
              {activeTab === 'pos' && (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 max-w-6xl w-full">
                  {result.partsOfSpeech.map((item, idx) => (
                    <div key={idx} className="p-8 bg-black/60 border border-white/5 rounded-[2.5rem] flex flex-col items-center justify-center gap-3 hover:border-emerald-500/40 transition-all shadow-2xl group hover:-translate-y-1">
                      <span className="text-[9px] font-black text-emerald-500/40 uppercase tracking-[0.5em]">{item.pos}</span>
                      <span className="font-bold text-white serif italic text-2xl tracking-tight">{item.word}</span>
                    </div>
                  ))}
                </div>
              )}
              {activeTab === 'notes' && (
                <div className="max-w-4xl w-full space-y-8 animate-in slide-in-from-bottom-8">
                  <div className="glass-dark p-12 rounded-[3rem] shadow-2xl">
                     <div className="flex items-center gap-5 mb-8">
                        <div className="w-12 h-12 moss-gradient rounded-2xl flex items-center justify-center text-white shadow-lg">
                          <Info size={24} />
                        </div>
                        <h2 className="text-3xl font-bold text-white serif tracking-tight">Structural Geneology ({framework === 'xbar' ? 'X-Bar' : 'Minimalism'})</h2>
                      </div>
                      <p className="text-emerald-50/90 leading-relaxed italic serif text-2xl border-l-2 border-emerald-500/20 pl-8">"{result.explanation}"</p>
                  </div>

                  {result.bracketedNotation && (
                    <div className="glass-dark p-12 rounded-[3rem] shadow-2xl">
                       <div className="flex items-center justify-between mb-8">
                          <div className="flex items-center gap-5">
                            <div className="w-12 h-12 bg-white/5 rounded-2xl flex items-center justify-center text-emerald-500 border border-white/10">
                              <Layers size={24} />
                            </div>
                            <div>
                              <h2 className="text-3xl font-bold text-white serif tracking-tight">Labeled Bracketing</h2>
                              <p className="text-[10px] font-black uppercase tracking-widest text-emerald-500/40">Syntax Tree String Formalism</p>
                            </div>
                          </div>
                          <div className="flex gap-4">
                            <button 
                              onClick={copyBracketed}
                              className={`flex items-center gap-3 px-6 py-3 rounded-2xl border transition-all text-[11px] font-black uppercase tracking-widest ${
                                copied 
                                ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400' 
                                : 'bg-white/5 border-white/10 text-white/40 hover:text-emerald-400 hover:border-emerald-500/30'
                              }`}
                            >
                              {copied ? <Check size={14} /> : <Copy size={14} />}
                              {copied ? 'Copied to Soil' : 'Copy Code'}
                            </button>
                            <a 
                              href="https://mshang.ca/syntree/" 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="flex items-center gap-3 px-6 py-3 rounded-2xl border bg-white/5 border-white/10 text-white/40 hover:text-emerald-400 hover:border-emerald-500/30 transition-all text-[11px] font-black uppercase tracking-widest"
                            >
                              <ExternalLink size={14} />
                              Miles Shang
                            </a>
                          </div>
                        </div>
                        <div className="bg-black/40 p-8 rounded-[2rem] border border-white/5 shadow-inner">
                          <code className="text-emerald-400 mono text-lg break-all leading-relaxed opacity-90 selection:bg-emerald-500/30">
                            {result.bracketedNotation}
                          </code>
                        </div>
                    </div>
                  )}
                </div>
              )}
              {activeTab === 'stats' && (
                <div className="max-w-xl w-full glass-dark p-12 rounded-[3rem] shadow-2xl animate-in zoom-in-95">
                  <div className="flex items-center gap-5 mb-10">
                    <BarChart3 className="text-emerald-500" size={32} />
                    <h2 className="text-3xl font-bold text-white serif">Arboretum Metrics</h2>
                  </div>
                  <div className="space-y-8">
                    <div className="flex justify-between items-end">
                      <span className="text-[11px] font-black uppercase tracking-[0.2em] text-emerald-500/60">Syntactic Depth</span>
                      <span className="text-4xl font-bold text-white serif tracking-tighter">{stats.depth} <span className="text-base font-normal text-white/30">layers</span></span>
                    </div>
                    <div className="flex justify-between items-end">
                      <span className="text-[11px] font-black uppercase tracking-[0.2em] text-emerald-500/60">Node Population</span>
                      <span className="text-4xl font-bold text-white serif tracking-tighter">{stats.nodes} <span className="text-base font-normal text-white/30">entities</span></span>
                    </div>
                    <div className="pt-6 border-t border-white/10">
                      <div className="flex justify-between mb-3">
                        <span className="text-[11px] font-black uppercase tracking-[0.2em] text-emerald-500/60">Structural Complexity</span>
                        <span className="text-sm font-bold text-emerald-400">{stats.complexity}</span>
                      </div>
                      <div className="h-3 bg-black/40 rounded-full overflow-hidden p-0.5 border border-white/5">
                        <div 
                          className="h-full moss-gradient rounded-full transition-all duration-1000" 
                          style={{ width: `${Math.min(100, (stats.depth / 15) * 100)}%` }}
                        ></div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : !loading && (
            <div className="w-full h-full flex flex-col items-center justify-center text-emerald-900/10 gap-10">
              <div className="relative">
                <div className="absolute inset-0 bg-emerald-500/20 blur-[80px] rounded-full scale-150 animate-pulse"></div>
                <div className="relative z-10 w-32 h-32 rounded-full border border-white/5 flex items-center justify-center bg-black/20 backdrop-blur-sm shadow-inner">
                  <Sprout size={64} className="text-emerald-500/40 animate-pulse" />
                </div>
              </div>
              <div className="text-center z-10">
                <p className="font-extrabold text-white text-3xl mono mb-3 tracking-tighter">Awaiting Structural Genesis</p>
                <p className="text-emerald-900 font-black uppercase text-[10px] tracking-[0.8em] opacity-80 text-balance max-w-lg mx-auto">Cast a thought into the generative soil to begin its derivation.</p>
              </div>
            </div>
          )}
        </div>

        {/* Navigation Sidebar */}
        <div className="absolute right-8 top-1/2 -translate-y-1/2 z-30 flex flex-col gap-4">
          {[
            { id: 'tree', icon: Layers, label: 'Canopy' },
            { id: 'growth', icon: FlameKindling, label: 'Growth Simulation' },
            { id: 'pos', icon: BookOpen, label: 'Catalog' },
            { id: 'notes', icon: FileText, label: 'Notes' },
            { id: 'stats', icon: BarChart3, label: 'Stats' },
          ].map((tab) => (
            <button
              key={tab.id}
              disabled={!result}
              onClick={() => setActiveTab(tab.id as any)}
              className={`group relative w-14 h-14 rounded-2xl flex items-center justify-center transition-all border shadow-2xl disabled:opacity-20 disabled:cursor-not-allowed ${
                activeTab === tab.id 
                ? 'moss-gradient text-white border-emerald-400/50 shadow-[0_0_20px_rgba(6,78,59,0.4)] scale-110' 
                : 'glass-dark text-emerald-600/60 border-white/5 hover:text-emerald-400 hover:border-white/10 hover:scale-105'
              }`}
            >
              <tab.icon size={22} />
              <span className="absolute right-full mr-5 px-4 py-2 rounded-xl bg-black/90 backdrop-blur-xl text-[10px] font-black uppercase tracking-[0.3em] text-emerald-400 opacity-0 group-hover:opacity-100 pointer-events-none transition-all border border-white/10 whitespace-nowrap shadow-2xl translate-x-2 group-hover:translate-x-0">
                {tab.label}
              </span>
            </button>
          ))}
        </div>

        {/* Input UI */}
        <div className={`absolute bottom-10 left-1/2 -translate-x-1/2 z-30 w-full max-w-3xl px-8 transition-all duration-700 ${isInputVisible ? 'opacity-100 translate-y-0 pointer-events-auto' : 'opacity-0 translate-y-10 pointer-events-none'}`}>
          <div className={`glass-dark rounded-[2.5rem] border border-white/10 shadow-[0_30px_60px_rgba(0,0,0,0.8)] transition-all duration-700 overflow-hidden`}>
            <div className="flex items-center justify-between px-7 py-3.5 border-b border-white/5 bg-black/30">
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_#10b981]"></div>
                <span className="text-[9px] font-black uppercase tracking-[0.4em] text-emerald-500/80">Arboretum Link</span>
              </div>
              <div className="flex items-center gap-1.5">
                <button 
                  onClick={() => setIsInputExpanded(!isInputExpanded)}
                  title={isInputExpanded ? "Collapse" : "Expand"}
                  className="p-1.5 hover:bg-white/10 rounded-xl transition-colors text-emerald-500/60"
                >
                  {isInputExpanded ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
                </button>
                <button 
                  onClick={() => setIsInputVisible(false)}
                  title="Hide Control Panel"
                  className="p-1.5 hover:bg-rose-500/20 rounded-xl transition-colors text-emerald-500/60 hover:text-rose-400"
                >
                  <EyeOff size={18} />
                </button>
              </div>
            </div>
            
            <div className={`transition-all duration-700 ease-in-out ${isInputExpanded ? 'max-h-[350px] opacity-100 p-6 pt-4' : 'max-h-0 opacity-0'}`}>
              {error && (
                <div className="mb-4 bg-rose-500/10 border border-rose-500/20 px-4 py-3 rounded-2xl flex flex-col gap-3 text-rose-400 text-xs shadow-inner">
                  <div className="flex items-center gap-3 italic serif">
                    <AlertTriangle size={14} className="shrink-0" /> {error}
                  </div>
                  {needsKey && (
                    <button
                      onClick={handleOpenKeySelection}
                      className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-xl bg-rose-500/20 border border-rose-500/30 hover:bg-rose-500/40 transition-all font-black uppercase tracking-widest text-[10px] text-rose-200 animate-pulse shadow-[0_0_15px_rgba(244,63,94,0.3)]"
                    >
                      <Key size={12} />
                      Renew API Credentials
                    </button>
                  )}
                </div>
              )}
              
              <form onSubmit={handleParse} className="flex gap-4 items-end">
                <div className="flex-1 relative">
                  <textarea
                    className="w-full bg-black/40 border border-white/10 rounded-2xl p-4 text-emerald-50 serif italic placeholder:text-emerald-900/30 focus:outline-none focus:ring-2 focus:ring-emerald-500/10 transition-all resize-none h-20 text-lg shadow-inner leading-relaxed"
                    placeholder={`Plant a ${framework === 'xbar' ? 'Generative' : 'Minimalist'} linguistic seed...`}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    disabled={loading}
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="moss-gradient hover:brightness-110 disabled:opacity-40 text-white font-black w-20 h-20 rounded-2xl flex items-center justify-center shadow-[0_10px_20px_rgba(0,0,0,0.4)] active:scale-90 transition-all group shrink-0"
                >
                  {loading ? (
                    <RotateCcw className="animate-spin" size={24} />
                  ) : (
                    <Sparkles size={24} className="group-hover:rotate-12 group-hover:scale-110 transition-transform" />
                  )}
                </button>
              </form>
            </div>
            {!isInputExpanded && (
               <div className="px-7 py-4 flex items-center justify-between cursor-pointer group hover:bg-white/5 transition-colors" onClick={() => setIsInputExpanded(true)}>
                  <span className="text-emerald-50/50 serif italic text-sm truncate max-w-[400px]">"{input}"</span>
                  <span className="text-[8px] font-black text-emerald-500/30 uppercase tracking-[0.4em] group-hover:text-emerald-500 transition-colors">Expand Arbor Control</span>
               </div>
            )}
          </div>
        </div>

        {/* Restore Sprout Trigger */}
        {!isInputVisible && (
          <button
            onClick={() => setIsInputVisible(true)}
            className="absolute bottom-10 left-1/2 -translate-x-1/2 z-50 w-14 h-14 moss-gradient rounded-full flex items-center justify-center text-white shadow-[0_0_30px_rgba(16,185,129,0.4)] hover:scale-110 active:scale-95 transition-all animate-in fade-in slide-in-from-bottom-4 duration-500"
            title="Restore Arboretum Link"
          >
            <Sprout size={28} className="animate-pulse" />
          </button>
        )}
      </main>

      <footer className="bg-black/80 border-t border-white/10 py-4 px-10 shrink-0 z-40 shadow-[0_-10px_30px_rgba(0,0,0,0.5)]">
        <div className="max-w-[2000px] mx-auto flex items-center justify-between text-[8px] font-black text-emerald-900/50 uppercase tracking-[0.5em]">
          <div className="flex items-center gap-8">
            <span className="flex items-center gap-3"><Layers size={12} /> Sylvan Logic Engine</span>
            <span className="h-3 w-px bg-white/10"></span>
            <span className="flex items-center gap-3"><TreeDeciduous size={12} /> Deep Structural Formalism</span>
          </div>
          <div className="flex items-center gap-6">
            {needsKey && (
              <button 
                onClick={handleOpenKeySelection}
                className="flex items-center gap-2 text-rose-500/80 hover:text-rose-400 transition-colors"
              >
                <Key size={10} /> Key Expired - Renew
              </button>
            )}
            <div className="italic serif lowercase text-[10px] tracking-normal opacity-40">
              rooted in {framework === 'xbar' ? 'generative grammar' : 'minimalist principles'} and neural synthesis
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default App;