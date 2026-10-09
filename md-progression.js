/* ==========================================================================
   Eucalculia Fork — progression, MEM cue and identity patch
   ---------------------------------------------------------------------------
   This is a fork of Eucalculia by Alberto Flaño Lombardo, built with his
   permission. Ideas and changes in this fork: mighty_elf and .da.rk. (Discord).
   Fork v1.0 shipped as "v7.2.0-md"; from v1.1 on the file is named
   "Eucalculia Fork vX.Y (base v7.1.22)" so the lineage is visible.
   Alberto's curriculum, generators, adaptive baselines and cascade are untouched;
   everything below is layered on top as an outermost patch, in the same style
   as the build's existing patch blocks.

   What this patch adds
     1. Version identity + credit line + "About this build" card.
     2. MEM cue restored to the v6.8.88 style (amber capsule inside the stimulus
        frame, pop + ring), plus a short banner hold at the start of every MEM
        trial and an amber frame glow while a retained item is on screen.
     3. META¹ questions restate which values to use (as shown / TRANSFORMED).
     4. Progression modes (Settings → Progression):
          baseline  — Alberto's within-individual baseline (v7.1.22), untouched.
          staircase — multi-axis adaptive staircase: tier by windowed accuracy
                      (~85% target: Wilson, Shenhav, Straub & Cohen 2019;
                      transformed up-down: Levitt 1971), exposure = Alberto's
                      weighted up-down (Kaernbach 1991, converges ≈86%),
                      META spacing = expanding retrieval practice
                      (Landauer & Bjork 1978). Composite LV 1–100.
          rating    — Elo / IRT rating with a speed-accuracy scoring rule
                      (Klinkenberg, Straatemeier & van der Maas 2011;
                      Maris & van der Maas 2012). Per-family item difficulties
                      learn from play. Tier chosen where expected success ≈ 80%.
     5. Continuous META chain (eto's idea): a retained item is always in the
        back of your mind; a new chain opens right after a META is delivered.
     6. Level card with manual steps (v1.3/v1.4) and, from v1.4.1, a manual
        META layer (Auto / No META / META¹ / META² / META³): the layer is forced
        through an overlay on dAutoSnapshot(), so Alberto's chain logic,
        briefing cards and memory promises keep running unchanged underneath.
   ========================================================================== */
(function(){
  "use strict";
  if(globalThis.__EUCA_MD_PROGRESSION_INSTALLED__) return;
  globalThis.__EUCA_MD_PROGRESSION_INSTALLED__ = true;

  const FORK_VERSION = "1.5";
  const BASE_VERSION = "v7.1.22";
  const MD_VERSION = `${BASE_VERSION}-fork.${FORK_VERSION}`;      // machine-readable; keeps the app's /^v\d+\.\d+\.\d+/ contract
  const MD_TITLE = `Eucalculia Fork v${FORK_VERSION}`;             // what people see
  const MD_LABEL = `Fork v${FORK_VERSION} · base ${BASE_VERSION}`;
  const STORAGE_PREFIX = "euca:md:prog:v2:p";
  const MAX_TIER = 13;             // levelByMode.D 0..13: value ramp 0..7 (values 4→12) + six post-cap runway bands
  const SPACING_MAX = 5;
  const PREP_HOLD_MS = 720;        // extra PREP hold while the MEM banner is shown

  const hasState = () => typeof State === "object" && State;
  const cfg = () => (typeof CONFIG === "object" && CONFIG) ? CONFIG : {};
  const clampN = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const num = (v, d=0) => Number.isFinite(Number(v)) ? Number(v) : d;
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
  const safe = (fn, fallback) => { try { return fn(); } catch(e){ try { console.warn("[Eucalculia md] ", e); } catch(_){} return fallback; } };

  const FACTORIES = Object.create(null);
  function wrapGlobal(name, factory){
    FACTORIES[name] = factory;
    return applyWrap(name);
  }
  const REENTRY = Object.create(null);
  const INSTALLED = Object.create(null);
  function applyWrap(name){
    const factory = FACTORIES[name];
    const previous = globalThis[name];
    if(typeof factory !== "function" || typeof previous !== "function") return false;
    if(INSTALLED[name] && previous === INSTALLED[name]) return true;   // already outermost
    const inner = factory(previous);
    // If an older layer of this same wrapper is reached again further down the chain
    // (re-wrapped at boot), only the outermost layer does the accounting.
    const wrapped = function(){
      if(REENTRY[name]) return previous.apply(this, arguments);
      REENTRY[name] = true;
      try { return inner.apply(this, arguments); }
      finally { REENTRY[name] = false; }
    };
    // Earlier patches decide "already installed" by marker properties on the current
    // global; carry those markers so they never stack a second copy on top of us.
    // Pointers to originals are deliberately not copied: delegating past this layer
    // would silently remove it from the chain.
    for(const key of Object.keys(previous)){
      if(/Original$/.test(key) || /^__md/.test(key)) continue;
      if(typeof previous[key] === "function") continue;
      try { wrapped[key] = previous[key]; } catch(_){}
    }
    try { Object.defineProperty(wrapped, "name", {value:name + "MD"}); } catch(_){}
    wrapped.__mdWrapped = name;
    wrapped.__mdOriginal = previous;
    globalThis[name] = wrapped;
    INSTALLED[name] = wrapped;
    return true;
  }
  function reapplyWraps(){ for(const name of Object.keys(FACTORIES)) safe(() => applyWrap(name)); }

  // ------------------------------------------------------------------------
  // Progression state (per profile, stored in its own localStorage key so
  // Alberto's schema-validated profile blob is never touched).
  // ------------------------------------------------------------------------
  const MODES = {
    baseline:{
      id:"baseline", name:"Baseline", tag:"Alberto · v7.1.22",
      sub:"Within-individual baseline. Tiers move only when you beat your own accuracy and RT history at that tier.",
      desc:"The original rule. Upward: plateau + upper-quartile accuracy + faster than your own median RT. Downward: lower-quartile accuracy and slower RT. Honest, but it can hold you at a tier for a long time once your speed has stabilised."
    },
    staircase:{
      id:"staircase", name:"Staircase", tag:"multi-axis · 85% rule",
      sub:"Each difficulty axis climbs on its own adaptive staircase. Composite level 1–100.",
      desc:"Tier (magnitude range and relation families) steps up after a 20-trial window at ≥85% chance-corrected accuracy (≈85% on YES/NO, 70% on typed numbers) and steps down below ≈60% — the optimal-error-rate target from Wilson et al. (2019). Exposure keeps Alberto's weighted up-down staircase (5 ms / 30 ms, converging at ≈86%: Kaernbach 1991). META spacing grows with success (spaced retrieval: Landauer & Bjork 1978; Karpicke & Bauernschmidt 2011). The level combines tier, exposure, META layer and spacing. A lagging transfer probe holds the tier."
    },
    rating:{
      id:"rating", name:"Rating", tag:"Elo · IRT · speed-accuracy",
      sub:"One continuous rating, updated every answer with a speed-accuracy score. Tier = where your expected success is ≈80%.",
      desc:"Math-Garden-style adaptive practice (Klinkenberg et al. 2011): every question family has a difficulty rating that learns from your play; your rating rises when you beat the expectation and falls when you miss it. Fast correct answers score more than slow ones, fast errors score least (Maris & van der Maas 2012); long questions get a reading allowance before the clock counts against you. The number is comparable across sessions like a chess rating and never “sticks”."
    }
  };
  const MODE_ORDER = ["baseline", "staircase", "rating"];

  function defaultState(){
    return {
      schema:2,
      mode:"staircase",
      continuousMeta:true,
      memBanner:true,
      manualMeta:null,            // null = Auto (Alberto's evidence-based layers) · 0 = none · 1..3 = forced META layer
      peek:true,                  // v1.5 (Dark): reveal a retained item during a META question, at a cost
      peeks:{n:0, correct:0, byLevel:{1:0, 2:0, 3:0}},
      seenIntro:false,
      anchorTrials:0,
      tier:{level:0, win:[], changedAtTrial:0, changes:[]},
      spacing:{level:0, outcomes:[], changes:0},
      rating:{theta:1060, n:0, items:{}, peak:1060, hist:[]},
      block:{levelAtStart:null, thetaAtStart:null},
      savedAt:0
    };
  }

  const MD = {
    st:null,
    profile:1,
    _saveTimer:0,
    _lastCueKey:"",
    _prepBumped:false,
    _prepBase:null,
    _pendingHold:null,
    _audit:false,
    _installed:{}
  };

  function activeProfile(){ return clampN(num(hasState() && State.activeProfile, 1) || 1, 1, 3); }
  function storageKey(){ return STORAGE_PREFIX + activeProfile(); }

  function loadState(){
    const base = defaultState();
    let saved = null;
    try { const raw = localStorage.getItem(storageKey()); if(raw) saved = JSON.parse(raw); } catch(_){ saved = null; }
    if(saved && typeof saved === "object"){
      const st = {...base, ...saved};
      st.tier = {...base.tier, ...(saved.tier || {})};
      st.spacing = {...base.spacing, ...(saved.spacing || {})};
      st.rating = {...base.rating, ...(saved.rating || {})};
      st.block = {...base.block};
      if(!Array.isArray(st.tier.win)) st.tier.win = [];
      if(!Array.isArray(st.spacing.outcomes)) st.spacing.outcomes = [];
      if(!st.rating.items || typeof st.rating.items !== "object") st.rating.items = {};
      if(!MODES[st.mode]) st.mode = base.mode;
      st.manualMeta = (st.manualMeta === null || st.manualMeta === undefined || !Number.isFinite(Number(st.manualMeta))) ? null : clampN(Math.round(Number(st.manualMeta)), 0, 3);
      if(typeof st.peek !== "boolean") st.peek = true;
      st.peeks = {...base.peeks, ...(saved.peeks || {})}; if(!st.peeks.byLevel || typeof st.peeks.byLevel !== "object") st.peeks.byLevel = {1:0, 2:0, 3:0};
      // Profile reset (trial counter back to zero) or a much older import → start fresh.
      // Small gaps are normal: Alberto's profile save is deferred during a block.
      const trials = num(hasState() && State.stats && State.stats.trials, 0);
      const anchor = num(st.anchorTrials, 0);
      if((trials === 0 && anchor > 0) || trials < anchor * 0.5){
        MD.st = base;
      } else {
        MD.st = st;
      }
    } else {
      MD.st = base;
    }
    // keep the tier window coherent with the live tier
    const lv = num(hasState() && State.levelByMode && State.levelByMode.D, 0);
    if(MD.st.tier.level !== lv){ MD.st.tier.level = lv; MD.st.tier.win = []; }
    if(MD.st.mode === "rating" && !(num(MD.st.rating.n,0) > 0)) MD.st.rating.theta = thetaForTier(lv);
    return MD.st;
  }
  function saveStateNow(){
    if(!MD.st) return false;
    try {
      MD.st.anchorTrials = num(hasState() && State.stats && State.stats.trials, 0);
      MD.st.savedAt = Date.now();
      const copy = {...MD.st, block:undefined};
      localStorage.setItem(storageKey(), JSON.stringify(copy));
      return true;
    } catch(_){ return false; }
  }
  function saveState(){
    if(MD._saveTimer) return;
    MD._saveTimer = setTimeout(() => { MD._saveTimer = 0; saveStateNow(); }, 600);
  }
  function st(){ return MD.st || loadState(); }
  function mode(){ return st().mode; }
  function isBaseline(){ return mode() === "baseline"; }
  function isStaircase(){ return mode() === "staircase"; }
  function isRating(){ return mode() === "rating"; }

  // ------------------------------------------------------------------------
  // Axis helpers
  // ------------------------------------------------------------------------
  function tierMax(){ return safe(() => (typeof maxLevelIndexForMode === "function" ? maxLevelIndexForMode("D") : MAX_TIER), MAX_TIER); }
  function currentTier(){ return num(hasState() && State.levelByMode && State.levelByMode.D, 0); }
  function exposureMs(){ return num(hasState() && State.etByMode && State.etByMode.D, 1330); }
  function exposureStart(){ return num(cfg().startETByMode && cfg().startETByMode.D, 1330); }
  function exposureFloor(){ return num(cfg().minETByMode && cfg().minETByMode.D, 600); }
  function metaLevel(){ return safe(() => (typeof effectiveMetaLevel === "function" ? effectiveMetaLevel() : 0), 0); }
  function tutorialActive(){ return safe(() => (typeof autoTutorialPhaseActive === "function" ? !!autoTutorialPhaseActive() : false), false); }

  function exposureProgress(){
    const s = exposureStart(), f = exposureFloor();
    return clampN((s - exposureMs()) / Math.max(1, s - f), 0, 1);
  }
  // composite index in [0,1) for the staircase mode
  function staircaseRaw(){
    const tierProg = clampN(currentTier() / Math.max(1, tierMax()), 0, 1);
    const metaProg = clampN(metaLevel() / 3, 0, 1);
    const spaceProg = clampN(num(st().spacing.level, 0) / SPACING_MAX, 0, 1);
    return clampN(0.45 * tierProg + 0.20 * exposureProgress() + 0.20 * metaProg + 0.15 * spaceProg, 0, 0.9999);
  }
  function staircaseLevel(){ return 1 + Math.floor(staircaseRaw() * 99); }
  function staircaseFraction(){ const x = staircaseRaw() * 99; return x - Math.floor(x); }

  // Rating scale. Item base difficulty: 800 + 55·tier + layer bonus.
  const LAYER_BONUS = {0:0, 1:230, 2:420, 3:600};
  const LAYER_DEADLINE = {0:3600, 1:7600, 2:13000, 3:18000};
  const RATING_TARGET_P = 0.80;
  function expected(theta, delta){ return 1 / (1 + Math.pow(10, (delta - theta) / 400)); }
  function baseDifficulty(tier, layer){ return 800 + 55 * clampN(num(tier,0), 0, MAX_TIER) + (LAYER_BONUS[clampN(num(layer,0),0,3)] || 0); }
  function thetaForTier(tier){ return baseDifficulty(tier, 0) + 400 * Math.log10(RATING_TARGET_P / (1 - RATING_TARGET_P)) + 20; }
  function targetTierForTheta(theta){
    // highest tier whose L0 base difficulty still gives expected success ≥ target
    const margin = 400 * Math.log10(RATING_TARGET_P / (1 - RATING_TARGET_P)); // ≈ 240.8
    return clampN(Math.floor((theta - margin - 800) / 55), 0, tierMax());
  }
  function ratingLevel(theta){ return Math.max(1, 1 + Math.floor((num(theta,1060) - 1040) / 10)); }
  function ratingFraction(theta){ const x = (num(theta,1060) - 1040) / 10; return clampN(x - Math.floor(x), 0, 0.999); }
  function ratingK(n){ return n < 30 ? 40 : (n < 100 ? 24 : 14); }
  function itemKey(info, layer){
    const id = (info && (info.catId || (info.cat && info.cat.id) || (info.op && info.op.id) || info.opId || info.kind)) || "unknown";
    return `L${layer}:${String(id).slice(0, 64)}`;
  }
  // Reading allowance (v1.3): long, nested questions take time to read before any
  // reasoning starts, so the speed deadline grows by 220 ms per word beyond the
  // first eight (question + half the option text). Same rule as the RT tile.
  function readingAllowanceMs(info){
    const wc = t => String(t || "").trim().split(/\s+/).filter(Boolean).length;
    let w = wc(info && (info.question || info.delayedPrompt || info.relationQuestion) || "");
    if(info && Array.isArray(info.options)) w += Math.round(info.options.reduce((n, o) => n + wc(typeof o === "string" ? o : (o && (o.text || o.label)) || ""), 0) / 2);
    return 220 * Math.max(0, w - 8);
  }
  function scoreFor(correct, rt, layer, extraMs){
    const d = (LAYER_DEADLINE[clampN(num(layer,0),0,3)] || 3600) + num(extraMs, 0);
    const t = clampN(num(rt, d) / d, 0, 1);
    return correct ? (0.75 + 0.25 * (1 - t)) : (0.20 * t);
  }
  function ratingUpdate(info, correct, rt, layer, peeked){
    const R = st().rating;
    const key = itemKey(info, layer);
    if(!R.items[key]) R.items[key] = {d:0, n:0};
    const item = R.items[key];
    const delta = baseDifficulty(currentTier(), layer) + num(item.d, 0);
    const E = expected(R.theta, delta);
    let S = scoreFor(correct, rt, layer, readingAllowanceMs(info));
    if(peeked && correct) S = Math.min(S, 0.5);   // v1.5: a peeked correct answer counts half
    const K = ratingK(num(R.n, 0));
    R.theta = clampN(R.theta + K * (S - E), 600, 3200);
    item.d = clampN(num(item.d,0) + 8 * (E - S), -300, 300);
    item.n = num(item.n,0) + 1;
    R.n = num(R.n, 0) + 1;
    R.peak = Math.max(num(R.peak, R.theta), R.theta);
    R.hist = (R.hist || []).concat([Math.round(R.theta)]).slice(-120);
    // keep the per-family table bounded
    const keys = Object.keys(R.items);
    if(keys.length > 900){ for(const k of keys.slice(0, keys.length - 900)) delete R.items[k]; }
    return {E, S, K, delta};
  }

  function publicLevel(){
    if(isStaircase()) return staircaseLevel();
    if(isRating()) return ratingLevel(st().rating.theta);
    return currentTier() + 1;
  }
  function publicLevelLabel(){
    if(isStaircase()) return `LV ${staircaseLevel()}`;
    if(isRating()) return `LV ${ratingLevel(st().rating.theta)} · ${Math.round(st().rating.theta)}`;
    return `LV${currentTier() + 1}`;
  }
  function axisSummary(){
    const s = st();
    const parts = [`tier ${currentTier() + 1}/${tierMax() + 1}`, `exposure ${Math.round(exposureMs())} ms`];
    const ml = metaLevel();
    parts.push((ml >= 1 ? ({1:"META¹",2:"META²",3:"META³"})[ml] : "L0") + (forcedMetaLevel() !== null ? " (manual)" : ""));
    if(!isBaseline()) parts.push(`spacing ${num(s.spacing.level,0)}`);
    if(isRating()){
      const th = Math.round(s.rating.theta), pk = Math.round(s.rating.peak);
      parts.push(pk > th + 1 ? `rating ${th} (peak ${pk})` : `rating ${th}`);
    }
    return parts.join(" · ");
  }

  // ------------------------------------------------------------------------
  // Tier staircase (staircase mode) and rating-driven tier (rating mode)
  // ------------------------------------------------------------------------
  function tierWinSync(){
    const T = st().tier;
    const lv = currentTier();
    if(T.level !== lv){ T.level = lv; T.win = []; T.changedAtTrial = num(hasState() && State.stats && State.stats.trials, 0); }
    return T;
  }
  const transferLayer = () => globalThis.EUCA_TRANSFER || null;
  // chance level of the current answer format: YES/NO 0.5, k-way choice 1/k, typed numbers ≈ 0
  function trialChance(){
    const panel = String(hasState() && State.pendingPanel || "");
    const info = (hasState() && State.trialInfo) || {};
    if(panel === "bool") return 0.5;
    if(panel === "choice"){ const n = Array.isArray(info.options) ? info.options.length : 4; return num(info.requiredSelections, 1) > 1 ? 0.1 : 1 / Math.max(2, n); }
    return 0;
  }
  function recordTierOutcome(correct, rt){
    const TR = transferLayer();
    if(TR && safe(() => TR.isProbeTrial(), false)) return;   // probe blocks measure transfer; they never move the tier
    const T = tierWinSync();
    T.win.push({c:!!correct, rt:num(rt, 0), ch:trialChance()});
    if(T.win.length > 60) T.win.splice(0, T.win.length - 60);
    saveState();
  }
  // Chance-corrected accuracy over the last n tier trials: Σ(correct − chance) / Σ(1 − chance).
  // 0.70 corrected ≈ 85 % on YES/NO, ≈ 77 % on 4-way choice, 70 % on typed numbers (Wilson et al. 2019
  // concerns binary discriminations; Jansen et al. 2013 / Papoušek et al. 2016 favour lower raw targets
  // for open answers).
  function winAccuracy(n){
    const T = tierWinSync();
    const w = T.win.slice(-n);
    if(w.length < n) return null;
    let numer = 0, denom = 0;
    for(const e of w){ const ch = clampN(num(e.ch, 0), 0, 0.9); numer += (e.c ? 1 : 0) - ch; denom += 1 - ch; }
    return denom > 0 ? clampN(numer / denom, 0, 1) : null;
  }
  function familiesOk(){
    return safe(() => {
      const active = typeof dActiveL0FamilyCount === "function" ? dActiveL0FamilyCount(3) : 99;
      const available = typeof posnerFamilyWeights === "function" && typeof getPosnerTier === "function"
        ? Object.keys(posnerFamilyWeights(getPosnerTier())).length : 3;
      return active >= Math.min(2, Math.max(1, available));
    }, true);
  }
  // Alberto's post-cap "runway" bands (LV9–LV14) are gated by META evidence, not by RT.
  // Both new modes keep those blockers; only the RT-improvement gate is dropped.
  function runwayBlockers(target){
    return safe(() => {
      const snap = typeof progressRelationalAxisSnapshot === "function" ? progressRelationalAxisSnapshot() : null;
      if(!snap || !Number.isFinite(snap.valueCapLevel)) return [];
      if(target <= snap.valueCapLevel) return [];
      return Array.isArray(snap.nextLevelBlockedBy) ? snap.nextLevelBlockedBy.slice() : [];
    }, []);
  }
  const STAIR_UP = 0.70, STAIR_DOWN = 0.20;   // chance-corrected (see winAccuracy)
  function staircaseShouldUp(){
    if(currentTier() >= tierMax()) return false;
    const acc = winAccuracy(20);
    if(acc === null) return false;
    if(!familiesOk()) return false;
    if(acc < STAIR_UP) return false;
    const TR = transferLayer();
    if(TR && safe(() => TR.blocksTierUp(), false)) return false;   // last transfer probe lagged: hold the tier, widen variety
    return runwayBlockers(currentTier() + 1).length === 0;
  }
  function staircaseShouldDown(){
    if(currentTier() <= 0) return false;
    const acc = winAccuracy(12);
    if(acc === null) return false;
    return acc < STAIR_DOWN;
  }
  function ratingShouldUp(){
    if(currentTier() >= tierMax()) return false;
    const T = tierWinSync();
    if(T.win.length < 8) return false;
    if(targetTierForTheta(st().rating.theta - 15) <= currentTier()) return false;
    return runwayBlockers(currentTier() + 1).length === 0;
  }
  function ratingShouldDown(){
    if(currentTier() <= 0) return false;
    const T = tierWinSync();
    if(T.win.length < 8) return false;
    return targetTierForTheta(st().rating.theta + 15) < currentTier();
  }
  function noteTierChange(dir){
    const T = st().tier;
    T.changes = (T.changes || []).concat([{dir, from:currentTier(), at:Date.now()}]).slice(-40);
    T.win = [];
    T.level = currentTier() + dir; // evaluateModeDLevelChange applies the step right after we return true
    T.changedAtTrial = num(hasState() && State.stats && State.stats.trials, 0);
    saveState();
  }

  wrapGlobal("shouldLevelUpD", previous => function shouldLevelUpDMD(){
    if(isBaseline() || MD._audit) return previous.apply(this, arguments);
    const up = isRating() ? ratingShouldUp() : staircaseShouldUp();
    if(up) noteTierChange(+1);
    return up;
  });
  wrapGlobal("shouldLevelDownD", previous => function shouldLevelDownDMD(){
    if(isBaseline() || MD._audit) return previous.apply(this, arguments);
    const down = isRating() ? ratingShouldDown() : staircaseShouldDown();
    if(down) noteTierChange(-1);
    return down;
  });
  // Every counted L0 episode reaches pushAdaptiveBaseline exactly once (synthetic:false).
  wrapGlobal("pushAdaptiveBaseline", previous => function pushAdaptiveBaselineMD(modeArg, level, trial){
    const out = previous.apply(this, arguments);
    try {
      if(modeArg === "D" && trial && trial.synthetic === false && !isBaseline() && !MD._audit) recordTierOutcome(!!trial.correct, trial.rt);
    } catch(_){}
    return out;
  });
  // Alberto's built-in audit suite exercises his baseline rule with synthetic
  // trials; while it runs, the new modes step aside so the audit sees the original.
  wrapGlobal("auditAdaptiveBaseline", previous => function auditAdaptiveBaselineMD(){
    const prior = MD._audit;
    MD._audit = true;
    try { return previous.apply(this, arguments); }
    finally { MD._audit = prior; }
  });

  // ------------------------------------------------------------------------
  // Per-answer accounting: rating update + META spacing staircase
  // ------------------------------------------------------------------------
  function isMetaTrial(info, level){
    return level >= 1 && level <= 3 && !!info && !info.isMemInterferenceLure && info.countsForMetaHistory !== false
      && (info.kind === "meta1" || info.kind === "meta2" || info.kind === "meta3");
  }
  function recordSpacingOutcome(correct){
    const S = st().spacing;
    S.outcomes.push(!!correct);
    if(S.outcomes.length > 8) S.outcomes.splice(0, S.outcomes.length - 8);
    const last4 = S.outcomes.slice(-4);
    if(last4.length >= 4 && last4.every(Boolean)){
      if(S.level < SPACING_MAX){ S.level++; S.changes = num(S.changes,0) + 1; }
      S.outcomes = [];
    } else if(last4.length >= 2 && last4.filter(x => !x).length >= 2){
      if(S.level > 0){ S.level--; S.changes = num(S.changes,0) + 1; }
      S.outcomes = [];
    }
  }
  wrapGlobal("completeRuntimeProbe", previous => function completeRuntimeProbeMD(correct, rt){
    const out = previous.apply(this, arguments);
    try {
      if(!hasState() || isBaseline()) return out;
      const info = State.trialInfo || {};
      const level = clampN(num(State.currentTrialLevel, 0), 0, 3);
      const recognition = info.statsMode === "A" || info.autoPhase === "1A" || info.autoPhase === "1B" || info.renderMode === "single";
      const peeked = !!(info.__mdPeeked && isMetaTrial(info, level));
      if(isRating() && !recognition && State.mode === "D") ratingUpdate(info, !!correct, rt, level, peeked);
      if(isMetaTrial(info, level)) recordSpacingOutcome(peeked ? false : !!correct);
      if(peeked){
        const P = st().peeks; P.n = num(P.n, 0) + 1; if(correct) P.correct = num(P.correct, 0) + 1; P.byLevel[level] = num(P.byLevel[level], 0) + 1;
        st().block.peeks = num(st().block.peeks, 0) + 1;
        safe(() => { const g = gameEl(); if(g) g.classList.remove("md-peeked"); });
      }
      saveState();
    } catch(e){ safe(() => console.warn("[Eucalculia md] probe accounting", e)); }
    return out;
  });

  // ------------------------------------------------------------------------
  // META spacing: expanding retrieval interval (staircase + rating modes)
  // ------------------------------------------------------------------------
  function spacingLevel(){ return isBaseline() ? 0 : clampN(num(st().spacing.level, 0), 0, SPACING_MAX); }
  function plans(){ return safe(() => (typeof ensureMetaMemoryPlans === "function" ? ensureMetaMemoryPlans() : (State.metaPlan || {})), {}); }
  // v1.5: the hold is measured on the profile's trial counter (State.stats.trials), not on
  // the block counter — a due plan is carried across blocks by Alberto's resetBlock
  // transaction, so a block-relative deadline left over from a previous block (Menu →
  // Start, a break) could hold the question for most of the next block (Dark: "the meta
  // question came as 20th question"). Holds are also cleared whenever a block starts.
  function trialsNow(){ return num(hasState() && State.stats && State.stats.trials, 0); }
  function planHeld(p){
    if(!p || !p.due) return false;
    if(Number.isFinite(p._mdDueTrial)) return trialsNow() < p._mdDueTrial;
    return false;
  }
  function deferredPlanLevel(){
    if(isBaseline()) return 0;
    const P = plans();
    for(const lv of [3,2,1]){ if(planHeld(P[lv])) return lv; }
    return 0;
  }
  function clearHolds(reason){
    try { const P = plans(); for(const lv of [1,2,3]){ const p = P[lv]; if(p && Number.isFinite(p._mdDueTrial) && p._mdDueTrial > trialsNow()){ p._mdDueTrial = trialsNow(); noteMetaDelivery(lv, "hold_cleared:" + reason); } } } catch(_){}
  }
  // META question delivery log (diagnostics for "weird holds"): when a plan became due and
  // when its question was dealt, in profile trials.
  MD._metaLog = [];
  function noteMetaDelivery(level, event){
    try {
      const P = plans(), p = P[level] || {};
      MD._metaLog.push({level, event, trial:trialsNow(), bt:num(State.blockTrials, 0), dueTrial:p._mdDueSince ?? null, holdUntil:p._mdDueTrial ?? null});
      if(MD._metaLog.length > 60) MD._metaLog.splice(0, MD._metaLog.length - 60);
    } catch(_){}
  }
  // between MEM 1/2 and MEM 2/2 (META¹ chains only, like the original)
  wrapGlobal("memInterferenceProfile", previous => function memInterferenceProfileMD(targetLevel){
    const out = previous.apply(this, arguments);
    if(isBaseline()) return out;
    const s = spacingLevel();
    if(s <= 0) return {enabled:false};
    if(!out || !out.enabled) return out;
    return {...out, probability:1, minLag:Math.max(1, Math.ceil(s / 2)), maxLag:Math.max(1, s)};
  });
  // after MEM 2/2: hold the META¹ question for `s` interposed trials.
  // v1.4.1: the hold applies to META¹ only. A META² / META³ question retains two
  // whole META¹ / META² episodes, so its retention interval is already a full
  // chain long; holding it as well made the higher questions pile up at the
  // block end (where Alberto's drain rule opens no new top-level chain), so at
  // spacing ≥ 3 a META³ chain could never start. They are now asked as soon as
  // their second item is in, as in the original.
  wrapGlobal("completeMemoryPlanFromTrial", previous => function completeMemoryPlanFromTrialMD(prereqLevel){
    const targetLevel = num(prereqLevel, 0) + 1;
    const P = plans();
    const before = !!(P[targetLevel] && P[targetLevel].due);
    const collectedBefore = num(P[targetLevel] && P[targetLevel].collected, 0);
    const out = previous.apply(this, arguments);
    try {
      const plan = plans()[targetLevel];
      if(!plan) return out;
      const tookItem = (plan.due && !before) || num(plan.collected, 0) > collectedBefore;
      if(tookItem) plan._mdItemTrials = (Array.isArray(plan._mdItemTrials) ? plan._mdItemTrials : []).concat([trialsNow()]).slice(-2);
      if(plan.due && !before){
        plan._mdDueSince = trialsNow();
        plan._mdDueTrial = trialsNow() + (targetLevel === 1 ? spacingLevel() : 0);
        MD._dueItems[targetLevel] = {trials:(plan._mdItemTrials || []).slice(), since:trialsNow()};
        noteMetaDelivery(targetLevel, "due");
      }
    } catch(_){}
    return out;
  });
  MD._dueItems = {1:null, 2:null, 3:null};
  // when a chain opens, start its item list fresh
  wrapGlobal("attachMemoryPlanToCurrentTrial", previous => function attachMemoryPlanToCurrentTrialMD(){
    const P = plans(); const activeBefore = {1:!!(P[1] && P[1].active), 2:!!(P[2] && P[2].active), 3:!!(P[3] && P[3].active)};
    const out = previous.apply(this, arguments);
    try { const Q = plans(); for(const lv of [1,2,3]){ if(Q[lv] && Q[lv].active && !activeBefore[lv]) Q[lv]._mdItemTrials = []; } } catch(_){}
    return out;
  });
  // Block size follows the META cycle (v1.4.1). Alberto's auto block is 20, or 30
  // with META³; his drain rule opens no new top-level chain once the block is
  // full. With spacing s a META¹ chain takes ≈ 2 + 1.75·s trials (two pairs,
  // lures, hold), a META² cycle ≈ 5 + 3.5·s and a META³ cycle ≈ 11 + 7·s, so at
  // spacing ≥ 3 the first META² of a block often lands in the drain and a META³
  // chain can never start. The auto block grows (never shrinks) so that ~1.25
  // cycles of the top layer fit, capped at 60. "auto→N" in the menu shows it.
  function metaCycleTrials(top, s){ return top >= 3 ? 11 + 7 * s : (top >= 2 ? 5 + 3.5 * s : 2 + 1.75 * s); }
  wrapGlobal("recommendedAutoBlockSize", previous => function recommendedAutoBlockSizeMD(mode){
    const base = previous.apply(this, arguments);
    try {
      if(isBaseline() || MD._audit || !hasState()) return base;
      if((mode === undefined ? State.mode : mode) !== "D" || !relationalReached()) return base;
      const s = spacingLevel(), top = metaLevel();
      if(s <= 0 || top < 2) return base;
      return clampN(Math.max(num(base, 20), Math.ceil(metaCycleTrials(top, s) * 1.25)), num(base, 20), 60);
    } catch(_){ return base; }
  });
  wrapGlobal("nextTrialLevel", previous => function nextTrialLevelMD(){
    const lv = previous.apply(this, arguments);
    if(isBaseline() || lv <= 0) return lv;
    // While a META¹ question is being held back, the interposed trials are plain L0
    // so the retained pairs are the only thing in mind. v1.5: a META² / META³ that is
    // already due is dealt regardless — it was never held itself, and waiting behind a
    // META¹ hold pushed it towards the block end (Dark's "weird hold").
    try {
      const P = plans();
      if(lv === 1 && planHeld(P[1])) return 0;
      if(lv >= 2 && planHeld(P[lv])) return 0;
      if(lv >= 1 && P[lv] && P[lv].due) noteMetaDelivery(lv, "dealt");
    } catch(_){}
    return lv;
  });
  // continuous chain (eto): open a chain whenever the layer is genuinely active
  wrapGlobal("shouldOpenMetaMemoryPlan", previous => function shouldOpenMetaMemoryPlanMD(level){
    if(isBaseline()) return previous.apply(this, arguments);
    if(deferredPlanLevel() > 0) return false;           // never stack a new chain on a held question
    if(!st().continuousMeta) return previous.apply(this, arguments);
    try {
      if(State.mode !== "D") return false;
      if(typeof metaMemoryEffectiveCeiling === "function" && metaMemoryEffectiveCeiling() < level) return false;
      const forced = num(State.forceOpenMetaMemoryPlanLevel, 0);
      if(forced === num(level,0)) return previous.apply(this, arguments);
      if(num(State.blockTrials,0) >= num(State.blockSize,20)) return previous.apply(this, arguments);
      const snap = typeof dAutoSnapshot === "function" ? dAutoSnapshot() : null;
      const state = snap && snap.states ? snap.states["l" + level] : null;
      if(state === "active" && typeof dMetaPresence === "function" && dMetaPresence(level) > 0) return true;
    } catch(_){}
    return previous.apply(this, arguments);
  });

  // ------------------------------------------------------------------------
  // Manual META layer (v1.4.1, eto's request): Auto / No META / META¹ / META² / META³
  // ------------------------------------------------------------------------
  // Alberto's Auto opens META¹→²→³ on evidence (readiness + the "pyramid" cap
  // META ≤ tier + 1) and he retired the public manual-level control in v7.
  // Rather than flipping State.metaAuto (which the app forces back to true at
  // every start), the forced layer is an overlay on dAutoSnapshot(): every
  // consumer — effectiveMetaLevel(), dMetaPresence(), the chain openers, the
  // briefing cards, block size, HUD — sees the chosen layer as "active", while
  // the hysteresis bookkeeping underneath keeps following the real evidence,
  // so switching back to Auto is seamless. Memory promises (a MEM cue already
  // shown) are still honoured through metaMemoryEffectiveCeiling().
  const META_NAMES = {0:"No META", 1:"META¹", 2:"META²", 3:"META³"};
  function relationalReached(){ return safe(() => !!(hasState() && State.autoCurriculum && State.autoCurriculum.reachedRelational), false); }
  function manualMeta(){
    const m = st().manualMeta;
    return (m === null || m === undefined || !Number.isFinite(Number(m))) ? null : clampN(Math.round(Number(m)), 0, 3);
  }
  function forcedMetaLevel(){
    if(MD._audit || isBaseline() || !hasState() || State.mode !== "D" || !State.metaAuto) return null;
    if(!relationalReached()) return null;
    return manualMeta();
  }
  // what Alberto's Auto would run right now (the un-overlaid level)
  function autoMetaLevel(){
    if(forcedMetaLevel() === null) return metaLevel();
    return clampN(num(MD._autoSnapLevel, 0), 0, 3);
  }
  function overlayForcedMeta(snap, forced){
    if(MD._ovSrc === snap && MD._ovLevel === forced && MD._ovOut) return MD._ovOut;
    const states = {l1:forced >= 1 ? "active" : "locked", l2:forced >= 2 ? "active" : "locked", l3:forced >= 3 ? "active" : "locked"};
    const out = {
      ...snap,
      level:forced, states,
      retained:{l1:false, l2:false, l3:false},
      decaying:{l1:false, l2:false, l3:false},
      l1Active:forced >= 1, l2Active:forced >= 2, l3Active:forced >= 3,
      mdManual:forced, mdAuto:{level:num(snap.level, 0), states:{...(snap.states || {})}}
    };
    MD._ovSrc = snap; MD._ovLevel = forced; MD._ovOut = out;
    return out;
  }
  wrapGlobal("dAutoSnapshot", previous => function dAutoSnapshotMD(){
    const snap = previous.apply(this, arguments);
    try {
      if(snap && typeof snap === "object") MD._autoSnapLevel = num(snap.level, 0);
      const forced = forcedMetaLevel();
      if(forced === null || !snap || typeof snap !== "object") return snap;
      return overlayForcedMeta(snap, forced);
    } catch(_){ return snap; }
  });

  // ------------------------------------------------------------------------
  // MEM cue: v6.8.88 style, back inside the frame, with banner hold
  // ------------------------------------------------------------------------
  function hudHost(){ return document.getElementById("hud"); }
  function gameEl(){ return document.getElementById("game-container"); }
  function cueEl(){ return document.getElementById("memoryCue"); }
  function ensureBanner(){
    let b = document.getElementById("mdMemBanner");
    if(b) return b;
    const g = gameEl();
    if(!g) return null;
    b = document.createElement("div");
    b.id = "mdMemBanner";
    b.setAttribute("aria-hidden", "true");
    b.innerHTML = `<div class="md-banner-title"></div><div class="md-banner-sub"></div><div class="md-banner-scope"></div>`;
    g.appendChild(b);
    return b;
  }
  let _relocating = false;
  function relocateCue(){
    if(_relocating) return;
    const cue = cueEl(), hud = hudHost();
    if(!cue || !hud) return;
    _relocating = true;
    try {
      if(cue.parentElement !== hud) hud.appendChild(cue);
      if(cue.hasAttribute("data-prompt-hosted")) cue.removeAttribute("data-prompt-hosted");
      if(!cue.classList.contains("md-cue")) cue.classList.add("md-cue");
      const row = document.getElementById("promptRow");
      if(row && row.classList.contains("memory-cue-in-prompt")) row.classList.remove("memory-cue-in-prompt");
    } finally { _relocating = false; }
  }
  let _cueObserver = null;
  function installCueObserver(){
    if(_cueObserver || typeof MutationObserver !== "function") return;
    const row = document.getElementById("promptRow"), cue = cueEl();
    if(!row || !cue) return;
    _cueObserver = new MutationObserver(() => { if(_relocating) return; queueMicrotask(relocateCue); });
    _cueObserver.observe(row, {childList:true});
    _cueObserver.observe(cue, {attributes:true, attributeFilter:["data-prompt-hosted"]});
  }
  function scopeWord(info){
    if(!info) return "";
    if(info.memoryValueScope === "transformed") return "TRANSFORMED values";
    if(info.memoryValueScope === "shown" && info.hasRepresentationTransform) return "ORIGINAL values (ignore the transform)";
    return "";
  }
  function showBanner(info){
    const b = ensureBanner();
    if(!b) return;
    const level = clampN(num(info && info.memoryTargetLevel, 1), 1, 3);
    const step = num(info && info.memoryStep, 1), needed = num(info && info.memoryNeeded, 2);
    const subject = level === 1 ? "REMEMBER THIS PAIR" : "REMEMBER THIS ANSWER";
    const sup = ({1:"¹",2:"²",3:"³"})[level] || "";
    b.dataset.level = String(level);
    b.querySelector(".md-banner-title").textContent = `🧠 ${subject}`;
    b.querySelector(".md-banner-sub").textContent = `MEM${sup} ${step}/${needed} · for META${sup}`;
    const sc = scopeWord(info);
    b.querySelector(".md-banner-scope").textContent = sc ? `Retain the ${sc}` : (level === 1 ? "Retain LEFT and RIGHT as shown" : "");
    b.classList.add("visible");
  }
  function hideBanner(){ const b = document.getElementById("mdMemBanner"); if(b) b.classList.remove("visible"); }
  function restorePrep(){
    if(MD._prepBumped && MD._prepBase !== null){ cfg().prepMs = MD._prepBase; }
    MD._prepBumped = false;
    MD._pendingHold = null;
  }
  function bumpPrep(){
    const c = cfg();
    if(!MD._prepBumped){ MD._prepBase = num(c.prepMs, 250); c.prepMs = MD._prepBase + PREP_HOLD_MS; MD._prepBumped = true; }
  }
  function requestMemHold(info){
    if(!st().memBanner) return;
    if(!hasState()) return;
    const status = String(State.status || "");
    if(status === "PREP"){
      bumpPrep();
      showBanner(info);
      safe(() => { if(typeof schedulePrepTransition === "function") schedulePrepTransition("md_mem_hold"); });
    } else if(status !== "FLASH" && status !== "MASK" && status !== "INPUT"){
      // trial prepared before PREP: hold once PREP begins (consumed by the setStatus hook)
      MD._pendingHold = {info, at:Date.now()};
    }
  }
  // ------------------------------------------------------------------------
  // Base bug (v7.1.22, reported by .da.rk.): the first META¹ retained for META²
  // (and META² retained for META³) comes right after the META²/META³ onboarding
  // card. The card's "exact prerequisite" resume re-enters the already-built trial
  // through PREP → FLASH → MASK, the pipeline for flashed L0 pairs. A META trial
  // has no stimulus and no delayedPrompt, so the MASK→INPUT branch never calls
  // showMetaQuestion: black frame, empty question, "META¹ · ENTER NUMBER" in the
  // tray. Repair: as soon as such a trial enters PREP (and again at INPUT if
  // anything cleared it), show its question the way startTrial would have.
  function repairMetaQuestion(status){
    if(!hasState()) return false;
    const level = num(State.currentTrialLevel, 0);
    const info = State.trialInfo || {};
    if(level < 1 || !/^meta[123]$/.test(String(info.kind || ""))) return false;
    const el = document.getElementById("metaQuestion");
    if(!el || typeof showMetaQuestion !== "function") return false;
    const q = el.querySelector(".meta-q");
    if(el.classList.contains("visible") && q && String(q.textContent || "").trim()) return false;
    const text = info.question || info.delayedPrompt || info.relationQuestion || "";
    if(!text) return false;
    const opts = Array.isArray(info.options) && info.options.length ? info.options : null;
    if(opts && State.pendingPanel === "choice" && typeof setChoiceOptions === "function") safe(() => setChoiceOptions(opts));
    const hint = level === 1 && typeof l1MultiProbeHintForInfo === "function" ? safe(() => l1MultiProbeHintForInfo(info) || "", "") : "";
    safe(() => { if(typeof showLevelBadge === "function") showLevelBadge(level); });
    showMetaQuestion(level, text, hint, opts);
    safe(() => { if(typeof setPrompt === "function") setPrompt(({1:"META¹", 2:"META²", 3:"META³"})[level], "meta" + level); });
    MD._metaRepairs = (MD._metaRepairs || []).concat([{at:Date.now(), status, level, kind:info.kind, trial:num(State.stats && State.stats.trials, 0)}]).slice(-20);
    return true;
  }

  // the menu can open through the emergency path (pause button / Escape), which defers updateMenu
  wrapGlobal("openMenuEmergencySafe", previous => function openMenuEmergencySafeMD(){
    const out = previous.apply(this, arguments);
    try { renderLevelCard(); } catch(_){}
    return out;
  });
  wrapGlobal("setStatus", previous => function setStatusMD(status){
    const out = previous.apply(this, arguments);
    try { if(status === "PREP" || status === "INPUT") repairMetaQuestion(status); } catch(_){}
    try { if(status === "MENU") renderLevelCard(); } catch(_){}
    try {
      if(status === "PREP"){
        // A MEM cue that was attached before PREP (prepared trials) holds the PREP phase now.
        // beginValidatedPrep schedules its prep→flash transition right after this call, so the
        // bumped CONFIG.prepMs is what it will use.
        const hold = MD._pendingHold;
        MD._pendingHold = null;
        if(hold && st().memBanner && Date.now() - hold.at < 15000){ bumpPrep(); showBanner(hold.info); }
      } else if(MD._prepBumped || MD._pendingHold){
        hideBanner(); restorePrep();
      }
    } catch(_){}
    return out;
  });
  function syncMemFrame(){
    const cue = cueEl(), g = gameEl();
    if(!cue || !g) return;
    const visible = cue.classList.contains("visible") && !cue.classList.contains("md-hold");
    g.classList.toggle("md-mem-active", visible);
    if(visible) g.dataset.mdMemLevel = cue.dataset.level || "1"; else delete g.dataset.mdMemLevel;
  }
  function showHoldPill(level){
    const cue = cueEl();
    if(!cue) return;
    relocateCue();
    const sup = ({1:"¹",2:"²",3:"³"})[level] || "";
    cue.dataset.level = String(level);
    const icon = cue.querySelector(".memory-icon"), text = cue.querySelector(".memory-text");
    if(icon) icon.textContent = `🧠${sup}`;
    if(text) text.textContent = `HOLD · META${sup} soon`;
    cue.title = `Keep the retained items; the META${sup} question follows after these trials.`;
    cue.classList.add("visible", "md-hold");
    cue.classList.remove("memory-pop");
    cue.setAttribute("aria-hidden", "false");
    syncMemFrame();
  }
  wrapGlobal("updateMemoryCue", previous => function updateMemoryCueMD(){
    const cue = cueEl();
    const before = cue ? (cue.dataset.announced || "") : "";
    const out = previous.apply(this, arguments);
    try {
      relocateCue();
      const c = cueEl();
      if(!c) return out;
      c.classList.remove("md-hold");
      const info = hasState() ? (State.trialInfo || {}) : {};
      if(c.classList.contains("visible") && info.memoryActive){
        c.setAttribute("aria-hidden", "false");
        const key = `${c.dataset.announced || ""}|${info.memoryStep}|${info.memoryNeeded}|${info.memoryTargetLevel}|${num(State.stats && State.stats.trials,0)}`;
        if(key !== MD._lastCueKey){
          MD._lastCueKey = key;
          c.classList.remove("memory-pop"); void c.offsetWidth; c.classList.add("memory-pop");
          setTimeout(() => { try { c.classList.remove("memory-pop"); } catch(_){} }, 1100);
          requestMemHold(info);
        }
      } else {
        const held = deferredPlanLevel();
        if(held > 0 && hasState() && State.mode === "D") showHoldPill(held);
      }
      syncMemFrame();
    } catch(e){ safe(() => console.warn("[Eucalculia md] cue", e)); }
    return out;
  });
  wrapGlobal("hideMemoryCue", previous => function hideMemoryCueMD(){
    const out = previous.apply(this, arguments);
    try {
      relocateCue();
      const c = cueEl();
      if(c){ c.classList.remove("md-hold"); c.setAttribute("aria-hidden", "true"); }
      syncMemFrame();
      hideBanner();
    } catch(_){}
    return out;
  });

  // ------------------------------------------------------------------------
  // META¹: restate which retained values apply
  // ------------------------------------------------------------------------
  function scopeHintText(info){
    const p1 = info.pair1 && info.pair1.memoryValueScope ? info.pair1 : (info.rawPair1 || info.pair1 || {});
    const p2 = info.pair2 && info.pair2.memoryValueScope ? info.pair2 : (info.rawPair2 || info.pair2 || {});
    const word = p => p && p.memoryValueScope === "transformed" ? "<b>TRANSFORMED</b> values" : "values <b>as shown</b>";
    const anyTransform = !!((p1 && p1.hasRepresentationTransform) || (p2 && p2.hasRepresentationTransform) || info.transformedPair1 || info.transformedPair2
      || (p1 && p1.memoryValueScope === "transformed") || (p2 && p2.memoryValueScope === "transformed"));
    if(!anyTransform) return "Use the values <b>as shown</b> for both pairs";
    return `Use → Pair 1: ${word(p1)} · Pair 2: ${word(p2)}`;
  }
  // META² / META³ (v1.5, Dark): say *which* retained items the question is about — with
  // continuous chains a META¹ or META² block can sit between the two retained answers.
  function retainedItemsHint(level){
    const d = MD._dueItems[level];
    if(!d || !Array.isArray(d.trials) || !d.trials.length) return "";
    const now = trialsNow();
    const ago = t => { const n = now - num(t, now); return n <= 0 ? "just now" : n === 1 ? "1 trial ago" : `${n} trials ago`; };
    const names = level === 2 ? ["Answer 1", "Answer 2"] : ["Question A", "Question B"];
    const what = level === 2 ? "the two 🧠² MEM-marked META¹ answers" : "the two 🧠³ MEM-marked META² questions";
    return `About ${what}: <b>${names[0]}</b> — ${ago(d.trials[0])}${d.trials.length > 1 ? ` · <b>${names[1]}</b> — ${ago(d.trials[1])}` : ""}`;
  }
  wrapGlobal("showMetaQuestion", previous => function showMetaQuestionMD(level){
    const out = previous.apply(this, arguments);
    try {
      const el = document.getElementById("metaQuestion");
      if(!el) return out;
      let hint = el.querySelector(".md-scope-hint");
      const info = hasState() ? (State.trialInfo || {}) : {};
      const lv = num(level, 0);
      const isMeta = (lv === 1 && info.kind === "meta1") || (lv === 2 && info.kind === "meta2") || (lv === 3 && info.kind === "meta3");
      const text = !isMeta ? "" : (lv === 1 ? scopeHintText(info) : retainedItemsHint(lv));
      if(text){
        if(!hint){
          hint = document.createElement("div");
          hint.className = "md-scope-hint";
          const anchor = el.querySelector(".meta-hint") || el.querySelector(".meta-q");
          if(anchor && anchor.parentNode) anchor.parentNode.insertBefore(hint, anchor.nextSibling); else el.appendChild(hint);
        }
        hint.innerHTML = text;
        hint.classList.add("visible");
      } else if(hint){
        hint.classList.remove("visible");
      }
      renderPeekRow(el, info, lv);
    } catch(_){}
    return out;
  });

  // ------------------------------------------------------------------------
  // Peek (v1.5, .da.rk.'s request): reveal a retained item during a META question.
  // "It's sad that you can't answer an otherwise cool question just because you
  // weren't able to remember something essential." The reasoning still gets
  // practised; the memory part is what the peek costs:
  //   · the question counts half for the rating (a correct peeked answer scores 0.5,
  //     i.e. below the 80 % expectation, so it costs a few points instead of earning);
  //   · it counts as a MISSED memory for the META spacing staircase and for Alberto's
  //     META evidence (layer unlocks, runway tiers) — mighty_elf's condition: no META
  //     progression without the memory aspect;
  //   · accuracy, streak and the chain itself are untouched (the retained answer is
  //     what it is). Staircase and Rating modes; Baseline keeps Alberto's rules.
  // ------------------------------------------------------------------------
  function peekEnabled(){ return !!st().peek && !isBaseline(); }
  function fmtVal(v){ if(v === null || v === undefined || v === "") return "?"; if(typeof v === "boolean") return v ? "YES" : "NO"; return String(v); }
  function peekSlots(info, level){
    const out = [];
    if(!info) return out;
    if(level === 1 && info.kind === "meta1"){
      const pairOf = (p, raw) => (p && (p.a !== undefined || p.b !== undefined)) ? p : (raw || p || null);
      const p1 = pairOf(info.pair1, info.rawPair1), p2 = pairOf(info.pair2, info.rawPair2);
      const tf = p => (p && p.hasRepresentationTransform && p.memoryValueScope === "transformed") ? " (transformed)" : "";
      if(p1){ out.push({id:"p1a", label:"Pair 1 LEFT" + tf(p1), value:() => fmtVal(p1.a)}); out.push({id:"p1b", label:"Pair 1 RIGHT" + tf(p1), value:() => fmtVal(p1.b)}); }
      if(p2){ out.push({id:"p2a", label:"Pair 2 LEFT" + tf(p2), value:() => fmtVal(p2.a)}); out.push({id:"p2b", label:"Pair 2 RIGHT" + tf(p2), value:() => fmtVal(p2.b)}); }
    } else if(level === 2 && info.kind === "meta2"){
      const ans = (raw, r) => raw !== undefined && raw !== null ? raw : (r && typeof r === "object" ? (r.answerLabel ?? r.answer) : r);
      out.push({id:"a1", label:"Answer 1", value:() => fmtVal(ans(info.rawR1, info.r1))});
      out.push({id:"a2", label:"Answer 2", value:() => fmtVal(ans(info.rawR2, info.r2))});
      if(info.source1) out.push({id:"q1", label:"Question 1", value:() => String(info.source1)});
      if(info.source2) out.push({id:"q2", label:"Question 2", value:() => String(info.source2)});
    } else if(level === 3 && info.kind === "meta3"){
      const ep = (e, name) => {
        if(!e) return null;
        const pub = e.publicEpisode || {};
        const q = e.relationQuestion || e.question || pub.question || "";
        const concl = e.correctConclusion || pub.savedLine || (typeof e.isTrue === "boolean" ? (e.isTrue ? "YES" : "NO") : "");
        const vals = (Number.isFinite(Number(e.rawR1)) && Number.isFinite(Number(e.rawR2))) ? ` · its two answers were ${e.rawR1} and ${e.rawR2}` : "";
        return {id:name === "A" ? "ea" : "eb", label:`Question ${name}`, value:() => `${q ? q.replace(/\?$/, "") + " → " : ""}${concl}${vals}`};
      };
      const a = ep(info.episode1, "A"), b = ep(info.episode2, "B");
      if(a) out.push(a); if(b) out.push(b);
    }
    return out;
  }
  function renderPeekRow(el, info, level){
    let row = el.querySelector(".md-peek");
    const slots = (peekEnabled() && isMetaTrial(info, level)) ? peekSlots(info, level) : [];
    if(!slots.length){ if(row) row.classList.remove("visible"); return; }
    if(!row){
      row = document.createElement("div");
      row.className = "md-peek";
      row.setAttribute("role", "group");
      row.setAttribute("aria-label", "Peek: reveal a retained item at a cost");
      el.appendChild(row);
      row.addEventListener("click", ev => {
        const btn = ev.target && ev.target.closest ? ev.target.closest(".md-peek-btn") : null;
        if(!btn) return;
        ev.preventDefault(); ev.stopPropagation();
        peekSlot(btn.dataset.slot);
      });
      row.addEventListener("keydown", ev => { if(ev.key === " " || ev.key === "Enter"){ const b = ev.target && ev.target.closest && ev.target.closest(".md-peek-btn"); if(b){ ev.preventDefault(); ev.stopPropagation(); peekSlot(b.dataset.slot); } } });
    }
    const hint = el.querySelector(".md-scope-hint");
    if(hint && hint.nextSibling !== row && hint.parentNode === el) el.insertBefore(row, hint.nextSibling);
    else if(row.parentNode !== el) el.appendChild(row);
    const peeked = info.__mdPeeked && Array.isArray(info.__mdPeeked.slots) ? info.__mdPeeked.slots : [];
    row.innerHTML = `<span class="md-peek-label">🔍 Peek</span>` +
      slots.map(sl => peeked.includes(sl.id)
        ? `<button type="button" class="md-peek-btn revealed" data-slot="${esc(sl.id)}">${esc(sl.label)} = <b>${esc(sl.value())}</b></button>`
        : `<button type="button" class="md-peek-btn" data-slot="${esc(sl.id)}" title="Reveal ${esc(sl.label)} — counts as half, memory as missed">${esc(sl.label)}</button>`).join("") +
      `<span class="md-peek-cost">${peeked.length ? "peeked · counts half · memory as missed" : "forgot one? reveal it · counts half · memory as missed"}</span>`;
    row.classList.toggle("peeked", peeked.length > 0);
    row.classList.add("visible");
  }
  function peekSlot(id){
    if(!hasState() || !peekEnabled()) return false;
    if(State.status !== "INPUT") return false;
    const info = State.trialInfo || {};
    const level = clampN(num(State.currentTrialLevel, 0), 0, 3);
    if(!isMetaTrial(info, level)) return false;
    const slots = peekSlots(info, level);
    const sl = slots.find(x => x.id === id);
    if(!sl) return false;
    if(!info.__mdPeeked) info.__mdPeeked = {slots:[], at:trialsNow(), level};
    if(!info.__mdPeeked.slots.includes(id)) info.__mdPeeked.slots.push(id);
    const el = document.getElementById("metaQuestion");
    if(el) renderPeekRow(el, info, level);
    safe(() => { const g = gameEl(); if(g) g.classList.add("md-peeked"); });
    return true;
  }
  // accounting for a peeked trial, see the note above
  wrapGlobal("recordMetaReadinessOutcome", previous => function recordMetaReadinessOutcomeMD(level, correct, rt, info){
    if(info && info.__mdPeeked && !isBaseline()) return previous.call(this, level, false, rt, info);
    return previous.apply(this, arguments);
  });
  wrapGlobal("recordAutoPhaseDiagnostic", previous => function recordAutoPhaseDiagnosticMD(info, correct, rt){
    if(info && info.__mdPeeked && !isBaseline()) return previous.call(this, info, false, rt);
    return previous.apply(this, arguments);
  });
  wrapGlobal("updateMetaStateAfterTrial", previous => function updateMetaStateAfterTrialMD(level, correct, rt){
    try {
      const info = hasState() ? State.trialInfo : null;
      if(info && info.__mdPeeked && correct && !isBaseline() && num(level, 0) >= 1){
        // the lifetime META evidence counts the peeked answer as a miss (processInput credited it just before)
        if(num(level, 0) === 1 && info.op && State.meta && State.meta.l1Stats && State.meta.l1Stats[info.op.id]){ const b = State.meta.l1Stats[info.op.id]; b.c = Math.max(0, num(b.c, 0) - 1); }
        if(num(level, 0) === 2 && State.meta && State.meta.l2Stats){ State.meta.l2Stats.c = Math.max(0, num(State.meta.l2Stats.c, 0) - 1); }
        if(num(level, 0) === 3 && State.meta && State.meta.l3Stats){ State.meta.l3Stats.c = Math.max(0, num(State.meta.l3Stats.c, 0) - 1); }
      }
    } catch(_){}
    return previous.apply(this, arguments);
  });

  // ------------------------------------------------------------------------
  // HUD level label + pre-block progress bar
  // ------------------------------------------------------------------------
  wrapGlobal("updateHUD", previous => function updateHUDMD(){
    const out = previous.apply(this, arguments);
    fixHudLabel();
    return out;
  });
  function fixHudLabel(){
    try {
      if(isBaseline() || !hasState() || State.mode !== "D") return;
      const el = document.getElementById("modeLabel");
      if(!el) return;
      let text = String(el.textContent || "");
      let next = text.replace(/\s*\(peak LV\s?\d+\)/i, "");
      const label = publicLevelLabel();
      if(/LV\s?\d+(\s·\s\d+)?/.test(next)) next = next.replace(/LV\s?\d+(\s·\s\d+)?/, label);
      else if(!tutorialActive()) next = `${next} · ${label}`;
      const TR = transferLayer();
      const suffix = TR ? safe(() => TR.hudSuffix(), "") : "";
      next = next.replace(/\s·\s(🧪 PROBE|⚡ SPEED|🎯 ACCURACY)$/u, "");
      if(suffix) next = `${next} · ${suffix}`;
      if(next !== text) el.textContent = next;
    } catch(_){}
  }
  let _labelObserver = null;
  function installLabelObserver(){
    if(_labelObserver || typeof MutationObserver !== "function") return;
    const el = document.getElementById("modeLabel");
    if(!el) return;
    _labelObserver = new MutationObserver(() => fixHudLabel());
    _labelObserver.observe(el, {childList:true, characterData:true, subtree:true});
  }
  wrapGlobal("computeLevelUpProgress", previous => function computeLevelUpProgressMD(){
    if(isBaseline() || tutorialActive() || !hasState() || State.mode !== "D") return previous.apply(this, arguments);
    return isRating() ? ratingFraction(st().rating.theta) : staircaseFraction();
  });
  wrapGlobal("levelProgressLabel", previous => function levelProgressLabelMD(progress){
    if(isBaseline() || tutorialActive() || !hasState() || State.mode !== "D") return previous.apply(this, arguments);
    const pct = clampN(Math.round(num(progress,0) * 100), 0, 100);
    if(isRating()){
      const th = st().rating.theta, lv = ratingLevel(th);
      const next = 1040 + lv * 10;
      const TR2 = transferLayer();
      const suf2 = TR2 ? safe(() => TR2.hudSuffix(), "") : "";
      return `Rating ${Math.round(th)} · LV ${lv} → ${lv + 1} at ${next}${suf2 ? ` · ${suf2}` : ""}`;
    }
    const TR = transferLayer();
    const suffix = TR ? safe(() => TR.hudSuffix(), "") : "";
    const tail = suffix ? ` · ${suffix}` : "";
    const lv = staircaseLevel();
    if(lv >= 100) return "LV 100 · every axis at its ceiling" + tail;
    return `LV ${lv} → ${lv + 1} · ${pct}%${tail}`;
  });

  // ------------------------------------------------------------------------
  // Block summary line
  // ------------------------------------------------------------------------
  wrapGlobal("resetBlock", previous => function resetBlockMD(){
    const out = previous.apply(this, arguments);
    try { st().block.levelAtStart = publicLevel(); st().block.thetaAtStart = st().rating.theta; st().block.peeks = 0; } catch(_){}
    try { if(!isBaseline()) clearHolds("block_start"); } catch(_){}
    return out;
  });
  wrapGlobal("showBlockSummary", previous => function showBlockSummaryMD(){
    const out = previous.apply(this, arguments);
    try {
      const card = document.getElementById("summaryCard");
      const stats = card ? card.querySelector(".summaryStats") : null;
      if(!card || !hasState() || State.mode !== "D") return out;
      const lv = publicLevel();
      const start = st().block.levelAtStart;
      const delta = Number.isFinite(start) ? lv - start : null;
      const deltaTxt = delta === null ? "" : ` (${delta >= 0 ? "+" : ""}${delta} this block)`;
      let line = document.getElementById("mdSummaryLine");
      if(!line){
        line = document.createElement("div");
        line.id = "mdSummaryLine";
        line.className = "md-summary-line";
        if(stats && stats.parentNode) stats.parentNode.insertBefore(line, stats.nextSibling); else card.appendChild(line);
      }
      const ms = milestoneCrossed(start, lv);
      const next = nextStepLine();
      const frac = safe(() => (typeof computeLevelUpProgress === "function" ? clampN(num(computeLevelUpProgress(), 0), 0, 1) : 0), 0);
      const pk = num(st().block.peeks, 0);
      line.innerHTML = `Progression · <b>${esc(MODES[mode()].name)}</b> · <b>${esc(isBaseline() ? `tier ${currentTier()+1}` : `LV ${lv}`)}</b>${esc(deltaTxt)}${pk ? ` · 🔍 peeked ${pk} (counted half, memory as missed)` : ""}` +
        (ms ? `<br>🏁 <b>Level milestone: LV ${ms}</b>` : "") +
        `<br>${esc(axisSummary())}` +
        (isBaseline() ? "" : `<br><span class="md-next">Next: ${Math.round(frac * 100)}% to LV ${lv + 1}${next ? ` · ${esc(next)}` : ""}</span>`);
      if(ms){ st().milestones = (st().milestones || []).concat([{lv:ms, at:Date.now()}]).slice(-30); saveState(); }
    } catch(_){}
    return out;
  });

  // ------------------------------------------------------------------------
  // Version identity + credits
  // ------------------------------------------------------------------------
  wrapGlobal("currentAppVersion", () => function currentAppVersionMD(){ return MD_VERSION; });
  function syncVersionSurface(){
    try { document.title = MD_TITLE; } catch(_){}
    try { document.querySelectorAll("[data-app-version]").forEach(el => { el.textContent = MD_LABEL; }); } catch(_){}
    try {
      const tpl = document.getElementById("guideTemplate");
      const root = tpl && tpl.content ? tpl.content : null;
      if(root) root.querySelectorAll("[data-app-version]").forEach(el => { el.textContent = MD_LABEL; });
    } catch(_){}
  }
  function installCredit(){
    const footer = document.querySelector("#overlay .overlay-footer");
    if(!footer || footer.querySelector(".md-credit")) return;
    const p = document.createElement("p");
    p.className = "md-credit";
    p.innerHTML =
      `<span class="md-credit-build">${esc(MD_TITLE)} · community fork</span><br>` +
      `A fork of Eucalculia <strong>${esc(BASE_VERSION)}</strong> by <strong>Alberto Flaño Lombardo</strong>, built with his permission.<br>` +
      `Ideas &amp; changes: <strong>mighty_elf</strong> and <strong>.da.rk.</strong> (Discord) · <button type="button" id="mdAboutBtn">about this build</button>`;
    footer.appendChild(p);
    p.querySelector("#mdAboutBtn").addEventListener("click", ev => { ev.preventDefault(); ev.stopPropagation(); openAbout(); });
  }

  function aboutHTML(){
    return `
      <button type="button" class="md-close" id="mdAboutClose">Close</button>
      <div class="md-eyebrow">About this build</div>
      <h2>${esc(MD_TITLE)}</h2>
      <p class="md-version-line">Version string <code>${esc(MD_VERSION)}</code> · base ${esc(BASE_VERSION)}</p>
      <p><strong>This is a fork of Alberto Flaño Lombardo's Eucalculia (${esc(BASE_VERSION)}), built with his permission.</strong>
      Alberto designed and wrote Eucalculia: the UFOV-style presentation, the mask, the L0→META¹→META²→META³ cascade,
      the ~900 question specifications, the compositional load budget and the within-individual adaptive system. All of that is his and is unchanged here.</p>
      <p>The ideas and the changes in this fork come jointly from <strong>mighty_elf</strong> and <strong>.da.rk.</strong> (Discord).
      It is not the original: if you want Alberto's release, use ${esc(BASE_VERSION)}. The fork is versioned on its own (v1.0 was published as “v7.2.0-md”; this is v${esc(FORK_VERSION)}).</p>
      <h3>What changed</h3>
      <ul>
        <li><strong>MEM cue restored to the v6.8.88 style.</strong> The 🧠 cue is back inside the stimulus frame as an amber capsule with its pop and ring,
        the frame glows amber while a retained item is on screen, and every MEM trial opens with a short banner (“REMEMBER THIS PAIR · MEM¹ 1/2 · ORIGINAL values”).
        In ${esc(BASE_VERSION)} the cue had been moved into the answer tray as plain text.</li>
        <li><strong>META¹ questions say which values to use</strong> (values as shown vs TRANSFORMED) for each retained pair, so the rule is never ambiguous at question time.</li>
        <li><strong>Progression modes</strong> (Settings → Progression): Baseline (Alberto's rule), Staircase and Rating — see below.</li>
        <li><strong>Adaptive META spacing</strong> (Staircase and Rating): the number of trials between the retained pairs and the META¹ question is a staircase of its own.
        It starts at 0 (the question follows right after the second retained pair) and grows only while you keep answering META questions correctly. META² and META³ questions are asked as soon as their second item is in — their retention interval is already a whole chain long (fixed in v1.4.1: holding them too made them pile up at the block end, and META³ could not start at high spacing). For the same reason the auto block size grows with the spacing when META² or META³ is on (Alberto's 20 / 30 up to 60, shown as “auto→N”), so that one full META cycle fits before the block-end drain. What matters is the absolute spacing, not the expanding shape (Karpicke &amp; Bauernschmidt 2011).</li>
        <li><strong>Continuous META chain</strong> (toggle, eto's suggestion): a retained item is always in the back of your mind — a new chain opens as soon as a META question has been delivered.</li>
        <li><strong>Learn — a step-by-step tutorial</strong> (v1.1): ten short lessons (a Vocabulary lesson since v1.5) with live practice built on the game's own stimulus renderers, a first-launch welcome card, a “? HELP” button that pauses a block and opens the matching lesson, and a coach strip that hints the first few times each kind of trial appears.</li>
        <li><strong>v1.5 — feedback from .da.rk.:</strong> 🔍 <strong>Peek</strong> on META¹/²/³ questions — buttons under the question reveal a retained item (Pair 2 RIGHT, Answer 1, Question B…) when a memory slip would otherwise waste a good question. The reasoning still counts; the memory part is what it costs: the question counts half for the rating, and as a <em>missed</em> memory for the META spacing staircase and for Alberto's META evidence (layer unlocks, runway tiers) — so nobody levels up in META without the memory aspect. Toggle in Settings → Progression; Staircase and Rating only. Also: META² / META³ questions say which retained answers they are about and how many trials ago they were; the META¹ spacing hold is measured in profile trials and cleared at block start, and a due META² / META³ is never kept waiting behind a META¹ hold (the "weird hold" where a META came as the 20th question); reading aids in the question (negation highlighting, term hints with a glossary — "role-based", "side transfer", "leaves after groups of 3", the finite-state machines…); the counted-halving and finite-state-machine cards now state the actual inner rule; the rotation card's viewpoint line is white like the instruction it belongs to; build-a-pair prompts reject trivial pairs (a smaller value of 1, a difference of 1) with an explanation instead of marking a mathematically correct pair wrong; and a little "seal" shine on the block summary. <strong>Round four</strong> (before release): the directed-graph stimuli are bigger with thicker, larger arrows; the paper-folding candidates sit in one row with sheets about twice the size on a PC; paper-folding items whose candidate patterns were visually identical (a symmetry image differing only by rounding — 20–27 % of the base's items by its own G083 distinctness rule) are rebuilt from another seed before they are shown; the correction card of a build-a-pair task shows a pair that works and why ("different square-number status and different multiple-of-3 status" → LEFT 9, RIGHT 5); and nested yes/no questions ("Is at least one of these true: (1)… (2)…") carry a line explaining the two-part answer. Android: the fork's overlays no longer let a pull gesture reach Chrome's pull-to-refresh, which reloaded the page — and a file opened from the Files app cannot be reloaded by Chrome ("Your file couldn't be accessed").</li>
        <li><strong>v1.4.1 — feedback from eto:</strong> the META layer is now <strong>selectable by hand</strong> on the level card (Auto / No META / META¹ / META² / META³, Staircase and Rating modes, from the menu). Auto stays Alberto's rule — layers open on META evidence and never run more than one above the tier. A layer set by hand opens its chains from the next eligible trial, the usual briefing card comes first the first time; choosing a lower layer drops the chains that were still collecting above it (a question already due is still asked once), and switching back to Auto returns to whatever the evidence says. Handy if you feel one layer has more potential for you than another. Also from .da.rk.'s report (PC): the Learn coach strip no longer sits inside the answer tray — it used to push the fraction-builder's READY button below the tray edge — it has its own row between the frame and the tray, reserved for the block so the frame does not jump. And META² / META³ questions are no longer held back by the spacing rule (only META¹ is), with the auto block size growing with the spacing so a META³ cycle fits before the block-end drain.</li>
        <li><strong>v1.4 — feedback from eto:</strong> LEFT/RIGHT stimuli are drawn larger on the dual panel (≈84 % of each half instead of ≈68 %; Settings → Progression → stimulus size: Normal / Large / Max), and the level card has <strong>manual controls</strong> — force the relational tier or the META spacing up or down from the menu in the Staircase and Rating modes (self-chosen difficulty trains as well as adaptive: von Bastian &amp; Eschen 2016).</li>
        <li><strong>v1.3 — feedback from .da.rk.:</strong> a <strong>level card</strong> at the top of the menu (big LV, progress to the next level, next milestone every 10 levels, “what moves it now” with the exact open conditions), a “Next:” line and milestone note in the block summary, a <strong>fair reaction-time tile</strong> (median per trial type; budget = type target + reading time for long questions; colour against your own usual pace), and a fix for a base bug where the first META¹ retained for META² (right after the META² briefing card) came up as a black frame with no question.</li>
        <li><strong>Transfer &amp; mastery layer</strong> (v1.2, Settings → Progression → Transfer &amp; mastery, Staircase and Rating modes): multiple short exposure staircases with easy lead-in trials and per-format exposure offsets (Hung &amp; Seitz 2014; Ahissar &amp; Hochstein 1997); rotating held-out formats with probe blocks and a transfer index that can hold the tier (Raviv, Lupyan &amp; Green 2022); a format-coverage cap with weak/stale-format bias; focus blocks that alternate speed and accuracy emphasis (Gopher, Weil &amp; Bareket 1994; Kramer, Larish &amp; Strayer 1995); an optional UFOV-style divided-attention marker (Ball et al. 2002; Edwards et al. 2017); calendar, course and booster guidance (Cepeda et al. 2008; Wang, Zhou &amp; Shah 2014; Lampit et al. 2014). The Staircase tier rule now uses chance-corrected accuracy (0.70 ≈ 85 % on YES/NO, 70 % on typed numbers).</li>
      </ul>
      <p><em>Honest framing:</em> meta-analyses of cognitive training find near transfer to similar tasks and little or no far transfer to general ability (Melby-Lervåg, Redick &amp; Hulme 2016; Sala et al. 2019). The one training family with long-term real-world outcome data is adaptive speed-of-processing training with boosters (ACTIVE: Rebok et al. 2014; Edwards et al. 2017; Coe et al. 2026), which is what the divided-attention marker and the booster schedule imitate. Everything else here is aimed at generalisation across formats and rules inside the task, measured by the probe blocks rather than assumed.</p>
      <h3>Progression modes</h3>
      <ul>
        <li><strong>Baseline</strong> — ${esc(MODES.baseline.desc)}</li>
        <li><strong>Staircase</strong> — ${esc(MODES.staircase.desc)}</li>
        <li><strong>Rating</strong> — ${esc(MODES.rating.desc)}</li>
      </ul>
      <h3>Frameworks the new modes rest on</h3>
      <ul>
        <li>Wilson, Shenhav, Straub &amp; Cohen (2019). The eighty five percent rule for optimal learning. <em>Nature Communications</em>, 10, 4646.</li>
        <li>Levitt (1971). Transformed up-down methods in psychoacoustics. <em>JASA</em>, 49, 467–477. · Kaernbach (1991). Simple adaptive testing with the weighted up-down method. <em>Perception &amp; Psychophysics</em>, 49, 227–229.</li>
        <li>Landauer &amp; Bjork (1978). Optimum rehearsal patterns and name learning. In <em>Practical aspects of memory</em>. · Karpicke &amp; Bauernschmidt (2011). Spaced retrieval: absolute spacing enhances learning regardless of relative spacing. <em>JEP: LMC</em>, 37, 1250–1257. · Bjork &amp; Bjork (2011), desirable difficulties.</li>
        <li>Hung &amp; Seitz (2014). Prolonged training at threshold promotes robust retinotopic specificity in perceptual learning. <em>Journal of Neuroscience</em>, 34, 8423–8431. · Ahissar &amp; Hochstein (1997). Task difficulty and the specificity of perceptual learning. <em>Nature</em>, 387, 401–406.</li>
        <li>Raviv, Lupyan &amp; Green (2022). How variability shapes learning and generalization. <em>Trends in Cognitive Sciences</em>, 26, 462–483. · Dahlin et al. (2008). Transfer of learning after updating training mediated by the striatum. <em>Science</em>, 320, 1510–1512.</li>
        <li>Gopher, Weil &amp; Bareket (1994). Transfer of skill from a computer game trainer to flight. <em>Human Factors</em>, 36, 387–405. · Kramer, Larish &amp; Strayer (1995). Training for attentional control in dual task settings. <em>JEP: Applied</em>, 1, 50–76.</li>
        <li>Rebok et al. (2014). Ten-year effects of the ACTIVE cognitive training trial. <em>JAGS</em>, 62, 16–24. · Edwards et al. (2017). Speed of processing training results in lower risk of dementia. <em>Alzheimer's &amp; Dementia: TRCI</em>, 3, 603–611. · Cepeda et al. (2008). Spacing effects in learning: a temporal ridgeline of optimal retention. <em>Psychological Science</em>, 19, 1095–1102. · Wang, Zhou &amp; Shah (2014). Spaced cognitive training promotes training transfer. <em>Frontiers in Human Neuroscience</em>, 8, 217.</li>
        <li>Melby-Lervåg, Redick &amp; Hulme (2016). Working memory training does not improve performance on measures of intelligence or other measures of “far transfer”. <em>Perspectives on Psychological Science</em>, 11, 512–534. · Sala et al. (2019). Near and far transfer in cognitive training: a second-order meta-analysis. <em>Collabra: Psychology</em>, 5, 18.</li>
        <li>Klinkenberg, Straatemeier &amp; van der Maas (2011). Computer adaptive practice of maths ability using a new item response model for on the fly ability and difficulty estimation. <em>Computers &amp; Education</em>, 57, 1813–1824.</li>
        <li>Maris &amp; van der Maas (2012). Speed-accuracy response models: scoring rules based on response time and accuracy. <em>Psychometrika</em>, 77, 615–633.</li>
        <li>Ball et al. (2002) / Edwards et al. (2005): UFOV speed-of-processing training adapts display duration with a staircase — the same axis Eucalculia's exposure time already follows.</li>
      </ul>
      <p>Progression state for the new modes is stored next to your profile (<code>euca:md:prog</code>) and never modifies Alberto's saved profile format. Export/Import progress keeps working as before.</p>
    `;
  }
  function openAbout(){
    let m = document.getElementById("mdAboutModal");
    if(!m){
      m = document.createElement("div");
      m.id = "mdAboutModal";
      m.setAttribute("role", "dialog");
      m.setAttribute("aria-modal", "true");
      m.setAttribute("aria-label", "About this build");
      m.innerHTML = `<div id="mdAboutCard">${aboutHTML()}</div>`;
      document.body.appendChild(m);
      m.addEventListener("click", ev => { if(ev.target === m) closeAbout(); });
      // Escape is intercepted by the app's window-level capture handler (which
      // stops propagation), so listen at the same level, registered later.
      window.addEventListener("keydown", ev => {
        if(ev.key === "Escape" && m.classList.contains("visible")){ ev.preventDefault(); ev.stopImmediatePropagation(); closeAbout(); }
      }, true);
      m.querySelector("#mdAboutClose").addEventListener("click", closeAbout);
    }
    m.classList.add("visible");
    try { m.querySelector("#mdAboutClose").focus(); } catch(_){}
  }
  function closeAbout(){
    const m = document.getElementById("mdAboutModal");
    if(!m || !m.classList.contains("visible")) return;
    m.classList.remove("visible");
    safe(() => { const back = document.getElementById("mdAboutBtn2") || document.getElementById("mdAboutBtn"); back && back.focus({preventScroll:true}); });
  }
  // keep the app's Tab focus trap inside the About card while it is open
  wrapGlobal("activeModalForFocusTrap", previous => function activeModalForFocusTrapMD(){
    const m = document.getElementById("mdAboutModal");
    if(m && m.classList.contains("visible")) return m;
    return previous.apply(this, arguments);
  });

  // ------------------------------------------------------------------------
  // Pair stimulus size (eto: "see the stimuli better on the dual panel")
  // Alberto's r320 pair band normalises each LEFT/RIGHT stimulus to ≈68 % of its
  // half width inside a band 72 % tall. "Large" (default) raises that to ≈84 % in
  // an 84 % band, "Max" to ≈94 % / 92 %. Only the geometry contract changes; the
  // renderers, seeds and replay specs are untouched, and audit stims pass through.
  // ------------------------------------------------------------------------
  const PAIR_SIZES = {normal:null, large:{occ:0.84, band:0.84, pad:0.025}, max:{occ:0.94, band:0.92, pad:0.015}};
  const PAIR_SIZE_ORDER = ["normal", "large", "max"];
  function pairSize(){ const v = st().pairSize; return PAIR_SIZES.hasOwnProperty(v) ? v : "large"; }
  function setPairSize(v){
    if(!PAIR_SIZES.hasOwnProperty(v)) return false;
    st().pairSize = v; saveStateNow();
    safe(() => { if(typeof clearStimulusCanvasCache === "function") clearStimulusCanvasCache("md_pair_size"); });
    safe(() => { if(typeof invalidatePreparedTrial === "function") invalidatePreparedTrial("md_pair_size"); });
    renderSection();
    return true;
  }
  wrapGlobal("h320L0PairLayoutProfile", previous => function h320L0PairLayoutProfileMD(stim, w, h){
    const p = previous.apply(this, arguments);
    try {
      const size = PAIR_SIZES[pairSize()];
      if(!size || !p || !p.enabled || MD._audit || (stim && stim.__eucaR320PairAudit)) return p;
      const width = p.width, height = p.height;
      const padX = Math.max(4, Math.round(width * size.pad));
      const bandHeight = Math.max(1, Math.min(height, Math.round(Math.min(height * size.band, Math.max(220, width * 2.2)))));
      const bandY = Math.max(0, Math.round((height - bandHeight) / 2));
      const safeRect = Object.freeze({x:padX, y:bandY, width:Math.max(1, width - padX * 2), height:bandHeight});
      const minInk = Math.min(safeRect.width * 0.96, Math.max(width * size.occ, Math.min(96, safeRect.width * 0.96)));
      return Object.freeze({...p, band:Object.freeze({x:0, y:bandY, width, height:bandHeight}), safe:safeRect, minimumInlineInkPx:+minInk.toFixed(2), cacheKey:`${p.cacheKey}:md-${pairSize()}`});
    } catch(_){ return p; }
  });
  // Cap the bitmap up-scaling of small stimuli (one coin, one stroke) at 1.8× their
  // native ink so "Large"/"Max" enlarge the drawing box rather than blur a tiny object.
  wrapGlobal("h320NormalizeL0PairInk", previous => function h320NormalizeL0PairInkMD(canvas, context, profile, dpr){
    try {
      if(profile && profile.enabled && /:md-/.test(String(profile.cacheKey || "")) && typeof h320L0PairInkBounds === "function"){
        const first = h320L0PairInkBounds(canvas, profile.band);
        if(first && first.width > 0){
          const capped = Math.min(profile.minimumInlineInkPx, first.width * 1.8);
          if(capped < profile.minimumInlineInkPx) profile = Object.freeze({...profile, minimumInlineInkPx:+capped.toFixed(2)});
        }
      }
    } catch(_){}
    return previous.call(this, canvas, context, profile, dpr);
  });
  // Alberto's audit suite sees his own geometry and his own META layers
  for(const name of ["runFeatureAudit", "auditL0CrossRepProjection", "auditConstructiveGenerationRuntime", "auditVisualReplayContractCoverage", "auditAutoTransformReplayFidelity"]){
    wrapGlobal(name, previous => function auditPassthroughMD(){
      const prior = MD._audit; MD._audit = true;
      try { return previous.apply(this, arguments); } finally { MD._audit = prior; }
    });
  }

  // ------------------------------------------------------------------------
  // Level card (menu, front and center) + milestones every 10 levels
  // ------------------------------------------------------------------------
  const MILESTONE_STEP = 10;
  function nextMilestone(lv){ return Math.floor(num(lv, 1) / MILESTONE_STEP) * MILESTONE_STEP + MILESTONE_STEP; }
  function spacingStreak(){ const o = st().spacing.outcomes || []; let n = 0; for(let i = o.length - 1; i >= 0 && o[i]; i--) n++; return n; }
  // The concrete conditions that move the level right now, as {text, state:"ok"|"todo"|"info"}
  function levelRequirements(){
    const rows = [];
    if(!hasState()) return rows;
    const TR = transferLayer();
    if(!relationalReached() || State.mode !== "D"){
      const prog = safe(() => (typeof computeLevelUpProgress === "function" ? computeLevelUpProgress() : 0), 0);
      const detail = safe(() => (typeof levelProgressLabel === "function" ? levelProgressLabel(prog) : ""), "");
      rows.push({text:"Numerical sense phase: the level is the value range you have unlocked. A value × format cell counts as mastered when its exposure gets down to about 140 ms; the next range opens when enough cells are mastered.", state:"info"});
      if(detail) rows.push({text:detail, state:prog >= 0.995 ? "ok" : "todo"});
      return rows;
    }
    const tier = currentTier(), tmax = tierMax();
    const T = tierWinSync();
    if(isBaseline()){
      const blockers = safe(() => (typeof adaptiveDLevelUpBlockers === "function" ? adaptiveDLevelUpBlockers() : []), []);
      rows.push({text:`Tier ${tier + 1}/${tmax + 1} · Alberto's within-individual baseline: beat your own accuracy and RT history at this tier.`, state:"info"});
      if(!blockers.length) rows.push({text:"Gate satisfied — the next relational trials can move the tier.", state:"ok"});
      for(const b of blockers.slice(0, 4)) rows.push({text:String(b), state:"todo"});
      return rows;
    }
    if(isStaircase()){
      const n = T.win.length, acc = winAccuracy(20);
      const accNow = (() => { const w = T.win.slice(-20); if(!w.length) return null; let nu = 0, de = 0; for(const e of w){ const ch = clampN(num(e.ch,0),0,0.9); nu += (e.c?1:0) - ch; de += 1 - ch; } return de ? clampN(nu/de,0,1) : null; })();
      if(tier >= tmax) rows.push({text:`Tier ${tier + 1}/${tmax + 1} — top tier reached.`, state:"ok"});
      else {
        const ready = acc !== null && acc >= STAIR_UP;
        const need = Math.round(STAIR_UP * 100);
        if(n === 0) rows.push({text:`Tier ${tier + 1}/${tmax + 1}: new window — the next 20 relational trials decide. Window score ≥ ${need} (≈ 85% right on YES/NO questions, 70% on typed answers) moves the tier up.`, state:"todo"});
        else rows.push({text:`Tier ${tier + 1}/${tmax + 1}: window score ${Math.round(num(accNow, 0) * 100)}/100 over the last ${Math.min(20, n)}/20 trials · need ${need} (≈ 85% right on YES/NO, 70% on typed answers)${n < 20 ? ` · ${20 - n} more to fill the window` : ""}`, state:ready ? "ok" : "todo"});
        if(!familiesOk()) rows.push({text:"Relation families: a few more families need to be active at this tier.", state:"todo"});
        const blockers = runwayBlockers(tier + 1);
        if(blockers.length) rows.push({text:`Next tier waits for META evidence: ${blockers[0]}`, state:"todo"});
        if(TR && safe(() => TR.blocksTierUp(), false)) rows.push({text:"Tier on hold: the last transfer probe lagged by more than 10 points — variety is widened until the next probe.", state:"todo"});
      }
      rows.push({text:`Exposure ${Math.round(exposureMs())} ms (floor ${Math.round(exposureFloor())}): −5 ms per correct answer, +30 ms per error.`, state:exposureMs() <= exposureFloor() + 1 ? "ok" : "info"});
      rows.push(metaLayerRow());
      const sp = num(st().spacing.level, 0);
      rows.push({text:sp >= SPACING_MAX ? `META spacing ${sp}/${SPACING_MAX} — maximum.` : `META spacing ${sp}/${SPACING_MAX} (trials between the retained pairs and the META¹ question): ${spacingStreak()}/4 correct META answers in a row → +1.`, state:sp >= SPACING_MAX ? "ok" : "todo"});
      if(TR && TR.snapshot){ const sn = safe(() => TR.snapshot(), null); if(sn && sn.toggles && sn.toggles.probes){ rows.push(sn.lastIndex === null || sn.lastIndex === undefined ? {text:"Transfer probe: none yet (every 6th relational block).", state:"info"} : {text:`Transfer probe: ${sn.lastIndex >= 0 ? "+" : ""}${Math.round(sn.lastIndex * 100)} pts on untrained formats (needs ≥ −10).`, state:sn.lastIndex >= -0.10 ? "ok" : "todo"}); } }
      return rows;
    }
    // rating
    const R = st().rating, th = num(R.theta, 1060), lv = ratingLevel(th), next = 1040 + lv * 10;
    const E = expected(th, baseDifficulty(tier, 0));
    rows.push({text:`Rating ${Math.round(th)} → LV ${lv + 1} at ${next} (${Math.max(0, Math.round(next - th))} points to go). Fast correct answers add the most; fast errors cost the most.`, state:"todo"});
    rows.push({text:`Tier ${tier + 1}/${tmax + 1}: expected success here ≈ ${Math.round(E * 100)}% · the tier steps up when the rating predicts ≥ 80% one tier higher${tier < tmax ? ` (rating ≥ ${Math.round(thetaForTier(tier + 1) - 20 + 15)})` : ""}.`, state:tier >= tmax ? "ok" : (targetTierForTheta(th - 15) > tier ? "ok" : "todo")});
    const blockers = runwayBlockers(tier + 1);
    if(blockers.length) rows.push({text:`Next tier waits for META evidence: ${blockers[0]}`, state:"todo"});
    rows.push({text:`Exposure ${Math.round(exposureMs())} ms: −5 ms per correct answer, +30 ms per error.`, state:"info"});
    rows.push(metaLayerRow());
    const sp = num(st().spacing.level, 0);
    rows.push({text:sp >= SPACING_MAX ? `META spacing ${sp}/${SPACING_MAX} — maximum.` : `META spacing ${sp}/${SPACING_MAX} (trials between the retained pairs and the META¹ question): ${spacingStreak()}/4 correct META answers in a row → +1.`, state:sp >= SPACING_MAX ? "ok" : "todo"});
    return rows;
  }
  // The META-layer line of the level card: Auto (evidence) or the layer set by hand.
  function metaLayerRow(){
    const ml = metaLevel(), forced = forcedMetaLevel();
    if(forced !== null){
      const auto = autoMetaLevel();
      const autoTxt = auto >= 1 ? `Auto would run ${META_NAMES[auto]} now` : "Auto would run no META layer yet";
      if(forced === 0) return {text:`META layer: No META (set by hand) — no META chains open (a question that was already due when you chose it is still asked once). ${autoTxt}; choose Auto below to let the evidence decide again.`, state:"info"};
      return {text:`${META_NAMES[forced]} set by hand — chains for this layer open from the next eligible trial (the first time a layer appears, its briefing card is shown). ${autoTxt}; Auto opens layers on META evidence and keeps them ≤ tier + 1.`, state:"info"};
    }
    return {text:ml >= 3 ? "META³ active — the deepest memory layer." : `${ml >= 1 ? ({1:"META¹",2:"META²"})[ml] + " active" : "META¹ not active yet"} · the next layer opens on META evidence (correct META answers at the current layer), or pick a layer by hand below.`, state:ml >= 3 ? "ok" : "info"};
  }
  function levelCardData(){
    const lv = publicLevel();
    const frac = safe(() => (typeof computeLevelUpProgress === "function" ? clampN(num(computeLevelUpProgress(), 0), 0, 1) : 0), 0);
    const ms = nextMilestone(lv);
    const forced = forcedMetaLevel();
    const phase = !relationalReached() || (hasState() && State.mode !== "D") ? "Numerical sense" : ((metaLevel() >= 1 ? ({1:"META¹",2:"META²",3:"META³"})[metaLevel()] : "Relational") + (forced !== null ? " · manual" : ""));
    return {lv, frac, milestone:ms, phase, mode:MODES[mode()].name, label:publicLevelLabel(), rows:levelRequirements(), metaManual:forced, metaAuto:autoMetaLevel()};
  }
  // ---- Manual control (eto's request): force the relational tier or the META spacing ----
  // Self-selected difficulty produced the same gains and transfer as adaptive difficulty in
  // the controlled comparisons (von Bastian & Eschen 2016; Lau et al. 2025), so a manual step
  // costs nothing scientifically. Forced steps are logged; the normal rules keep working after.
  function manualAllowed(){
    return hasState() && !isBaseline() && State.mode === "D" && relationalReached() && (!State.running || State.paused);
  }
  function manualTierChange(dir){
    if(!manualAllowed()) return {ok:false, why:"Manual steps work in the Staircase and Rating modes, from the menu, once the relational phase has started."};
    const from = currentTier(), to = clampN(from + dir, 0, tierMax());
    if(to === from) return {ok:false, why:dir > 0 ? "Top tier reached." : "Already at the first tier."};
    State.levelByMode.D = to;
    safe(() => invalidateDAutoSnapshot(dir > 0 ? "md_manual_level_up" : "md_manual_level_down"));
    if(dir > 0){
      if(State.peakLevelByMode && to > num(State.peakLevelByMode.D, 0)) State.peakLevelByMode.D = to;
      State.recentLevelDown = null;
      safe(() => { if(typeof syncAutoReadingRangeAfterRelationalLevelUp === "function") syncAutoReadingRangeAfterRelationalLevelUp(); });
    } else {
      State.recentLevelDown = {to, fromLevel:from, fromTrial:num(State.stats && State.stats.trials, 0), fromTs:Date.now(), manual:true};
    }
    safe(() => { if(typeof ensureAdaptiveBaselineForLevel === "function") ensureAdaptiveBaselineForLevel("D", to); });
    safe(() => { if(typeof invalidatePreparedTrial === "function") invalidatePreparedTrial("md_manual_tier"); });
    const T = st().tier;
    T.changes = (T.changes || []).concat([{dir, from, at:Date.now(), manual:true}]).slice(-40);
    T.win = []; T.level = to; T.changedAtTrial = num(State.stats && State.stats.trials, 0);
    if(isRating()){
      const lo = thetaForTier(to) - 20 + 16, hi = thetaForTier(to + 1) - 20 - 16;
      st().rating.theta = to < tierMax() ? clampN(st().rating.theta, lo, Math.max(lo, hi)) : Math.max(st().rating.theta, lo);
    }
    st().manualMoves = num(st().manualMoves, 0) + 1;
    saveStateNow();
    safe(() => { if(typeof save === "function") save(); });
    safe(() => { if(typeof forceHUDUpdate === "function") forceHUDUpdate("md_manual_tier"); });
    safe(() => { if(typeof updateMenu === "function") updateMenu({force:true}); });
    renderLevelCard(); renderSection();
    return {ok:true, from, to, level:publicLevel()};
  }
  function manualSpacingChange(dir){
    if(!manualAllowed()) return {ok:false, why:"Manual steps work in the Staircase and Rating modes, from the menu."};
    const S = st().spacing, from = num(S.level, 0), to = clampN(from + dir, 0, SPACING_MAX);
    if(to === from) return {ok:false, why:dir > 0 ? "Spacing is at its maximum." : "Spacing is already 0."};
    S.level = to; S.outcomes = []; S.changes = num(S.changes, 0) + 1;
    st().manualMoves = num(st().manualMoves, 0) + 1;
    saveStateNow(); renderLevelCard(); renderSection();
    safe(() => { if(typeof forceHUDUpdate === "function") forceHUDUpdate("md_manual_spacing"); });
    return {ok:true, from, to, level:publicLevel()};
  }
  // A layer chosen by hand below a chain that is still collecting: the user said
  // stop, so collecting chains above the new layer are dropped. A question that is
  // already due (both items retained) is still asked — it costs one trial, not a
  // whole cycle. Auto keeps Alberto's contract (promises are honoured in full).
  function cancelCollectingChainsAbove(level){
    const P = plans(), dropped = [];
    for(const lv of [1, 2, 3]){
      if(lv <= level) continue;
      const p = P[lv];
      if(p && p.active && !p.due){
        p.active = false; p.collected = 0; p.items = [];
        safe(() => { if(typeof defaultMemSpacingState === "function") p.spacing = defaultMemSpacingState(); });
        dropped.push(lv);
      }
    }
    if(num(State.forceOpenMetaMemoryPlanLevel, 0) > level) State.forceOpenMetaMemoryPlanLevel = null;
    return dropped;
  }
  // value: "auto" | null | 0..3
  function manualMetaChange(value){
    if(!manualAllowed()) return {ok:false, why:"The META layer can be chosen in the Staircase and Rating modes, from the menu, once the relational phase has started."};
    const next = (value === "auto" || value === null || value === undefined || value === "") ? null : clampN(Math.round(num(value, 0)), 0, 3);
    const prev = manualMeta();
    if(next === prev) return {ok:false, why:next === null ? "Already on Auto." : `${META_NAMES[next]} is already selected.`};
    const before = metaLevel();
    st().manualMeta = next;
    const dropped = next === null ? [] : cancelCollectingChainsAbove(next);
    st().manualMetaChanges = (st().manualMetaChanges || []).concat([{from:prev, to:next, at:Date.now(), trial:num(State.stats && State.stats.trials, 0), dropped}]).slice(-40);
    MD._ovSrc = null; MD._ovOut = null;
    safe(() => invalidateDAutoSnapshot(next === null ? "md_manual_meta_auto" : "md_manual_meta_" + next));
    safe(() => { if(typeof invalidatePreparedTrial === "function") invalidatePreparedTrial("md_manual_meta"); });
    // Alberto's own transition bookkeeping: a rise opens a fresh memory window
    // (promised chains are preserved), a drop is only recorded.
    safe(() => { if(typeof dMaybeShowAutoUnlockNotice === "function") dMaybeShowAutoUnlockNotice(); });
    safe(() => { if(typeof applyAutoBlockSizeForCurrentState === "function" && !State.running) applyAutoBlockSizeForCurrentState(); });
    st().manualMoves = num(st().manualMoves, 0) + 1;
    saveStateNow();
    safe(() => { if(typeof save === "function") save(); });
    safe(() => { if(typeof forceHUDUpdate === "function") forceHUDUpdate("md_manual_meta"); });
    safe(() => { if(typeof updateMenu === "function") updateMenu({force:true}); });
    renderLevelCard(); renderSection();
    return {ok:true, from:prev, to:next, before, after:metaLevel(), auto:autoMetaLevel(), level:publicLevel(), dropped};
  }
  function metaChangeNote(r){
    const name = lv => lv >= 1 ? META_NAMES[lv] : "no META layer";
    if(r.to === null) return `META layer → Auto · the evidence decides again: ${name(r.after)} now · LV ${r.level}.`;
    const drop = r.dropped && r.dropped.length ? ` · ${r.dropped.map(l => META_NAMES[l]).join(", ")} chain${r.dropped.length > 1 ? "s" : ""} still collecting dropped` : "";
    if(r.to === 0) return `META layer → No META · no new META chains open; a question that is already due is still asked${drop} · LV ${r.level}.`;
    return `META layer → ${META_NAMES[r.to]} · chains open from the next eligible trial${r.to > r.auto ? " — the briefing card comes first if this layer is new to you" : ""}${drop} · now LV ${r.level}.`;
  }
  function flashCardNote(text, ok){
    const card = document.getElementById("mdLevelCard"); if(!card) return;
    const note = card.querySelector(".md-lc-note"); if(!note) return;
    note.textContent = text; note.classList.toggle("bad", !ok); note.classList.add("visible");
    clearTimeout(MD._noteTimer); MD._noteTimer = setTimeout(() => note.classList.remove("visible"), 4200);
  }

  function ensureLevelCard(){
    let card = document.getElementById("mdLevelCard");
    if(card) return card;
    const overlayCard = document.getElementById("overlayCard");
    if(!overlayCard) return null;
    card = document.createElement("section");
    card.id = "mdLevelCard";
    card.setAttribute("aria-label", "Your level and what moves it");
    card.innerHTML =
      `<div class="md-lc-top"><div class="md-lc-left"><div class="md-lc-eyebrow"></div><div class="md-lc-phase"></div></div><div class="md-lc-level"><span class="md-lc-lv">LV</span><span class="md-lc-num">1</span></div></div>` +
      `<div class="md-lc-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i></div>` +
      `<div class="md-lc-next"></div>` +
      `<button type="button" class="md-lc-toggle" aria-expanded="true">What moves it now</button>` +
      `<ul class="md-lc-rows"></ul>` +
      `<div class="md-lc-manual">` +
        `<div class="md-lc-manual-row"><span class="md-lc-manual-label">Tier</span><button type="button" class="md-lc-btn" data-act="tier-down" aria-label="Tier down">▼</button><span class="md-lc-manual-val" data-val="tier">—</span><button type="button" class="md-lc-btn" data-act="tier-up" aria-label="Tier up">▲</button></div>` +
        `<div class="md-lc-manual-row"><span class="md-lc-manual-label">META spacing</span><button type="button" class="md-lc-btn" data-act="sp-down" aria-label="Spacing down">▼</button><span class="md-lc-manual-val" data-val="spacing">—</span><button type="button" class="md-lc-btn" data-act="sp-up" aria-label="Spacing up">▲</button></div>` +
        `<div class="md-lc-manual-row md-lc-seg-row"><span class="md-lc-manual-label">META layer</span>` +
          `<div class="md-lc-seg" role="radiogroup" aria-label="META layer">` +
            ["auto", "0", "1", "2", "3"].map(v => `<button type="button" class="md-lc-btn md-lc-segbtn" role="radio" aria-checked="false" data-meta="${v}">${v === "auto" ? "Auto" : esc(META_NAMES[Number(v)])}</button>`).join("") +
          `</div>` +
        `</div>` +
        `<div class="md-lc-manual-hint"></div>` +
        `<div class="md-lc-note" aria-live="polite"></div>` +
      `</div>`;
    const brand = overlayCard.querySelector(".brandRow");
    if(brand && brand.parentNode === overlayCard) overlayCard.insertBefore(card, brand.nextSibling); else overlayCard.insertBefore(card, overlayCard.firstChild);
    card.querySelector(".md-lc-toggle").addEventListener("click", ev => {
      ev.preventDefault(); ev.stopPropagation();
      const open = card.classList.toggle("collapsed") === false;
      card.querySelector(".md-lc-toggle").setAttribute("aria-expanded", String(open));
      st().levelCardOpen = open; saveState();
    });
    if(st().levelCardOpen === false){ card.classList.add("collapsed"); card.querySelector(".md-lc-toggle").setAttribute("aria-expanded", "false"); }
    card.querySelectorAll(".md-lc-btn[data-act]").forEach(btn => btn.addEventListener("click", ev => {
      ev.preventDefault(); ev.stopPropagation();
      const act = btn.dataset.act;
      const r = act === "tier-up" ? manualTierChange(+1) : act === "tier-down" ? manualTierChange(-1) : act === "sp-up" ? manualSpacingChange(+1) : manualSpacingChange(-1);
      if(!r.ok) flashCardNote(r.why || "Not available.", false);
      else if(act.startsWith("tier")) flashCardNote(`Tier ${r.from + 1} → ${r.to + 1} · now LV ${r.level}. The normal rules keep working from here — a tier that is too hard steps back down on its own.`, true);
      else flashCardNote(`META spacing ${r.from} → ${r.to} · now LV ${r.level}.`, true);
    }));
    card.querySelectorAll(".md-lc-segbtn").forEach(btn => btn.addEventListener("click", ev => {
      ev.preventDefault(); ev.stopPropagation();
      const v = btn.dataset.meta;
      const r = manualMetaChange(v === "auto" ? "auto" : Number(v));
      if(!r.ok) flashCardNote(r.why || "Not available.", false);
      else flashCardNote(metaChangeNote(r), true);
    }));
    return card;
  }
  function renderLevelCard(){
    const card = ensureLevelCard();
    if(!card || !hasState()) return;
    const d = levelCardData();
    card.querySelector(".md-lc-eyebrow").textContent = `${d.mode} progression`;
    card.querySelector(".md-lc-phase").textContent = d.phase;
    card.querySelector(".md-lc-num").textContent = String(d.lv);
    const bar = card.querySelector(".md-lc-bar"); bar.querySelector("i").style.width = `${Math.round(d.frac * 100)}%`; bar.setAttribute("aria-valuenow", String(Math.round(d.frac * 100)));
    const capped = isStaircase() && d.lv >= 100;
    card.querySelector(".md-lc-next").innerHTML = capped ? `<b>LV 100</b> · every axis at its ceiling` :
      `<b>${Math.round(d.frac * 100)}%</b> to LV ${d.lv + 1} · next milestone <b>LV ${d.milestone}</b> (${d.milestone - d.lv} level${d.milestone - d.lv === 1 ? "" : "s"} away)`;
    const ul = card.querySelector(".md-lc-rows");
    ul.innerHTML = d.rows.map(r => `<li class="md-lc-${esc(r.state)}"><span class="md-lc-ico">${r.state === "ok" ? "✓" : (r.state === "todo" ? "→" : "·")}</span><span>${esc(r.text)}</span></li>`).join("");
    // manual controls
    const manual = card.querySelector(".md-lc-manual");
    if(manual){
      const allowed = manualAllowed();
      manual.classList.toggle("disabled", !allowed);
      manual.querySelectorAll(".md-lc-btn").forEach(b => { b.disabled = !allowed; });
      const tv = manual.querySelector('[data-val="tier"]'); if(tv) tv.textContent = `${currentTier() + 1}/${tierMax() + 1}`;
      const sv = manual.querySelector('[data-val="spacing"]'); if(sv) sv.textContent = `${num(st().spacing.level, 0)}/${SPACING_MAX}`;
      const sel = isBaseline() ? "auto" : (manualMeta() === null ? "auto" : String(manualMeta()));
      const auto = autoMetaLevel();
      manual.querySelectorAll(".md-lc-segbtn").forEach(b => {
        const on = b.dataset.meta === sel;
        b.setAttribute("aria-checked", String(on));
        b.classList.toggle("on", on);
        if(b.dataset.meta === "auto") b.title = allowed ? `Alberto's evidence-based layers · ${auto >= 1 ? META_NAMES[auto] + " now" : "no META layer yet"}` : "";
        else if(b.dataset.meta === "0") b.title = allowed ? "No META chains: relational LEFT/RIGHT questions only" : "";
        else b.title = allowed ? `Force ${META_NAMES[Number(b.dataset.meta)]} on` : "";
      });
      const hint = manual.querySelector(".md-lc-manual-hint");
      if(hint) hint.textContent = allowed
        ? `Manual steps: choose your own tier, spacing or META layer${manualMeta() !== null ? ` (Auto is at ${auto >= 1 ? META_NAMES[auto] : "no META layer"} right now)` : ""}. Self-chosen difficulty trains as well as adaptive difficulty (von Bastian & Eschen 2016); the rules keep adapting afterwards.`
        : (isBaseline() ? "Manual steps are available in the Staircase and Rating modes (Baseline keeps Alberto's rules untouched)." : (!relationalReached() ? "Manual steps unlock once the relational phase has started." : "Manual steps are made from the menu."));
    }
  }
  function milestoneCrossed(from, to){
    if(!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return null;
    const m = Math.floor(to / MILESTONE_STEP) * MILESTONE_STEP;
    return m > from && m >= MILESTONE_STEP ? m : null;
  }
  // one-line "what next" for the block summary
  function nextStepLine(){
    const rows = levelRequirements().filter(r => r.state === "todo");
    if(!rows.length){ const ok = levelRequirements().find(r => r.state === "ok"); return ok ? ok.text : ""; }
    return rows[0].text;
  }

  // ------------------------------------------------------------------------
  // Settings section
  // ------------------------------------------------------------------------
  function setMode(next){
    if(!MODES[next]) return false;
    const S = st();
    if(S.mode === next) return true;
    S.mode = next;
    if(next === "rating" && !(num(S.rating.n,0) > 0)) S.rating.theta = thetaForTier(currentTier());
    if(next === "rating"){
      // keep the tier where it is: nudge theta into the band of the current tier
      const lo = thetaForTier(currentTier()) - 20 + 16, hi = thetaForTier(currentTier() + 1) - 20 - 16;
      if(currentTier() < tierMax()) S.rating.theta = clampN(S.rating.theta, lo, Math.max(lo, hi));
      else S.rating.theta = Math.max(S.rating.theta, lo);
    }
    S.tier.win = [];
    S.tier.level = currentTier();
    saveStateNow();
    renderSection();
    safe(() => { if(typeof forceHUDUpdate === "function") forceHUDUpdate("md_mode"); else if(typeof updateHUD === "function") updateHUD(true); });
    safe(() => { if(typeof updateMenu === "function") updateMenu({force:true}); });
    return true;
  }
  function statusText(){
    const blockers = currentTier() < tierMax() ? runwayBlockers(currentTier() + 1) : [];
    const gate = blockers.length ? ` · next tier: ${blockers[0]}` : "";
    if(isBaseline()) return `Current: relational tier ${currentTier()+1}/${tierMax()+1} · exposure ${Math.round(exposureMs())} ms · ${axisSummary().split(" · ").slice(2).join(" · ")}${gate}`;
    return `Current: ${publicLevelLabel()} · ${axisSummary()}${gate}`;
  }
  function renderSection(){
    const sec = document.getElementById("mdProgressionSection");
    if(!sec) return;
    const S = st();
    sec.querySelectorAll(".md-mode").forEach(btn => { btn.setAttribute("aria-checked", String(btn.dataset.mode === S.mode)); });
    const desc = sec.querySelector(".md-desc"); if(desc) desc.textContent = MODES[S.mode].desc;
    const status = sec.querySelector(".md-status"); if(status) status.textContent = statusText();
    const cont = sec.querySelector("#mdToggleContinuous");
    if(cont){ cont.setAttribute("aria-pressed", String(!!S.continuousMeta)); cont.disabled = isBaseline(); cont.title = isBaseline() ? "Available in Staircase and Rating" : ""; }
    const ban = sec.querySelector("#mdToggleBanner"); if(ban) ban.setAttribute("aria-pressed", String(!!S.memBanner));
    const pk = sec.querySelector("#mdTogglePeek");
    if(pk){ pk.setAttribute("aria-pressed", String(!!S.peek && !isBaseline())); pk.disabled = isBaseline(); pk.title = isBaseline() ? "Available in Staircase and Rating (Baseline keeps Alberto's rules untouched)" : "Reveal a retained item during a META question — counts half, memory as missed"; }
    sec.querySelectorAll(".md-pairsize-btn").forEach(btn => btn.setAttribute("aria-checked", String(btn.dataset.size === pairSize())));
    const nw = sec.querySelector(".md-new"); if(nw) nw.style.display = "";
  }
  function installSection(){
    const panel = document.querySelector("#settingsPanel .panelBody");
    if(!panel || document.getElementById("mdProgressionSection")) return;
    const sec = document.createElement("div");
    sec.id = "mdProgressionSection";
    sec.setAttribute("role", "group");
    sec.setAttribute("aria-label", "Progression mode");
    sec.innerHTML =
      `<div class="md-sec-title"><span>Progression</span><span class="md-new">${esc(MD_LABEL)}</span></div>` +
      `<div class="md-modes" role="radiogroup" aria-label="Progression mode">` +
        MODE_ORDER.map(id => `<button type="button" class="md-mode" role="radio" aria-checked="false" data-mode="${id}">` +
          `<span class="md-mode-name">${esc(MODES[id].name)}</span><span class="md-mode-sub">${esc(MODES[id].sub)}</span><span class="md-mode-tag">${esc(MODES[id].tag)}</span></button>`).join("") +
      `</div>` +
      `<div class="md-desc"></div>` +
      `<div class="md-status" aria-live="polite"></div>` +
      `<div class="md-toggles">` +
        `<button type="button" class="md-toggle" id="mdToggleContinuous" aria-pressed="false">Continuous META chain</button>` +
        `<button type="button" class="md-toggle" id="mdToggleBanner" aria-pressed="false">MEM banner hold at trial start</button>` +
        `<button type="button" class="md-toggle" id="mdTogglePeek" aria-pressed="false" title="Reveal a retained item during a META question — counts half, memory as missed">🔍 Peek on META questions</button>` +
      `</div>` +
      `<div class="md-pairsize" role="radiogroup" aria-label="Pair stimulus size"><span class="md-pairsize-label">LEFT/RIGHT stimulus size</span>` +
        PAIR_SIZE_ORDER.map(id => `<button type="button" class="md-toggle md-pairsize-btn" role="radio" aria-checked="false" data-size="${id}">${({normal:"Normal (Alberto)", large:"Large", max:"Max"})[id]}</button>`).join("") +
      `</div>` +
      `<div class="md-about-row"><button type="button" class="md-link-btn" id="mdAboutBtn2">About this build · credits</button></div>`;
    const notice = panel.querySelector(".autoCoreNotice");
    if(notice && notice.parentNode === panel) panel.insertBefore(sec, notice.nextSibling); else panel.insertBefore(sec, panel.firstChild);
    sec.querySelectorAll(".md-mode").forEach(btn => btn.addEventListener("click", ev => { ev.preventDefault(); ev.stopPropagation(); st().seenIntro = true; setMode(btn.dataset.mode); }));
    sec.querySelector("#mdToggleContinuous").addEventListener("click", ev => { ev.preventDefault(); ev.stopPropagation(); if(isBaseline()) return; st().continuousMeta = !st().continuousMeta; saveStateNow(); renderSection(); });
    sec.querySelector("#mdToggleBanner").addEventListener("click", ev => { ev.preventDefault(); ev.stopPropagation(); st().memBanner = !st().memBanner; saveStateNow(); renderSection(); });
    sec.querySelector("#mdTogglePeek").addEventListener("click", ev => { ev.preventDefault(); ev.stopPropagation(); if(isBaseline()) return; st().peek = !st().peek; saveStateNow(); renderSection(); });
    sec.querySelectorAll(".md-pairsize-btn").forEach(btn => btn.addEventListener("click", ev => { ev.preventDefault(); ev.stopPropagation(); setPairSize(btn.dataset.size); }));
    sec.querySelector("#mdAboutBtn2").addEventListener("click", ev => { ev.preventDefault(); ev.stopPropagation(); st().seenIntro = true; saveStateNow(); renderSection(); openAbout(); });
    // keep the section text fresh whenever the settings panel is opened
    const details = document.getElementById("settingsPanel");
    if(details) details.addEventListener("toggle", () => renderSection());
    renderSection();
  }
  wrapGlobal("updateMenu", previous => function updateMenuMD(){
    const out = previous.apply(this, arguments);
    try { renderSection(); } catch(_){}
    try { renderLevelCard(); } catch(_){}
    return out;
  });

  // ------------------------------------------------------------------------
  // Public API (diagnostics, tests)
  // ------------------------------------------------------------------------
  const api = {
    version:MD_VERSION,
    fork:FORK_VERSION,
    label:MD_TITLE,
    base:BASE_VERSION,
    modes:MODE_ORDER.slice(),
    get state(){ return st(); },
    setMode,
    setContinuous(v){ st().continuousMeta = !!v; saveStateNow(); renderSection(); return st().continuousMeta; },
    setBanner(v){ st().memBanner = !!v; saveStateNow(); renderSection(); return st().memBanner; },
    setPeek(v){ st().peek = !!v; saveStateNow(); renderSection(); return st().peek; },
    peek:peekSlot, peekSlots(){ return hasState() ? peekSlots(State.trialInfo || {}, clampN(num(State.currentTrialLevel, 0), 0, 3)).map(x => ({id:x.id, label:x.label})) : []; },
    get peeks(){ return JSON.parse(JSON.stringify(st().peeks)); },
    get metaLog(){ return MD._metaLog.slice(); },
    save:saveStateNow,
    reload:loadState,
    reset(){ MD.st = defaultState(); saveStateNow(); renderSection(); return MD.st; },
    snapshot(){
      const S = st();
      return {
        mode:S.mode, level:publicLevel(), label:publicLevelLabel(), tier:currentTier(), tierWin:S.tier.win.length,
        tierAcc20:winAccuracy(20), exposure:Math.round(exposureMs()), meta:metaLevel(), metaManual:forcedMetaLevel(), metaAuto:autoMetaLevel(), spacing:S.spacing.level,
        spacingOutcomes:S.spacing.outcomes.slice(), theta:Math.round(S.rating.theta), ratingN:S.rating.n,
        continuous:S.continuousMeta, banner:S.memBanner, peek:S.peek, peeks:S.peeks.n, deferred:deferredPlanLevel(), raw:isStaircase() ? staircaseRaw() : null,
        blockers:currentTier() < tierMax() ? runwayBlockers(currentTier() + 1) : []
      };
    },
    thetaForTier, targetTierForTheta, expected, scoreFor, ratingLevel, staircaseLevel,
    levelCard:levelCardData, requirements:levelRequirements, renderLevelCard,
    manualTier:manualTierChange, manualSpacing:manualSpacingChange, manualMeta:manualMetaChange,
    get metaManual(){ return manualMeta(); }, get metaForced(){ return forcedMetaLevel(); }, get metaAuto(){ return autoMetaLevel(); },
    setPairSize, get pairSize(){ return pairSize(); },
    get metaRepairs(){ return (MD._metaRepairs || []).slice(); }
  };
  try { Object.defineProperty(globalThis, "EUCA_PROGRESSION", {value:api, writable:false, configurable:false, enumerable:true}); } catch(_){ globalThis.EUCA_PROGRESSION = api; }

  // ------------------------------------------------------------------------
  // Boot
  // ------------------------------------------------------------------------
  function boot(){
    reapplyWraps();
    loadState();
    syncVersionSurface();
    installLabelObserver();
    installCueObserver();
    installCredit();
    installSection();
    safe(renderLevelCard);
    relocateCue();
    ensureBanner();
    safe(() => { if(typeof forceHUDUpdate === "function") forceHUDUpdate("md_boot"); });
    window.addEventListener("load", () => { reapplyWraps(); relocateCue(); }, {once:true});
    window.addEventListener("beforeunload", saveStateNow);
    document.addEventListener("visibilitychange", () => { if(document.visibilityState === "hidden") saveStateNow(); });
    document.documentElement.dataset.eucaMdProgression = MD_VERSION;
  }
  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, {once:true});
  else boot();
})();
