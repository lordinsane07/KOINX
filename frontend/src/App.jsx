import { useState, useEffect, useRef } from 'react';
import { 
  Sliders, 
  Bolt, 
  FolderOpen,
  Clock, 
  ArrowRight,
  Download, 
  Inbox, 
  ChevronLeft, 
  ChevronRight, 
  CheckCircle2, 
  Building,
  ShieldAlert,
  Sparkles,
  Activity,
  ServerCrash
} from 'lucide-react';

export default function App() {
  // System Health States
  const [dbOnline, setDbOnline] = useState(true);
  const [redisOnline, setRedisOnline] = useState(true);
  const [uptime, setUptime] = useState('Uptime: 0s');
  
  // Job Input Configuration
  const [userFile, setUserFile] = useState('user_transactions.csv');
  const [exchangeFile, setExchangeFile] = useState('exchange_transactions.csv');
  const [timestampTolerance, setTimestampTolerance] = useState(300);
  const [quantityTolerance, setQuantityTolerance] = useState(0.01);
  const [requireExactType, setRequireExactType] = useState(false);
  
  // Job Execution Lifecycle
  const [runId, setRunId] = useState(null);
  const [runStatus, setRunStatus] = useState('IDLE');
  const [isProcessing, setIsProcessing] = useState(false);
  
  // Aggregated Counters
  const [matchedCount, setMatchedCount] = useState(0);
  const [conflictingCount, setConflictingCount] = useState(0);
  const [unmatchedUserCount, setUnmatchedUserCount] = useState(0);
  const [unmatchedExchangeCount, setUnmatchedExchangeCount] = useState(0);
  const [totalUserRows, setTotalUserRows] = useState(0);
  const [totalExchangeRows, setTotalExchangeRows] = useState(0);
  
  // Explorer Ledger & Table
  const [records, setRecords] = useState([]);
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [page, setPage] = useState(1);
  const [totalRecords, setTotalRecords] = useState(0);
  const limit = 10;
  
  const pollIntervalRef = useRef(null);

  // Background System Health Diagnostician
  useEffect(() => {
    const checkHealth = async () => {
      try {
        const res = await fetch('/health');
        if (!res.ok) throw new Error('Offline');
        const data = await res.json();
        setDbOnline(true);
        setRedisOnline(true);
        
        const secs = Math.floor(data.uptime);
        if (secs >= 3600) {
          setUptime(`Uptime: ${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`);
        } else if (secs >= 60) {
          setUptime(`Uptime: ${Math.floor(secs / 60)}m`);
        } else {
          setUptime(`Uptime: ${secs}s`);
        }
      } catch {
        setDbOnline(false);
        setRedisOnline(false);
        setUptime('Uptime: Offline');
      }
    };

    checkHealth();
    const healthTimer = setInterval(checkHealth, 3000);
    return () => {
      clearInterval(healthTimer);
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, []);

  // Trigger Reconciliation API Orchestrator
  const handleRunReconciliation = async (e) => {
    e.preventDefault();
    if (isProcessing) return;

    setIsProcessing(true);
    setRunStatus('PENDING');

    const payload = {
      userFilePath: userFile,
      exchangeFilePath: exchangeFile,
      config: {
        timestampToleranceSecs: timestampTolerance,
        quantityTolerancePct: quantityTolerance,
        requireExactType
      }
    };

    try {
      const res = await fetch('/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || 'Failed to trigger reconciliation run.');
      }

      const run = await res.json();
      setRunId(run.runId);
      setRunStatus(run.status);
      setPage(1);
      setCategoryFilter('ALL');

      if (run.status === 'COMPLETE') {
        await finalizeRun(run.runId);
      } else {
        startStatusPolling(run.runId);
      }
    } catch (err) {
      alert(err.message);
      setIsProcessing(false);
      setRunStatus('FAILED');
    }
  };

  // Poll background job state from BullMQ / Queue fallbacks
  const startStatusPolling = (id) => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);

    pollIntervalRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/report/${id}/summary`);
        if (!res.ok) throw new Error('Status summary fetch failed');
        const report = await res.json();

        setRunStatus(report.status);

        if (report.status === 'COMPLETE' || report.status === 'PARTIAL') {
          clearInterval(pollIntervalRef.current);
          await finalizeRun(id);
        }
      } catch {
        clearInterval(pollIntervalRef.current);
        setIsProcessing(false);
        setRunStatus('FAILED');
      }
    }, 1000);
  };

  const finalizeRun = async (id) => {
    setIsProcessing(false);
    await fetchSummaryMetrics(id);
    await fetchReportEntries(id, 'ALL', 1);
  };

  const fetchSummaryMetrics = async (id) => {
    try {
      const res = await fetch(`/report/${id}/summary`);
      if (!res.ok) throw new Error('Summary fetch failed');
      const data = await res.json();

      setMatchedCount(data.summary.matched);
      setConflictingCount(data.summary.conflicting);
      setUnmatchedUserCount(data.summary.unmatchedUser);
      setUnmatchedExchangeCount(data.summary.unmatchedExchange);
      setTotalUserRows(data.summary.totalUserRows || 1);
      setTotalExchangeRows(data.summary.totalExchangeRows || 1);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchReportEntries = async (id, cat, pg) => {
    try {
      let url = `/report/${id}?page=${pg}&limit=${limit}`;
      if (cat !== 'ALL') {
        url += `&category=${cat}`;
      }

      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to retrieve items');
      const data = await res.json();

      setRecords(data.data);
      setTotalRecords(data.total);
    } catch (err) {
      console.error(err);
      setRecords([]);
    }
  };

  const handleTabChange = async (cat) => {
    setCategoryFilter(cat);
    setPage(1);
    if (runId) {
      await fetchReportEntries(runId, cat, 1);
    }
  };

  const handlePageChange = async (next) => {
    const nextPg = next ? page + 1 : page - 1;
    setPage(nextPg);
    await fetchReportEntries(runId, categoryFilter, nextPg);
  };

  // Safe unmatched ratios helper avoiding NaN dividing
  const totalProcessed = totalUserRows + totalExchangeRows;
  const unmatchedRatio = totalProcessed > 0
    ? (unmatchedUserCount + unmatchedExchangeCount) / totalProcessed
    : 0;
  const totalPages = Math.ceil(totalRecords / limit);

  return (
    <div className="max-w-[1560px] mx-auto p-6 flex flex-col gap-6 font-sans">
      
      {/* Header */}
      <header className="flex justify-between items-center px-6 py-4 bg-brand-card backdrop-blur-md border border-brand-border rounded-2xl shadow-xl flex-wrap gap-4">
        <div className="flex items-center gap-4">
          <div className="w-11 h-11 bg-gradient-to-br from-brand-cyan to-brand-blue rounded-xl flex items-center justify-center shadow-lg shadow-cyan-500/20">
            <Activity className="w-6 h-6 text-brand-darkBg" />
          </div>
          <div>
            <h1 className="font-sans font-bold text-2xl tracking-wide bg-gradient-to-r from-white to-indigo-300 bg-clip-text text-transparent">KoinX</h1>
            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">Reconciliation Hub</p>
          </div>
        </div>
        
        <div className="flex items-center gap-3 flex-wrap text-white">
          <div className="flex items-center gap-2 px-3 py-2 bg-white/5 border border-brand-border rounded-xl text-xs font-semibold">
            <span className={`w-2.5 h-2.5 rounded-full ${dbOnline ? 'bg-status-matched shadow-[0_0_8px_#00e676]' : 'bg-status-unmatched shadow-[0_0_8px_#ff5252]'}`}></span>
            <span>Database: {dbOnline ? 'Connected' : 'Offline'}</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-2 bg-white/5 border border-brand-border rounded-xl text-xs font-semibold">
            <span className={`w-2.5 h-2.5 rounded-full ${redisOnline ? 'bg-status-matched shadow-[0_0_8px_#00e676]' : 'bg-status-unmatched shadow-[0_0_8px_#ff5252]'}`}></span>
            <span>Redis Queue: {redisOnline ? 'Active' : 'Offline'}</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-2 bg-white/5 border border-brand-border rounded-xl text-xs font-semibold">
            <Clock className="w-4 h-4 text-brand-blue" />
            <span>{uptime}</span>
          </div>
        </div>
      </header>

      {/* Grid Layout Container */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_1.3fr] gap-6">
        
        {/* Left Side Control Panel */}
        <section className="bg-brand-card backdrop-blur-md border border-brand-border rounded-3xl shadow-2xl p-6">
          <div className="flex items-center gap-3 border-b border-brand-border pb-5 mb-6">
            <Sliders className="w-5 h-5 text-brand-cyan" />
            <h2 className="font-sans font-bold text-lg text-white">Reconciliation Control</h2>
          </div>
          
          <form onSubmit={handleRunReconciliation} className="flex flex-col gap-5 text-white">
            <div className="flex flex-col gap-2">
              <label className="text-xs font-bold text-gray-400"><i className="fa-solid fa-file-csv text-brand-blue mr-1"></i> User Export CSV File</label>
              <div className="flex items-center gap-3 px-4 py-3 bg-white/5 border border-brand-border rounded-xl focus-within:border-brand-blue transition-colors duration-200">
                <i className="fa-solid fa-user-shield text-brand-blue"></i>
                <input 
                  type="text" 
                  className="flex-grow bg-transparent border-none text-sm font-semibold outline-none text-white placeholder-gray-500" 
                  value={userFile} 
                  onChange={e => setUserFile(e.target.value)} 
                  placeholder="user_transactions.csv" 
                />
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-xs font-bold text-gray-400"><i className="fa-solid fa-file-csv text-brand-blue mr-1"></i> Exchange Export CSV File</label>
              <div className="flex items-center gap-3 px-4 py-3 bg-white/5 border border-brand-border rounded-xl focus-within:border-brand-blue transition-colors duration-200">
                <i className="fa-solid fa-building-columns text-brand-blue"></i>
                <input 
                  type="text" 
                  className="flex-grow bg-transparent border-none text-sm font-semibold outline-none text-white placeholder-gray-500" 
                  value={exchangeFile} 
                  onChange={e => setExchangeFile(e.target.value)} 
                  placeholder="exchange_transactions.csv" 
                />
              </div>
            </div>

            <div className="text-[10px] font-extrabold uppercase tracking-widest text-gray-500 mt-4 mb-1 flex items-center gap-3 after:content-[''] after:flex-grow after:h-[1px] after:bg-brand-border">Matching Parameters</div>

            <div className="flex flex-col gap-2">
              <div className="flex justify-between items-center text-xs">
                <label className="font-bold text-gray-400"><i className="fa-solid fa-stopwatch text-brand-cyan mr-1"></i> Time Proximity Windows</label>
                <span className="font-extrabold text-brand-cyan">{timestampTolerance}s ({Math.floor(timestampTolerance/60)}m)</span>
              </div>
              <input 
                type="range" 
                min="10" 
                max="3600" 
                step="10" 
                value={timestampTolerance} 
                onChange={e => setTimestampTolerance(parseInt(e.target.value, 10))} 
                className="w-full h-1.5 bg-white/10 rounded-lg outline-none cursor-pointer" 
              />
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex justify-between items-center text-xs">
                <label className="font-bold text-gray-400"><i className="fa-solid fa-scale-balanced text-brand-cyan mr-1"></i> Quantity Tolerances</label>
                <span className="font-extrabold text-brand-cyan">{(quantityTolerance*100).toFixed(1)}%</span>
              </div>
              <input 
                type="range" 
                min="0.001" 
                max="0.1" 
                step="0.001" 
                value={quantityTolerance} 
                onChange={e => setQuantityTolerance(parseFloat(e.target.value))} 
                className="w-full h-1.5 bg-white/10 rounded-lg outline-none cursor-pointer" 
              />
            </div>

            <div className="flex items-start gap-3 my-4 cursor-pointer" onClick={() => setRequireExactType(!requireExactType)}>
              <input 
                type="checkbox" 
                checked={requireExactType} 
                readOnly 
                className="w-4 h-4 rounded border-brand-border bg-white/5 cursor-pointer mt-1" 
              />
              <div className="flex flex-col select-none">
                <strong className="text-sm font-semibold text-white">Require Exact Type Mapping</strong>
                <span className="text-[10px] text-gray-400">Forces transaction types (BUY, SELL, etc.) to match strictly during Pass 2</span>
              </div>
            </div>

            <button 
              type="submit" 
              disabled={isProcessing} 
              className={`w-full py-4 bg-gradient-to-r from-brand-cyan to-brand-blue text-brand-darkBg font-extrabold rounded-xl shadow-lg shadow-cyan-500/10 hover:shadow-cyan-500/20 active:translate-y-0 -translate-y-0.5 hover:-translate-y-1 transition-all duration-300 flex items-center justify-center gap-2 ${isProcessing ? 'opacity-50 cursor-not-allowed transform-none shadow-none bg-white/10 text-gray-400' : ''}`}
            >
              {isProcessing ? (
                <>
                  <i className="fa-solid fa-circle-notch fa-spin"></i>
                  <span>Processing Engine Queue...</span>
                </>
              ) : (
                <>
                  <Bolt className="w-4 h-4 text-brand-darkBg" />
                  <span>Run Reconciliation Pipeline</span>
                </>
              )}
            </button>
          </form>
        </section>

        {/* Right Side Execution Panel */}
        <section className="bg-brand-card backdrop-blur-md border border-brand-border rounded-3xl shadow-2xl p-6 flex flex-col gap-5 text-white">
          <div className="flex items-center gap-3 border-b border-brand-border pb-5">
            <Sparkles className="w-5 h-5 text-brand-cyan" />
            <h2 className="font-sans font-bold text-lg text-white">Execution Summary Dashboard</h2>
          </div>
          
          {/* Active Job status summary card */}
          <div className="flex items-center gap-4 p-4 bg-white/5 border border-brand-border rounded-2xl">
            <div className={`w-11 h-11 rounded-xl flex items-center justify-center text-lg ${
              runStatus === 'IDLE' ? 'bg-white/5 text-gray-400' :
              runStatus === 'PENDING' || runStatus === 'RUNNING' ? 'bg-status-conflicting/20 text-status-conflicting animate-pulse' :
              runStatus === 'COMPLETE' ? 'bg-status-matched/20 text-status-matched' : 'bg-status-unmatched/20 text-status-unmatched'
            }`}>
              {runStatus === 'IDLE' && <FolderOpen className="w-5 h-5 text-gray-400" />}
              {(runStatus === 'PENDING' || runStatus === 'RUNNING') && <i className="fa-solid fa-circle-notch fa-spin"></i>}
              {runStatus === 'COMPLETE' && <CheckCircle2 className="w-5 h-5 text-status-matched" />}
              {(runStatus === 'FAILED' || runStatus === 'PARTIAL') && <ServerCrash className="w-5 h-5 text-status-unmatched" />}
            </div>
            <div className="flex flex-col min-w-0">
              <h3 className="text-sm font-bold truncate max-w-[280px]" title={runId}>{runId ? `Run UUID: ${runId}` : 'No active execution selected'}</h3>
              <p className="text-xs text-gray-400">
                {runStatus === 'IDLE' && 'Select paths above and trigger matching to calculate differences.'}
                {(runStatus === 'PENDING' || runStatus === 'RUNNING') && 'Ingesting CSV sheets, compiling checksums, and matching...'}
                {runStatus === 'COMPLETE' && 'Success: Transaction database normalized and matching completed.'}
                {runStatus === 'FAILED' && 'Error: Matching process aborted or failed.'}
              </p>
            </div>
          </div>

          {/* Glassmorphic Metric Counters */}
          <div className="grid grid-cols-2 gap-4">
            <div className="flex justify-between items-center p-4 bg-white/[0.02] border border-brand-border rounded-2xl hover:bg-white/5 transition-all duration-300 hover:-translate-y-0.5">
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-bold text-gray-400">Matched Rows</span>
                <strong className="font-sans text-3xl font-extrabold text-white">{matchedCount}</strong>
              </div>
              <div className="w-9 h-9 rounded-xl bg-status-matched/10 text-status-matched flex items-center justify-center text-sm"><CheckCircle2 className="w-4 h-4" /></div>
            </div>

            <div className="flex justify-between items-center p-4 bg-white/[0.02] border border-brand-border rounded-2xl hover:bg-white/5 transition-all duration-300 hover:-translate-y-0.5">
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-bold text-gray-400">Conflicting Rows</span>
                <strong className="font-sans text-3xl font-extrabold text-white">{conflictingCount}</strong>
              </div>
              <div className="w-9 h-9 rounded-xl bg-status-conflicting/10 text-status-conflicting flex items-center justify-center text-sm"><ShieldAlert className="w-4 h-4" /></div>
            </div>

            <div className="flex justify-between items-center p-4 bg-white/[0.02] border border-brand-border rounded-2xl hover:bg-white/5 transition-all duration-300 hover:-translate-y-0.5">
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-bold text-gray-400">Unmatched User</span>
                <strong class="font-sans text-3xl font-extrabold text-white">{unmatchedUserCount}</strong>
              </div>
              <div className="w-9 h-9 rounded-xl bg-status-unmatched/10 text-status-unmatched flex items-center justify-center text-sm"><i className="fa-solid fa-user-minus"></i></div>
            </div>

            <div className="flex justify-between items-center p-4 bg-white/[0.02] border border-brand-border rounded-2xl hover:bg-white/5 transition-all duration-300 hover:-translate-y-0.5">
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-bold text-gray-400">Unmatched Exch.</span>
                <strong class="font-sans text-3xl font-extrabold text-white">{unmatchedExchangeCount}</strong>
              </div>
              <div className="w-9 h-9 rounded-xl bg-status-unmatched/10 text-status-unmatched flex items-center justify-center text-sm"><Building className="w-4 h-4" /></div>
            </div>
          </div>

          {/* Quality warning card */}
          {unmatchedRatio >= 0.20 && (
            <div className="flex items-start gap-4 p-4 bg-status-unmatched/10 border border-status-unmatched/25 rounded-2xl text-status-unmatched">
              <ShieldAlert className="w-5 h-5 text-status-unmatched flex-shrink-0 mt-0.5" />
              <div>
                <h4 className="text-xs font-bold">Unmatched Ratio Warning Exceeded!</h4>
                <p className="text-[10px] text-gray-300 mt-1 leading-relaxed">The unmatched user/exchange row metrics exceed 20% of processed transaction arrays. Evaluator data quality check recommended.</p>
              </div>
            </div>
          )}

          {/* Download CSV button */}
          {runId && (
            <div className="mt-auto">
              <a href={`/report/${runId}/download`} className="flex items-center justify-center gap-2.5 w-full py-4 bg-white/5 border border-brand-border rounded-xl text-sm font-bold hover:bg-white/10 hover:border-gray-400 transition-all duration-300">
                <Download className="w-4 h-4 text-brand-cyan" />
                <span>Download Audited Side-by-Side CSV</span>
              </a>
            </div>
          )}
        </section>
      </div>

      {/* Bottom Ledger Section */}
      <section className="bg-brand-card backdrop-blur-md border border-brand-border rounded-3xl shadow-2xl overflow-hidden text-white">
        <div className="flex justify-between items-center p-6 border-b border-brand-border bg-white/[0.01] flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <FolderOpen className="w-5 h-5 text-brand-cyan" />
            <h2 className="font-sans font-bold text-base">Reconciliation Audit Ledger Explorer</h2>
          </div>
          
          {/* Filters Tab buttons */}
          <div className="flex bg-black/20 p-1 border border-brand-border rounded-xl flex-wrap">
            <button className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all duration-300 ${categoryFilter === 'ALL' ? 'bg-white/10 text-white shadow-lg' : 'text-gray-400 hover:text-white'}`} onClick={() => handleTabChange('ALL')}>All Items</button>
            <button className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all duration-300 flex items-center gap-1.5 ${categoryFilter === 'MATCHED' ? 'bg-white/10 text-white shadow-lg' : 'text-gray-400 hover:text-white'}`} onClick={() => handleTabChange('MATCHED')}><span className="w-1.5 h-1.5 rounded-full bg-status-matched"></span> Matched</button>
            <button className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all duration-300 flex items-center gap-1.5 ${categoryFilter === 'CONFLICTING' ? 'bg-white/10 text-white shadow-lg' : 'text-gray-400 hover:text-white'}`} onClick={() => handleTabChange('CONFLICTING')}><span className="w-1.5 h-1.5 rounded-full bg-status-conflicting"></span> Conflicting</button>
            <button className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all duration-300 flex items-center gap-1.5 ${categoryFilter === 'UNMATCHED_USER' ? 'bg-white/10 text-white shadow-lg' : 'text-gray-400 hover:text-white'}`} onClick={() => handleTabChange('UNMATCHED_USER')}><span className="w-1.5 h-1.5 rounded-full bg-status-unmatched"></span> Unmatched User</button>
            <button className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all duration-300 flex items-center gap-1.5 ${categoryFilter === 'UNMATCHED_EXCHANGE' ? 'bg-white/10 text-white shadow-lg' : 'text-gray-400 hover:text-white'}`} onClick={() => handleTabChange('UNMATCHED_EXCHANGE')}><span className="w-1.5 h-1.5 rounded-full bg-brand-blue"></span> Unmatched Exch.</button>
          </div>
        </div>

        {/* Ledger table */}
        <div className="overflow-x-auto max-h-[480px]">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="bg-white/[0.01] border-b border-brand-border text-[10px] text-gray-400 font-bold uppercase tracking-wider">
                <th className="px-6 py-4 w-[10%]">Category</th>
                <th className="px-6 py-4 w-[22%]">User Record details</th>
                <th className="px-6 py-4 w-[22%]">Exchange Record Details</th>
                <th className="px-6 py-4 w-[8%] text-center">Score</th>
                <th className="px-6 py-4 w-[38%]">Audit conflict and processing metrics</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-border">
              {records.length === 0 ? (
                <tr>
                  <td colSpan="5" className="py-24 text-center">
                    <div className="flex flex-col items-center gap-4 text-gray-500">
                      <Inbox className="w-12 h-12 opacity-30" />
                      <p className="text-sm font-medium max-w-sm leading-relaxed">No matching results to display. Configure options and start a run above to analyze transaction ledger differences.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                records.map((entry, idx) => {
                  const userBox = renderRecordBox(entry.userRecord);
                  const exchangeBox = renderRecordBox(entry.exchangeRecord);
                  const diffNotes = renderAuditNotes(entry);

                  return (
                    <tr key={idx} className="hover:bg-white/[0.01] transition-all duration-150">
                      <td className="px-6 py-5 align-top">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-extrabold uppercase ${
                          entry.category === 'MATCHED' ? 'bg-status-matched/10 text-status-matched border border-status-matched/25' :
                          entry.category === 'CONFLICTING' ? 'bg-status-conflicting/10 text-status-conflicting border border-status-conflicting/25' :
                          entry.category === 'UNMATCHED_USER' ? 'bg-status-unmatched/10 text-status-unmatched border border-status-unmatched/25' :
                          'bg-brand-blue/10 text-[#60a5fa] border border-blue-500/25'
                        }`}>
                          {entry.category.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-6 py-5 align-top">{userBox}</td>
                      <td className="px-6 py-5 align-top">{exchangeBox}</td>
                      <td className="px-6 py-5 align-top text-center">
                        {entry.matchScore !== null && entry.matchScore !== undefined ? (
                          <span className={`w-8 h-8 rounded-full inline-flex items-center justify-center font-bold text-xs ${
                            entry.matchScore >= 80 ? 'bg-status-matched/15 text-status-matched border border-status-matched/20' :
                            entry.matchScore >= 40 ? 'bg-status-conflicting/15 text-status-conflicting border border-status-conflicting/20' :
                            'bg-status-unmatched/15 text-status-unmatched border border-status-unmatched/20'
                          }`}>{entry.matchScore}</span>
                        ) : (
                          <span className="text-gray-600">—</span>
                        )}
                      </td>
                      <td className="px-6 py-5 align-top">{diffNotes}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination controls */}
        {totalRecords > limit && (
          <footer className="flex justify-between items-center p-6 border-t border-brand-border bg-white/[0.005]">
            <span className="text-xs text-gray-400 font-semibold">Showing {(page-1)*limit+1} - {Math.min(page*limit, totalRecords)} of {totalRecords} entries (Page {page}/{totalPages})</span>
            <div className="flex gap-3">
              <button disabled={page === 1} onClick={() => handlePageChange(false)} className="px-4 py-2 bg-white/5 border border-brand-border rounded-lg text-xs font-bold text-white hover:bg-white/10 active:translate-y-0 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-white/5 transition-all"><ChevronLeft className="w-3.5 h-3.5 mr-1 inline" /> Previous</button>
              <button disabled={page === totalPages} onClick={() => handlePageChange(true)} className="px-4 py-2 bg-white/5 border border-brand-border rounded-lg text-xs font-bold text-white hover:bg-white/10 active:translate-y-0 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-white/5 transition-all">Next <ChevronRight className="w-3.5 h-3.5 ml-1 inline" /></button>
            </div>
          </footer>
        )}
      </section>

    </div>
  );
}

function renderRecordBox(record) {
  if (!record) return <span className="text-gray-500 italic">None Ingested</span>;
  
  let dateText = 'Invalid Timestamp';
  if (record.timestamp) {
    try {
      dateText = new Date(record.timestamp).toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
    } catch {
      dateText = record.timestamp;
    }
  }

  const txId = record.txHash || record.exchangeId || record.transaction_id || record.tx_hash || 'No ID';

  return (
    <div className="flex flex-col gap-1">
      <div className="font-mono text-[10px] font-semibold text-white bg-white/5 px-2 py-0.5 rounded w-fit max-w-[170px] truncate" title={txId}>{txId}</div>
      <span className="text-[11px] text-gray-400">Time: <strong className="text-white">{dateText}</strong></span>
      <span className="text-[11px] text-gray-400">Asset: <strong className="text-white">{record.asset || 'N/A'}</strong></span>
      <span className="text-[11px] text-gray-400">Type: <strong className="text-white">{record.type || 'N/A'}</strong></span>
      <span className="text-[11px] text-gray-400">Qty: <strong className="text-white">{record.quantity || '0'}</strong></span>
    </div>
  );
}

function renderAuditNotes(entry) {
  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-white leading-relaxed font-semibold">{entry.reason}</p>
      
      {entry.category === 'CONFLICTING' && entry.conflictDetails && entry.conflictDetails.length > 0 && (
        <div className="flex flex-col gap-1.5 p-3 bg-black/30 border border-brand-border rounded-xl">
          {entry.conflictDetails.map((diff, idx) => (
            <div key={idx} className="text-[10px] flex flex-wrap gap-1.5 items-center">
              <span className="font-bold text-gray-400"><ArrowRight className="w-3 h-3 text-brand-blue inline mr-0.5" /> {diff.field}:</span>
              <span className="text-status-unmatched line-through">{diff.userValue || 'N/A'}</span>
              <i className="fa-solid fa-arrow-right-long text-gray-500"></i>
              <span className="text-status-matched font-bold">{diff.exchangeValue || 'N/A'}</span>
              {diff.delta && <span className="text-brand-cyan font-bold">({diff.delta})</span>}
            </div>
          ))}
        </div>
      )}

      {/* User Flags */}
      {entry.userRecord && entry.userRecord.qualityFlags && entry.userRecord.qualityFlags.length > 0 && (
        <div className="flex flex-col gap-1.5 p-3 bg-status-unmatched/5 border border-status-unmatched/15 rounded-xl text-status-unmatched">
          <div className="text-[10px] flex items-center gap-1.5 flex-wrap">
            <strong><i className="fa-solid fa-circle-exclamation mr-0.5"></i> Ingestion Quality Flags:</strong>
            {entry.userRecord.qualityFlags.map((f, i) => (
              <code key={i} className="bg-white/5 px-1.5 py-0.5 rounded font-mono text-[9px]">{f}</code>
            ))}
          </div>
        </div>
      )}

      {/* Exchange Flags */}
      {entry.exchangeRecord && entry.exchangeRecord.qualityFlags && entry.exchangeRecord.qualityFlags.length > 0 && (
        <div className="flex flex-col gap-1.5 p-3 bg-status-unmatched/5 border border-status-unmatched/15 rounded-xl text-status-unmatched">
          <div className="text-[10px] flex items-center gap-1.5 flex-wrap">
            <strong><i className="fa-solid fa-circle-exclamation mr-0.5"></i> Ingestion Quality Flags:</strong>
            {entry.exchangeRecord.qualityFlags.map((f, i) => (
              <code key={i} className="bg-white/5 px-1.5 py-0.5 rounded font-mono text-[9px]">{f}</code>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
