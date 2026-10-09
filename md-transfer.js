/* ==========================================================================
   Eucalculia Fork — Transfer & mastery layer
   ---------------------------------------------------------------------------
   A fork of Eucalculia by Alberto Flaño Lombardo, built with his permission.
   Ideas and changes in this fork: mighty_elf and .da.rk. (Discord).

   What this layer adds (all rules, no new content generators; every piece is a
   toggle in Settings → Progression → Transfer & mastery):

     1. Multiple short exposure staircases (Hung & Seitz 2014; Ahissar &
        Hochstein 1997): every block starts with four easy lead-in trials
        (exposure ×2 → ×1.2 back to threshold), ~20 % of the other trials are
        clearly suprathreshold, and each visual format carries its own exposure
        offset on top of the global staircase, so formats you read slowly get
        more time and fast ones less. Target: perceptual learning that does not
        stay specific to one format / one exposure.
     2. Rotating held-out transfer probes (Raviv, Lupyan & Green 2022; Dahlin
        et al. 2008): two formats are kept out of training; every 6th relational
        block is a PROBE block on those formats only. Transfer index = probe
        accuracy − trained accuracy. In Staircase mode a lagging probe (< −10
        points) blocks the next tier and tightens the format-coverage cap until
        the next probe. Hold-outs rotate every 40 relational blocks.
     3. Format coverage & weakness bias: no format above ~15 % of recent
        trials; formats read worse or not seen for days are drawn more often.
     4. Focus blocks (variable-priority training; Gopher, Weil & Bareket 1994;
        Kramer, Larish & Strayer 1995): every 4th relational block asks for
        SPEED or ACCURACY and scores it accordingly.
     5. Divided-attention marker (ACTIVE / UFOV speed-of-processing training:
        Ball et al. 2002; Edwards et al. 2017): a small marker appears with the
        flash at one of eight peripheral positions; tap where it was before
        answering. The marker shrinks and ■ distractors are added as accuracy
        climbs; misses add exposure time. Off by default.
     6. Calendar & booster guidance (Cepeda et al. 2008; Wang, Zhou & Shah 2014;
        Lampit et al. 2014; ACTIVE boosters): training days, 10-day courses,
        booster suggestions, and a gentle daily soft cap.
   ========================================================================== */
(function(){
  "use strict";
  if(globalThis.__EUCA_MD_TRANSFER_INSTALLED__) return;
  globalThis.__EUCA_MD_TRANSFER_INSTALLED__ = true;

  const STORAGE_PREFIX = "euca:md:xfer:v1:p";
  const LEADIN_D = [2.0, 1.7, 1.45, 1.2], LEADIN_A = [1.6, 1.4, 1.2, 1.1];
  const EASY_P_D = 0.20, EASY_MULT_D = 1.5, EASY_P_A = 0.15, EASY_MULT_A = 1.3;
  const FMT_K_MIN = -0.30, FMT_K_MAX = 0.45, FMT_UP = 0.08, FMT_DOWN = 0.02;
  const PROBE_EVERY = 6, PROBE_MIN_TRIALS = 8, PROBE_GATE = -0.10, PROBE_GATE_BLOCKS = 12, HOLDOUT_ROTATE_BLOCKS = 40;
  const COVER_CAP = 0.15, COVER_CAP_GATED = 0.10;
  const FOCUS_EVERY = 4, FOCUS_DEADLINE_MS = 3600;
  const DA_DIST = [0, 2, 4], DA_WIN = 20, DA_UP = 0.85, DA_DOWN = 0.60, DA_K_MISS = 0.08, DA_K_HIT = 0.015, DA_K_MAX = 0.6;
  const COURSE_DAYS = 10, DAILY_SOFT_CAP_MIN = 25, BOOSTER_OFFSETS_DAYS = [28, 84], BOOSTER_DAYS = 4;

  const hasState = () => typeof State === "object" && !!State;
  const cfg = () => (typeof CONFIG === "object" && CONFIG) ? CONFIG : {};
  const num = (v, d=0) => Number.isFinite(Number(v)) ? Number(v) : d;
  const clampN = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
  const safe = (fn, fallback) => { try { return fn(); } catch(e){ try { console.warn("[Eucalculia transfer] ", e); } catch(_){} return fallback; } };
  const $ = id => document.getElementById(id);
  function h(tag, attrs, ...children){
    const el = document.createElement(tag);
    if(attrs) for(const [k, v] of Object.entries(attrs)){
      if(v === null || v === undefined || v === false) continue;
      if(k === "class") el.className = v; else if(k === "text") el.textContent = v; else if(k === "html") el.innerHTML = v;
      else if(k === "style") el.style.cssText = v; else if(k === "on"){ for(const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn); }
      else el.setAttribute(k, v === true ? "" : String(v));
    }
    for(const c of children.flat()){ if(c === null || c === undefined || c === false) continue; el.appendChild(typeof c === "string" ? document.createTextNode(c) : c); }
    return el;
  }

  // ---- outermost wrappers (same technique as the other fork layers) ----------
  const FACTORIES = Object.create(null), INSTALLED = Object.create(null), REENTRY = Object.create(null);
  function wrap(name, factory){ FACTORIES[name] = factory; return applyWrap(name); }
  function applyWrap(name){
    const factory = FACTORIES[name], previous = globalThis[name];
    if(typeof factory !== "function" || typeof previous !== "function") return false;
    if(INSTALLED[name] && previous === INSTALLED[name]) return true;
    const inner = factory(previous);
    const wrapped = function(){
      if(REENTRY[name]) return previous.apply(this, arguments);
      REENTRY[name] = true;
      try { return inner.apply(this, arguments); } finally { REENTRY[name] = false; }
    };
    for(const key of Object.keys(previous)){
      if(/Original$/.test(key) || /^__m[dlx]/.test(key)) continue;
      if(typeof previous[key] === "function") continue;
      try { wrapped[key] = previous[key]; } catch(_){}
    }
    try { Object.defineProperty(wrapped, "name", {value:name + "MX"}); } catch(_){}
    wrapped.__mxWrapped = name; wrapped.__mxOriginal = previous;
    globalThis[name] = wrapped; INSTALLED[name] = wrapped;
    return true;
  }
  function reapplyWraps(){ for(const name of Object.keys(FACTORIES)) safe(() => applyWrap(name)); }

  // ------------------------------------------------------------------------
  // State (per profile)
  // ------------------------------------------------------------------------
  const X = {st:null, profile:0, block:null, etCache:new WeakMap(), da:null, _saveTimer:0, audit:false, lastProbe:false};
  function activeProfile(){ return clampN(num(hasState() && State.activeProfile, 1) || 1, 1, 3); }
  function defaultState(){
    return {
      v:1,
      toggles:{shortStairs:true, probes:true, coverage:true, focus:true, da:false, calendar:true},
      fmt:{}, fam:{},
      probes:{holdout:[], order:[], rotations:0, blocksSinceProbe:0, blocksSinceRotation:0, history:[], lastIndex:null, lastProbeBlock:0, relBlocks:0},
      da:{ecc:0, dist:0, k:0, win:[], total:0, hits:0},
      focus:{counter:0, history:[]},
      calendar:{days:{}, courses:[], boostersDone:[]},
      recent:[],
      rtHist:{0:[], 1:[], 2:[], 3:[]},
      savedAt:0
    };
  }
  function st(){
    const p = activeProfile();
    if(X.st && X.profile === p) return X.st;
    const base = defaultState();
    let saved = null;
    try { const raw = localStorage.getItem(STORAGE_PREFIX + p); if(raw) saved = JSON.parse(raw); } catch(_){ saved = null; }
    if(saved && typeof saved === "object"){
      X.st = {...base, ...saved,
        toggles:{...base.toggles, ...(saved.toggles || {})}, fmt:{...(saved.fmt || {})}, fam:{...(saved.fam || {})},
        probes:{...base.probes, ...(saved.probes || {})}, da:{...base.da, ...(saved.da || {})}, focus:{...base.focus, ...(saved.focus || {})},
        calendar:{...base.calendar, ...(saved.calendar || {}), days:{...((saved.calendar || {}).days || {})}},
        recent:Array.isArray(saved.recent) ? saved.recent.slice(-200) : [],
        rtHist:{...base.rtHist, ...((saved.rtHist && typeof saved.rtHist === "object") ? saved.rtHist : {})}};
      if(!Array.isArray(X.st.probes.holdout)) X.st.probes.holdout = [];
      if(!Array.isArray(X.st.probes.history)) X.st.probes.history = [];
      if(!Array.isArray(X.st.da.win)) X.st.da.win = [];
    } else X.st = base;
    X.profile = p;
    return X.st;
  }
  function saveNow(){ try { const s = st(); s.savedAt = Date.now(); localStorage.setItem(STORAGE_PREFIX + X.profile, JSON.stringify(s)); return true; } catch(_){ return false; } }
  function save(){ if(X._saveTimer) return; X._saveTimer = setTimeout(() => { X._saveTimer = 0; saveNow(); }, 700); }
  function T(){ return st().toggles; }
  function block(){ if(!X.block) X.block = {probe:false, focus:null, startedAt:Date.now(), trials:[], daTotal:0, daHits:0, logged:false}; return X.block; }

  const prog = () => globalThis.EUCA_PROGRESSION || null;
  function newModes(){ const p = prog(); return !!(p && p.state && p.state.mode !== "baseline"); }
  // the layer only shapes live play: never Alberto's audits, prewarms or menu-time generators
  function livePlay(){ return hasState() && !!State.running && !X.audit && State.status !== "MENU" && State.status !== "SUMMARY"; }
  function relational(){ return hasState() && State.mode === "D" && !!(State.autoCurriculum && State.autoCurriculum.reachedRelational); }
  const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };
  const dayNum = key => Math.round(new Date(key + "T12:00:00").getTime() / 86400000);

  // ------------------------------------------------------------------------
  // Trial classification helpers
  // ------------------------------------------------------------------------
  function info(){ return (hasState() && State.trialInfo) || {}; }
  const VISUAL_REPS = ["dots","cluster","ten","dice","domino","tally","finger","abacus","card","cube","coins","roman","clock","grid"];
  const VISUAL_SET = new Set(VISUAL_REPS.concat(["digit"]));
  function repsOf(i){
    const out = [];
    for(const r of [i.repA, i.repB, i.rep, i.requiredRep]) if(r && typeof r === "string" && VISUAL_SET.has(r) && !out.includes(r)) out.push(r);
    if(!out.length && hasState() && State.currentTrialRep && VISUAL_SET.has(State.currentTrialRep)) out.push(State.currentTrialRep);
    return out;
  }
  function isSingleA(i){ return i.statsMode === "A" || i.renderMode === "single" || i.autoPhase === "1A" || i.autoPhase === "1B"; }
  function isL0Pair(i){ return hasState() && State.mode === "D" && num(State.currentTrialLevel, 0) === 0 && !isSingleA(i) && (i.kind === "posner" || i.kind === "scalar_witness_inline") && !i.visualPredict && !i.paperFolding && !i.generativeInline && !i.xrepPhase; }
  function chanceOf(panel, i){
    if(panel === "bool") return 0.5;
    if(panel === "choice"){ const n = Array.isArray(i.options) ? i.options.length : 4; return num(i.requiredSelections, 1) > 1 ? 0.1 : 1 / Math.max(2, n); }
    return 0;
  }
  function familyOf(i){ return String(i.family || i.catFamily || i.canonicalFamily || i.sourceFamily || "") || null; }

  // ------------------------------------------------------------------------
  // 1. Multiple short exposure staircases + per-format offsets + DA time
  // ------------------------------------------------------------------------
  function etPlan(i){
    // cached per trial so currentET() stays constant while the flash runs
    if(!i || typeof i !== "object") return {lead:1, easy:false};
    let plan = X.etCache.get(i);
    if(plan) return plan;
    const a = isSingleA(i);
    const idx = num(hasState() && State.blockTrials, 0);
    let lead = 1, easy = false;
    if(idx < 4){ lead = (a ? LEADIN_A : LEADIN_D)[idx]; easy = true; }
    else if(Math.random() < (a ? EASY_P_A : EASY_P_D)){ lead = a ? EASY_MULT_A : EASY_MULT_D; easy = true; }
    plan = {lead, easy};
    X.etCache.set(i, plan);
    return plan;
  }
  function fmtOffset(reps){
    let k = 0;
    for(const r of reps){ const f = st().fmt[r]; if(f) k = Math.max(k, num(f.k, 0)); }
    if(reps.length && k === 0){ for(const r of reps){ const f = st().fmt[r]; if(f) k = Math.min(k, num(f.k, 0)); } }
    return k;
  }
  wrap("currentET", previous => function currentETMX(){
    const base = previous.apply(this, arguments);
    try {
      if(!newModes() || !livePlay()) return base;
      const i = info();
      if(!i || !Object.keys(i).length) return base;
      const a = isSingleA(i);
      const mode = a ? "A" : "D";
      const startET = num(cfg().startETByMode && cfg().startETByMode[mode], a ? 750 : 1330);
      const minET = num(cfg().minETByMode && cfg().minETByMode[mode], a ? 70 : 600);
      let mult = 1;
      if(T().shortStairs){
        const plan = etPlan(i);
        mult *= plan.lead;
        if(!a && isL0Pair(i)) mult *= Math.exp(fmtOffset(repsOf(i)));
      }
      if(T().da && X.da && X.da.info === i) mult *= Math.exp(num(st().da.k, 0));
      if(mult === 1) return base;
      return clampN(base * mult, minET, Math.max(startET, base));
    } catch(_){ return base; }
  });

  // Alberto's audit suite must see his generators unfiltered
  for(const name of ["runFeatureAudit", "auditL0CrossRepProjection", "auditConstructiveGenerationRuntime", "auditVisualReplayContractCoverage", "auditAutoTransformReplayFidelity"]){
    wrap(name, previous => function auditPassthroughMX(){
      const prior = X.audit; X.audit = true;
      try { return previous.apply(this, arguments); } finally { X.audit = prior; }
    });
  }

  // ------------------------------------------------------------------------
  // Outcome accounting (one call per answered trial)
  // ------------------------------------------------------------------------
  // ---- RT fairness: a per-trial time budget = trial-type target + reading time ----
  // Alberto's targets (rtGood 1.8 s for L0, 3.8 / 6.5 / 9 s for META¹/²/³) assume the
  // question is parsed instantly. Long, nested wordings are read at ~4 words/s, so the
  // budget adds 220 ms per word beyond the first eight (question + half the option text).
  const READ_MS_PER_WORD = 220, READ_FREE_WORDS = 8;
  function wordCount(text){ return String(text || "").trim().split(/\s+/).filter(Boolean).length; }
  function questionWords(i){
    let w = wordCount(i.question || i.delayedPrompt || i.relationQuestion || "");
    if(Array.isArray(i.options)) w += Math.round(i.options.reduce((n, o) => n + wordCount(typeof o === "string" ? o : (o && (o.text || o.label)) || ""), 0) / 2);
    return w;
  }
  function rtTarget(level){ return safe(() => (typeof trialGoodRT === "function" ? num(trialGoodRT(level, State.mode), 1800) : 1800), 1800); }
  function rtBudget(i, level){ return rtTarget(level) + READ_MS_PER_WORD * Math.max(0, questionWords(i) - READ_FREE_WORDS); }
  function median(arr){ if(!arr.length) return null; const a = arr.slice().sort((x, y) => x - y); const m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; }
  function usualRT(level){ const h = (st().rtHist || {})[level] || []; return h.length >= 6 ? median(h) : null; }
  const fmtS = ms => `${(num(ms, 0) / 1000).toFixed(1)} s`;

  function recordOutcome(correct, rt){
    if(!hasState()) return;
    const i = info();
    const reps = repsOf(i);
    const panel = String(State.pendingPanel || "");
    const plan = X.etCache.get(i) || {easy:false};
    const l0 = isL0Pair(i);
    const b = block();
    const probeTrial = !!(b.probe && l0 && reps.length && reps.every(r => holdoutSet().has(r)));
    const lvl = num(State.currentTrialLevel, 0);
    const words = questionWords(i);
    const rec = {c:!!correct, rt:num(rt, 0), p:panel, ch:chanceOf(panel, i), reps, l0, a:isSingleA(i), probe:probeTrial, easy:!!plan.easy, lvl, t:Date.now(),
                 words, target:rtTarget(lvl), budget:rtBudget(i, lvl)};
    if(correct && !rec.a && num(rt, 0) > 0){ const H = st().rtHist || (st().rtHist = {0:[],1:[],2:[],3:[]}); const arr = H[lvl] || (H[lvl] = []); arr.push(num(rt, 0)); if(arr.length > 60) arr.splice(0, arr.length - 60); }
    b.trials.push(rec);
    const s = st();
    if(newModes()){
      if(l0 && !isSingleA(i)){
        for(const r of reps){
          const f = s.fmt[r] || (s.fmt[r] = {k:0, t:0, c:0, seen:0});
          f.t++; if(correct) f.c++; f.seen = Date.now();
          if(T().shortStairs) f.k = clampN(num(f.k, 0) + (correct ? -FMT_DOWN * (plan.easy ? 0.5 : 1) : FMT_UP), FMT_K_MIN, FMT_K_MAX);
        }
      }
      const fam = familyOf(i);
      if(fam && l0){ const g = s.fam[fam] || (s.fam[fam] = {t:0, c:0, last:0}); g.t++; if(correct) g.c++; g.last = Date.now(); }
      if(State.mode === "D"){ s.recent.push({c:!!correct, reps, l0, probe:probeTrial, t:Date.now()}); if(s.recent.length > 200) s.recent.splice(0, s.recent.length - 200); }
    }
    if(X.da && X.da.info === i && X.da.answered === null) daResolve(false, "unanswered");
    save();
  }
  wrap("completeRuntimeProbe", previous => function completeRuntimeProbeMX(correct, rt){
    const out = previous.apply(this, arguments);
    safe(() => recordOutcome(correct, rt));
    return out;
  });

  // ------------------------------------------------------------------------
  // 2. Held-out transfer probes
  // ------------------------------------------------------------------------
  function enabledReps(){
    const on = safe(() => Array.from(document.querySelectorAll(".repChip.on")).map(c => c.dataset.rep).filter(r => VISUAL_REPS.includes(r)), []);
    return on.length >= 4 ? on : VISUAL_REPS.slice();
  }
  function shuffle(a){ for(let i = a.length - 1; i > 0; i--){ const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  function ensureHoldout(){
    const P = st().probes;
    const pool = enabledReps();
    if(!Array.isArray(P.order) || !P.order.length) P.order = shuffle(pool.slice());
    for(const r of pool) if(!P.order.includes(r)) P.order.push(r);
    const valid = P.holdout.filter(r => pool.includes(r));
    if(valid.length < 2){
      const next = P.order.filter(r => pool.includes(r) && !valid.includes(r)).slice(0, 2 - valid.length);
      P.holdout = valid.concat(next);
    }
    return P.holdout;
  }
  function holdoutSet(){ return new Set(T().probes ? ensureHoldout() : []); }
  function rotateHoldout(reason){
    const P = st().probes;
    const pool = enabledReps();
    const order = P.order.filter(r => pool.includes(r));
    if(order.length < 4) return P.holdout;
    const idx = Math.max(...P.holdout.map(r => order.indexOf(r)), -1);
    const next = [];
    for(let n = 1; next.length < 2 && n <= order.length; n++){ const r = order[(idx + n) % order.length]; if(!P.holdout.includes(r) && !next.includes(r)) next.push(r); }
    P.history.push({at:Date.now(), rotation:true, from:P.holdout.slice(), to:next.slice(), reason:reason || "rotation"});
    P.holdout = next; P.rotations = num(P.rotations, 0) + 1; P.blocksSinceRotation = 0; P.lastIndex = null;
    saveNow();
    return P.holdout;
  }
  wrap("allowedReps", previous => function allowedRepsMX(v){
    const list = previous.apply(this, arguments);
    try {
      if(!T().probes || !newModes() || !livePlay() || State.mode !== "D" || !Array.isArray(list)) return list;
      const hold = holdoutSet();
      if(!hold.size) return list;
      if(block().probe){ const only = list.filter(r => hold.has(r)); return only.length ? only : list; }
      const rest = list.filter(r => !hold.has(r));
      return rest.length >= 2 ? rest : list;
    } catch(_){ return list; }
  });
  function isProbeTrial(){
    const b = X.block; if(!b || !b.probe) return false;
    const i = info(); const reps = repsOf(i);
    return isL0Pair(i) && reps.length > 0 && reps.every(r => holdoutSet().has(r));
  }
  function trainedAccuracy(){
    const rows = st().recent.filter(r => r.l0 && !r.probe).slice(-60);
    if(rows.length < 20) return null;
    return rows.filter(r => r.c).length / rows.length;
  }
  function closeProbeBlock(){
    const b = block(); if(!b.probe) return null;
    const P = st().probes;
    const rows = b.trials.filter(r => r.probe);
    if(rows.length < PROBE_MIN_TRIALS){ P.history.push({at:Date.now(), skipped:true, n:rows.length}); return null; }
    const acc = rows.filter(r => r.c).length / rows.length;
    const trained = trainedAccuracy();
    const index = trained === null ? null : acc - trained;
    const entry = {at:Date.now(), n:rows.length, acc, trained, index, holdout:P.holdout.slice(), tier:num(State.levelByMode && State.levelByMode.D, 0)};
    P.history.push(entry); if(P.history.length > 80) P.history.splice(0, P.history.length - 80);
    P.lastIndex = index; P.lastProbeBlock = num(P.relBlocks, 0);
    return entry;
  }
  function gated(){
    const P = st().probes;
    return T().probes && newModes() && P.lastIndex !== null && P.lastIndex < PROBE_GATE && (num(P.relBlocks, 0) - num(P.lastProbeBlock, 0)) < PROBE_GATE_BLOCKS;
  }

  // ------------------------------------------------------------------------
  // 3. Format coverage cap + weakness / staleness bias
  // ------------------------------------------------------------------------
  function repShares(){
    const rows = st().recent.filter(r => r.l0).slice(-100);
    const counts = {}; let total = 0;
    for(const r of rows) for(const rep of (r.reps || [])){ counts[rep] = (counts[rep] || 0) + 1; total++; }
    return {counts, total};
  }
  function repWeight(rep, shares){
    const f = st().fmt[rep];
    const acc = f && f.t >= 6 ? f.c / f.t : 0.85;
    const days = f && f.seen ? (Date.now() - f.seen) / 86400000 : 3;
    const share = shares.total ? (shares.counts[rep] || 0) / shares.total : 0;
    return (1 + 2 * (1 - acc)) * (1 + Math.min(3, days / 2)) / (1 + 4 * share);
  }
  function weightedPick(list, w){
    let sum = 0; const ws = list.map(r => { const x = Math.max(0.01, w(r)); sum += x; return x; });
    let u = Math.random() * sum;
    for(let i = 0; i < list.length; i++){ u -= ws[i]; if(u <= 0) return list[i]; }
    return list[list.length - 1];
  }
  wrap("pickVisual", previous => function pickVisualMX(v, modeOverride){
    const vis = previous.apply(this, arguments);
    try {
      if(!T().coverage || !newModes() || !livePlay() || (modeOverride || State.mode) !== "D" || !relational()) return vis;
      const reps = (typeof allowedReps === "function" ? allowedReps(v) : []).filter(r => r !== "digit");
      if(!vis || !vis.rep || reps.length < 2) return vis;
      const shares = repShares();
      if(shares.total < 30) return vis;
      const share = (shares.counts[vis.rep] || 0) / shares.total;
      const cap = gated() ? COVER_CAP_GATED : COVER_CAP;
      let pick = vis.rep;
      if(share > cap && Math.random() < 0.8) pick = weightedPick(reps.filter(r => r !== vis.rep), r => repWeight(r, shares));
      else if(Math.random() < 0.25) pick = weightedPick(reps, r => repWeight(r, shares));
      if(pick !== vis.rep && typeof makeVisualInstance === "function") return makeVisualInstance(v, pick);
    } catch(_){}
    return vis;
  });

  // ------------------------------------------------------------------------
  // 4. Focus (variable-priority) blocks
  // ------------------------------------------------------------------------
  function focusScore(b){
    const rows = b.trials.filter(r => r.l0 || r.lvl > 0 || !r.a);
    if(!rows.length) return null;
    const n = rows.length, c = rows.filter(r => r.c).length;
    const med = rows.map(r => r.rt).sort((x, y) => x - y)[Math.floor(n / 2)];
    if(b.focus === "speed"){
      const s = rows.reduce((acc, r) => acc + (r.c ? 60 + 40 * (1 - clampN(r.rt / FOCUS_DEADLINE_MS, 0, 1)) : 0), 0) / n;
      return {score:Math.round(s), acc:c / n, med};
    }
    const s = 100 * clampN((c - (n - c)) / n, 0, 1);
    return {score:Math.round(s), acc:c / n, med};
  }

  // ------------------------------------------------------------------------
  // 5. Divided-attention marker (UFOV-style)
  // ------------------------------------------------------------------------
  // Eight fixed peripheral spots in the frame margins (corners, mid-edges) — the only
  // regions the stimuli never fill. Difficulty scales the marker (size, contrast) and
  // adds ■ distractors rather than moving the target into the stimulus area.
  const DA_SPOTS = [[0.07,0.14],[0.50,0.08],[0.93,0.14],[0.96,0.50],[0.93,0.84],[0.50,0.90],[0.07,0.84],[0.04,0.50]];
  const DA_SIZE = [11, 9, 7], DA_FILL = ["#ffffff", "#d0cde0", "#a3a0b8"];
  function daPositions(w, hgt){ return DA_SPOTS.map(([fx, fy]) => ({x:w * fx, y:hgt * fy})); }
  function daEligible(i){
    if(!T().da || !newModes() || !hasState() || State.mode !== "D") return false;
    if(!i || !Object.keys(i).length) return false;
    if(i.visualPredict || i.paperFolding || i.generativeInline || i.xrepPhase || i.inductiveConstructive) return false;
    if(num(State.currentTrialLevel, 0) > 0) return false;
    return isL0Pair(i) || (isSingleA(i) && i.renderMode === "single");
  }
  function daStart(i){
    if(!daEligible(i)){ X.da = null; return; }
    const D = st().da;
    const distN = DA_DIST[clampN(num(D.dist, 0), 0, 2)];
    const idx = Math.floor(Math.random() * 8);
    const others = shuffle([0,1,2,3,4,5,6,7].filter(k => k !== idx)).slice(0, distN);
    X.da = {info:i, idx, distractors:others, lvl:clampN(num(D.ecc, 0), 0, 2), answered:null, shown:false, startedAt:0};
  }
  function drawGlyph(c, x, y, size, target, fill){
    c.save();
    c.lineJoin = "round";
    c.shadowColor = "rgba(0,0,0,0.9)"; c.shadowBlur = 6;
    c.fillStyle = fill || "#e9e6ff"; c.strokeStyle = "rgba(0,0,0,0.85)"; c.lineWidth = 2;
    c.beginPath();
    if(target){ c.moveTo(x, y - size); c.lineTo(x + size * 0.95, y + size * 0.75); c.lineTo(x - size * 0.95, y + size * 0.75); c.closePath(); }
    else { c.rect(x - size * 0.8, y - size * 0.8, size * 1.6, size * 1.6); }
    c.fill(); c.stroke();
    c.restore();
  }
  wrap("draw", previous => function drawMX(){
    const out = previous.apply(this, arguments);
    try {
      const d = X.da;
      if(!d || !hasState() || State.status !== "FLASH" || d.info !== State.trialInfo) return out;
      if(typeof ctx === "undefined" || !ctx || !State.mainCache) return out;
      const gc = $("game-container");
      if(gc && gc.dataset.renderOwner === "dom") return out;
      const dpr = num(typeof DPR !== "undefined" ? DPR : 1, 1) || 1;
      const w = ctx.canvas.width / dpr, hgt = ctx.canvas.height / dpr;
      const pos = daPositions(w, hgt);
      const size = DA_SIZE[d.lvl] * (Math.min(w, hgt) < 420 ? 0.85 : 1);
      for(const k of d.distractors) drawGlyph(ctx, pos[k].x, pos[k].y, size, false, DA_FILL[d.lvl]);
      drawGlyph(ctx, pos[d.idx].x, pos[d.idx].y, size, true, DA_FILL[d.lvl]);
      d.shown = true;
    } catch(_){}
    return out;
  });
  function daOverlay(){
    let ov = $("mdDaOverlay");
    if(ov) return ov;
    const gc = $("game-container"); if(!gc) return null;
    ov = h("div", {id:"mdDaOverlay", "aria-label":"Where was the marker?"});
    const label = h("div", {class:"mx-da-label", text:"Tap the ▲ spot · then answer"});
    ov.appendChild(label);
    for(let k = 0; k < 8; k++){
      const btn = h("button", {type:"button", class:"mx-da-spot", "data-k":String(k), "aria-label":`Marker position ${k + 1}`});
      btn.addEventListener("click", ev => { ev.preventDefault(); ev.stopPropagation(); daAnswer(k); });
      btn.addEventListener("pointerdown", ev => ev.stopPropagation());
      ov.appendChild(btn);
    }
    gc.appendChild(ov);
    return ov;
  }
  function daShowOverlay(){
    const d = X.da; if(!d || !d.shown || d.answered !== null) return;
    const ov = daOverlay(); if(!ov) return;
    const gc = $("game-container");
    const w = gc.clientWidth, hgt = gc.clientHeight;
    const pos = daPositions(w, hgt);
    ov.querySelectorAll(".mx-da-spot").forEach((btn, k) => { btn.style.left = `${pos[k].x}px`; btn.style.top = `${pos[k].y}px`; btn.classList.remove("hit", "miss", "target"); });
    ov.classList.add("visible");
    d.startedAt = Date.now();
  }
  function daHideOverlay(){ const ov = $("mdDaOverlay"); if(ov) ov.classList.remove("visible"); }
  function daAnswer(k){
    const d = X.da; if(!d || d.answered !== null) return;
    d.answered = k;
    const ov = $("mdDaOverlay");
    if(ov){ const spots = ov.querySelectorAll(".mx-da-spot"); spots[k].classList.add(k === d.idx ? "hit" : "miss"); if(k !== d.idx) spots[d.idx].classList.add("target"); }
    daResolve(k === d.idx, "tap");
    setTimeout(daHideOverlay, k === d.idx ? 220 : 650);
  }
  function daResolve(hit, how){
    const d = X.da; if(!d || d.resolved) return;
    d.resolved = true;
    if(!d.shown) return;                               // marker never painted (dom-rendered trial): no score
    const D = st().da, b = block();
    D.total = num(D.total, 0) + 1; if(hit) D.hits = num(D.hits, 0) + 1;
    b.daTotal++; if(hit) b.daHits++;
    D.win.push(!!hit); if(D.win.length > DA_WIN) D.win.splice(0, D.win.length - DA_WIN);
    D.k = clampN(num(D.k, 0) + (hit ? -DA_K_HIT : DA_K_MISS), 0, DA_K_MAX);
    if(D.win.length >= DA_WIN){
      const acc = D.win.filter(Boolean).length / D.win.length;
      if(acc >= DA_UP){ if(D.ecc < 2) D.ecc++; else if(D.dist < 2) D.dist++; D.win = []; }
      else if(acc < DA_DOWN){ if(D.dist > 0) D.dist--; else if(D.ecc > 0) D.ecc--; D.win = []; }
    }
    save();
  }
  function daLevelLabel(){ const D = st().da; return `marker level ${clampN(num(D.ecc,0),0,2)+1}/3 · distractors ${DA_DIST[clampN(num(D.dist,0),0,2)]}`; }

  // ------------------------------------------------------------------------
  // Status hook: block start / PREP / INPUT / end-of-trial
  // ------------------------------------------------------------------------
  wrap("showRT", previous => function showRTMX(rt, correct){
    const out = previous.apply(this, arguments);
    try {
      if(!correct || !hasState()) return out;
      const el = $("rtDisplay"); if(!el) return out;
      const lvl = num(State.currentTrialLevel, 0), i = info();
      const target = rtTarget(lvl), budget = rtBudget(i, lvl);
      if(num(rt, 0) >= target && num(rt, 0) <= budget){ el.style.color = "var(--ok)"; el.textContent = `${Math.round(num(rt, 0))}ms ✓`; }
    } catch(_){}
    return out;
  });
  wrap("setStatus", previous => function setStatusMX(status){
    const out = previous.apply(this, arguments);
    try {
      if(status === "PREP"){ daHideOverlay(); daStart(info()); }
      else if(status === "INPUT"){ if(X.da && X.da.info === State.trialInfo) daShowOverlay(); }
      else if(status === "FLASH" || status === "MASK"){ /* nothing */ }
      else { if(X.da && X.da.answered === null && X.da.shown && status !== "INPUT") { daResolve(false, status); } daHideOverlay(); }
    } catch(_){}
    return out;
  });

  wrap("resetBlock", previous => function resetBlockMX(){
    const out = previous.apply(this, arguments);
    try {
      // a double-tapped Continue/Start runs resetBlock twice for one block: count it once
      if(X.block && X.block.trials.length === 0 && Date.now() - num(X.block.startedAt, 0) < 1500) return out;
      X.block = {probe:false, focus:null, startedAt:Date.now(), trials:[], daTotal:0, daHits:0, logged:false};
      const b = X.block, s = st(), P = s.probes;
      if(newModes() && relational()){
        P.relBlocks = num(P.relBlocks, 0) + 1;
        P.blocksSinceRotation = num(P.blocksSinceRotation, 0) + 1;
        if(T().probes){
          ensureHoldout();
          if(P.blocksSinceRotation >= HOLDOUT_ROTATE_BLOCKS) rotateHoldout("40 relational blocks");
          P.blocksSinceProbe = num(P.blocksSinceProbe, 0) + 1;
          if(P.blocksSinceProbe >= PROBE_EVERY && holdoutSet().size >= 2){ b.probe = true; P.blocksSinceProbe = 0; }
          // a trial prepared under the previous block's format filter must not leak across the boundary
          if(b.probe !== !!X.lastProbe && typeof invalidatePreparedTrial === "function") safe(() => invalidatePreparedTrial(b.probe ? "md_probe_block" : "md_probe_block_end"));
          X.lastProbe = b.probe;
        }
        if(T().focus && !b.probe){
          s.focus.counter = num(s.focus.counter, 0) + 1;
          if(s.focus.counter % FOCUS_EVERY === 0) b.focus = (Math.floor(s.focus.counter / FOCUS_EVERY) % 2 === 1) ? "speed" : "accuracy";
        }
      }
      save();
    } catch(_){}
    return out;
  });

  // ------------------------------------------------------------------------
  // 6. Calendar & boosters
  // ------------------------------------------------------------------------
  function trainingDays(){ return Object.keys(st().calendar.days).filter(k => num(st().calendar.days[k].blocks, 0) > 0).sort(); }
  function logBlock(){
    const b = block(); if(b.logged) return; b.logged = true;
    const C = st().calendar, key = todayKey();
    const d = C.days[key] || (C.days[key] = {min:0, blocks:0, trials:0});
    d.blocks++; d.trials += b.trials.length;
    d.min = Math.round((num(d.min, 0) + Math.min(12, (Date.now() - num(b.startedAt, Date.now())) / 60000)) * 10) / 10;
    // courses: every 10 distinct training days
    const days = trainingDays();
    const doneDays = C.courses.reduce((n, c) => n + num(c.days, 0), 0);
    const inCourse = days.length - doneDays;
    if(inCourse >= COURSE_DAYS){
      C.courses.push({start:days[doneDays], end:days[days.length - 1], days:COURSE_DAYS, at:Date.now()});
      if(T().probes) rotateHoldout("course complete");
    }
    const keys = Object.keys(C.days).sort();
    if(keys.length > 400) for(const k of keys.slice(0, keys.length - 400)) delete C.days[k];
  }
  function calendarInfo(){
    const C = st().calendar, key = todayKey();
    const today = C.days[key] || {min:0, blocks:0, trials:0};
    const days = trainingDays();
    const tn = dayNum(key);
    const week = days.filter(k => tn - dayNum(k) < 7).length;
    let streak = 0; for(let n = 0; n < 60; n++){ const k = new Date(Date.now() - n * 86400000); const kk = `${k.getFullYear()}-${String(k.getMonth()+1).padStart(2,"0")}-${String(k.getDate()).padStart(2,"0")}`; if(C.days[kk] && C.days[kk].blocks > 0) streak++; else if(n > 0) break; }
    const doneDays = C.courses.reduce((n, c) => n + num(c.days, 0), 0);
    const courseNo = C.courses.length + 1;
    const courseDay = Math.min(COURSE_DAYS, Math.max(0, days.length - doneDays));
    const last = C.courses[C.courses.length - 1] || null;
    const boosters = last ? BOOSTER_OFFSETS_DAYS.map((off, i) => ({due:dayNum(last.end) + off, label:i === 0 ? "1st booster" : "2nd booster"})) : [];
    const sinceLastCourse = last ? tn - dayNum(last.end) : null;
    const tips = [];
    if(today.min >= DAILY_SOFT_CAP_MIN) tips.push(`Today: ${today.min} min — that is a full session. Spacing across days beats long sessions; tomorrow again.`);
    if(streak >= 6) tips.push("Six days in a row. A rest day costs nothing and consolidation happens between sessions.");
    if(last && sinceLastCourse !== null && sinceLastCourse <= 4 && courseDay <= 1) tips.push(`Course ${C.courses.length} complete (${COURSE_DAYS} training days). A few days off before continuing is fine — and a 4-session booster around ${dateLabel(boosters[0].due)} is what the ACTIVE trial's speed training did.`);
    for(const bst of boosters){ if(tn >= bst.due && tn - bst.due <= 21) tips.push(`${bst.label} due: ${BOOSTER_DAYS} short sessions this week or next keep the trained speed alive.`); }
    if(week === 0 && days.length > 5) tips.push("No training this week yet — 3 to 5 short days a week is the target.");
    return {today, week, streak, days:days.length, courseNo, courseDay, last, boosters, tips};
  }
  function dateLabel(dn){ const d = new Date(dn * 86400000); return d.toLocaleDateString(undefined, {month:"short", day:"numeric"}); }

  // ------------------------------------------------------------------------
  // Block end: probe result, focus score, calendar log; summary HTML
  // ------------------------------------------------------------------------
  let lastSummary = null;
  function fairRTTile(b){
    const rtEl = $("sumRT"); if(!rtEl) return;
    const rows = b.trials.filter(r => !r.a && r.rt > 0);
    if(rows.length < 3) return;
    const byLevel = {};
    for(const r of rows){ (byLevel[r.lvl] = byLevel[r.lvl] || []).push(r); }
    const levels = Object.keys(byLevel).map(Number).sort((x, y) => x - y);
    const names = {0:"L0", 1:"META¹", 2:"META²", 3:"META³"};
    const main = byLevel[0] ? 0 : levels[0];
    const medMain = median(byLevel[main].map(r => r.rt));
    const correctRows = rows.filter(r => r.c);
    const within = correctRows.length ? correctRows.filter(r => r.rt <= r.budget).length / correctRows.length : 0;
    const usual = usualRT(main);
    const parts = levels.filter(l => l !== main).map(l => `${names[l] || "L" + l} ${fmtS(median(byLevel[l].map(r => r.rt)))}`);
    const usualTxt = usual ? ` · usual ${fmtS(usual)}` : "";
    const val = rtEl.querySelector(".stat-value"), lab = rtEl.querySelector(".stat-label"), sub = rtEl.querySelector(".stat-sub");
    if(val) val.textContent = fmtS(medMain);
    if(lab) lab.textContent = `Median RT · ${names[main] || "L" + main}`;
    if(sub) sub.textContent = `${parts.length ? parts.join(" · ") + " · " : ""}${Math.round(within * 100)}% in budget${usualTxt}`;
    rtEl.title = "Budget per trial = the trial type's target (L0 1.8 s, META¹ 3.8 s, META² 6.5 s, META³ 9 s) + 220 ms per word of question text beyond the first eight. Colour compares you with your own usual pace, not with a single number.";
    rtEl.classList.remove("good", "warn", "bad");
    const vsUsual = usual ? medMain / usual : 1;
    rtEl.classList.add((within >= 0.65 || vsUsual <= 1.05) ? "good" : ((within >= 0.4 || vsUsual <= 1.3) ? "warn" : "bad"));
  }
  wrap("showBlockSummary", previous => function showBlockSummaryMX(){
    const out = previous.apply(this, arguments);
    try {
      const b = block();
      safe(() => fairRTTile(b));
      const parts = [];
      if(newModes()){
        const probe = closeProbeBlock();
        if(probe){
          const idx = probe.index === null ? "" : ` · transfer index ${probe.index >= 0 ? "+" : ""}${Math.round(probe.index * 100)} pts`;
          parts.push(`🧪 <b>Probe block</b> (${probe.holdout.map(prettyRep).join(" + ")}): ${Math.round(probe.acc * 100)}% on untrained formats${probe.trained !== null ? ` vs ${Math.round(probe.trained * 100)}% trained` : ""}${idx}${gated() ? " · tier advance held until the next probe" : ""}`);
        }
        if(b.focus){
          const fs = focusScore(b);
          if(fs){ st().focus.history.push({at:Date.now(), kind:b.focus, ...fs}); if(st().focus.history.length > 60) st().focus.history.splice(0, st().focus.history.length - 60);
            parts.push(`${b.focus === "speed" ? "⚡ <b>Speed block</b>" : "🎯 <b>Accuracy block</b>"}: score ${fs.score} (accuracy ${Math.round(fs.acc * 100)}%, median RT ${(fs.med / 1000).toFixed(1)} s)`); }
        }
        if(T().da && b.daTotal) parts.push(`🎯 Marker: ${b.daHits}/${b.daTotal} · ${daLevelLabel()}`);
      }
      if(T().calendar){ logBlock(); const ci = calendarInfo(); if(ci.tips.length) parts.push(`📅 ${esc(ci.tips[0])}`); }
      lastSummary = parts;
      const line = $("mdSummaryLine");
      if(line && parts.length){
        let extra = $("mdTransferSummary");
        if(!extra){ extra = h("div", {id:"mdTransferSummary", class:"md-summary-line mx-summary"}); line.parentNode.insertBefore(extra, line.nextSibling); }
        extra.innerHTML = parts.join("<br>");
      } else { const extra = $("mdTransferSummary"); if(extra) extra.innerHTML = ""; }
      saveNow();
      renderSection();
    } catch(e){ safe(() => console.warn("[Eucalculia transfer] summary", e)); }
    return out;
  });
  const REP_NAMES = {dots:"Dots", cluster:"Cluster", ten:"Ten-frame", dice:"Dice", domino:"Domino", tally:"Tally", finger:"Fingers", abacus:"Abacus", card:"Cards", cube:"Cubes", coins:"Coins", roman:"Roman", clock:"Clock", grid:"Grid", digit:"Digit"};
  const prettyRep = r => REP_NAMES[r] || r;

  // HUD / intro suffixes consumed by the progression layer
  function hudSuffix(){
    const b = X.block; if(!b || !newModes()) return "";
    if(b.probe) return "🧪 PROBE";
    if(b.focus === "speed") return "⚡ SPEED";
    if(b.focus === "accuracy") return "🎯 ACCURACY";
    return "";
  }
  function introSuffix(){
    const b = X.block; if(!b || !newModes()) return "";
    if(b.probe) return `Probe block · untrained formats (${ensureHoldout().map(prettyRep).join(", ")})`;
    if(b.focus === "speed") return "Focus block · SPEED counts double";
    if(b.focus === "accuracy") return "Focus block · ACCURACY counts double";
    return "";
  }

  // ------------------------------------------------------------------------
  // Settings section
  // ------------------------------------------------------------------------
  const TOGGLES = [
    {id:"shortStairs", name:"Short staircases", sub:"easy lead-in each block · per-format exposure"},
    {id:"probes", name:"Transfer probes", sub:"2 held-out formats · probe block every 6th"},
    {id:"coverage", name:"Format coverage", sub:"cap 15 % · weak & stale formats first"},
    {id:"focus", name:"Focus blocks", sub:"every 4th block: speed or accuracy"},
    {id:"da", name:"Divided-attention marker", sub:"UFOV-style peripheral target · experimental"},
    {id:"calendar", name:"Calendar & boosters", sub:"training days · courses · booster tips"}
  ];
  function statusRows(){
    const s = st(), P = s.probes, rows = [];
    if(!newModes()) rows.push("Available in the Staircase and Rating modes (Baseline keeps Alberto's rules untouched).");
    if(T().probes){
      const hold = ensureHoldout().map(prettyRep).join(" + ");
      const last = P.history.filter(e => !e.skipped && !e.rotation).slice(-1)[0];
      rows.push(`Held-out formats: <b>${esc(hold)}</b> · rotation ${num(P.rotations,0)} · next probe in ${Math.max(0, PROBE_EVERY - num(P.blocksSinceProbe,0))} relational block(s)`);
      if(last) rows.push(`Last probe: ${Math.round(last.acc*100)}% untrained${last.trained !== null ? ` vs ${Math.round(last.trained*100)}% trained · index ${last.index >= 0 ? "+" : ""}${Math.round(last.index*100)} pts` : ""}${gated() ? " · <b>tier advance on hold</b>" : ""}`);
      else rows.push("No probe yet — the first one comes after 6 relational blocks.");
    }
    if(T().shortStairs){
      const fm = Object.entries(s.fmt).filter(([, f]) => f.t >= 6).sort((a, b) => b[1].k - a[1].k);
      if(fm.length) rows.push(`Exposure offsets: slowest ${esc(prettyRep(fm[0][0]))} ×${Math.exp(fm[0][1].k).toFixed(2)} · fastest ${esc(prettyRep(fm[fm.length-1][0]))} ×${Math.exp(fm[fm.length-1][1].k).toFixed(2)}`);
    }
    if(T().da) rows.push(`Marker: ${num(s.da.hits,0)}/${num(s.da.total,0)} lifetime · ${daLevelLabel()} · extra exposure ×${Math.exp(num(s.da.k,0)).toFixed(2)}`);
    if(T().calendar){
      const ci = calendarInfo();
      rows.push(`📅 Today ${ci.today.blocks} block(s) · ${ci.today.min} min · this week ${ci.week} day(s) (aim 3–5) · course ${ci.courseNo}, day ${ci.courseDay}/${COURSE_DAYS}${ci.boosters.length ? ` · ${ci.boosters.map(b => `${b.label} ${dateLabel(b.due)}`).join(", ")}` : ""}`);
      for(const t of ci.tips.slice(0, 2)) rows.push(`<i>${esc(t)}</i>`);
    }
    return rows;
  }
  function renderSection(){
    const sec = $("mdTransferSection"); if(!sec) return;
    sec.querySelectorAll(".mx-toggle").forEach(btn => { btn.setAttribute("aria-pressed", String(!!T()[btn.dataset.t])); });
    const status = sec.querySelector(".mx-status"); if(status) status.innerHTML = statusRows().map(r => `<div>${r}</div>`).join("");
  }
  function installSection(){
    const host = $("mdProgressionSection"); if(!host || $("mdTransferSection")) return;
    const sec = h("div", {id:"mdTransferSection", role:"group", "aria-label":"Transfer and mastery"});
    sec.appendChild(h("div", {class:"md-sec-title"}, h("span", {text:"Transfer & mastery"}), h("span", {class:"md-new", text:"v1.2"})));
    sec.appendChild(h("div", {class:"md-desc", text:"Rules that keep training varied, spaced and slightly above threshold, and that measure how well what you learn carries over to formats you did not train."}));
    const grid = h("div", {class:"mx-toggles"});
    for(const t of TOGGLES){
      const btn = h("button", {type:"button", class:"mx-toggle", "data-t":t.id, "aria-pressed":"false"}, h("span", {class:"mx-t-name", text:t.name}), h("span", {class:"mx-t-sub", text:t.sub}));
      btn.addEventListener("click", ev => { ev.preventDefault(); ev.stopPropagation(); T()[t.id] = !T()[t.id]; if(t.id === "da" && !T().da) daHideOverlay(); saveNow(); renderSection(); });
      grid.appendChild(btn);
    }
    sec.appendChild(grid);
    sec.appendChild(h("div", {class:"mx-status md-status", "aria-live":"polite"}));
    const rot = h("button", {type:"button", class:"md-link-btn", text:"Rotate held-out formats now", on:{click:ev => { ev.preventDefault(); ev.stopPropagation(); rotateHoldout("manual"); renderSection(); }}});
    sec.appendChild(h("div", {class:"md-about-row"}, rot));
    host.appendChild(sec);
    const details = $("settingsPanel"); if(details) details.addEventListener("toggle", () => renderSection());
    renderSection();
  }
  wrap("updateMenu", previous => function updateMenuMX(){ const out = previous.apply(this, arguments); safe(renderSection); return out; });

  // ------------------------------------------------------------------------
  // Public API + boot
  // ------------------------------------------------------------------------
  const api = {
    get state(){ return st(); },
    get toggles(){ return T(); },
    set(name, v){ if(name in T()){ T()[name] = !!v; saveNow(); renderSection(); } return T()[name]; },
    isProbeTrial, blocksTierUp:gated, hudSuffix, introSuffix,
    get block(){ return X.block; },
    rotateHoldout, holdout(){ return ensureHoldout().slice(); },
    calendar:calendarInfo,
    daAnswer, get da(){ return X.da; },
    snapshot(){ const s = st(); return {toggles:{...T()}, holdout:ensureHoldout().slice(), lastIndex:s.probes.lastIndex, gated:gated(), probes:s.probes.history.filter(e => !e.rotation && !e.skipped).length, relBlocks:s.probes.relBlocks, da:{...s.da, win:undefined}, fmt:Object.fromEntries(Object.entries(s.fmt).map(([k, f]) => [k, {k:+num(f.k,0).toFixed(3), t:f.t, c:f.c}])), focus:s.focus.counter, block:X.block ? {probe:X.block.probe, focus:X.block.focus, n:X.block.trials.length} : null, calendar:calendarInfo()}; },
    reset(){ X.st = defaultState(); X.profile = activeProfile(); saveNow(); renderSection(); return X.st; },
    save:saveNow
  };
  try { Object.defineProperty(globalThis, "EUCA_TRANSFER", {value:api, writable:false, configurable:false, enumerable:true}); } catch(_){ globalThis.EUCA_TRANSFER = api; }

  function boot(){
    reapplyWraps();
    st();
    installSection();
    window.addEventListener("load", () => { reapplyWraps(); installSection(); }, {once:true});
    window.addEventListener("beforeunload", saveNow);
    document.addEventListener("visibilitychange", () => { if(document.visibilityState === "hidden") saveNow(); });
    document.documentElement.dataset.eucaMdTransfer = "1";
  }
  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, {once:true});
  else boot();
})();
