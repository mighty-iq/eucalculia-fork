/* ==========================================================================
   Eucalculia Fork — Learn (tutorial) system
   ---------------------------------------------------------------------------
   Built on Eucalculia by Alberto Flaño Lombardo, with his permission.
   Ideas and changes in this fork: mighty_elf and .da.rk. (Discord).

   Architecture
     • A "Learn" modal (#mdLearn) with eight short lessons, opened from the menu
       (🎓 Learn), from the first-launch welcome card, or from the "? HELP" chip
       during a block (which pauses the block first).
     • Every lesson that can be practised has a live demo that reuses the game's
       own stimulus renderers (makeStim) — flash → mask → question → answer —
       so what you rehearse here is exactly what the trials look like.
     • A coach strip above the answer buttons shows a one-line hint the first
       few times each kind of trial appears (learn as you go). It never reveals
       hidden information (interference lures stay unmarked).
     • Progress per profile in localStorage["euca:md:learn:v1:p<profile>"].
       Alberto's saved profile format is never touched.
   ========================================================================== */
(function(){
  "use strict";
  if(globalThis.__EUCA_MD_LEARN_INSTALLED__) return;
  globalThis.__EUCA_MD_LEARN_INSTALLED__ = true;

  const STORAGE_PREFIX = "euca:md:learn:v1:p";
  const COACH_SHOW_PER_KIND = 8;      // hints per trial kind before the strip goes quiet
  const DEMO_PREP_MS = 250, DEMO_MASK_MS = 150, DEMO_EXPOSURE_DEFAULT = 1000;

  const hasState = () => typeof State === "object" && !!State;
  const num = (v, d=0) => Number.isFinite(Number(v)) ? Number(v) : d;
  const clampN = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
  const safe = (fn, fallback) => { try { return fn(); } catch(e){ try { console.warn("[Eucalculia learn] ", e); } catch(_){} return fallback; } };
  const $ = id => document.getElementById(id);
  const forkLabel = () => safe(() => (globalThis.EUCA_PROGRESSION && globalThis.EUCA_PROGRESSION.label) || "Eucalculia Fork", "Eucalculia Fork");

  function h(tag, attrs, ...children){
    const el = document.createElement(tag);
    if(attrs){
      for(const [k, v] of Object.entries(attrs)){
        if(v === null || v === undefined || v === false) continue;
        if(k === "class") el.className = v;
        else if(k === "text") el.textContent = v;
        else if(k === "html") el.innerHTML = v;
        else if(k === "style") el.style.cssText = v;
        else if(k === "on"){ for(const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn); }
        else if(k === "dataset"){ Object.assign(el.dataset, v); }
        else el.setAttribute(k, v === true ? "" : String(v));
      }
    }
    for(const c of children.flat()){
      if(c === null || c === undefined || c === false) continue;
      el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return el;
  }
  const frag = html => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content; };

  // ------------------------------------------------------------------------
  // Global wrappers (same technique as the progression patch: outermost layer,
  // marker properties carried so earlier installers don't stack again).
  // ------------------------------------------------------------------------
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
      if(/Original$/.test(key) || /^__md/.test(key) || /^__ml/.test(key)) continue;
      if(typeof previous[key] === "function") continue;
      try { wrapped[key] = previous[key]; } catch(_){}
    }
    try { Object.defineProperty(wrapped, "name", {value:name + "ML"}); } catch(_){}
    wrapped.__mlWrapped = name;
    wrapped.__mlOriginal = previous;
    globalThis[name] = wrapped;
    INSTALLED[name] = wrapped;
    return true;
  }
  function reapplyWraps(){ for(const name of Object.keys(FACTORIES)) safe(() => applyWrap(name)); }

  // ------------------------------------------------------------------------
  // Progress (per profile)
  // ------------------------------------------------------------------------
  const P = {st:null, profile:0};
  function activeProfile(){ return clampN(num(hasState() && State.activeProfile, 1) || 1, 1, 3); }
  function storageKey(){ return STORAGE_PREFIX + activeProfile(); }
  function defaultProgress(){ return {v:1, done:{}, last:"welcome", welcomed:false, opened:false, coach:true, seen:{}, quiz:{}}; }
  function prog(){
    const profile = activeProfile();
    if(P.st && P.profile === profile) return P.st;
    const base = defaultProgress();
    let saved = null;
    try { const raw = localStorage.getItem(STORAGE_PREFIX + profile); if(raw) saved = JSON.parse(raw); } catch(_){ saved = null; }
    P.st = (saved && typeof saved === "object") ? {...base, ...saved, done:{...(saved.done || {})}, seen:{...(saved.seen || {})}, quiz:{...(saved.quiz || {})}} : base;
    P.profile = profile;
    return P.st;
  }
  function saveProg(){ try { localStorage.setItem(storageKey(), JSON.stringify(prog())); } catch(_){} }
  function doneCount(){ const d = prog().done; return LESSONS.filter(l => d[l.id]).length; }

  // ------------------------------------------------------------------------
  // Stimulus helpers (the game's own renderers)
  // ------------------------------------------------------------------------
  const REPS = [
    {id:"dots",    name:"Dots",      rule:"Count the dots. They are scattered on purpose, so there is no pattern to lean on: take in the whole cloud at once.", max:20},
    {id:"cluster", name:"Cluster",   rule:"Diamonds in small colour groups. The value is the total over all groups — the groups are there to help you chunk.", max:15},
    {id:"ten",     name:"Ten-frame", rule:"A frame of 10 cells (a bigger frame for larger values). Count the filled cells; a full row is 5.", max:20},
    {id:"dice",    name:"Dice",      rule:"Pips on the top face. Values above 6 use two or three dice: add the top faces.", max:12},
    {id:"domino",  name:"Domino",    rule:"Add the pips of both halves.", max:12},
    {id:"tally",   name:"Tally",     rule:"Strokes in bundles of five (four strokes crossed by a fifth). Bundles × 5, plus the loose strokes.", max:20},
    {id:"finger",  name:"Fingers",   rule:"Raised fingers: one hand up to 5, two hands up to 10.", max:10},
    {id:"abacus",  name:"Abacus",    rule:"Upper row: every red bead is worth 5. Lower row: every green bead is worth 1. Add them up.", max:20},
    {id:"card",    name:"Cards",     rule:"The rank of the card: A = 1, number cards as printed, J = 11, Q = 12, K = 13. Two cards → add the ranks.", max:13},
    {id:"cube",    name:"Cubes",     rule:"Count the cubes in the 3-D stack, including the ones you only see partly.", max:9},
    {id:"coins",   name:"Coins",     rule:"Copper = 1, silver = 2, gold = 5. Add the values, not the number of coins.", max:20},
    {id:"roman",   name:"Roman",     rule:"Roman numerals: I = 1, V = 5, X = 10. A smaller numeral in front is subtracted (IV = 4, IX = 9).", max:20},
    {id:"clock",   name:"Clock",     rule:"One hand only: read the hour it points to (1–12).", max:12},
    {id:"grid",    name:"Grid",      rule:"Filled cells of the grid (3 × 3 up to 9, a taller grid beyond).", max:12},
    {id:"digit",   name:"Digit",     rule:"The plain number. Off by default in Settings → Representations: the point is to read the other formats.", max:20}
  ];
  const REP_BY_ID = Object.fromEntries(REPS.map(r => [r.id, r]));
  function canShow(rep, v){
    if(typeof makeStim !== "function") return false;
    if(rep === "digit") return v >= 0;
    return safe(() => typeof repPhysicallyAllows === "function" ? !!repPhysicallyAllows(rep, v) : true, false);
  }
  function enabledReps(){
    // representations the player currently has switched on (Settings → Representations); falls back to all visual formats
    const on = safe(() => Array.from(document.querySelectorAll(".repChip.on")).map(c => c.dataset.rep).filter(Boolean), []);
    const list = on.length ? on : REPS.map(r => r.id).filter(id => id !== "digit");
    return list.filter(id => REP_BY_ID[id]);
  }
  function drawStimOn(canvas, v, rep, seed, cssW, cssH){
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
    canvas.style.width = cssW + "px"; canvas.style.height = cssH + "px";
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, cssW, cssH);
    try {
      const stim = makeStim(v, rep, {seed:seed});
      const s = Math.min(cssW, cssH) * 0.86;
      stim.draw(ctx, (cssW - s) / 2, (cssH - s) / 2, s, s);
      return true;
    } catch(e){
      ctx.fillStyle = "#fff"; ctx.font = "bold 28px " + (getComputedStyle(document.body).fontFamily || "sans-serif");
      ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(String(v), cssW / 2, cssH / 2);
      return false;
    }
  }
  function thumb(v, rep, label, seed, size){
    const c = h("canvas");
    const wrapEl = h("div", {class:"ml-stim"}, c, label ? h("div", {class:"ml-stim-label", text:label}) : null);
    drawStimOn(c, v, rep, seed ?? 11, size || 96, size || 96);
    return wrapEl;
  }
  const rnd = n => Math.floor(Math.random() * n);
  const pick = arr => arr[rnd(arr.length)];
  function randomValueFor(rep, lo, hi){
    const r = REP_BY_ID[rep] || {max:12};
    const top = Math.min(hi ?? r.max, r.max);
    const options = [];
    for(let v = Math.max(1, lo ?? 1); v <= top; v++) if(canShow(rep, v)) options.push(v);
    return options.length ? pick(options) : 3;
  }
  function randomRep(exclude){
    const list = enabledReps().filter(id => id !== "digit" && id !== exclude);
    return list.length ? pick(list) : "dots";
  }
  const isPrime = n => { if(n < 2) return false; for(let i = 2; i * i <= n; i++) if(n % i === 0) return false; return true; };

  // ------------------------------------------------------------------------
  // Demo engine: flash → mask → question → answer, on a canvas of our own
  // ------------------------------------------------------------------------
  const CANCEL = Symbol("cancel");
  const demos = new Set();
  function createDemo(host, opts){
    opts = opts || {};
    const canvas = h("canvas");
    const msg = h("div", {class:"ml-demo-msg"});
    const labL = h("span", {class:"ml-side-label left", text:"LEFT", style:"display:none"});
    const labR = h("span", {class:"ml-side-label right", text:"RIGHT", style:"display:none"});
    const mem = h("div", {class:"ml-mem"});
    const stage = h("div", {class:"ml-demo-stage"}, canvas, labL, labR, mem, msg);
    const ctrls = h("div", {class:"ml-demo-ctrls"});
    const status = h("div", {class:"ml-demo-status", style:"font-size:0.66rem;color:var(--ml-muted)"});
    const bar = h("div", {class:"ml-demo-bar"}, ctrls, status);
    const answers = h("div", {class:"ml-answers", style:"display:none"});
    const feedback = h("div", {class:"ml-feedback", style:"display:none"});
    const root = h("div", {class:"ml-demo"}, stage, bar, answers, feedback);
    host.appendChild(root);

    const D = {root, stage, bar, ctrls, status, answers, feedback, token:0, timers:new Map(), pendingReject:null, ask:null};
    demos.add(D);

    function size(){
      const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
      const w = Math.max(120, stage.clientWidth), hgt = Math.max(120, stage.clientHeight);
      if(canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(hgt * dpr)){
        canvas.width = Math.round(w * dpr); canvas.height = Math.round(hgt * dpr);
      }
      const ctx = canvas.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return {ctx, w, h:hgt};
    }
    D.clear = function(){
      const {ctx, w, h:hgt} = size();
      ctx.fillStyle = "#000"; ctx.fillRect(0, 0, w, hgt);
      msg.innerHTML = ""; labL.style.display = "none"; labR.style.display = "none";
    };
    D.message = function(kicker, q, sub){
      msg.innerHTML = "";
      if(kicker) msg.appendChild(h("div", {class:"ml-kicker", text:kicker}));
      if(q) msg.appendChild(h("div", {class:"ml-q", text:q}));
      if(sub) msg.appendChild(h("div", {class:"ml-sub", text:sub}));
    };
    D.prep = function(){
      D.clear();
      const {ctx, w, h:hgt} = size();
      ctx.strokeStyle = "rgba(140,125,255,0.55)"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(w / 2, hgt / 2, 9, 0, Math.PI * 2); ctx.stroke();
    };
    D.drawItems = function(items){
      D.clear();
      const {ctx, w, h:hgt} = size();
      if(items.length === 1){
        const s = Math.min(w, hgt) * 0.8;
        safe(() => makeStim(items[0].v, items[0].rep, {seed:items[0].seed ?? 11}).draw(ctx, (w - s) / 2, (hgt - s) / 2, s, s));
      } else {
        const s = Math.min(w / 2, hgt) * 0.78;
        items.slice(0, 2).forEach((it, i) => {
          const cx = (i === 0 ? w * 0.25 : w * 0.75);
          safe(() => makeStim(it.v, it.rep, {seed:it.seed ?? 11}).draw(ctx, cx - s / 2, (hgt - s) / 2, s, s));
        });
        labL.style.display = ""; labR.style.display = "";
      }
    };
    D.mask = function(){
      const {ctx, w, h:hgt} = size();
      ctx.fillStyle = "#000"; ctx.fillRect(0, 0, w, hgt);
      for(let i = 0; i < 220; i++){
        const g = 90 + rnd(140);
        ctx.fillStyle = `rgba(${g},${g},${g + rnd(40)},${0.35 + Math.random() * 0.5})`;
        const sz = 3 + rnd(14);
        ctx.fillRect(rnd(w), rnd(hgt), sz, sz * (0.5 + Math.random()));
      }
      msg.innerHTML = "";
    };
    D.setMem = function(label){
      if(label){ mem.textContent = label; mem.classList.add("visible"); stage.classList.add("mem-glow"); }
      else { mem.classList.remove("visible"); stage.classList.remove("mem-glow"); }
    };
    D.setStatus = function(text){ status.textContent = text || ""; };
    D.begin = function(){
      D.cancel();
      D.token++;
      feedback.style.display = "none"; feedback.innerHTML = "";
      answers.style.display = "none"; answers.innerHTML = "";
      return D.token;
    };
    D.cancel = function(){
      for(const [t, rej] of D.timers){ clearTimeout(t); safe(() => rej(CANCEL)); }
      D.timers.clear();
      if(D.pendingReject){ const r = D.pendingReject; D.pendingReject = null; r(CANCEL); }
      D.ask = null;
    };
    D.wait = function(ms, token){
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => { D.timers.delete(t); if(token !== D.token) reject(CANCEL); else resolve(true); }, ms);
        D.timers.set(t, reject);
      });
    };
    // answer collection -------------------------------------------------
    D.askAnswer = function(spec, token){
      return new Promise((resolve, reject) => {
        if(token !== D.token){ reject(CANCEL); return; }
        answers.innerHTML = ""; answers.style.display = "";
        D.pendingReject = reject;
        const finish = val => {
          if(token !== D.token) return;
          D.pendingReject = null; D.ask = null;
          answers.style.display = "none"; answers.innerHTML = "";
          resolve(val);
        };
        if(spec.type === "bool"){
          const yes = h("button", {type:"button", class:"ml-yes", text:"YES · Y / ←", on:{click:() => finish(true)}});
          const no = h("button", {type:"button", class:"ml-no", text:"NO · N / →", on:{click:() => finish(false)}});
          answers.append(yes, no);
          D.ask = {onKey(e){
            const k = e.key;
            if(k === "y" || k === "Y" || k === "ArrowLeft"){ finish(true); return true; }
            if(k === "n" || k === "N" || k === "ArrowRight"){ finish(false); return true; }
            return false;
          }};
          setTimeout(() => safe(() => yes.focus({preventScroll:true})), 0);
        } else if(spec.type === "choice"){
          const list = h("div", {class:"ml-choice-list", style:"display:grid;gap:8px;width:100%;grid-template-columns:repeat(auto-fit,minmax(150px,1fr))"});
          spec.options.forEach((label, i) => {
            list.appendChild(h("button", {type:"button", class:"ml-btn", style:"text-align:left;display:flex;gap:10px;align-items:center;padding:12px", on:{click:() => finish(i)}},
              h("span", {class:"ml-choice-num", text:String(i + 1), style:"display:inline-flex;width:24px;height:24px;border-radius:7px;align-items:center;justify-content:center;background:rgba(140,125,255,0.25);font-weight:900"}),
              h("span", {text:label})));
          });
          answers.appendChild(list);
          D.ask = {onKey(e){
            const n = parseInt(e.key, 10);
            if(Number.isInteger(n) && n >= 1 && n <= spec.options.length){ finish(n - 1); return true; }
            return false;
          }};
          setTimeout(() => safe(() => list.querySelector("button").focus({preventScroll:true})), 0);
        } else { // number
          let buffer = "";
          const display = h("div", {class:"ml-num-display", text:"–"});
          const pad = h("div", {class:"ml-numpad"});
          const setBuf = b => { buffer = b.slice(0, 3); display.textContent = buffer || "–"; };
          const submit = () => { if(buffer.length) finish(parseInt(buffer, 10)); };
          for(const d of ["1","2","3","4","5","6","7","8","9","0"]) pad.appendChild(h("button", {type:"button", text:d, on:{click:() => setBuf(buffer + d)}}));
          pad.appendChild(h("button", {type:"button", class:"wide", text:"⌫", on:{click:() => setBuf(buffer.slice(0, -1))}}));
          pad.appendChild(h("button", {type:"button", class:"ok", style:"grid-column:span 3", text:"OK · Enter", on:{click:submit}}));
          answers.append(display, pad);
          D.ask = {onKey(e){
            if(e.key >= "0" && e.key <= "9"){ setBuf(buffer + e.key); return true; }
            if(e.key === "Backspace"){ setBuf(buffer.slice(0, -1)); return true; }
            if(e.key === "Enter"){ submit(); return true; }
            return false;
          }};
          setTimeout(() => safe(() => pad.querySelector("button").focus({preventScroll:true})), 0);
        }
      });
    };
    D.showFeedback = function(ok, title, html, stims){
      feedback.className = "ml-feedback " + (ok ? "good" : "bad");
      feedback.innerHTML = "";
      feedback.appendChild(h("div", {class:"ml-fb-title", text:title}));
      feedback.appendChild(h("div", {html:html}));
      if(stims && stims.length){
        const row = h("div", {class:"ml-stim-row"});
        for(const s of stims) row.appendChild(thumb(s.v, s.rep, s.label, s.seed, 72));
        feedback.appendChild(row);
      }
      feedback.style.display = "";
    };
    D.destroy = function(){ D.cancel(); demos.delete(D); };
    D.clear();
    D.message(opts.kicker || "DEMO", opts.title || "", opts.sub || "");
    return D;
  }
  function cancelAllDemos(){ for(const d of demos) safe(() => d.cancel()); }
  function destroyAllDemos(){ for(const d of Array.from(demos)) safe(() => d.destroy()); }
  const isCancel = e => e === CANCEL;

  // one complete single-value trial
  async function runSingleTrial(D, spec){
    const token = D.begin();
    try {
      D.setMem(null);
      D.setStatus("get ready…");
      D.clear(); D.message("", "", ""); D.prep();
      await D.wait(spec.prepMs ?? 700, token);
      D.setStatus(`flash · ${Math.round(spec.exposure)} ms`);
      D.drawItems([{v:spec.v, rep:spec.rep, seed:spec.seed}]);
      await D.wait(spec.exposure, token);
      D.setStatus("mask · 150 ms"); D.mask();
      await D.wait(DEMO_MASK_MS, token);
      D.clear(); D.setStatus("answer");
      D.message(spec.kicker || "QUESTION", spec.question || "What number?", spec.sub || "");
      const ans = await D.askAnswer({type:spec.answerType || "num", options:spec.options}, token);
      const ok = ans === spec.correct;
      D.clear(); D.message(ok ? "✓ CORRECT" : "✗ NOT QUITE", ok ? "" : `The answer was ${spec.correctLabel ?? spec.correct}`, "");
      D.setStatus("done — play again to try another one");
      return {ok, ans};
    } catch(e){ if(!isCancel(e)) safe(() => console.warn("[Eucalculia learn] demo", e)); return null; }
  }

  // ------------------------------------------------------------------------
  // Question banks
  // ------------------------------------------------------------------------
  const REL_BANK = [
    {fam:"Comparison",  type:"bool",   q:"Is LEFT greater than RIGHT?",                     f:(a,b) => a > b},
    {fam:"Comparison",  type:"bool",   q:"Is RIGHT smaller than LEFT?",                     f:(a,b) => b < a},
    {fam:"Negation",    type:"bool",   q:"Is RIGHT not greater than LEFT?",                 f:(a,b) => !(b > a), tip:"“not greater” means smaller <b>or equal</b>."},
    {fam:"Equality",    type:"bool",   q:"Are LEFT and RIGHT the same value?",              f:(a,b) => a === b},
    {fam:"Equality",    type:"bool",   q:"Are RIGHT and LEFT not the same value?",          f:(a,b) => a !== b},
    {fam:"Parity",      type:"bool",   q:"Are both values even?",                           f:(a,b) => a % 2 === 0 && b % 2 === 0},
    {fam:"Parity",      type:"bool",   q:"Is exactly one of the values odd?",               f:(a,b) => (a % 2) + (b % 2) === 1, tip:"“exactly one” fails when both are odd <i>and</i> when neither is."},
    {fam:"Parity",      type:"bool",   q:"Is the larger value odd?",                        f:(a,b) => Math.max(a, b) % 2 === 1},
    {fam:"Sum",         type:"bool",   q:"Is LEFT + RIGHT greater than 10?",                f:(a,b) => a + b > 10},
    {fam:"Sum",         type:"num",    q:"What is LEFT + RIGHT?",                           f:(a,b) => a + b},
    {fam:"Gap",         type:"num",    q:"Enter the exact distance between LEFT and RIGHT.", f:(a,b) => Math.abs(a - b)},
    {fam:"Gap",         type:"bool",   q:"Is the gap between LEFT and RIGHT exactly 2?",    f:(a,b) => Math.abs(a - b) === 2},
    {fam:"Primes",      type:"bool",   q:"Is at least one of the values prime?",            f:(a,b) => isPrime(a) || isPrime(b), tip:"Primes up to 12: 2, 3, 5, 7, 11. (1 is not prime.)"},
    {fam:"Primes",      type:"bool",   q:"Are both values prime?",                          f:(a,b) => isPrime(a) && isPrime(b)},
    {fam:"Divisibility",type:"bool",   q:"Does LEFT divide RIGHT exactly?",                 f:(a,b) => b % a === 0, tip:"“LEFT divides RIGHT” means RIGHT is a whole multiple of LEFT (3 divides 9; 4 does not divide 6)."},
    {fam:"Negation",    type:"bool",   q:"Is neither value greater than 5?",                f:(a,b) => a <= 5 && b <= 5, tip:"“neither … greater than 5” = both are 5 or less."},
    {fam:"Direction",   type:"bool",   q:"From LEFT to RIGHT, did the quantity decrease?",  f:(a,b) => b < a},
    {fam:"Threshold",   type:"bool",   q:"Find the value closer to 10. Is it odd?",         f:(a,b) => (Math.abs(10 - a) <= Math.abs(10 - b) ? a : b) % 2 === 1},
    {fam:"Comparison",  type:"num",    q:"What is the larger value?",                       f:(a,b) => Math.max(a, b)},
    {fam:"Comparison",  type:"choice", q:"Which side showed the larger value?",             options:["LEFT", "They were equal", "RIGHT"], f:(a,b) => a > b ? 0 : (a === b ? 1 : 2)}
  ];
  const TRANSFORM_BANK = [
    {rep:"dice",   lo:1, hi:6,  q:"Which number is on the hidden face opposite the top face?", f:v => 7 - v,  rule:"Opposite faces of a die always add up to 7."},
    {rep:"ten",    lo:1, hi:9,  q:"How many cells are still empty in the frame?",               f:v => 10 - v, rule:"A ten-frame has 10 cells: empty = 10 − filled."},
    {rep:"grid",   lo:1, hi:8,  q:"How many cells of the 3 × 3 grid are empty?",                f:v => 9 - v,  rule:"A 3 × 3 grid has 9 cells: empty = 9 − filled."},
    {rep:"clock",  lo:1, hi:12, q:"What hour will it be 3 hours later?",                        f:v => ((v + 3 - 1) % 12) + 1, rule:"Hours wrap after 12 (11 + 3 → 2)."},
    {rep:"clock",  lo:1, hi:12, q:"Which hour is directly opposite on the dial?",              f:v => ((v + 6 - 1) % 12) + 1, rule:"The opposite hour is 6 hours away, wrapping past 12."},
    {rep:"finger", lo:1, hi:9,  q:"How many of the 10 fingers are folded down?",                f:v => 10 - v, rule:"Two hands hold 10 fingers: folded = 10 − raised."},
    {rep:"tally",  lo:1, hi:14, q:"How many more strokes until the next complete bundle of 5?", f:v => 5 - (v % 5), skip:v => v % 5 === 0, rule:"A bundle is 5 strokes: missing = 5 − (strokes mod 5)."},
    {rep:"abacus", lo:1, hi:14, q:"What is the value of the upper (red) row alone?",            f:v => 5 * Math.floor(v / 5), rule:"Each red bead is 5; the lower green row is not counted."}
  ];
  const META_BANK = [
    {type:"choice", q:"Which pair had the larger LEFT value?", options:["Pair 1", "Both had the same LEFT value", "Pair 2"], f:(p1, p2) => p1.a > p2.a ? 0 : (p1.a === p2.a ? 1 : 2)},
    {type:"num",    q:"Add the two LEFT values. What do you get?", f:(p1, p2) => p1.a + p2.a},
    {type:"num",    q:"Add each pair separately. How far apart are the two pair totals?", f:(p1, p2) => Math.abs((p1.a + p1.b) - (p2.a + p2.b))},
    {type:"bool",   q:"Was Pair 1's answer YES?", f:(p1) => p1.answer === true, needsAnswer:true},
    {type:"bool",   q:"Did both pairs have the same RIGHT value?", f:(p1, p2) => p1.b === p2.b},
    {type:"choice", q:"Which pair had the larger total?", options:["Pair 1", "Same total", "Pair 2"], f:(p1, p2) => (p1.a + p1.b) > (p2.a + p2.b) ? 0 : ((p1.a + p1.b) === (p2.a + p2.b) ? 1 : 2)}
  ];
  function relFeedbackLine(item, a, b, correct){
    const val = item.type === "choice" ? item.options[correct] : (item.type === "bool" ? (correct ? "YES" : "NO") : String(correct));
    return `<b>LEFT = ${a}</b>, <b>RIGHT = ${b}</b> → the answer was <b>${esc(val)}</b>.${item.tip ? " " + item.tip : ""}`;
  }

  // ------------------------------------------------------------------------
  // Lessons
  // ------------------------------------------------------------------------
  function liveNumbers(){
    const cfg = (typeof CONFIG === "object" && CONFIG) || {};
    return {
      prep:num(cfg.prepMs, 250), mask:num(cfg.maskMs, 150),
      etA:num(cfg.startETByMode && cfg.startETByMode.A, 750), minA:num(cfg.minETByMode && cfg.minETByMode.A, 70),
      etD:num(cfg.startETByMode && cfg.startETByMode.D, 1330), minD:num(cfg.minETByMode && cfg.minETByMode.D, 600),
      block:num(hasState() && State.blockSize, 20)
    };
  }

  const LESSONS = [
    // 1 --------------------------------------------------------------------
    {id:"welcome", icon:"👋", title:"How Eucalculia works", sub:"3 min · start here",
     render(body){
       const n = liveNumbers();
       body.appendChild(frag(`
         <h3>Welcome to Eucalculia</h3>
         <p class="ml-lead">A quantity is flashed for a fraction of a second, hidden behind a mask, and you answer from what you <b>saw</b> — not from what you counted.
         That is the whole game. Everything else is the same trick applied to harder questions: two quantities at once, transformed readings, and questions about pairs you were asked to keep in mind.</p>
         <h4>The path (Auto mode chooses it for you)</h4>
         <div class="ml-pipe">
           <div><div class="ml-pipe-k">1 · Numerical sense</div><div class="ml-pipe-t">“What number?”</div><div class="ml-pipe-s">One quantity, 14 visual formats. The flash gets shorter as you get faster.</div></div>
           <div><div class="ml-pipe-k">2 · Manipulation</div><div class="ml-pipe-t">Transformed reading</div><div class="ml-pipe-s">Same flash, but the question asks for a derived value: empty cells, the hidden die face, three hours later…</div></div>
           <div><div class="ml-pipe-k">3 · Relational</div><div class="ml-pipe-t">LEFT &amp; RIGHT</div><div class="ml-pipe-s">Two quantities. A question about the pair: compare, add, parity, primes, distance…</div></div>
           <div><div class="ml-pipe-k">4 · META¹ → META² → META³</div><div class="ml-pipe-t">Pairs you retained 🧠</div><div class="ml-pipe-s">Some pairs are marked MEM. Later a META question asks about them. Then about your META answers.</div></div>
         </div>
         <div class="ml-card violet">
           <div class="ml-card-title">One trial, step by step</div>
           <ul>
             <li><b>PREP</b> · ${n.prep} ms — the frame gets ready. Eyes on the centre.</li>
             <li><b>FLASH</b> — the stimulus. Numerical sense starts at ${n.etA} ms and can shrink to ${n.minA} ms; relational trials start at ${n.etD} ms and never go below ${n.minD} ms.</li>
             <li><b>MASK</b> · ${n.mask} ms — visual noise wipes the after-image, so you cannot keep reading the picture.</li>
             <li><b>QUESTION + ANSWER</b> — the question, the buttons and the reaction-time clock all start together.</li>
             <li><b>FEEDBACK</b> — wrong answers open a short review card. <kbd>Space</kbd> or <kbd>Enter</kbd> continues.</li>
           </ul>
         </div>
         <div class="ml-grid cols-2">
           <div class="ml-card"><div class="ml-card-title">Blocks</div><p>A block is ${n.block} trials. After each block you get a summary; you can stop there or continue. The <b>Menu</b> button (or <kbd>Esc</kbd>) pauses a block at any time.</p></div>
           <div class="ml-card"><div class="ml-card-title">Auto path</div><p>You do not pick levels. The app moves you between numerical sense, manipulation, relational and META work from your own accuracy and speed — see <i>Levels &amp; progression</i>.</p></div>
         </div>
         <div class="ml-callout"><span class="ml-callout-icon">💡</span><div><b>You don't need to memorise this.</b> The coach strip (on by default) shows a one-line hint above the answer buttons the first few times each kind of trial appears. And the <b>? HELP</b> button in the frame pauses the block and opens the lesson that matches the trial on screen.</div></div>
         <h4>Suggested order</h4>
         <ul>
           <li><b>Reading the formats</b> — two minutes, so the first flashes are not a surprise.</li>
           <li><b>Flash, mask, answer</b> — try the real rhythm with a slider for the exposure.</li>
           <li>Start a block. Come back to <b>Relational</b>, <b>Transformed readings</b> and <b>MEM &amp; META</b> when those phases arrive (the app tells you).</li>
           <li>Read <b>Training for transfer</b> once you have a few sessions behind you — it explains the probe blocks, focus blocks and the calendar guidance.</li>
         </ul>
       `));
     }},
    // 2 --------------------------------------------------------------------
    {id:"formats", icon:"🎴", title:"Reading the formats", sub:"gallery + quiz",
     render(body){
       body.appendChild(frag(`
         <h3>Reading the 15 formats</h3>
         <p class="ml-lead">Every format is a different way of showing the same number. You will see them all, in random order, so learn the reading rule of each one once — then let your eyes do it.</p>
       `));
       const grid = h("div", {class:"ml-grid cols-4"});
       const reveal = h("button", {type:"button", class:"ml-toggle", "aria-pressed":"true", text:"Values shown"});
       let shown = true;
       const renderGallery = () => {
         grid.innerHTML = "";
         for(const r of REPS){
           const v = randomValueFor(r.id, 1, Math.min(r.max, 12));
           const c = h("canvas");
           const card = h("div", {class:"ml-fmt"}, c,
             h("div", {class:"ml-fmt-name", text:r.name}),
             h("div", {class:"ml-fmt-rule", text:r.rule}),
             h("div", {class:"ml-fmt-val", text:shown ? `= ${v}` : "= ?", dataset:{v:String(v)}}));
           grid.appendChild(card);
           drawStimOn(c, v, r.id, 5 + v, 150, 150);
         }
       };
       reveal.addEventListener("click", () => { shown = !shown; reveal.setAttribute("aria-pressed", String(shown)); grid.querySelectorAll(".ml-fmt-val").forEach(el => { el.textContent = shown ? `= ${el.dataset.v}` : "= ?"; }); });
       const reroll = h("button", {type:"button", class:"ml-btn small", text:"↻ New examples", on:{click:renderGallery}});
       body.appendChild(h("div", {class:"ml-done-row", style:"margin:0 0 10px"}, reveal, reroll));
       body.appendChild(grid);
       renderGallery();

       // quiz
       body.appendChild(frag(`<h4>Practice · “What number?”</h4><p>No flash here — take your time and check your reading of each format. Type the number (keyboard works too), then <b>OK</b>.</p>`));
       const quizHost = h("div");
       body.appendChild(quizHost);
       const D = createDemo(quizHost, {kicker:"PRACTICE", title:"Press Start", sub:"a random format each time"});
       const score = {n:0, ok:0};
       const scoreEl = h("span", {class:"ml-score", text:""});
       const startBtn = h("button", {type:"button", class:"ml-btn primary", text:"▶ Start"});
       D.ctrls.append(startBtn, scoreEl);
       async function round(){
         const rep = randomRep();
         const v = randomValueFor(rep, 1, 12);
         const token = D.begin();
         try {
           D.setMem(null); D.drawItems([{v, rep, seed:3 + v}]);
           D.message("", "", ""); D.setStatus(`${REP_BY_ID[rep].name} · what number?`);
           const ans = await D.askAnswer({type:"num"}, token);
           const ok = ans === v;
           score.n++; if(ok) score.ok++;
           scoreEl.textContent = `${score.ok}/${score.n} correct`;
           const q = prog().quiz; q.formats = score.ok; saveProg();
           D.showFeedback(ok, ok ? "Correct" : "Not quite", `${REP_BY_ID[rep].name}: <b>${v}</b>. ${esc(REP_BY_ID[rep].rule)}`);
           startBtn.textContent = "▶ Next";
         } catch(e){ if(!isCancel(e)) throw e; }
       }
       startBtn.addEventListener("click", () => { round(); });
     }},
    // 3 --------------------------------------------------------------------
    {id:"rhythm", icon:"⚡", title:"Flash, mask, answer", sub:"the trial rhythm · demo",
     render(body){
       const n = liveNumbers();
       body.appendChild(frag(`
         <h3>Flash, mask, answer</h3>
         <p class="ml-lead">This is the exact rhythm of a trial. Set the exposure, press play, and answer. Start long (1000 ms), then try what ${n.minA}–200 ms feels like: that is where numerical sense ends up.</p>
       `));
       const host = h("div"); body.appendChild(host);
       const D = createDemo(host, {kicker:"DEMO", title:"Press ▶ Play", sub:"one quantity · flash → mask → “What number?”"});
       const slider = h("input", {type:"range", min:"70", max:"1330", step:"10", value:String(DEMO_EXPOSURE_DEFAULT)});
       const sliderVal = h("b", {text:`${DEMO_EXPOSURE_DEFAULT} ms`});
       slider.addEventListener("input", () => { sliderVal.textContent = `${slider.value} ms`; });
       const play = h("button", {type:"button", class:"ml-btn primary", text:"▶ Play"});
       const repSel = h("select", {"aria-label":"Format"});
       repSel.appendChild(h("option", {value:"random", text:"random format"}));
       for(const r of REPS) if(r.id !== "digit") repSel.appendChild(h("option", {value:r.id, text:r.name}));
       D.ctrls.append(play, h("label", {}, "exposure ", slider, sliderVal), repSel);
       const score = {n:0, ok:0}; const scoreEl = h("span", {class:"ml-score"});
       D.ctrls.appendChild(scoreEl);
       play.addEventListener("click", async () => {
         const rep = repSel.value === "random" ? randomRep() : repSel.value;
         const v = randomValueFor(rep, 1, 12);
         const res = await runSingleTrial(D, {v, rep, seed:20 + v, exposure:num(slider.value, 800), question:"What number?", correct:v});
         if(!res) return;
         score.n++; if(res.ok) score.ok++;
         scoreEl.textContent = `${score.ok}/${score.n} · last exposure ${slider.value} ms`;
         D.showFeedback(res.ok, res.ok ? "Correct" : `It was ${v}`, `${REP_BY_ID[rep].name}, shown for <b>${slider.value} ms</b>. ${esc(REP_BY_ID[rep].rule)}`, [{v, rep, seed:20 + v, label:`= ${v}`}]);
       });
       body.appendChild(frag(`
         <h4>What the app does with your answers</h4>
         <div class="ml-grid cols-2">
           <div class="ml-card"><div class="ml-card-title">Exposure adapts</div><p>Numerical sense: a correct, fast answer shortens the next flash by 34 ms; an error lengthens it by up to 170 ms. Relational: −5 ms per correct answer, +30 ms per error, between ${n.etD} and ${n.minD} ms. It settles where you are right about 85% of the time — the sweet spot for learning.</p></div>
           <div class="ml-card"><div class="ml-card-title">Numbers submit themselves</div><p>There is no OK button in the real trials: as soon as the digits you typed are complete (or already wrong) the answer is in. Type carefully — a first digit that is wrong ends the trial as an error.</p></div>
           <div class="ml-card"><div class="ml-card-title">Don't count</div><p>At 150 ms there is no time to count. Take in the whole picture: the shape of a dot cloud, a full row of five in the frame, the bundle of tally strokes. That global read is exactly what the training strengthens.</p></div>
           <div class="ml-card"><div class="ml-card-title">Speed is measured, not forced</div><p>Your reaction time starts when the question appears. It matters for progression, but an error costs far more than a slow answer — when unsure, take half a second.</p></div>
         </div>
       `));
     }},
    // 4 --------------------------------------------------------------------
    {id:"relational", icon:"⚖️", title:"Relational questions", sub:"LEFT & RIGHT · practice",
     render(body){
       body.appendChild(frag(`
         <h3>Two values: relational questions</h3>
         <p class="ml-lead">In the relational phase two quantities are flashed side by side — <b>LEFT</b> and <b>RIGHT</b>, usually in two different formats — and the question is about the pair. You never see the question before the flash, so encode both values, then read the question carefully.</p>
       `));
       const host = h("div"); body.appendChild(host);
       const D = createDemo(host, {kicker:"DEMO", title:"Press ▶ Play", sub:"two quantities → a random relational question"});
       const slider = h("input", {type:"range", min:"600", max:"1330", step:"10", value:"1100"});
       const sliderVal = h("b", {text:"1100 ms"});
       slider.addEventListener("input", () => { sliderVal.textContent = `${slider.value} ms`; });
       const play = h("button", {type:"button", class:"ml-btn primary", text:"▶ Play"});
       const scoreEl = h("span", {class:"ml-score"});
       D.ctrls.append(play, h("label", {}, "exposure ", slider, sliderVal), scoreEl);
       const score = {n:0, ok:0};
       play.addEventListener("click", async () => {
         const repA = randomRep(), repB = randomRep(repA);
         const a = randomValueFor(repA, 1, 12), b = randomValueFor(repB, 1, 12);
         const item = pick(REL_BANK);
         const correct = item.f(a, b);
         const token = D.begin();
         try {
           D.setMem(null); D.setStatus("get ready…"); D.prep();
           await D.wait(700, token);
           D.setStatus(`flash · ${slider.value} ms`); D.drawItems([{v:a, rep:repA, seed:31 + a}, {v:b, rep:repB, seed:47 + b}]);
           await D.wait(num(slider.value, 1000), token);
           D.setStatus("mask"); D.mask(); await D.wait(DEMO_MASK_MS, token);
           D.clear(); D.setStatus("answer"); D.message("RELATIONAL", item.q, item.type === "num" ? "type the number" : (item.type === "bool" ? "Y / N or ← →" : "press 1–3 or tap"));
           const ans = await D.askAnswer({type:item.type, options:item.options}, token);
           const ok = ans === correct;
           score.n++; if(ok) score.ok++; scoreEl.textContent = `${score.ok}/${score.n}`;
           D.clear(); D.message(ok ? "✓ CORRECT" : "✗ NOT QUITE", "", "");
           D.showFeedback(ok, ok ? "Correct" : "Not quite", relFeedbackLine(item, a, b, correct), [{v:a, rep:repA, seed:31 + a, label:`LEFT = ${a}`}, {v:b, rep:repB, seed:47 + b, label:`RIGHT = ${b}`}]);
         } catch(e){ if(!isCancel(e)) throw e; }
       });
       body.appendChild(frag(`
         <h4>Question families you will meet</h4>
         <div class="ml-card" style="padding:6px 10px">
         <table class="ml-table">
           <thead><tr><th>Family</th><th>Typical wording</th><th>What to compute</th></tr></thead>
           <tbody>
             <tr><td>Comparison</td><td>“Is LEFT greater than RIGHT?” · “Which side was larger?”</td><td>Order of the two values.</td></tr>
             <tr><td>Equality</td><td>“Are LEFT and RIGHT the same value?”</td><td>Same number, even in different formats.</td></tr>
             <tr><td>Sum &amp; threshold</td><td>“What is LEFT + RIGHT?” · “Is the total greater than 10?”</td><td>Add, then compare with the threshold.</td></tr>
             <tr><td>Distance</td><td>“Enter the exact distance between LEFT and RIGHT.”</td><td>|LEFT − RIGHT|, always positive.</td></tr>
             <tr><td>Parity</td><td>“Are both even?” · “Is exactly one value odd?” · “Is the larger value odd?”</td><td>Odd/even of one or both values.</td></tr>
             <tr><td>Primes &amp; multiples</td><td>“Is at least one value prime?” · “Does LEFT divide RIGHT?”</td><td>Primes ≤ 12: 2 3 5 7 11. “A divides B” = B is a whole multiple of A.</td></tr>
             <tr><td>Direction</td><td>“From LEFT to RIGHT, did the quantity decrease?”</td><td>Read the pair as a change over time.</td></tr>
             <tr><td>Signed values</td><td>“LEFT is negative. RIGHT is positive. What is LEFT + RIGHT?”</td><td>Apply the sign the question gives before computing. Use the <b>−</b> key on the pad for negative answers.</td></tr>
             <tr><td>Ratio</td><td>“How many LEFT units are there for each RIGHT unit?”</td><td>LEFT ÷ RIGHT.</td></tr>
           </tbody>
         </table>
         </div>
         <div class="ml-callout"><span class="ml-callout-icon">🔍</span><div><b>Phrasing is part of the task.</b> “<i>not greater</i>” includes equal. “<i>neither</i> … greater than 5” means both ≤ 5. “<i>exactly one</i>” excludes both-and-none. “<i>at least one</i>” includes both. Read the last word before you answer.</div></div>
         <h4>Other trial shapes in the relational phase</h4>
         <div class="ml-grid cols-3">
           <div class="ml-card"><div class="ml-card-title">Build a pair</div><p>“Choose LEFT and RIGHT so the answer is YES: are both numbers prime?” — no flash. Pick a LEFT value, then a RIGHT value, from the small number pads so the statement comes out as asked.</p></div>
           <div class="ml-card"><div class="ml-card-title">Choose one</div><p>Some questions offer 2–4 options (“Which equality is true?”). Keys <kbd>1</kbd>–<kbd>4</kbd> select; the selection submits immediately.</p></div>
           <div class="ml-card"><div class="ml-card-title">Spatial</div><p>A source figure plus a move (“top tips toward you”, a paper fold, a view from the right). Apply the move mentally and pick the matching result among the numbered states.</p></div>
         </div>
       `));
     }},
    // 5 --------------------------------------------------------------------
    {id:"transform", icon:"🔄", title:"Transformed readings", sub:"manipulation · practice",
     render(body){
       body.appendChild(frag(`
         <h3>Transformed readings</h3>
         <p class="ml-lead">In the <b>Manipulation</b> phase — and later inside relational trials — the question does not ask what you saw but for something derived from it. The rule is always written in the question; your job is to hold the picture and apply the rule.</p>
         <div class="ml-card amber"><div class="ml-card-title">as shown vs TRANSFORMED</div>
           <p>A value read exactly as displayed is the value <b>as shown</b> (the app also calls it the <b>original</b> value). After the rule has been applied it is the <b>TRANSFORMED</b> value.
           When a transformed pair is retained for a META question, the question tells you which one to use: <i>“Use → Pair 1: TRANSFORMED values · Pair 2: values as shown”</i>.</p></div>
       `));
       const host = h("div"); body.appendChild(host);
       const D = createDemo(host, {kicker:"PRACTICE", title:"Press ▶ Play", sub:"a flashed value, then a transformed question"});
       const slider = h("input", {type:"range", min:"300", max:"1330", step:"10", value:"1000"});
       const sliderVal = h("b", {text:"1000 ms"});
       slider.addEventListener("input", () => { sliderVal.textContent = `${slider.value} ms`; });
       const play = h("button", {type:"button", class:"ml-btn primary", text:"▶ Play"});
       const scoreEl = h("span", {class:"ml-score"});
       D.ctrls.append(play, h("label", {}, "exposure ", slider, sliderVal), scoreEl);
       const score = {n:0, ok:0};
       play.addEventListener("click", async () => {
         let item = pick(TRANSFORM_BANK), v = randomValueFor(item.rep, item.lo, item.hi), tries = 0;
         while(item.skip && item.skip(v) && tries++ < 20) v = randomValueFor(item.rep, item.lo, item.hi);
         const correct = item.f(v);
         const res = await runSingleTrial(D, {v, rep:item.rep, seed:60 + v, exposure:num(slider.value, 1000), kicker:"MANIPULATION", question:item.q, correct});
         if(!res) return;
         score.n++; if(res.ok) score.ok++; scoreEl.textContent = `${score.ok}/${score.n}`;
         D.showFeedback(res.ok, res.ok ? "Correct" : `It was ${correct}`, `Shown: ${REP_BY_ID[item.rep].name} = <b>${v}</b> (as shown). ${esc(item.rule)} → <b>${correct}</b> (transformed).`, [{v, rep:item.rep, seed:60 + v, label:`as shown = ${v}`}]);
       });
       body.appendChild(frag(`
         <h4>The rules by format</h4>
         <div class="ml-card" style="padding:6px 10px">
         <table class="ml-table">
           <thead><tr><th>Format</th><th>Transformations you will meet</th></tr></thead>
           <tbody>
             <tr><td>Dice</td><td>the hidden face opposite the top (7 − top); a visible side face; the top after rolling the die onto a side; sums of visible or hidden faces.</td></tr>
             <tr><td>Ten-frame</td><td>empty cells (10 − filled); cells beyond the first full row of 5; cells missing to the next 5.</td></tr>
             <tr><td>Grid</td><td>empty cells (9 − filled); filled corners; filled edge cells; is the centre filled; complete rows/columns.</td></tr>
             <tr><td>Clock</td><td>the opposite hour (+6); 3 or 5 hours later or earlier (wrap past 12); the hand turned by a quarter turn.</td></tr>
             <tr><td>Domino</td><td>the larger or smaller half; the gap between the halves; is it a double; each half's complement to 6.</td></tr>
             <tr><td>Fingers</td><td>fingers folded down (complement to 5 or to 10).</td></tr>
             <tr><td>Tally</td><td>strokes missing to the next bundle; complete bundles; the remainder after the bundles.</td></tr>
             <tr><td>Cluster</td><td>the largest or smallest colour group; the total without it; how many groups.</td></tr>
             <tr><td>Abacus</td><td>the upper (5s) row alone; the lower (1s) row alone; the value after adding or removing one bead.</td></tr>
             <tr><td>Coins</td><td>the total of one metal only; how many different denominations.</td></tr>
             <tr><td>Cards</td><td>the largest or smallest rank on the table.</td></tr>
             <tr><td>Cubes</td><td>the stack seen from the opposite side, from the right, from above; the front or back row only.</td></tr>
           </tbody>
         </table>
         </div>
         <div class="ml-callout"><span class="ml-callout-icon">🧭</span><div>Strategy: read the value <b>as shown</b> during the flash — that part must be automatic — and apply the rule only once the question is on screen. The answer stays “what you saw”, just one step further.</div></div>
       `));
     }},
    // 6 --------------------------------------------------------------------
    {id:"meta", icon:"🧠", title:"MEM & META chains", sub:"remember a pair · practice",
     render(body){
       body.appendChild(frag(`
         <h3>Memory chains: MEM and META</h3>
         <p class="ml-lead">Once the relational phase is solid, some trials are marked <b>🧠 MEM</b>. Answer them normally — <i>and keep the pair</i>. Two retained pairs later, a <b>META¹</b> question asks about both. That is the step from seeing numbers to holding relations in mind.</p>
         <h4>What a META¹ chain looks like</h4>
         <div class="ml-chain">
           <div class="mem"><span class="ml-chain-k">🧠 MEM¹ 1/2</span>Pair 1 is flashed. Answer its question. <b>Retain LEFT and RIGHT.</b></div>
           <div><span class="ml-chain-k">…</span>Ordinary trials may follow (spacing). Only 🧠-marked pairs count.</div>
           <div class="mem"><span class="ml-chain-k">🧠 MEM¹ 2/2</span>Pair 2 is flashed. Answer it. Retain it too.</div>
           <div><span class="ml-chain-k">HOLD</span>A dashed “HOLD · META¹ soon” pill means the question is being held back a few trials.</div>
           <div class="meta"><span class="ml-chain-k">META¹</span>“Which pair had the larger LEFT value?” — no new flash; you answer from memory.</div>
         </div>
         <div class="ml-grid cols-2">
           <div class="ml-card amber"><div class="ml-card-title">How you are told</div>
             <ul>
               <li>The trial starts with a short amber banner: <b>REMEMBER THIS PAIR · MEM¹ 1/2 · for META¹</b>, and which values to keep (as shown / TRANSFORMED).</li>
               <li>An amber <b>🧠 MEM¹ 1/2</b> capsule sits in the frame and the whole frame glows amber while the pair is on screen.</li>
               <li>The counter tells you where you are in the chain: <b>1/2</b> first pair, <b>2/2</b> second pair.</li>
             </ul></div>
           <div class="ml-card violet"><div class="ml-card-title">Then META² and META³</div>
             <ul>
               <li><b>META²</b> asks about two of your <i>META¹ episodes</i> — e.g. “Were both META¹ answers YES?”. Its cue is 🧠² and the glow turns orange.</li>
               <li><b>META³</b> combines two META² episodes (🧠³, red-orange glow).</li>
               <li>The first time each layer appears the app pauses on an explanation card; press <kbd>Space</kbd> when ready.</li>
               <li>Layers open on evidence (Auto). If you would rather train a particular layer, pick it by hand on the level card (META layer: Auto / No META / META¹ / META² / META³).</li>
             </ul></div>
         </div>
         <div class="ml-callout"><span class="ml-callout-icon">🎯</span><div><b>What to retain:</b> the two values (LEFT and RIGHT, in that order) and, if you can, your answer. META¹ questions ask things like <i>which pair had the larger LEFT</i>, <i>the sum of the LEFT values</i>, <i>how far apart the pair totals were</i>, or <i>was Pair 1's answer YES</i>. Under the question, a hint restates which values to use for each pair. <b>Vocabulary:</b> a <i>pair total</i> is LEFT + RIGHT of that pair; “the difference between the two pair totals” is |(L1 + R1) − (L2 + R2)|, not the difference inside a pair; “all four retained slots” are L1, R1, L2, R2.</div></div>
       `));
       body.appendChild(frag(`<div class="ml-callout"><span class="ml-callout-icon">🔀</span><div><b>Nested yes/no questions</b> (from level 6): “<i>Is at least one of these true: (1) … (2) …</i>” is answered in two parts. Decide (1) and (2) separately, then pick the option that names which of them hold — <i>YES — only (1) holds</i>, <i>NO — neither holds</i>… The YES/NO prefix of the option is the verdict for the whole question; the rest says why. A line under the question restates this and what the connective means (<i>at least one</i>: YES unless neither holds; <i>exactly one</i>: NO when both or neither; <i>both</i>: YES only when both).</div></div>`));
       body.appendChild(frag(`<h4>Practice · a full META¹ chain</h4><p>Two marked pairs, each with its own question, then the META¹ question. Optionally one unmarked trial in between, like the spacing you will meet in the Staircase and Rating modes.</p>`));
       const host = h("div"); body.appendChild(host);
       const D = createDemo(host, {kicker:"PRACTICE", title:"Press ▶ Start chain", sub:"MEM¹ 1/2 → MEM¹ 2/2 → META¹"});
       const play = h("button", {type:"button", class:"ml-btn amber", text:"▶ Start chain"});
       const spacing = h("input", {type:"checkbox"});
       const scoreEl = h("span", {class:"ml-score"});
       D.ctrls.append(play, h("label", {}, spacing, " one distractor trial before META¹"), scoreEl);
       const L0_FOR_CHAIN = REL_BANK.filter(i => i.type === "bool" && !i.tip);
       async function pairStep(token, label, pr, exposure){
         D.setStatus(`${label} · get ready`); D.prep(); D.setMem(null);
         await D.wait(650, token);
         D.setMem(label);
         D.setStatus(`${label} · flash`); D.drawItems([{v:pr.a, rep:pr.repA, seed:pr.seedA}, {v:pr.b, rep:pr.repB, seed:pr.seedB}]);
         await D.wait(exposure, token);
         D.mask(); await D.wait(DEMO_MASK_MS, token);
         D.clear(); D.setStatus(`${label} · answer, then keep the pair in mind`);
         D.message(label, pr.item.q, "Y / N");
         const ans = await D.askAnswer({type:"bool"}, token);
         pr.answer = ans; pr.correct = pr.item.f(pr.a, pr.b); pr.ok = ans === pr.correct;
         D.clear(); D.message(pr.ok ? "✓" : "✗", pr.ok ? "Correct — retain the pair" : `The answer was ${pr.correct ? "YES" : "NO"} — still retain the pair`, "");
         await D.wait(1100, token);
       }
       play.addEventListener("click", async () => {
         const token = D.begin();
         const mk = () => { const repA = randomRep(), repB = randomRep(repA); const a = randomValueFor(repA, 1, 9), b = randomValueFor(repB, 1, 9); return {a, b, repA, repB, seedA:80 + a, seedB:90 + b, item:pick(L0_FOR_CHAIN)}; };
         const p1 = mk(), p2 = mk();
         try {
           await pairStep(token, "🧠 MEM¹ 1/2", p1, 1100);
           if(spacing.checked){
             D.setMem(null);
             const lure = mk();
             D.setStatus("ordinary trial (not marked) — answer it, do not retain it"); D.prep();
             await D.wait(600, token);
             D.drawItems([{v:lure.a, rep:lure.repA, seed:lure.seedA}, {v:lure.b, rep:lure.repB, seed:lure.seedB}]);
             await D.wait(1100, token); D.mask(); await D.wait(DEMO_MASK_MS, token);
             D.clear(); D.message("RELATIONAL", lure.item.q, "Y / N · this one is not part of the chain");
             await D.askAnswer({type:"bool"}, token);
           }
           await pairStep(token, "🧠 MEM¹ 2/2", p2, 1100);
           D.setMem(null);
           const meta = pick(META_BANK);
           const correct = meta.f(p1, p2);
           D.clear(); D.setStatus("META¹ · from memory");
           D.message("META¹ · QUESTION", meta.q, "Use the values as shown for both pairs");
           const ans = await D.askAnswer({type:meta.type, options:meta.options}, token);
           const ok = ans === correct;
           const val = meta.type === "choice" ? meta.options[correct] : (meta.type === "bool" ? (correct ? "YES" : "NO") : String(correct));
           D.clear(); D.message(ok ? "✓ CORRECT" : "✗ NOT QUITE", ok ? "" : `The answer was ${val}`, "");
           D.showFeedback(ok, ok ? "Chain complete" : "Chain complete — not quite", `Pair 1 was <b>${p1.a} / ${p1.b}</b> (answer ${p1.correct ? "YES" : "NO"}), Pair 2 was <b>${p2.a} / ${p2.b}</b> (answer ${p2.correct ? "YES" : "NO"}). META¹: <b>${esc(val)}</b>.`,
             [{v:p1.a, rep:p1.repA, seed:p1.seedA, label:`P1 LEFT ${p1.a}`}, {v:p1.b, rep:p1.repB, seed:p1.seedB, label:`P1 RIGHT ${p1.b}`}, {v:p2.a, rep:p2.repA, seed:p2.seedA, label:`P2 LEFT ${p2.a}`}, {v:p2.b, rep:p2.repB, seed:p2.seedB, label:`P2 RIGHT ${p2.b}`}]);
           const q = prog().quiz; q.chains = num(q.chains, 0) + 1; if(ok) q.chainsOk = num(q.chainsOk, 0) + 1; saveProg();
           scoreEl.textContent = `${num(q.chainsOk, 0)}/${num(q.chains, 0)} chains`;
           play.textContent = "▶ Another chain";
         } catch(e){ if(!isCancel(e)) throw e; }
       });
       body.appendChild(frag(`
         <h4>Tips that help</h4>
         <ul>
           <li><b>Name the pair</b> silently as a mini-sentence when it is marked (“six–four”). Words survive the next trial better than pictures.</li>
           <li>Two marked pairs is the whole chain — you never have to hold more than that for META¹.</li>
           <li>If a marked trial goes wrong, the chain continues: a short <i>repair card</i> tells you the true values so the META question still makes sense.</li>
           <li>In the Staircase and Rating modes the gap between the pairs and the question grows only while you keep getting META questions right (see <i>Levels &amp; progression</i>).</li>
         </ul>
       `));
     }},
    // 7 --------------------------------------------------------------------
    {id:"transfer", icon:"🧪", title:"Training for transfer", sub:"what carries over · the v1.2 layer",
     render(body){
       const X = globalThis.EUCA_TRANSFER || null;
       const snap = safe(() => X && X.snapshot ? X.snapshot() : null, null);
       const tg = snap ? snap.toggles : null;
       const onOff = k => tg ? (tg[k] ? "on" : "off") : "—";
       const hold = snap && snap.holdout && snap.holdout.length ? snap.holdout.map(r => (REP_BY_ID[r] || {name:r}).name).join(" + ") : "—";
       const idx = snap && snap.lastIndex !== null && snap.lastIndex !== undefined ? `${snap.lastIndex >= 0 ? "+" : ""}${Math.round(snap.lastIndex * 100)} points` : "no probe yet";
       const cal = snap ? snap.calendar : null;
       body.appendChild(frag(`
         <h3>Training for transfer</h3>
         <p class="ml-lead">Cognitive training reliably improves the trained task, somewhat improves similar tasks, and — across the best meta-analyses — does little for general ability. This fork does not promise otherwise. What it does is train the <b>same processes in as many variations as possible</b>, keep difficulty just above threshold without pinning you there, space the work across days, and <b>measure</b> how well your reading skill carries over to formats you did not practise.</p>
         <div class="ml-card amber"><div class="ml-card-title">What the evidence supports</div>
           <ul>
             <li><b>Near transfer is real, far transfer is not established.</b> Working-memory training moves similar tasks; effects on intelligence shrink to about zero once active control groups and publication bias are accounted for (Melby-Lervåg, Redick &amp; Hulme 2016; Sala et al. 2019).</li>
             <li><b>The exception with long-term data is speed-of-processing training</b> — adaptive, speeded, divided-attention, with booster sessions (the ACTIVE trial): trained gains lasted ten years and the speed arm had a lower dementia incidence (Rebok et al. 2014; Edwards et al. 2017; Coe et al. 2026). One trial, older adults — encouraging, not proven.</li>
             <li><b>Generalisation follows variability and spacing.</b> More varied input learns slower but generalises better (Raviv, Lupyan &amp; Green 2022); the same sessions spread over more days transferred more (Wang, Zhou &amp; Shah 2014); perceptual learning stayed specific when every trial sat at threshold and transferred when easy trials were mixed in (Hung &amp; Seitz 2014).</li>
             <li><b>Transfer follows shared processes, not shared surface.</b> Updating training transferred only to tasks using the same updating process (Dahlin et al. 2008). Hence: train relations and retention across every format, and check it.</li>
           </ul></div>
         <h4>The transfer &amp; mastery layer (Settings → Progression)</h4>
         <div class="ml-grid cols-2">
           <div class="ml-card"><div class="ml-card-title">Short staircases · ${esc(onOff("shortStairs"))}</div><p>Each block opens with four easy trials (exposure ×2 → ×1.2) and about one trial in five stays clearly above threshold, so you never spend a whole session at the edge. Every format keeps its own exposure offset on top of the global staircase: formats you read slowly get more time, fast ones less.</p></div>
           <div class="ml-card"><div class="ml-card-title">Transfer probes · ${esc(onOff("probes"))}</div><p>Two formats are held out of training — right now <b>${esc(hold)}</b>. Every sixth relational block is a <b>🧪 PROBE</b> block on those formats only. Transfer index = probe accuracy − trained accuracy (last: <b>${esc(idx)}</b>). If a probe lags by more than 10 points, the tier waits and variety widens until the next probe. Hold-outs rotate every 40 blocks or at the end of a course, so over time every format is trained.</p></div>
           <div class="ml-card"><div class="ml-card-title">Format coverage · ${esc(onOff("coverage"))}</div><p>No format takes more than about 15 % of recent trials; formats you read worse, or have not seen for days, come up more often. Together with Alberto's family balancing this is what “as many variations as possible” means in practice.</p></div>
           <div class="ml-card"><div class="ml-card-title">Focus blocks · ${esc(onOff("focus"))}</div><p>Every fourth relational block asks for one priority: <b>⚡ SPEED</b> (fast correct answers score up to 100, errors 0) or <b>🎯 ACCURACY</b> (errors count double). Shifting the emphasis is the variable-priority training that transferred between tasks in the Space Fortress and dual-task studies.</p></div>
           <div class="ml-card violet"><div class="ml-card-title">Divided-attention marker · ${esc(onOff("da"))}</div><p>UFOV-style: a small <b>▲ marker</b> flashes with the quantity at one of eight positions around the frame. After the mask, <b>tap the dashed spot where it was, then answer the question</b>. Correct localisation shrinks the marker and later adds ■ distractors; misses add exposure time. Off by default — switch it on once the ordinary trials feel comfortable. It adds your tap time to the reaction time, so compare RTs only with it on or off.</p></div>
           <div class="ml-card"><div class="ml-card-title">Calendar &amp; boosters · ${esc(onOff("calendar"))}</div><p>3–5 training days a week, 15–25 minutes each, beats bingeing. Ten training days make a <b>course</b>; after a course a few days off and a 4-session <b>booster</b> around four and twelve weeks later mirror what the ACTIVE speed training did. The app only suggests — nothing is locked.</p></div>
         </div>
         ${cal ? `<div class="ml-callout"><span class="ml-callout-icon">📅</span><div><b>Today:</b> ${cal.today.blocks} block(s), ${cal.today.min} min · <b>this week:</b> ${cal.week} training day(s) · <b>course ${cal.courseNo}</b>, day ${cal.courseDay}/10${cal.tips && cal.tips.length ? `<br>${esc(cal.tips[0])}` : ""}</div></div>` : ""}
         <h4>A routine that fits the evidence</h4>
         <ul>
           <li>Keep <b>all formats on</b> (Settings → Representations) and let the coverage cap do the mixing. Digits stay off.</li>
           <li>Train <b>3–5 days a week, 2–4 blocks</b> a day. Stop when the summary says the day is full; the next day matters more than the next block.</li>
           <li>Treat <b>probe blocks</b> as the score that matters: a rising transfer index means the reading skill is general, not format-specific.</li>
           <li>When a tier is held by a probe, do not chase it — the widened variety is the work.</li>
           <li>In <b>focus blocks</b> actually change your priority: rush in SPEED, slow down in ACCURACY. The switch is the training.</li>
           <li>Once relational trials are comfortable, try the <b>marker</b> for a few blocks per session — it is the closest thing here to the training with long-term data.</li>
           <li>After a <b>course</b>, take the pause and do the boosters. Retention, not intensity, is what those follow-ups rewarded.</li>
         </ul>
         <div class="ml-callout"><span class="ml-callout-icon">⚖️</span><div><b>What the numbers cannot tell you.</b> LV and rating measure the trained task. The transfer index measures generalisation across formats inside this task. Neither is a measure of your intelligence, memory or everyday cognition — and no app can honestly claim that.</div></div>
       `));
       const openSettings = h("button", {type:"button", class:"ml-btn", text:"Open Settings → Transfer & mastery", on:{click:() => { closeLearn(); safe(() => { const p = $("settingsPanel"); if(p){ p.open = true; const sec = $("mdTransferSection"); (sec || p).scrollIntoView({behavior:"smooth", block:"center"}); } }); }}});
       body.appendChild(h("div", {class:"ml-done-row"}, openSettings));
     }},
    // 8 --------------------------------------------------------------------
    {id:"levels", icon:"📈", title:"Levels & progression", sub:"what the LV number means",
     render(body){
       const api = globalThis.EUCA_PROGRESSION || null;
       const snap = safe(() => api && api.snapshot ? api.snapshot() : null, null);
       const modeName = snap ? ({baseline:"Baseline", staircase:"Staircase", rating:"Rating"}[snap.mode] || snap.mode) : "—";
       const status = snap ? `${esc(snap.label || ("LV " + snap.level))} · exposure ${snap.exposure} ms · META layer ${snap.meta}${snap.metaManual !== null && snap.metaManual !== undefined ? " (manual)" : ""} · spacing ${snap.spacing}${snap.blockers && snap.blockers.length ? ` · next tier: ${esc(snap.blockers[0])}` : ""}` : "Progression status is available once a profile has trained.";
       body.appendChild(frag(`
         <h3>Levels &amp; progression</h3>
         <p class="ml-lead">The HUD shows the phase and a level: <b>Auto · Relational · LV 23</b>. The <b>level card at the top of the menu</b> shows the same number big, the progress to the next level, the next <b>milestone</b> (every 10 levels) and — under “What moves it now” — the exact conditions that are still open. What moves the number depends on the progression mode you picked in Settings → Progression.</p>
         <div class="ml-card amber"><div class="ml-card-title">Right now · ${esc(modeName)}</div><p>${status}</p></div>
         <div class="ml-grid cols-3">
           <div class="ml-mode-card" data-active="${snap && snap.mode === "baseline"}"><div class="ml-mode-name">Baseline<span class="ml-mode-now">${snap && snap.mode === "baseline" ? "active" : ""}</span></div><p>Alberto's original rule. Your tier moves only when you beat your <i>own</i> history at that tier: high accuracy <b>and</b> faster than your median reaction time to go up; low accuracy or slow answers to go down. Level shown = tier (1–14).</p></div>
           <div class="ml-mode-card" data-active="${snap && snap.mode === "staircase"}"><div class="ml-mode-name">Staircase<span class="ml-mode-now">${snap && snap.mode === "staircase" ? "active" : ""}</span></div><p>Each difficulty axis has its own staircase. Tier: up after a 20-trial window at ≥ 85 % chance-corrected accuracy (≈ 85 % on YES/NO, 70 % on typed numbers), down below ≈ 60 %; a lagging transfer probe holds it. Exposure: −5 / +30 ms. META spacing (trials between the retained pairs and the META¹ question): grows after 4 correct META answers in a row. LV 1–100 combines tier, exposure, META layer and spacing.</p></div>
           <div class="ml-mode-card" data-active="${snap && snap.mode === "rating"}"><div class="ml-mode-name">Rating<span class="ml-mode-now">${snap && snap.mode === "rating" ? "active" : ""}</span></div><p>A chess-style rating, updated after every answer: fast correct answers earn the most, fast errors lose the most. Every question family has its own difficulty that learns from your play. Your tier is the highest one where you are expected to succeed about 80 % of the time.</p></div>
         </div>
         <h4>What a tier is</h4>
         <p>In the relational phase the <b>tier</b> sets the magnitude range (values grow from 4 up to 12) and which question families are in play. Above the value cap come six “runway” bands that are unlocked by META evidence — that is what <i>“next tier: needs META¹ …”</i> means in the status line: the next band waits for enough correct META answers, not for more L0 speed.</p>
         <h4>Numerical sense has its own ladder</h4>
         <p>Before the relational phase, the level is the <b>value range</b> you have unlocked (LV 1 = values up to 4). A value × format cell counts as mastered when your exposure for it gets down to about 140 ms; the next range opens when enough cells are mastered.</p>
         <div class="ml-callout"><span class="ml-callout-icon">🕹️</span><div><b>Manual steps.</b> Under “What moves it now” the level card has ▼/▲ buttons for the relational tier and for the META spacing, and a <b>META layer</b> selector — Auto / No META / META¹ / META² / META³ (Staircase and Rating, from the menu). Use them when a tier feels stale, when you want to test yourself one step higher, or when you feel one META layer has more potential for you than the one Auto is running. A tier that turns out too hard steps back down on its own through the normal rule; a layer set by hand opens its chains from the next eligible trial (its briefing card comes first the first time); choosing a lower layer drops the chains still collecting above it, a question already due is still asked once, and Auto returns to whatever the evidence says. Every forced step is logged.</div></div>
         <div class="ml-callout"><span class="ml-callout-icon">🧪</span><div><b>Which mode should I use?</b> Staircase (default) is the most predictable: keep ~85 % and you climb. Rating is best if you like one number that is comparable across sessions. Baseline is the original behaviour, kept unchanged — honest, but it can hold you at a tier for a long time once your speed has stabilised.</div></div>
       `));
       const openSettings = h("button", {type:"button", class:"ml-btn", text:"Open Settings → Progression", on:{click:() => { closeLearn(); safe(() => { const p = $("settingsPanel"); if(p){ p.open = true; const sec = $("mdProgressionSection"); (sec || p).scrollIntoView({behavior:"smooth", block:"center"}); } }); }}});
       body.appendChild(h("div", {class:"ml-done-row"}, openSettings));
     }},
    // 9 --------------------------------------------------------------------
    {id:"vocabulary", icon:"📖", title:"Vocabulary", sub:"the words the questions use",
     render(body){
       const G = (globalThis.EUCA_READING && Array.isArray(EUCA_READING.glossary)) ? EUCA_READING.glossary : [];
       body.appendChild(frag(`
         <h3>Vocabulary</h3>
         <p class="ml-lead">Alberto's questions name their rules precisely — <i>role-based</i>, <i>side transfer</i>, <i>what LEFT leaves after groups of 3</i>, the <i>even/odd machine</i>… Every term here is defined from the generator that produces it. During a block, jargon in the question is dotted-underlined: tap it (or the 📖 chip at the bottom) for the same note. <b>Negations</b> — <i>not</i>, <i>neither</i>, <i>only</i>, <i>exactly one</i> — are highlighted in gold so they are not overlooked. Both can be switched off in Settings → Progression.</p>
       `));
       const search = h("input", {type:"search", class:"ml-input", placeholder:"Search a term…", "aria-label":"Search the vocabulary"});
       const list = h("div", {class:"ml-vocab"});
       const render = q => {
         const needle = String(q || "").trim().toLowerCase();
         const rows = G.filter(g => !needle || g.title.toLowerCase().includes(needle) || (g.match || []).some(m => m.toLowerCase().includes(needle)) || g.def.toLowerCase().includes(needle));
         list.innerHTML = rows.length ? rows.map(g => `<div class="ml-vocab-row"><b>${esc(g.title)}</b><span>${esc(g.def)}</span>${g.match && g.match.length > 1 ? `<i>also: ${esc(g.match.filter(m => m.toLowerCase() !== g.title.toLowerCase()).slice(0, 4).join(" · "))}</i>` : ""}</div>`).join("") : `<div class="ml-vocab-row"><span>No term matches.</span></div>`;
       };
       search.addEventListener("input", () => render(search.value));
       body.appendChild(h("div", {class:"ml-card"}, search));
       body.appendChild(list);
       render("");
       body.appendChild(frag(`<div class="ml-callout"><span class="ml-callout-icon">🔍</span><div><b>Forgot a retained value?</b> Under every META question there is a <b>Peek</b> row: reveal one retained item (Pair 2 RIGHT, Answer 1, Question B…) instead of giving the question up. The reasoning still counts; the memory part is what it costs — the question counts half for the rating, and as a missed memory for the META spacing and for the META evidence that opens layers. Staircase and Rating modes; toggle in Settings → Progression.</div></div>`));
     }},
    {id:"controls", icon:"⌨️", title:"Controls & settings", sub:"shortcuts · menu · coach",
     render(body){
       body.appendChild(frag(`
         <h3>Controls, review and settings</h3>
         <p class="ml-lead">Everything can be done by touch, but the keyboard is faster — reaction time counts from the moment the question appears.</p>
         <h4>Keyboard</h4>
         <div class="ml-card"><div class="ml-kbd-grid">
           <div><span>Start a block from the menu</span><span><kbd>Space</kbd></span></div>
           <div><span>Type a number</span><span><kbd>0</kbd>–<kbd>9</kbd> · <kbd>−</kbd> for negative</span></div>
           <div><span>YES / NO</span><span><kbd>Y</kbd> / <kbd>N</kbd> or <kbd>←</kbd> / <kbd>→</kbd></span></div>
           <div><span>Choose an option</span><span><kbd>1</kbd>–<kbd>4</kbd></span></div>
           <div><span>Continue after a review card / briefing</span><span><kbd>Space</kbd> or <kbd>Enter</kbd></span></div>
           <div><span>Pause → menu</span><span><kbd>Esc</kbd></span></div>
           <div><span>In this panel: next / previous lesson</span><span><kbd>→</kbd> / <kbd>←</kbd></span></div>
           <div><span>Close this panel</span><span><kbd>Esc</kbd></span></div>
         </div></div>
         <h4>During a block</h4>
         <div class="ml-grid cols-2">
           <div class="ml-card"><div class="ml-card-title">Review card</div><p>After an error the trial is explained: the values, the rule, the right answer. It stays until you press <kbd>Space</kbd>/<kbd>Enter</kbd> or tap Continue — read it, that is where most of the learning is.</p></div>
           <div class="ml-card"><div class="ml-card-title">Menu / resume</div><p><b>Menu</b> (or <kbd>Esc</kbd>) pauses the block. <b>Resume block</b> continues it exactly where it was; <b>Start block</b> applies menu changes and begins a new one.</p></div>
           <div class="ml-card"><div class="ml-card-title">Block summary</div><p>Accuracy, reaction time, level and what changed, plus a “Next:” line with the first open condition for the next level. <kbd>Space</kbd> continues, Take a break returns to the menu, <kbd>M</kbd> opens Milestones.</p></div>
           <div class="ml-card"><div class="ml-card-title">Reaction time, fairly</div><p>The RT tile shows the <b>median per trial type</b> and how many answers fit their <b>budget</b> = the type's target (L0 1.8 s, META¹ 3.8 s, META² 6.5 s, META³ 9 s) + 220 ms per word of question beyond the first eight. Colour compares you with your own usual pace. A ✓ next to a trial's RT means “slower than the raw target, but within budget for a question this long”.</p></div>
           <div class="ml-card"><div class="ml-card-title">? HELP</div><p>The chip next to Menu pauses the block and opens the lesson that matches the trial on screen. On phones use Menu → 🎓 Learn.</p></div>
           <div class="ml-card"><div class="ml-card-title">🧪 PROBE · ⚡ SPEED · 🎯 ACCURACY</div><p>Block tags in the HUD. A probe block uses only the two held-out formats and measures transfer; focus blocks ask you to change your priority. See <i>Training for transfer</i>.</p></div>
           <div class="ml-card"><div class="ml-card-title">▲ Marker (optional)</div><p>With the divided-attention marker on, dashed spots appear after the mask: tap the one where the ▲ flashed, then answer. Keyboard users: it is a pointer tap; the answer keys still work as usual afterwards.</p></div>
         </div>
         <h4>Menu</h4>
         <ul>
           <li><b>User P1 / P2 / P3</b> — three independent profiles (progress, settings, tutorial progress).</li>
           <li><b>Progress summary, history, milestones</b> — your accuracy, RT and level over time.</li>
           <li><b>Settings → Representations</b> — switch formats on or off. Keep them all on for the full effect; “Digits” is off by default.</li>
           <li><b>Settings → Progression</b> — Baseline / Staircase / Rating, continuous META chain, MEM banner hold, 🔍 Peek on META questions, the reading aids (highlight negations, term hints, summary shine, bigger diagrams) and the <b>LEFT/RIGHT stimulus size</b> (Normal = Alberto's layout, Large = default, Max).</li>
           <li><b>Level card → manual steps</b> — in Staircase and Rating you can push the relational tier or the META spacing up or down yourself from the menu, and pick the META layer (Auto / No META / META¹ / META² / META³); the normal rules keep adapting afterwards (self-chosen difficulty trains as well as adaptive difficulty: von Bastian &amp; Eschen 2016).</li>
           <li><b>Sound / haptics</b> — feedback cues. <b>Export / Import progress</b> — a JSON file you can move to another device. <b>Reset</b> — hold the button to wipe the active profile.</li>
         </ul>
       `));
       const p = prog();
       const coach = h("button", {type:"button", class:"ml-toggle", "aria-pressed":String(!!p.coach), text:"Coach hints during trials"});
       coach.addEventListener("click", () => { const s = prog(); s.coach = !s.coach; saveProg(); coach.setAttribute("aria-pressed", String(!!s.coach)); if(!s.coach) hideCoach(); });
       const resetHints = h("button", {type:"button", class:"ml-btn small ghost", text:"Show all hints again", on:{click:() => { const s = prog(); s.seen = {}; s.coach = true; saveProg(); coach.setAttribute("aria-pressed", "true"); resetHints.textContent = "✓ hints reset"; }}});
       const resetAll = h("button", {type:"button", class:"ml-btn small ghost", text:"Reset tutorial progress", on:{click:() => { P.st = defaultProgress(); P.st.opened = true; saveProg(); renderRail(); updateHeadProgress(); refreshMenuBits(); resetAll.textContent = "✓ reset"; }}});
       body.appendChild(h("div", {class:"ml-done-row"}, coach, resetHints, resetAll));
     }}
  ];
  const LESSON_INDEX = Object.fromEntries(LESSONS.map((l, i) => [l.id, i]));

  // ------------------------------------------------------------------------
  // Modal
  // ------------------------------------------------------------------------
  const M = {root:null, rail:null, body:null, foot:null, head:null, bar:null, count:null, current:null, prevBtn:null, nextBtn:null, doneBtn:null, invoker:null};
  function isOpen(){ return !!(M.root && M.root.classList.contains("visible")); }
  function ensureModal(){
    if(M.root) return M.root;
    const close = h("button", {type:"button", id:"mdLearnClose", text:"Close · Esc", on:{click:() => closeLearn()}});
    M.bar = h("i");
    M.count = h("span", {text:"0/8"});
    M.head = h("div", {id:"mdLearnHead"},
      h("div", {class:"ml-head-text"}, h("div", {class:"ml-eyebrow", text:"Learn · step by step"}), h("h2", {id:"mdLearnTitle", text:"Eucalculia tutorial"})),
      h("div", {class:"ml-head-progress"}, h("div", {class:"ml-bar"}, M.bar), M.count),
      close);
    M.rail = h("nav", {id:"mdLearnRail", "aria-label":"Lessons"});
    M.body = h("div", {id:"mdLearnBody", tabindex:"-1"});
    M.prevBtn = h("button", {type:"button", class:"ml-btn ghost", text:"← Previous", on:{click:() => navigate(-1)}});
    M.nextBtn = h("button", {type:"button", class:"ml-btn primary", text:"Next lesson →", on:{click:() => navigate(+1, true)}});
    M.doneBtn = h("button", {type:"button", class:"ml-toggle", text:"✓ Mark as read", on:{click:() => { toggleDone(M.current); }}});
    M.foot = h("div", {id:"mdLearnFoot"}, M.prevBtn, h("div", {class:"ml-foot-mid"}, M.doneBtn), M.nextBtn);
    const card = h("div", {id:"mdLearnCard", role:"document"}, M.head, M.rail, M.body, M.foot);
    M.root = h("div", {id:"mdLearn", role:"dialog", "aria-modal":"true", "aria-labelledby":"mdLearnTitle"}, card);
    M.root.addEventListener("click", ev => { if(ev.target === M.root) closeLearn(); });
    document.body.appendChild(M.root);
    renderRail();
    return M.root;
  }
  function renderRail(){
    if(!M.rail) return;
    M.rail.innerHTML = "";
    const d = prog().done;
    LESSONS.forEach((l, i) => {
      const btn = h("button", {type:"button", class:"ml-chapter", "aria-current":String(M.current === l.id), on:{click:() => showLesson(l.id)}},
        h("span", {class:"ml-ch-icon", text:l.icon}),
        h("span", {}, h("span", {class:"ml-ch-title", text:l.title}), h("span", {class:"ml-ch-sub", text:l.sub})),
        d[l.id] ? h("span", {class:"ml-ch-done", text:"✓"}) : h("span", {class:"ml-ch-num", text:String(i + 1)}));
      M.rail.appendChild(btn);
    });
  }
  function updateHeadProgress(){
    if(!M.bar) return;
    const n = doneCount();
    M.bar.style.width = `${Math.round(100 * n / LESSONS.length)}%`;
    M.count.textContent = `${n}/${LESSONS.length}`;
    if(M.doneBtn && M.current){ const done = !!prog().done[M.current]; M.doneBtn.setAttribute("aria-pressed", String(done)); M.doneBtn.textContent = done ? "✓ Read" : "Mark as read"; }
  }
  function markDone(id){ const s = prog(); if(!s.done[id]){ s.done[id] = true; saveProg(); } renderRail(); updateHeadProgress(); refreshMenuBits(); }
  function toggleDone(id){ const s = prog(); if(s.done[id]) delete s.done[id]; else s.done[id] = true; saveProg(); renderRail(); updateHeadProgress(); refreshMenuBits(); }
  function showLesson(id){
    ensureModal();
    if(!LESSONS[LESSON_INDEX[id]]) id = LESSONS[0].id;
    destroyAllDemos();
    M.current = id;
    const idx = LESSON_INDEX[id], lesson = LESSONS[idx];
    M.body.innerHTML = "";
    const wrapEl = h("div", {class:"ml-lesson"});
    safe(() => lesson.render(wrapEl));
    M.body.appendChild(wrapEl);
    M.body.scrollTop = 0;
    M.prevBtn.disabled = idx === 0;
    M.nextBtn.textContent = idx === LESSONS.length - 1 ? "Finish ✓" : "Next lesson →";
    const s = prog(); s.last = id; s.opened = true; saveProg();
    renderRail(); updateHeadProgress(); refreshMenuBits();
    safe(() => M.body.focus({preventScroll:true}));
  }
  function navigate(dir, markCurrent){
    if(!M.current) return;
    if(markCurrent) markDone(M.current);
    const idx = LESSON_INDEX[M.current] + dir;
    if(idx < 0) return;
    if(idx >= LESSONS.length){ closeLearn(); return; }
    showLesson(LESSONS[idx].id);
  }
  function openLearn(lessonId){
    ensureModal();
    if(!isOpen()) M.invoker = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
    M.root.classList.add("visible");
    showLesson(lessonId || prog().last || LESSONS[0].id);
  }
  function closeLearn(){
    if(!isOpen()) return;
    destroyAllDemos();
    M.root.classList.remove("visible");
    const target = (M.invoker && M.invoker.isConnected) ? M.invoker : $("mdLearnBtn");
    M.invoker = null;
    safe(() => target && target.focus({preventScroll:true}));
    refreshMenuBits();
  }

  // keyboard: registered on window in capture phase; the game's own capture
  // handlers ran already (they were registered first) and answer keys are
  // ignored by the game while the menu is open.
  window.addEventListener("keydown", e => {
    if(!isOpen()) return;
    const t = e.target;
    const inField = !!(t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA" || t.isContentEditable));
    if(e.key === "Escape"){ e.preventDefault(); e.stopImmediatePropagation(); closeLearn(); return; }
    if(e.key === "Tab") return;                       // the game's focus trap handles it (activeModalForFocusTrap → #mdLearn)
    if(inField) return;
    const ask = currentAsk();
    if(ask && !e.altKey && !e.ctrlKey && !e.metaKey){
      if(safe(() => ask.onKey(e), false)){ e.preventDefault(); e.stopImmediatePropagation(); return; }
    }
    if(ask && (e.key === "ArrowRight" || e.key === "ArrowLeft")) return;   // a practice question is waiting: arrows don't change lesson
    if((e.key === " " || e.code === "Space") && t && t.tagName === "BUTTON" && M.root.contains(t)){
      // the menu's Space handler already called preventDefault: activate the focused button ourselves
      e.preventDefault(); e.stopImmediatePropagation(); t.click(); return;
    }
    if((e.key === "ArrowRight" || e.key === "ArrowLeft") && !e.altKey && !e.ctrlKey && !e.metaKey && !(t && t.tagName === "BUTTON" && t.closest(".ml-answers"))){
      e.preventDefault(); e.stopImmediatePropagation(); navigate(e.key === "ArrowRight" ? +1 : -1, false);
    }
  }, true);
  window.addEventListener("keyup", e => {
    if(!isOpen()) return;
    if((e.key === " " || e.code === "Space") && e.target && e.target.tagName === "BUTTON" && M.root.contains(e.target)){ e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
  function currentAsk(){ for(const d of demos) if(d.ask) return d.ask; return null; }
  // nothing behind the modal may receive a (synthetic or real) click while it is open
  document.addEventListener("click", e => {
    if(!isOpen()) return;
    if(M.root.contains(e.target)) return;
    e.stopPropagation(); e.preventDefault();
  }, true);
  wrap("activeModalForFocusTrap", previous => function activeModalForFocusTrapML(){
    if(isOpen()) return M.root;
    return previous.apply(this, arguments);
  });

  // ------------------------------------------------------------------------
  // Menu: Learn button + welcome card
  // ------------------------------------------------------------------------
  function installMenuButton(){
    if($("mdLearnBtn")) return;
    const guide = $("guideBtn");
    if(!guide) return;
    const btn = h("button", {type:"button", id:"mdLearnBtn", class:"btn euca-action--secondary menuAuxAction", "aria-haspopup":"dialog", "aria-controls":"mdLearn"},
      "🎓 Learn — tutorial", h("span", {class:"ml-progress-pill", text:"NEW"}));
    btn.addEventListener("click", ev => { ev.preventDefault(); ev.stopPropagation(); openLearn(); });
    guide.parentNode.insertBefore(btn, guide.nextSibling);
  }
  function installWelcome(){
    if($("mdWelcome")) return;
    const row = document.querySelector("#overlayCard .btnRow");
    if(!row) return;
    const card = h("div", {id:"mdWelcome", role:"region", "aria-label":"First time here?"},
      h("div", {class:"ml-w-text"}, h("div", {class:"ml-w-title", text:"First time here? Take the 5-minute tutorial."}), h("div", {class:"ml-w-sub", text:"What the flashes are, how to read every format, what LEFT/RIGHT questions and 🧠 MEM chains ask of you — with practice rounds. You can also just start: the coach will hint as you go."})),
      h("div", {class:"ml-w-actions"},
        h("button", {type:"button", class:"ml-btn primary", text:"Start the tutorial", on:{click:ev => { ev.preventDefault(); ev.stopPropagation(); const s = prog(); s.welcomed = true; saveProg(); openLearn("welcome"); }}}),
        h("button", {type:"button", class:"ml-btn ghost", text:"Skip", on:{click:ev => { ev.preventDefault(); ev.stopPropagation(); const s = prog(); s.welcomed = true; saveProg(); refreshMenuBits(); }}})));
    row.parentNode.insertBefore(card, row);
  }
  function refreshMenuBits(){
    const s = prog();
    const btn = $("mdLearnBtn");
    if(btn){
      const pill = btn.querySelector(".ml-progress-pill");
      const n = doneCount();
      if(pill) pill.textContent = s.opened ? (n >= LESSONS.length ? "✓ done" : `${n}/${LESSONS.length}`) : "NEW";
    }
    const w = $("mdWelcome");
    if(w){
      const trials = num(hasState() && State.stats && State.stats.trials, 0);
      const show = !s.welcomed && !s.opened && trials < 20;
      w.style.display = show ? "" : "none";
    }
    installHelpChip();
  }
  wrap("updateMenu", previous => function updateMenuML(){
    const out = previous.apply(this, arguments);
    safe(refreshMenuBits);
    return out;
  });

  // ------------------------------------------------------------------------
  // In-game: help chip + coach strip
  // ------------------------------------------------------------------------
  function lessonForCurrentTrial(){
    const k = classifyTrial();
    if(!k) return "welcome";
    if(k.meta) return "meta";
    switch(k.kind){
      case "subitize": return "formats";
      case "transform": case "posner_tr": return "transform";
      case "posner": case "witness": case "build": case "spatial": case "choice": return "relational";
      default: return "welcome";
    }
  }
  function installHelpChip(){
    if($("mdHelpChip")) return;
    const hud = $("hud");
    if(!hud) return;
    const chip = h("button", {type:"button", id:"mdHelpChip", title:"Pause and open the lesson for this trial", "aria-label":"Help: pause and open the tutorial", text:"? HELP"});
    chip.addEventListener("click", ev => {
      ev.preventDefault(); ev.stopPropagation();
      const lesson = lessonForCurrentTrial();
      const running = !!(hasState() && State.running);
      if(running && !(hasState() && State.paused)){
        safe(() => { if(typeof openMenuEmergencySafe === "function") openMenuEmergencySafe("learn_help"); else $("pauseBtn") && $("pauseBtn").click(); });
        setTimeout(() => openLearn(lesson), 60);
      } else openLearn(lesson);
    });
    hud.appendChild(chip);
  }
  function updateHelpChip(status){
    const chip = $("mdHelpChip");
    if(!chip) return;
    const show = hasState() && State.running && !["MENU", "SUMMARY", "BLOCK_INTRO"].includes(status);
    chip.classList.toggle("visible", !!show);
  }

  function classifyTrial(){
    if(!hasState()) return null;
    const info = State.trialInfo || {};
    const panel = String(State.pendingPanel || "");
    const lvl = num(State.currentTrialLevel, 0);
    const kind = String(info.kind || "");
    const mem = !!info.memoryActive;
    let k = "other";
    if(lvl >= 1 || /^meta[123]/.test(kind)) k = "meta";
    else if(kind === "subitize") k = "subitize";
    else if(kind === "subitize_transform" || info.autoPhase === "1B") k = "transform";
    else if(/^generative/.test(kind) || panel === "genpair" || panel === "geninduct") k = "build";
    else if(/visual_predict|paper|spatial|cube|rotation/.test(kind) || panel === "xrep") k = "spatial";
    else if(kind === "scalar_witness_inline") k = "witness";
    else if(info.representationTransform) k = "posner_tr";
    else if(kind === "posner") k = panel === "choice" ? "choice" : "posner";
    return {kind:k, meta:k === "meta" ? clampN(lvl, 1, 3) : 0, panel, mem, level:lvl};
  }
  function coachText(k){
    if(k.mem && k.kind !== "meta") return "🧠 Retain this pair (LEFT and RIGHT) for a later META question — and answer this one as usual.";
    switch(k.kind){
      case "subitize": return "One quantity was flashed. Type the number you saw — it submits by itself, no Enter needed.";
      case "transform": return "Read the value as shown, then apply the rule in the question (empty cells, hidden face, hours later…).";
      case "posner_tr": return "One side is TRANSFORMED — the question states the rule. Apply it before you compare.";
      case "posner": return k.panel === "numpad" ? "Two values were flashed, LEFT and RIGHT. Type the number the question asks for." : "Two values were flashed, LEFT and RIGHT. Answer the question about them: Y / N or ← / →.";
      case "choice": return "Pick the option that is true for the LEFT / RIGHT pair you just saw — keys 1–4.";
      case "witness": return "Exact distance = |LEFT − RIGHT|, always a positive number.";
      case "build": return "Build a pair: choose a LEFT value, then a RIGHT value, so the statement comes out as asked (YES or NO).";
      case "spatial": return "Spatial: apply the stated move to the source figure in your mind, then pick the matching result.";
      case "meta": {
        if(k.mem) return `🧠 Your answer here is retained for a later META${k.meta === 1 ? "²" : "³"} question — answer as usual.`;
        if(k.meta === 1) return "META¹ asks about the two 🧠 pairs you retained (Pair 1, then Pair 2). Values as shown unless the hint says TRANSFORMED. Forgot one? 🔍 Peek below reveals it.";
        if(k.meta === 2) return "META² asks about your two previous META¹ episodes.";
        return "META³ combines two META² episodes.";
      }
      default: return "";
    }
  }
  function ensureCoach(){
    let strip = $("mdCoach");
    if(strip) return strip;
    const tray = $("tray");
    if(!tray) return null;
    strip = h("div", {id:"mdCoach", role:"status", "aria-live":"polite"},
      h("span", {class:"ml-coach-text"}),
      h("span", {style:"display:flex;gap:6px;flex:0 0 auto"},
        h("button", {type:"button", title:"Open the lesson for this trial", text:"?", on:{click:ev => { ev.preventDefault(); ev.stopPropagation(); const chip = $("mdHelpChip"); if(chip) chip.click(); }}}),
        h("button", {type:"button", title:"Turn coach hints off (Learn → Controls to turn them back on)", text:"hide", on:{click:ev => { ev.preventDefault(); ev.stopPropagation(); const s = prog(); s.coach = false; saveProg(); hideCoach(); syncCoachRow(true); }}})));
    // v1.4.1: the strip sits between the stimulus frame and the answer tray as its
    // own grid row of #app, so it borrows height from the frame, never from the
    // answer buttons (inside the tray it squeezed 4-option META²/³ choices on phones).
    if(tray.parentNode && tray.parentNode.id === "app") tray.parentNode.insertBefore(strip, tray); else tray.insertBefore(strip, tray.firstChild);
    setTimeout(() => safe(() => syncCoachRow(true)), 0);
    return strip;
  }
  // The row is *reserved* for the whole block while the coach can still speak (some trial kind
  // is under its hint cap), so the stimulus frame keeps one height from FLASH to INPUT instead
  // of jumping by the strip's height each time a hint appears. Re-evaluated at block boundaries.
  function coachReserved(){
    const s = prog();
    if(!s.coach) return false;
    const keys = Object.keys(s.seen || {});
    if(!keys.length) return true;
    return keys.some(k => num(s.seen[k], 0) <= COACH_SHOW_PER_KIND);
  }
  let _rowReserved = null;
  function syncCoachRow(force){
    const app = $("app"), strip = $("mdCoach");
    if(!app || !strip || strip.parentNode !== app) return;
    const st = hasState() ? String(State.status || "") : "";
    if(_rowReserved === null || force === true || st === "MENU" || st === "SUMMARY" || st === "BLOCK_INTRO" || st === "IDLE") _rowReserved = coachReserved();
    const visible = strip.classList.contains("visible");
    app.classList.toggle("md-has-coach", !!(_rowReserved || visible));
    strip.classList.toggle("reserved", !!(_rowReserved && !visible));
  }
  function hideCoach(){ const s = $("mdCoach"); if(s){ s.classList.remove("visible", "mem"); } syncCoachRow(); }
  const coachState = {lastTrial:-1};
  function updateCoach(status){
    const strip = ensureCoach();
    if(!strip) return;
    if(status !== "INPUT" || !prog().coach){ hideCoach(); return; }
    const k = classifyTrial();
    if(!k || !k.kind || k.kind === "other"){ hideCoach(); return; }
    const key = k.kind + (k.meta ? k.meta : "") + (k.mem ? "+mem" : "");
    const s = prog();
    const trialNo = num(State.stats && State.stats.trials, 0) + ":" + num(State.blockTrials, 0);
    if(coachState.lastTrial !== trialNo){
      coachState.lastTrial = trialNo;
      s.seen[key] = num(s.seen[key], 0) + 1;
      saveProg();
    }
    if(num(s.seen[key], 0) > COACH_SHOW_PER_KIND){ hideCoach(); return; }
    const text = coachText(k);
    if(!text){ hideCoach(); return; }
    strip.querySelector(".ml-coach-text").textContent = text;
    strip.classList.toggle("mem", !!k.mem);
    strip.classList.add("visible");
    syncCoachRow();
  }
  wrap("setStatus", previous => function setStatusML(status){
    const out = previous.apply(this, arguments);
    safe(() => { updateCoach(status); updateHelpChip(status); });
    return out;
  });

  // ------------------------------------------------------------------------
  // Public API + boot
  // ------------------------------------------------------------------------
  const api = {
    open:openLearn, close:closeLearn, show:showLesson,
    lessons:LESSONS.map(l => ({id:l.id, title:l.title})),
    get progress(){ return prog(); },
    get isOpen(){ return isOpen(); },
    reset(){ P.st = defaultProgress(); saveProg(); renderRail(); updateHeadProgress(); refreshMenuBits(); return P.st; },
    classify:classifyTrial,
    lessonForCurrentTrial
  };
  try { Object.defineProperty(globalThis, "EUCA_LEARN", {value:api, writable:false, configurable:false, enumerable:true}); } catch(_){ globalThis.EUCA_LEARN = api; }

  function boot(){
    reapplyWraps();
    installMenuButton();
    installWelcome();
    installHelpChip();
    ensureCoach();
    refreshMenuBits();
    window.addEventListener("load", () => { reapplyWraps(); refreshMenuBits(); }, {once:true});
    document.documentElement.dataset.eucaMdLearn = "1";
  }
  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, {once:true});
  else boot();
})();
