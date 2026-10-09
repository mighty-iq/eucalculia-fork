/* ==========================================================================
   Eucalculia Fork — reading aids & polish (v1.5, .da.rk.'s feedback)
   ---------------------------------------------------------------------------
   A fork of Eucalculia by Alberto Flaño Lombardo, built with his permission.
   Ideas and changes: mighty_elf and .da.rk. (Discord). Appended patch block —
   Alberto's code is never edited in place.

     1. Term hints: jargon in a question ("role-based", "side transfer",
        "leaves after groups of 3", "finite-state machine"…) gets a dotted
        underline; tap/click shows a short definition. A 📖 chip lists every
        term in the current question and its options. Definitions are written
        from the generators' own semantics.
     2. Negation highlighting: not / neither / only / exactly one / without…
        are emphasised so they are not overlooked ("sometimes I overlook 'not'").
     3. Recursive-trace cards state the actual inner rule for counted halving
        and the finite-state machines (the generic row left the rule unsaid).
     4. The rotation card's viewpoint line ("FROM BEHIND THE FIGURE") is drawn
        white like the instruction it belongs to.
     5. Build-a-pair prompts whose rule has an implicit domain (a smaller value
        of 1, a difference of 1) reject such pairs with an explanation instead
        of marking a mathematically correct pair wrong.
     6. A short "seal" shine on the block summary (gold on a level milestone).
     7. Bigger, clearer diagrams (.da.rk., round four): the directed-graph
        stimuli fill their box with larger panels, thicker edges and bigger
        arrowheads; the paper-folding candidates sit in one row with sheets
        about twice the size on a PC.
     8. Paper-folding items whose candidate patterns are visually identical
        (a symmetry image that differs only by rounding — "any1 seeing a
        difference between 3 and 4?") are rebuilt from another seed before
        they are shown, with Alberto's own G083 distinctness rule.
     9. The correction card of a build-a-pair task shows a pair that works
        (and why, for the two-property questions) instead of only "build a
        pair that makes the claim YES".
    10. Nested yes/no questions ("Is at least one of these true: (1)… (2)…")
        get a line explaining the two-part answer: decide (1) and (2), pick
        the option naming which hold — its YES/NO prefix is the verdict.
   ========================================================================== */
(function(){
  "use strict";
  if(globalThis.__EUCA_MD_READING_INSTALLED__) return;
  globalThis.__EUCA_MD_READING_INSTALLED__ = true;

  const STORAGE_PREFIX = "euca:md:read:v1:p";
  const hasState = () => typeof State === "object" && !!State;
  const num = (v, d=0) => Number.isFinite(Number(v)) ? Number(v) : d;
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
  const safe = (fn, fallback) => { try { return fn(); } catch(e){ try { console.warn("[Eucalculia md-reading] ", e); } catch(_){} return fallback; } };
  const $ = id => document.getElementById(id);
  const R = {st:null, profile:0, audit:false, terms:[], pop:null, panel:null, _sealTimer:0};

  // ---- outermost wrappers (same technique as the other fork blocks) ----
  const FACTORIES = Object.create(null), INSTALLED = Object.create(null), REENTRY = Object.create(null);
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
      if(/Original$/.test(key) || /^__m[dlxr]/.test(key)) continue;
      if(typeof previous[key] === "function") continue;
      try { wrapped[key] = previous[key]; } catch(_){}
    }
    try { Object.defineProperty(wrapped, "name", {value:name + "MR"}); } catch(_){}
    wrapped.__mrWrapped = name; wrapped.__mrOriginal = previous;
    globalThis[name] = wrapped; INSTALLED[name] = wrapped;
    return true;
  }
  function wrap(name, factory){ FACTORIES[name] = factory; return applyWrap(name); }
  function reapplyWraps(){ for(const name of Object.keys(FACTORIES)) safe(() => applyWrap(name)); }
  const prog = () => globalThis.EUCA_PROGRESSION || null;
  function isBaseline(){ const P = prog(); return !!(P && P.state && P.state.mode === "baseline"); }

  // ------------------------------------------------------------------------
  // Settings (per profile)
  // ------------------------------------------------------------------------
  function activeProfile(){ return Math.max(1, Math.min(3, num(hasState() && State.activeProfile, 1) || 1)); }
  function defaults(){ return {negations:true, terms:true, seal:true, visuals:true, seen:{}}; }
  function st(){
    if(R.st && R.profile === activeProfile()) return R.st;
    R.profile = activeProfile();
    let saved = null;
    try { const raw = localStorage.getItem(STORAGE_PREFIX + R.profile); if(raw) saved = JSON.parse(raw); } catch(_){ saved = null; }
    R.st = {...defaults(), ...(saved && typeof saved === "object" ? saved : {})};
    if(!R.st.seen || typeof R.st.seen !== "object") R.st.seen = {};
    return R.st;
  }
  function save(){ try { localStorage.setItem(STORAGE_PREFIX + R.profile, JSON.stringify(st())); } catch(_){} }

  // ------------------------------------------------------------------------
  // 1. Glossary — written from the generators' own semantics
  // ------------------------------------------------------------------------
  // match: literal phrases (case-insensitive, word-bounded) or a regex with a dynamic definition
  const GLOSSARY = [
    {key:"role_based", title:"role-based", match:["role-based", "role based", "role-based task", "role-based operation"],
     def:"The values are picked by their ROLE inside a pair — the larger or the smaller one — not by side (LEFT/RIGHT). Example: “add the larger of each pair”, “pair 1's smaller value plus pair 2's larger value”."},
    {key:"role_transfer", title:"role transfer / side transfer", match:["role-transfer", "role transfer", "side transfer", "cross-pair side transfer", "side-transfer rule", "side transfer from pair 1 to pair 2"],
     def:"Find the SIDE (left or right) where pair 1's larger (or smaller, or even…) value sat, then read pair 2's value on that same side — or on the opposite side if the question says so."},
    {key:"same_side", title:"same-named side readout", match:["same-named side readout", "left/right position", "left/right-position", "left/right side readout"],
     def:"The question reads values by their side name: LEFT with LEFT or RIGHT with RIGHT. Examples: the sum of the LEFT values, the gap between the two RIGHT values."},
    {key:"global", title:"global calculation", match:["whole-pair/global calculation", "global calculation", "global operation"],
     def:"Uses all four retained values at once: the sum of all four, the largest or the smallest of all four, their order."},
    {key:"pair_compare", title:"pair-to-pair comparison", match:["pair-to-pair comparison", "pair-comparison", "pair comparison"],
     def:"Compares the two pairs as wholes — which pair had the larger total, the difference between the pair totals."},
    {key:"gap", title:"gap (within a pair)", match:["within-pair gap/difference", "within-pair gap", "gap within a pair", "a gap within a pair"],
     def:"The difference between the two values of the SAME pair: |LEFT − RIGHT|. A “gap rule” works on that difference."},
    {key:"anchor", title:"anchor", match:["anchor", "approach anchor", "movement toward an anchor", "approach-anchor"],
     def:"A fixed reference number (10, 5, the first pair's total…). The question measures distance to it or whether the values moved toward it."},
    {key:"conditional", title:"if/else (conditional) rule", match:["if/else", "conditional rule", "if-rule", "if-else rule"],
     def:"A rule with a test: if the condition holds, use one computation; otherwise the other. Check the condition first, then apply only the matching branch."},
    {key:"property", title:"property filter", match:["property-filter", "property filter", "property-count", "property count"],
     def:"Keep only the values that have a property (even, odd, prime, above 5…) and compute with those — for instance count them or add them."},
    {key:"trajectory", title:"before/after change", match:["before/after change", "before/after-change", "before/after change between pairs", "trajectory"],
     def:"How a quantity changed from pair 1 to pair 2 — grew, shrank, by how much, or moved toward an anchor."},
    {key:"interval_transfer", title:"interval transfer", match:["interval transfer", "interval-transfer", "between-interval transfer"],
     def:"Take the interval (the gap) of one pair and carry it onto the other pair or onto an anchor."},
    {key:"transformation", title:"transformation / transformed values", match:["transformation rule", "transformed values", "transformed numbers", "changed-values-first"],
     def:"The values AFTER the stated change (opposite die face, frame complement, +3 hours, folded fingers…) rather than as they were shown. The banner and the hint under META¹ say which pairs use them."},
    {key:"witness", title:"witness", match:["witness", "dual witness", "witnesses"],
     def:"A concrete LEFT/RIGHT pair that shows a claim is possible — a “witness” for YES. Build-a-pair tasks ask you to construct one (a dual witness: one pair for YES and one for NO)."},
    {key:"threshold", title:"threshold", match:["threshold", "threshold rule", "cut-off"],
     def:"The cut-off number a value is compared against: “more than 10?”, “at least 5?”. Watch for “more than” (strict) versus “at least” (includes the number)."},
    {key:"parity", title:"parity", match:["parity", "same parity", "different parity"],
     def:"Whether a number is even or odd. Same parity = both even or both odd."},
    {key:"prime", title:"prime", match:["prime", "primes", "prime number", "prime numbers", "non-prime"],
     def:"A whole number above 1 that only 1 and itself divide: 2, 3, 5, 7, 11, 13, 17, 19. 1 is not prime; 2 is the only even prime."},
    {key:"composite", title:"composite", match:["composite", "composites", "composite number"],
     def:"A whole number above 1 that is NOT prime (it has another divisor): 4, 6, 8, 9, 10, 12, 14, 15, 16, 18, 20."},
    {key:"square", title:"square number", match:["square number", "perfect square", "a square"],
     def:"A whole number times itself: 1, 4, 9, 16, 25, 36…"},
    {key:"status_square", title:"square-number status", match:["square-number status", "square number status", "square status", "being a square"],
     def:"Whether a value IS a square number (1, 4, 9, 16, 25…) or is not. “Different square-number status” = one value is a square and the other is not (9 and 5); “the same” = both are (4 and 9) or neither is (5 and 7)."},
    {key:"status_mult3", title:"multiple-of-3 status", match:["multiple-of-3 status", "multiple of 3 status", "divisibility by 3", "multiple-of-3 left"],
     def:"Whether a value is divisible by 3 (3, 6, 9, 12…) or not. Different status = exactly one of the two is a multiple of 3 (9 and 5); the same = both are (6 and 9) or neither is (4 and 5)."},
    {key:"status_prime", title:"prime status", match:["prime status", "primality"],
     def:"Whether a value is prime or not. Different prime status = one is prime and the other is not; the same = both prime or both non-prime."},
    {key:"matched_on", title:"matched / mismatched on", match:["matched on", "mismatched on", "agree on", "disagree on"],
     def:"Matched (agree) on a property: both values have it or both lack it. Mismatched (disagree): exactly one of them has it. Each property in the question is checked separately, then the two verdicts are combined as the question says (and / but)."},
    {key:"multiple", title:"multiple / divisible", match:["exact multiple", "a multiple of", "multiple of", "divisible by", "divisible", "with no remainder", "divides evenly", "evenly divisible"],
     def:"A is a multiple of B (A is divisible by B) when A ÷ B leaves no remainder: 12 is a multiple of 3; 12 ÷ 5 leaves 2, so it is not a multiple of 5."},
    {key:"gcd", title:"greatest common divisor / coprime", match:["greatest common divisor", "common divisor", "coprime", "co-prime", "gcd"],
     def:"The greatest common divisor is the largest number that divides both values (gcd of 8 and 12 is 4). Coprime = their only common divisor is 1 (8 and 15)."},
    {key:"remainder", title:"remainder / modulo", match:["remainder", "remainders", "modulo", "mod 3", "mod 2", "remainder class", "remainder classes"],
     def:"What is left after dividing: 11 ÷ 3 = 3 remainder 2 (11 mod 3 = 2). Remainder classes group numbers by that leftover (0, 1 or 2 when dividing by 3)."},
    {key:"groups_of", title:"what X leaves after groups of N", re:/\b(?:leaves?|left over|remaining) after groups of (\d+)\b/i,
     def:m => `The REMAINDER when dividing by ${m[1]} (the value mod ${m[1]}): take away groups of ${m[1]} until fewer than ${m[1]} remain. 10 after groups of 3 leaves 1; 11 leaves 2; 12 leaves 0.`},
    {key:"digit_sum", title:"digit sum", match:["digit sum", "digit-sum", "sum of its digits"],
     def:"Add the digits of the number: 47 → 4 + 7 = 11 → 1 + 1 = 2 when repeated until one digit remains."},
    {key:"two_digit", title:"two-digit number from LEFT then RIGHT", match:["tens digit", "ones digit", "two-digit number"],
     def:"Read LEFT as the tens digit and RIGHT as the ones digit: LEFT 6, RIGHT 9 → 69."},
    {key:"fsm", title:"finite-state machine", match:["finite-state machine", "finite state machine", "finite automaton", "the machine"],
     def:"A tiny machine that reads the digits one at a time (LEFT digit first, then RIGHT) and switches between a few states by a fixed rule; the question asks which state it ends in. The even/odd machine tracks whether the digits read so far add up to even or odd; the division-by-3 machine tracks the remainder (÷ 3) of the number read so far."},
    {key:"fsm_parity", title:"even/odd machine", match:["even/odd machine", "even state", "odd state", "parity machine"],
     def:"Starts in EVEN. Each odd digit flips EVEN ↔ ODD; even digits leave the state alone. It finishes in the EVEN state exactly when the digits read add up to an even number (6 then 9 → 15, odd → ODD)."},
    {key:"fsm_div3", title:"division-by-3 machine", match:["division-by-3 machine", "remainder state 0", "remainder state 1", "remainder state 2", "remainder state"],
     def:"Starts at remainder 0. After each digit the state becomes (10 × state + digit) mod 3 — the remainder of the number read so far when divided by 3. Finishing in remainder state 1 means the two-digit number LEFT-RIGHT leaves remainder 1 (e.g. 6 then 4 → 64 → remainder 1)."},
    {key:"counted", title:"counted halving / step count", match:["counted halving", "step-count", "step count", "counted iteration", "inner recursive rule", "inner rule"],
     def:"Apply “if the value is even, halve it; stop when it is odd” and COUNT the halvings: 12 → 6 → 3 is 2 steps; 7 is already odd → 0 steps. The question is about the count, not the final value."},
    {key:"halving", title:"halving to odd", match:["halving", "halve it", "divide-by-2 step", "divide-by-2 steps"],
     def:"While the value is even, divide it by 2; stop at the first odd value (20 → 10 → 5)."},
    {key:"recursive", title:"recursive rule / trace", match:["recursive rule", "recursive", "trace source", "the trace", "observed trace", "trace"],
     def:"A rule applied again and again to its own result until a stop condition (the base case). The trace is the list of values it produces, starting from the trace source (LEFT, RIGHT, LEFT + RIGHT…)."},
    {key:"base_case", title:"base case", match:["base case", "base-case"],
     def:"The stop condition of a recursive rule — the value at which it no longer applies (odd for halving, 1 for Collatz, empty input for a machine)."},
    {key:"collatz", title:"Collatz rule", match:["collatz"],
     def:"If the value is even, halve it; if odd, use 3n + 1; stop at 1 (or at the stated limit). 6 → 3 → 10 → 5 → 16 → 8 → 4 → 2 → 1."},
    {key:"euclid", title:"Euclid's remainder step", match:["euclid", "euclid's remainder step", "euclidean"],
     def:"Replace (larger, smaller) by (smaller, remainder of larger ÷ smaller) until the remainder is 0; the last non-zero value is the gcd: (12, 8) → (8, 4) → (4, 0) → gcd 4."},
    {key:"branch", title:"branch (of a rule)", match:["branch", "branches", "step type"],
     def:"One of the alternatives inside a rule with cases (the halve branch vs the minus-one branch). “Uses both branches” = both cases occurred during the trace."},
    {key:"invariant", title:"invariant", match:["invariant", "invariant holds"],
     def:"A property that stays true at every step of the trace (for example “every value stayed above 5”)."},
    {key:"net_change", title:"net change / value-change", match:["net change", "value-change", "value change"],
     def:"Final value minus starting value (or the size of that difference)."},
    {key:"exactly_one", title:"exactly one", match:["exactly one", "exactly one of"],
     def:"One of the two, and not the other — not both, not neither."},
    {key:"at_least_one", title:"at least one", match:["at least one", "at least one of"],
     def:"One or both. Only “neither” makes it false."},
    {key:"at_most", title:"at most", match:["at most one", "at most"],
     def:"That many or fewer: “at most one” allows none or one, not two."},
    {key:"neither", title:"neither", match:["neither", "neither … nor", "none of"],
     def:"Not the first and not the second. “Neither previous question used X” is true only when both did without X."},
    {key:"complement", title:"complement (frame)", match:["complement", "ten-frame complement", "grid complement", "empty cells"],
     def:"What is missing up to the full frame: 10 − value for a ten-frame, 9 − value for the 3×3 grid (the empty cells)."},
    {key:"clock", title:"12-clock loop", match:["12-clock loop", "clock loop", "clock arithmetic", "clock-wise", "opposite hour"],
     def:"Hours wrap around after 12: 11 + 3 = 2, the opposite hour is 6 away (3 ↔ 9)."},
    {key:"ordinal", title:"ordinal pattern", match:["ordinal pattern", "interleaved", "one pair inside the other", "entirely lower"],
     def:"The order of the four retained values on the number line: one pair's two values inside the other pair's, the pairs interleaved, or one pair entirely below the other."},
    {key:"nested", title:"nested rule", match:["nested", "nested rule", "nested boolean", "inner condition"],
     def:"A rule inside another rule. Evaluate the inner part first, then use its result in the outer one."},
    {key:"both_true", title:"are both of these true", match:["both of these true"],
     def:"YES only when (1) and (2) both hold. The options also say which of (1)/(2) hold — decide each separately first, then pick the option naming them; its YES/NO prefix answers the question."},
    {key:"at_least_one_true", title:"is at least one of these true", match:["at least one of these true"],
     def:"YES when (1) holds, or (2) holds, or both; NO only when neither does. The option you pick also states which of (1)/(2) hold — decide each separately first."},
    {key:"exactly_one_true", title:"is exactly one of these true", match:["exactly one of these true"],
     def:"YES when exactly one of (1)/(2) holds; NO when both do or neither does. The option you pick also states which of them hold."},
    {key:"at_least_one_false", title:"is at least one of these false", match:["at least one of these false"],
     def:"YES unless (1) and (2) both hold (one failing is enough). The option you pick also states which of (1)/(2) hold."},
    {key:"both_false", title:"are both of these false", match:["both of these false"],
     def:"YES only when neither (1) nor (2) holds. The option you pick also states which of (1)/(2) hold."},
    {key:"implication", title:"implication (if … then)", match:["implication", "implies", "if … then"],
     def:"“If A then B” is false only when A holds and B fails; whenever A does not hold, it counts as true."},
    {key:"quantifier", title:"quantifier", match:["quantifier", "all of", "some of", "none of the"],
     def:"Words that say how many: all, some, none, exactly one, at least one. Decide the count first, then the claim."},
    {key:"mental_line", title:"mental number line", match:["mental line", "mental-line", "number line", "midpoint", "mirror distance", "symmetric distance", "referent", "closest to"],
     def:"Positions on a number line: the midpoint of two values is halfway between them; the mirror distance is how far a value sits on the other side of a referent (a fixed reference point)."},
    {key:"proportion", title:"proportion / share / ratio", match:["proportion", "share", "ratio", "same fraction", "fraction of its visible whole"],
     def:"A part compared with its whole: 3 filled of 9 cells is one third. Two pictures show the same fraction when part ÷ whole matches, whatever the frame size."},
    {key:"balance", title:"balance", match:["balance", "balanced", "balance rule"],
     def:"Two sides are balanced when their totals (with the stated weights) are equal; the question asks what keeps or breaks that equality."},
    {key:"inverse", title:"inverse operation", match:["inverse operation", "inverse", "undo", "undoes"],
     def:"The operation that undoes another: subtracting 3 undoes adding 3; halving undoes doubling."},
    {key:"conclusion", title:"valid conclusion", match:["valid conclusion", "the valid conclusion"],
     def:"The one statement that follows from the two retained META¹ answers (or META² questions) — test each option against them; the wrong ones flip one detail (comparison, parity, threshold, which question)."},
    {key:"readout", title:"readout", match:["readout", "read out"],
     def:"Which value is taken from a pair and how: by side (LEFT/RIGHT) or by role (larger/smaller)."},
    {key:"provenance", title:"calculation provenance", match:["calculation provenance", "how the previous answers were calculated", "provenance"],
     def:"Which KIND of rule produced each previous META¹ answer — role-based, threshold, gap, position, side transfer, conditional — rather than the answers' values."},
    {key:"public_pattern", title:"public pattern", match:["public pattern", "public patterns"],
     def:"What a previous META² question openly asked and concluded (its topic and corrected answer) — the part you were told to retain for META³."},
    {key:"abacus_rows", title:"abacus rows", match:["upper row", "lower row", "upper bead", "lower beads", "row weighting"],
     def:"On the abacus the upper bead counts 5 and each lower bead counts 1; a row rule reads only that row."},
    {key:"epistemic", title:"who can determine the claim", match:["can determine", "sufficient information", "cannot know", "agent capacity"],
     def:"Each agent knows only their own lines; ask whether those lines alone settle the claim. If they fit both a YES and a NO world, the agent cannot determine it."},
    {key:"frame_burst", title:"frame burst", match:["frame burst", "same encoded pair"],
     def:"Several questions in a row about the SAME flashed pair — keep both values until the burst ends."},
    {key:"state_chain", title:"update chain", match:["update chain", "internal update", "running value", "final left", "final right"],
     def:"Apply the stated update to LEFT or RIGHT in your head, step by step; the question is about the final (updated) value, not the one shown."},
  ];
  // compiled matcher: regex entries first (longest literal phrases first)
  let MATCHERS = null;
  function matchers(){
    if(MATCHERS) return MATCHERS;
    const lit = [];
    for(const g of GLOSSARY){
      if(g.re) continue;
      for(const m of (g.match || [])) lit.push({g, phrase:m});
    }
    lit.sort((a, b) => b.phrase.length - a.phrase.length);
    const escRe = s => s.replace(/[\s-]+/g, "\u0001").replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\u0001/g, "[\\s-]+");
    const alts = lit.map(x => escRe(x.phrase));
    const literalRe = new RegExp(`(?<![\\w-])(${alts.join("|")})(?![\\w-])`, "gi");
    const byPhrase = new Map(lit.map(x => [x.phrase.toLowerCase().replace(/[\s-]+/g, " "), x.g]));
    MATCHERS = {literalRe, byPhrase, regexEntries:GLOSSARY.filter(g => g.re)};
    return MATCHERS;
  }
  function entryForLiteral(text){
    const key = String(text).toLowerCase().replace(/[\s-]+/g, " ");
    const M = matchers();
    if(M.byPhrase.has(key)) return M.byPhrase.get(key);
    // hyphen/space variants
    for(const [k, g] of M.byPhrase.entries()){ if(k === key) return g; }
    return null;
  }
  function defText(g, match){ return typeof g.def === "function" ? g.def(match) : g.def; }
  const NEG_TERMS = new Set(["neither", "exactly_one", "at_least_one", "at_most", "both_true", "at_least_one_true", "exactly_one_true", "at_least_one_false", "both_false"]);
  // negation / scope words that are easy to overlook
  const NEG_RE = /(?<![\w-])(not|no|neither|nor|never|without|except|unless|cannot|can't|isn't|aren't|doesn't|don't|didn't|wasn't|weren't|none|non-\w+|other than|different from|exactly one|at least one|at most one|only)(?![\w-])/gi;

  // ------------------------------------------------------------------------
  // Decoration of text nodes (textContent is preserved — only spans are added)
  // ------------------------------------------------------------------------
  function decorateNode(root, opts){
    if(!root) return [];
    const found = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {acceptNode(n){
      if(!n.nodeValue || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      const p = n.parentElement;
      if(!p) return NodeFilter.FILTER_REJECT;
      if(p.closest(".md-term, .md-neg, script, style, .md-peek, .md-scope-hint, .md-term-pop, .md-term-panel")) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }});
    const nodes = []; let n;
    while((n = walker.nextNode())) nodes.push(n);
    const M = matchers();
    for(const node of nodes){
      const text = node.nodeValue;
      // collect ranges: terms first (regex entries + literals), then negations in the gaps
      const ranges = [];
      if(opts.terms){
        for(const g of M.regexEntries){
          const re = new RegExp(g.re.source, g.re.flags.includes("g") ? g.re.flags : g.re.flags + "g");
          let m; while((m = re.exec(text))){ ranges.push({s:m.index, e:m.index + m[0].length, kind:"term", g, match:m}); if(m[0].length === 0) re.lastIndex++; }
        }
        M.literalRe.lastIndex = 0;
        let m; while((m = M.literalRe.exec(text))){
          const g = entryForLiteral(m[1]); if(!g) continue;
          if(ranges.some(r => r.kind === "term" && m.index < r.e && m.index + m[0].length > r.s)) continue;
          ranges.push({s:m.index, e:m.index + m[0].length, kind:"term", g, match:m});
        }
      }
      if(opts.negations){
        NEG_RE.lastIndex = 0;
        let m; while((m = NEG_RE.exec(text))){
          if(ranges.some(r => m.index < r.e && m.index + m[0].length > r.s)) continue;
          ranges.push({s:m.index, e:m.index + m[0].length, kind:"neg"});
        }
      }
      if(!ranges.length) continue;
      ranges.sort((a, b) => a.s - b.s);
      const frag = document.createDocumentFragment();
      let pos = 0;
      for(const r of ranges){
        if(r.s < pos) continue;
        if(r.s > pos) frag.appendChild(document.createTextNode(text.slice(pos, r.s)));
        if(r.kind === "term"){
          const span = document.createElement("span");
          const d = defText(r.g, r.match);
          span.className = "md-term" + (NEG_TERMS.has(r.g.key) ? " md-neg" : ""); span.dataset.term = r.g.key; span.dataset.def = d; span.dataset.title = r.g.title; span.textContent = text.slice(r.s, r.e);
          span.setAttribute("title", `${r.g.title}: ${d}`);
          if(opts.interactive){ span.setAttribute("role", "button"); span.setAttribute("tabindex", "0"); }
          frag.appendChild(span);
          if(!found.some(f => f.key === r.g.key)) found.push({key:r.g.key, title:r.g.title, def:d});
        } else {
          const b = document.createElement("b"); b.className = "md-neg"; b.textContent = text.slice(r.s, r.e); frag.appendChild(b);
        }
        pos = r.e;
      }
      if(pos < text.length) frag.appendChild(document.createTextNode(text.slice(pos)));
      node.parentNode.replaceChild(frag, node);
    }
    return found;
  }
  function decorateQuestion(){
    if(R.audit) return;
    const S = st();
    const el = $("metaQuestion"); if(!el) return;
    const opts = {terms:!!S.terms, negations:!!S.negations, interactive:true};
    for(const sel of [".meta-q", ".meta-hint"]){ const n = el.querySelector(sel); if(n) decorateNode(n, opts); }
    const fo = el.querySelector(".meta-options"); if(fo) decorateNode(fo, {...opts, interactive:false});
    const pad = $("choicepad"); if(pad) decorateNode(pad, {...opts, interactive:false});
    R.terms = collectTerms([el, pad]);
    renderChip();
  }
  // every term currently on the surface (also those decorated on an earlier pass)
  function collectTerms(roots){
    const out = [], seen = new Set();
    for(const root of roots){
      if(!root) continue;
      root.querySelectorAll(".md-term[data-term]").forEach(t => {
        if(!t.getClientRects().length) return;   // not rendered (a hidden panel keeps its old text)
        const key = t.dataset.term; if(seen.has(key)) return; seen.add(key);
        out.push({key, title:t.dataset.title || key, def:t.dataset.def || ""});
      });
    }
    return out;
  }
  function decorateReview(){
    if(R.audit) return;
    const S = st();
    const opts = {terms:!!S.terms, negations:!!S.negations, interactive:true};
    let found = [];
    for(const id of ["reviewQuestion", "reviewReasonList"]){ const n = $(id); if(n) decorateNode(n, opts); }
    for(const id of ["reviewUserAnswer", "reviewCorrectAnswer"]){ const n = $(id); if(n) decorateNode(n, {...opts, negations:false}); }
    R.reviewTerms = collectTerms([$("reviewPanel") || $("reviewQuestion")]);
  }

  // ---- popover (one at a time) ----
  function ensurePop(){
    if(R.pop) return R.pop;
    const pop = document.createElement("div");
    pop.id = "mdTermPop"; pop.className = "md-term-pop"; pop.setAttribute("role", "dialog"); pop.setAttribute("aria-live", "polite");
    pop.innerHTML = `<div class="md-term-pop-title"></div><div class="md-term-pop-def"></div><button type="button" class="md-term-pop-close" aria-label="Close">×</button>`;
    pop.querySelector(".md-term-pop-close").addEventListener("click", ev => { ev.preventDefault(); ev.stopPropagation(); hidePop(); });
    pop.addEventListener("click", ev => ev.stopPropagation());
    document.body.appendChild(pop);
    R.pop = pop;
    return pop;
  }
  function showPop(anchor, key){
    const g = GLOSSARY.find(x => x.key === key); if(!g) return;
    const pop = ensurePop();
    const def = (anchor && anchor.dataset && anchor.dataset.def) || defText(g, ["", "N"]);
    pop.querySelector(".md-term-pop-title").textContent = g.title;
    pop.querySelector(".md-term-pop-def").textContent = def;
    pop.classList.add("visible");
    const r = anchor.getBoundingClientRect();
    const w = Math.min(360, window.innerWidth - 24);
    pop.style.width = w + "px";
    let left = Math.round(r.left + r.width / 2 - w / 2); left = Math.max(12, Math.min(window.innerWidth - w - 12, left));
    pop.style.left = left + "px";
    const h = pop.offsetHeight || 90;
    let top = r.bottom + 8; if(top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 8);
    pop.style.top = Math.round(top) + "px";
    try { st().seen[key] = num(st().seen[key], 0) + 1; save(); } catch(_){}
  }
  function hidePop(){ if(R.pop) R.pop.classList.remove("visible"); }
  document.addEventListener("click", ev => {
    const t = ev.target && ev.target.closest ? ev.target.closest(".md-term[role='button']") : null;
    if(t){ ev.preventDefault(); ev.stopPropagation(); showPop(t, t.dataset.term); return; }
    if(R.pop && R.pop.classList.contains("visible") && !(ev.target.closest && ev.target.closest("#mdTermPop"))) hidePop();
    if(R.panel && R.panel.classList.contains("visible") && !(ev.target.closest && (ev.target.closest("#mdTermPanel") || ev.target.closest("#mdTermsChip")))) hidePanel();
  }, true);
  document.addEventListener("keydown", ev => {
    if(ev.key === "Escape"){ if(R.pop && R.pop.classList.contains("visible")){ hidePop(); ev.stopPropagation(); } if(R.panel && R.panel.classList.contains("visible")){ hidePanel(); ev.stopPropagation(); } return; }
    if((ev.key === "Enter" || ev.key === " ") && ev.target && ev.target.classList && ev.target.classList.contains("md-term")){ ev.preventDefault(); ev.stopPropagation(); showPop(ev.target, ev.target.dataset.term); }
  }, true);

  // ---- 📖 chip + panel (all terms of the current question) ----
  function ensureChip(){
    let chip = $("mdTermsChip");
    if(chip) return chip;
    const bot = document.querySelector("#hud .hud-bot"); if(!bot) return null;
    chip = document.createElement("button");
    chip.id = "mdTermsChip"; chip.type = "button"; chip.setAttribute("aria-label", "Explain the terms in this question");
    chip.addEventListener("click", ev => { ev.preventDefault(); ev.stopPropagation(); togglePanel(); });
    bot.appendChild(chip);
    return chip;
  }
  function renderChip(){
    const chip = ensureChip(); if(!chip) return;
    const n = R.terms.length;
    chip.textContent = n ? `📖 ${n} term${n === 1 ? "" : "s"}` : "📖";
    chip.classList.toggle("visible", n > 0 && !!st().terms);
    if(R.panel && R.panel.classList.contains("visible")) renderPanel();
  }
  function ensurePanel(){
    if(R.panel) return R.panel;
    const g = $("game-container"); if(!g) return null;
    const panel = document.createElement("div");
    panel.id = "mdTermPanel"; panel.className = "md-term-panel"; panel.setAttribute("role", "dialog"); panel.setAttribute("aria-label", "Terms in this question");
    panel.innerHTML = `<div class="md-term-panel-head"><span>📖 Terms in this question</span><button type="button" class="md-term-panel-close" aria-label="Close">×</button></div><div class="md-term-panel-body"></div><div class="md-term-panel-foot">Tap an underlined word in the question for the same note · full list in Learn → Vocabulary</div>`;
    panel.querySelector(".md-term-panel-close").addEventListener("click", ev => { ev.preventDefault(); ev.stopPropagation(); hidePanel(); });
    panel.addEventListener("click", ev => ev.stopPropagation());
    g.appendChild(panel);
    R.panel = panel;
    return panel;
  }
  function renderPanel(){
    const panel = ensurePanel(); if(!panel) return;
    const body = panel.querySelector(".md-term-panel-body");
    body.innerHTML = R.terms.length ? R.terms.map(t => `<div class="md-term-row"><b>${esc(t.title)}</b><span>${esc(t.def)}</span></div>`).join("") : `<div class="md-term-row"><span>No special terms in this question.</span></div>`;
  }
  function togglePanel(){ const p = ensurePanel(); if(!p) return; if(p.classList.contains("visible")) hidePanel(); else { renderPanel(); p.classList.add("visible"); hidePop(); } }
  function hidePanel(){ if(R.panel) R.panel.classList.remove("visible"); }

  // ------------------------------------------------------------------------
  // 3. Recursive-trace cards: say the actual inner rule
  // ------------------------------------------------------------------------
  function preciseRule(info){
    const rt = info && info.recursiveTrace; const id = rt && rt.opId; const cat = String(info && info.catId || "");
    if(id === "counted_iteration") return "count the steps of this inner rule: if the value is even, halve it; stop when it is odd — the step count is the number of halvings (12 → 6 → 3 is 2 steps; an odd start is 0 steps)";
    if(id === "finite_automaton"){
      if(/div3/.test(cat)) return "the division-by-3 machine: start at remainder 0; after each digit (LEFT first, then RIGHT) the state becomes (10 × state + digit) mod 3, i.e. the remainder of the number read so far when divided by 3";
      return "the even/odd machine: start in EVEN; every odd digit (LEFT first, then RIGHT) flips EVEN ↔ ODD, even digits change nothing — it ends in EVEN when the digits add up to an even number";
    }
    return null;
  }
  wrap("renderStructuredQuestionHTML", previous => function renderStructuredQuestionHTMLMR(qText, info){
    const out = previous.apply(this, arguments);
    try {
      if(R.audit || !out || typeof out !== "string") return out;
      const rule = preciseRule(info);
      if(!rule) return out;
      return out
        .replace("• run the inner recursive rule while tracking the step count", "• " + esc(rule))
        .replace("• read each digit through the finite-state machine", "• " + esc(rule));
    } catch(_){ return out; }
  });

  // ------------------------------------------------------------------------
  // 4. Rotation card: the viewpoint line belongs to the instruction → white
  // ------------------------------------------------------------------------
  function restyleViewpoint(){
    try {
      const g = $("game-container"); if(!g) return;
      g.querySelectorAll("svg text").forEach(t => {
        const s = (t.textContent || "").trim();
        if(/^FROM (YOUR PERSPECTIVE|BEHIND THE FIGURE)$/.test(s) && t.getAttribute("fill") !== "#f3f0ff"){
          t.setAttribute("fill", "#f3f0ff"); t.setAttribute("font-weight", "900");
          const fs = parseFloat(t.getAttribute("font-size") || "12"); if(fs < 13) t.setAttribute("font-size", "13");
        }
      });
    } catch(_){}
  }

  // ------------------------------------------------------------------------
  // 5. Build-a-pair prompts with an implicit domain
  // ------------------------------------------------------------------------
  const DOMAINS = {
    sum_divisible_by_smaller:{valid:(a, b) => Math.min(a, b) > 1, msg:"Use values where the smaller one is greater than 1 — every whole number divides by 1, so a 1 would make the question trivial."},
    larger_multiple_of_gap:{valid:(a, b) => Math.abs(a - b) > 1, msg:"Use values that differ by at least 2 — every number is a multiple of 1, so a difference of 1 would make the question trivial."}
  };
  function installDomains(){
    try {
      if(typeof POSNER_CATS === "undefined" || !Array.isArray(POSNER_CATS)) return;
      for(const [id, d] of Object.entries(DOMAINS)){
        const cat = (typeof dPosnerCatById === "function" ? dPosnerCatById(id) : null) || POSNER_CATS.find(c => c && c.id === id);
        if(!cat || cat.__mdDomain) continue;
        if(Object.isFrozen(cat)) continue;
        if(typeof cat.valid !== "function"){ cat.valid = (a, b) => d.valid(Number(a), Number(b)); cat.__mdDomain = d.msg; }
      }
    } catch(_){}
  }
  function fixInvalidPairMessage(){
    try {
      if(!hasState() || !State.trialInfo) return;
      const info = State.trialInfo, inv = info.constructiveInvalidPair;
      if(!inv || !inv.message) return;
      const cat = typeof dPosnerCatById === "function" ? dPosnerCatById(info.sourceCatId || info.catId) : null;
      const msg = cat && cat.__mdDomain;
      if(!msg) return;
      if(!DOMAINS[cat.id].valid(Number(inv.a), Number(inv.b)) && /not valid for this construction prompt/.test(inv.message)){
        const hintEl = document.querySelector("#metaQuestion .meta-hint");
        if(hintEl && /not valid for this construction prompt/.test(hintEl.textContent || "")){ hintEl.textContent = msg; hintEl.style.display = ""; }
      }
    } catch(_){}
  }

  // ------------------------------------------------------------------------
  // 6. Seal shine on the block summary
  // ------------------------------------------------------------------------
  function playSeal(){
    try {
      if(!st().seal) return;
      const card = $("summaryCard"), title = $("summaryTitle"); if(!card || !title) return;
      // Alberto's summary hero already carries the crest logo (#summaryCrest); the shine is
      // played on it. A fallback crest is only built when that hero is absent.
      const crest = $("summaryCrest");
      if(!crest) return;
      if(!crest.querySelector(".md-seal-ring")){ const ring = document.createElement("span"); ring.className = "md-seal-ring"; crest.appendChild(ring); }
      if(!crest.querySelector(".md-seal-shine")){ const sh = document.createElement("span"); sh.className = "md-seal-shine"; crest.appendChild(sh); }
      crest.classList.add("md-seal");
      const line = $("mdSummaryLine");
      const milestone = !!(line && /milestone/i.test(line.textContent || ""));
      crest.classList.remove("play", "gold"); void crest.offsetWidth;
      if(milestone) crest.classList.add("gold");
      crest.classList.add("play");
      clearTimeout(R._sealTimer); R._sealTimer = setTimeout(() => crest.classList.remove("play"), 2600);
    } catch(_){}
  }
  wrap("showBlockSummary", previous => function showBlockSummaryMR(){
    const out = previous.apply(this, arguments);
    setTimeout(playSeal, 0);
    return out;
  });

  // ------------------------------------------------------------------------
  // 7. Bigger, clearer diagrams — .da.rk.: "imo these web graphs should be bigger,
  //    so u can see the arrows more clearly". Same data, same drawing rules as
  //    Alberto's graphRenderSingleSVG; the box is filled better (wider panels, a
  //    wider card), edges are thicker and the arrowheads larger. Rendering only —
  //    the graphs, the question and the answer are untouched. Audits get the base.
  // ------------------------------------------------------------------------
  function visualsOn(){ return !!st().visuals && !R.audit; }
  const GRAPH_STROKE = "#e2e4ff";
  function graphArrowDef(){
    return `<defs><marker id="mdGraphArrow" viewBox="0 0 10 10" refX="8.6" refY="5" markerWidth="7.5" markerHeight="7.5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${GRAPH_STROKE}"/></marker></defs>`;
  }
  function drawGraph(g, ox, oy, w, h, marks){
    if(!g || !Number.isInteger(g.n) || g.n <= 0) return "";
    const layout = (g.layout && g.layout.length === g.n) ? g.layout : (typeof graphLayoutForTemplate === "function" ? graphLayoutForTemplate(g.id, 0) : null);
    if(!layout || layout.length !== g.n) return "";
    const r = Math.max(8, Math.min(13, 17 - g.n));
    const pts = layout.map(p => ({x:ox + num(p.x, 0.5) * w, y:oy + num(p.y, 0.5) * h}));
    const edges = typeof graphNormalizeEdges === "function" ? graphNormalizeEdges(g.edges, g.n) : (Array.isArray(g.edges) ? g.edges : []);
    const squareMark = Number.isInteger(marks && marks.square) ? marks.square : null;
    const ringMark = Number.isInteger(marks && marks.ring) ? marks.ring : null;
    let svg = "<g>";
    for(const e of edges){
      const a = e[0], b = e[1], A = pts[a], B = pts[b];
      if(!A || !B) continue;
      const dx = B.x - A.x, dy = B.y - A.y, len = Math.max(1, Math.hypot(dx, dy));
      const sx = A.x + (dx / len) * (r + 1.5), sy = A.y + (dy / len) * (r + 1.5);
      const ex = B.x - (dx / len) * (r + 4.5), ey = B.y - (dy / len) * (r + 4.5);
      const mx = (sx + ex) / 2, my = (sy + ey) / 2, bend = 0.06 * w, nx = -dy / len, ny = dx / len;
      const hasReverse = edges.some(f => f[0] === b && f[1] === a);
      const cpx = mx + nx * (hasReverse ? bend : bend * 0.28), cpy = my + ny * (hasReverse ? bend : bend * 0.28);
      svg += `<path d="M ${sx.toFixed(1)} ${sy.toFixed(1)} Q ${cpx.toFixed(1)} ${cpy.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}" fill="none" stroke="${GRAPH_STROKE}" stroke-opacity="0.92" stroke-width="2.6" stroke-linecap="round" marker-end="url(#mdGraphArrow)"/>`;
    }
    for(let i = 0; i < g.n; i++){
      const P = pts[i]; if(!P) continue;
      const cx = P.x.toFixed(1), cy = P.y.toFixed(1);
      if(i === squareMark){
        const side = r * 2.15;
        svg += `<rect x="${(P.x - side / 2).toFixed(1)}" y="${(P.y - side / 2).toFixed(1)}" width="${side.toFixed(1)}" height="${side.toFixed(1)}" rx="3.4" fill="#17121a" stroke="#ff9f43" stroke-width="3"/>`;
        svg += `<rect x="${(P.x - r * 0.45).toFixed(1)}" y="${(P.y - r * 0.45).toFixed(1)}" width="${(r * 0.9).toFixed(1)}" height="${(r * 0.9).toFixed(1)}" rx="2" fill="#ff7f50" fill-opacity="0.85"/>`;
      } else if(i === ringMark){
        svg += `<circle cx="${cx}" cy="${cy}" r="${(r + 4.6).toFixed(1)}" fill="none" stroke="#ff9f43" stroke-width="2.3"/>`;
        svg += `<circle cx="${cx}" cy="${cy}" r="${(r + 0.9).toFixed(1)}" fill="#101018" stroke="#ffcf8a" stroke-width="2.3"/>`;
        svg += `<circle cx="${cx}" cy="${cy}" r="${Math.max(2.8, r * 0.36).toFixed(1)}" fill="#6c5ce7" fill-opacity="0.85"/>`;
      } else {
        svg += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#101018" stroke="#a093ff" stroke-width="2.4"/>`;
        svg += `<circle cx="${cx}" cy="${cy}" r="${Math.max(2.8, r * 0.36).toFixed(1)}" fill="#6c5ce7" fill-opacity="0.85"/>`;
      }
    }
    return svg + "</g>";
  }
  function graphPanel(x, y, w, h){ return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="16" fill="rgba(255,255,255,0.022)" stroke="rgba(255,255,255,0.09)"/>`; }
  function graphLabel(x, y, text){ return `<text x="${x}" y="${y}" font-size="12" font-weight="700" letter-spacing="1" fill="#a39fc4" text-anchor="middle">${esc(text)}</text>`; }
  function renderGraphPairBig(L, Rg, labels, legend, aria){
    const W = 480, H = legend ? 202 : 190, panelW = 226, panelH = legend ? 150 : 156, leftX = 8, rightX = 246, topY = 26;
    let svg = `<svg class="graph-svg md-graph-big" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg" style="display:block;width:min(100%,680px);height:auto;" aria-label="${esc(aria)}">`;
    svg += graphArrowDef();
    svg += graphLabel(leftX + panelW / 2, 15, labels[0]) + graphLabel(rightX + panelW / 2, 15, labels[1]);
    svg += graphPanel(leftX, topY, panelW, panelH) + graphPanel(rightX, topY, panelW, panelH);
    svg += drawGraph(L, leftX + 14, topY + 12, panelW - 28, panelH - 24, (L && L.marks) || null);
    svg += drawGraph(Rg, rightX + 14, topY + 12, panelW - 28, panelH - 24, (Rg && Rg.marks) || null);
    svg += `<line x1="240" y1="${topY + 4}" x2="240" y2="${topY + panelH - 4}" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>`;
    if(legend) svg += `<text x="${W / 2}" y="${H - 6}" font-size="12" fill="#c9c3ff" text-anchor="middle" font-weight="700">${esc(legend)}</text>`;
    return svg + "</svg>";
  }
  wrap("graphConditionalRenderPairSVG", previous => function graphConditionalRenderPairSVGMR(graphLeft, graphRight){
    if(!visualsOn()) return previous.apply(this, arguments);
    try {
      if(!graphLeft || !graphRight || !Number.isInteger(graphLeft.n) || !Number.isInteger(graphRight.n)) return previous.apply(this, arguments);
      const roles = !!((graphLeft && (graphLeft.marks || graphLeft.roleMatchGate)) || (graphRight && (graphRight.marks || graphRight.roleMatchGate)));
      const out = roles
        ? renderGraphPairBig(graphLeft, graphRight, ["LEFT ROLES", "RIGHT CLAIM"], "□ square role · ◎ ring role", "two directed graphs with marked node correspondences")
        : renderGraphPairBig(graphLeft, graphRight, ["LEFT GRAPH", "RIGHT GRAPH"], "", "two directed graphs");
      return out && out.indexOf("<path") >= 0 ? out : previous.apply(this, arguments);
    } catch(_){ return previous.apply(this, arguments); }
  });
  wrap("graphRelationGateRenderSVG", previous => function graphRelationGateRenderSVGMR(graph, markA, markB){
    if(!visualsOn()) return previous.apply(this, arguments);
    try {
      if(!graph || !Number.isInteger(graph.n)) return previous.apply(this, arguments);
      const W = 480, H = 190, panelW = 300, panelH = 148, x = (W - panelW) / 2, y = 24;
      let svg = `<svg class="graph-svg md-graph-big" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg" style="display:block;width:min(100%,680px);height:auto;" aria-label="single directed graph with a square node and a ringed node">`;
      svg += graphArrowDef();
      svg += graphLabel(W / 2, 15, "GRAPH RULE SELECTOR");
      svg += graphPanel(x, y, panelW, panelH);
      svg += drawGraph(graph, x + 16, y + 12, panelW - 32, panelH - 24, {square:markA, ring:markB});
      svg += `<text x="${W / 2}" y="${H - 6}" font-size="12" fill="#c9c3ff" text-anchor="middle" font-weight="700">□ first node · ◎ second node</text></svg>`;
      return svg.indexOf("<path") >= 0 || !Array.isArray(graph.edges) || !graph.edges.length ? svg : previous.apply(this, arguments);
    } catch(_){ return previous.apply(this, arguments); }
  });
  function markGraphCard(){
    try {
      const el = $("metaQuestion"); if(!el) return;
      const svg = el.querySelector(".meta-stimulus svg.md-graph-big");
      el.classList.toggle("md-graph-wide", !!svg);
      if(!svg){ el.classList.remove("md-compact-q"); return; }
      // the card scrolls when stimulus + question do not fit (the base clips the same way on
      // low screens); first tighten the question's type, then give the graph back some height
      svg.style.maxHeight = ""; el.classList.remove("md-compact-q");
      const over = () => el.scrollHeight - el.clientHeight;
      if(over() <= 1) return;
      el.classList.add("md-compact-q");
      const o = over(); if(o <= 1) return;
      const h = svg.getBoundingClientRect().height;
      svg.style.maxHeight = Math.max(150, Math.floor(h - o - 2)) + "px";
    } catch(_){}
  }
  let fitTimer = 0;
  try { window.addEventListener("resize", () => { clearTimeout(fitTimer); fitTimer = setTimeout(() => { if(!R.audit) markGraphCard(); }, 150); }, {passive:true}); } catch(_){}

  // ---- paper folding: one row of four larger sheets (same hole geometry) ----
  function holeSheet(points, x, y, size){
    let out = `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="8" fill="#f4f0e8" stroke="#8177b8" stroke-width="3"/>`;
    for(const p of (points || [])){
      const px = x + num(p.x, 0) * size, py = y + (1 - num(p.y, 0)) * size;
      out += `<circle cx="${px.toFixed(2)}" cy="${py.toFixed(2)}" r="${Math.max(4.6, size * 0.052).toFixed(2)}" fill="#050508" stroke="#5f55a9" stroke-width="1.5"/>`;
    }
    return out;
  }
  function paperCandidatesBig(item){
    const W = 560, H = 176, cardW = 130, cardH = 142, gap = 10, x0 = (W - (4 * cardW + 3 * gap)) / 2, y0 = 28, sheet = 100;
    let svg = `<svg class="visual-predict-svg visual-predict-paper md-paper-big" data-variant="paper_full_unfold" data-candidates="4" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Four complete unfolded paper states">`;
    svg += `<text x="${W / 2}" y="17" text-anchor="middle" font-size="13" font-weight="900" letter-spacing="2" fill="#5aaeff">UNFOLDED PATTERNS</text>`;
    item.candidates.forEach((c, i) => {
      const x = x0 + i * (cardW + gap), y = y0;
      svg += `<rect x="${x}" y="${y}" width="${cardW}" height="${cardH}" rx="14" fill="#090911" stroke="#342d59" stroke-width="2"/>`;
      svg += `<rect x="${x + 7}" y="${y + 7}" width="26" height="22" rx="7" fill="#211a43" stroke="#8d7cff"/><text x="${x + 20}" y="${y + 23}" text-anchor="middle" font-size="15" font-weight="900" fill="#a99cff">${i + 1}</text>`;
      svg += holeSheet(c.state, x + (cardW - sheet) / 2, y + 34, sheet);
    });
    return svg + "</svg>";
  }
  function renderPaperQuestionBig(item){
    let sequence = "";
    try { if(typeof paperFoldingRenderSequence === "function") sequence = paperFoldingRenderSequence(item.operations) || ""; } catch(_){ sequence = ""; }
    return `<div class="visual-predict-stack md-paper-stack" data-variant="paper_full_unfold"><div class="visual-predict-sequence">${sequence}</div>${paperCandidatesBig(item)}</div>`;
  }
  wrap("metaStimulusSVGForTrialInfo", previous => function metaStimulusSVGForTrialInfoMR(info){
    try {
      const item = info && info.visualPredict;
      if(visualsOn() && item && item.variant === "paper_full_unfold" && Array.isArray(item.candidates) && item.candidates.length === 4 && item.candidates.every(c => Array.isArray(c.state))) return renderPaperQuestionBig(item);
    } catch(_){}
    return previous.apply(this, arguments);
  });
  // the fold sequence's punch marks are tiny circles — make them a little bolder
  function boldenPunches(){
    try {
      if(!visualsOn()) return;
      document.querySelectorAll("#metaQuestion .visual-predict-sequence svg circle").forEach(c => {
        if(c.getAttribute("r") === "2.4"){ c.setAttribute("r", "3"); c.setAttribute("stroke-width", "1.8"); }
      });
      document.querySelectorAll("#metaQuestion .visual-predict-sequence svg path[stroke='#534AB7']").forEach(p => p.setAttribute("stroke-width", "1.8"));
    } catch(_){}
  }

  // ------------------------------------------------------------------------
  // 8. Paper folding: no two candidate patterns may look the same.
  //    buildPaper() makes the distractors from the eight symmetry images of the
  //    correct hole set and drops only EXACT duplicates (same 5-decimal key), so a
  //    hole set that is symmetric up to rounding keeps two visually identical
  //    cards — .da.rk.: "any1 seeing a difference between 3 and 4? xD" (the
  //    correction then showed two sheets differing by a hair). Measured on the
  //    base generator: 20–27 % of items have such a pair by Alberto's own G083
  //    distinctness rule (Hausdorff ≥ 0.14 and at least two holes moved); in 13 %
  //    two cards are identical to within 0.0005. The item is rebuilt from another
  //    seed (same plan first) before it is shown; the trial object is kept.
  // ------------------------------------------------------------------------
  const PAPER_MIN_SEP = 0.14;
  function paperSeparation(a, b){
    const nd = (p, pts) => Math.min(...pts.map(q => Math.hypot(num(p.x) - num(q.x), num(p.y) - num(q.y))));
    const da = a.map(p => nd(p, b)), db = b.map(p => nd(p, a));
    return {h:Math.max(...da, ...db), changed:da.filter(v => v >= PAPER_MIN_SEP - 0.001).length + db.filter(v => v >= PAPER_MIN_SEP - 0.001).length};
  }
  function paperDistinct(a, b){
    if(!Array.isArray(a) || !Array.isArray(b) || !a.length || !b.length) return true;
    const m = paperSeparation(a, b);
    return m.h >= PAPER_MIN_SEP && m.changed >= 2;
  }
  function paperItemClean(item){
    const c = item && item.candidates;
    if(!Array.isArray(c) || c.length !== 4) return true;
    for(let i = 0; i < 4; i++) for(let j = i + 1; j < 4; j++) if(!paperDistinct(c[i].state, c[j].state)) return false;
    return true;
  }
  function repairPaperTrial(){
    if(!hasState() || R.audit) return false;
    const info = State.trialInfo, item = info && info.visualPredict;
    if(!info || info.kind !== "visual_predict_complete_state" || !item || item.variant !== "paper_full_unfold") return false;
    R.paperChecked = (R.paperChecked || 0) + 1;
    if(paperItemClean(item)) return false;
    const api = globalThis.EUCALCULIA_G08_VISUAL_PREDICT;
    if(!api || typeof api.build !== "function" || typeof api.geometryValid !== "function" || typeof api.verify !== "function") return false;
    const base = num(item.seed, 1) >>> 0;
    for(let t = 1; t <= 16; t++){
      const seed = (((base % 2147483647) * 7919) + t * 104729) % 4294967296;
      let it = null;
      try {
        const coord = globalThis.EUCALCULIA_SPATIAL_AUTO_COORDINATOR;
        const level = num(coord && typeof coord.contentLevelFor === "function" ? coord.contentLevelFor("visual_predict_complete_state") : 5, 5);
        it = api.build(t <= 8 ? {variant:"paper_full_unfold", seed, level, planId:item.planId} : {variant:"paper_full_unfold", seed, level});
      } catch(_){ it = null; }
      if(!it || it.variant !== "paper_full_unfold" || !api.geometryValid(it) || !api.verify(it, it.correctIndex) || !paperItemClean(it)) continue;
      info.visualPredict = it;
      info.options = it.options;
      info.answer = info.correctIndex = info.semanticCorrectIndex = info.targetOutcome = it.correctIndex;
      info.__mdPaperRepaired = {fromSeed:item.seed, toSeed:seed, tries:t, planKept:t <= 8};
      try { if(it.replaySpec && typeof it.replaySpec === "object") it.replaySpec.mdRepair = {fromSeed:item.seed, planId:t <= 8 ? item.planId : null}; } catch(_){}
      State.targetValue = it.correctIndex;
      try {
        const mon = State.productionMonitor && State.productionMonitor.g08VisualPredict;
        const last = mon && Array.isArray(mon.recent) ? mon.recent[mon.recent.length - 1] : null;
        if(last && last.sourceKey === item.sourceKey){ last.sourceKey = it.sourceKey; last.correctIndex = it.correctIndex; last.mdRepaired = true; }
      } catch(_){}
      R.paperRepairs = (R.paperRepairs || 0) + 1;
      R.paperLog = (R.paperLog || []).concat([{trial:num(State.stats && State.stats.trials, 0), fromSeed:item.seed, toSeed:seed, tries:t, planId:it.planId, at:Date.now()}]).slice(-12);
      try { if(typeof setChoiceOptions === "function") setChoiceOptions(it.options); } catch(_){}
      try { if(typeof showMetaQuestion === "function") showMetaQuestion(0, info.question || "Which pattern appears when the paper is fully unfolded?", "", null); } catch(_){}
      return true;
    }
    R.paperRepairFailures = (R.paperRepairFailures || 0) + 1;
    return false;
  }
  // Hooked on beginInputPhase(), the last call of the G08 start routine: the spatial
  // families are started by the coordinator directly (not through the start-hook chain),
  // so a wrapper on maybeStartInlineGenerativeTrialAfterReset would never see them.
  wrap("beginInputPhase", previous => function beginInputPhaseMR(){
    const out = previous.apply(this, arguments);
    try { if(hasState() && State.trialInfo && State.trialInfo.kind === "visual_predict_complete_state" && !State.trialInfo.__mdPaperChecked){ State.trialInfo.__mdPaperChecked = true; repairPaperTrial(); } } catch(_){}
    return out;
  });

  // ------------------------------------------------------------------------
  // 9. Build-a-pair correction: show a pair that works (and why, when the
  //    question is a two-property one). .da.rk. could not find a pair with
  //    "different square-number status and different multiple-of-3 status"
  //    (tried 9/4 and 10/5); the card only said "build a pair that makes the
  //    claim YES". Same search space as the task (1..cap, the category's own
  //    verify / valid / distinctness); the example closest to the player's
  //    own pair is preferred.
  // ------------------------------------------------------------------------
  const PROP_WORDS = {even:"even", prime:"prime", square:"a square number", multiple3:"a multiple of 3"};
  function pairWitness(info){
    try {
      if(!info || info.kind !== "generative_inline") return null;
      const id = info.sourceCatId || (info.generativeInline && info.generativeInline.sourceCatId);
      const cat = (typeof dPosnerCatById === "function" ? dPosnerCatById(id) : null) || (typeof POSNER_CATS !== "undefined" && Array.isArray(POSNER_CATS) ? POSNER_CATS.find(c => c && c.id === id) : null);
      if(!cat || typeof cat.verify !== "function") return null;
      const cap = Math.max(2, Math.min(12, Math.floor(num(info.cap, 8)) || 8));
      const m = Math.max(2, num(info.m, cap) || cap);
      const target = !!(typeof info.constructiveTargetTruth === "boolean" ? info.constructiveTargetTruth : info.targetTruth);
      const distinct = !!info.requiresDistinctPair;
      const ok = (a, b) => { try { if(distinct && a === b) return false; if(typeof cat.valid === "function" && !cat.valid(a, b, m)) return false; return !!cat.verify(a, b, m) === target; } catch(_){ return false; } };
      const found = [];
      for(let a = 1; a <= cap; a++) for(let b = 1; b <= cap; b++) if(ok(a, b)) found.push({a, b});
      if(!found.length) return null;
      const user = info.userPair || (Array.isArray(info.pairs) && info.pairs.length ? info.pairs[info.pairs.length - 1].pair : null);
      let best = found[0];
      if(user && Number.isFinite(Number(user.a)) && Number.isFinite(Number(user.b))){
        const ua = Number(user.a), ub = Number(user.b);
        const dist = p => Math.abs(p.a - ua) + Math.abs(p.b - ub);
        const near = found.filter(p => p.a === ua || p.b === ub);
        best = (near.length ? near : found).slice().sort((p, q) => dist(p) - dist(q))[0];
      }
      let why = "";
      const tp = /^two_property_([a-z0-9]+)_([a-z0-9]+)_([SD])([SD])$/.exec(String(cat.id || ""));
      if(tp && typeof twoPropertyValueHas === "function"){
        const kA = tp[1], kB = tp[2];
        const wA = PROP_WORDS[kA] || kA, wB = PROP_WORDS[kB] || kB;
        const has = (k, n) => { try { return !!twoPropertyValueHas(k, n, m); } catch(_){ return false; } };
        const line = (name, n) => `${name} ${n} — ${wA}: ${has(kA, n) ? "yes" : "no"}, ${wB}: ${has(kB, n) ? "yes" : "no"}`;
        const sameA = has(kA, best.a) === has(kA, best.b), sameB = has(kB, best.a) === has(kB, best.b);
        why = `${line("LEFT", best.a)} · ${line("RIGHT", best.b)} → ${sameA ? "the same" : "different"} on “${wA}”, ${sameB ? "the same" : "different"} on “${wB}”.`;
      }
      return {pair:best, count:found.length, cap, target, why};
    } catch(_){ return null; }
  }
  wrap("h35ReviewBuildModel", previous => function h35ReviewBuildModelMR(info){
    const model = previous.apply(this, arguments);
    try {
      if(R.audit || !model || typeof model !== "object") return model;
      const i = info || (hasState() ? State.trialInfo : null);
      if(!i || i.kind !== "generative_inline" || i.constructiveVerdict === "matched_target") return model;
      const w = pairWitness(i);
      if(!w) return model;
      const label = `LEFT ${w.pair.a}, RIGHT ${w.pair.b}`;
      const verdict = w.target ? "YES" : "NO";
      model.correctAnswer = `A pair that makes the claim ${verdict} — for example ${label}`;
      if(Array.isArray(model.reasons)){
        model.reasons.push(w.why ? `Why ${label} works: ${w.why}` : `${label} makes the claim ${verdict} (one of ${w.count} such pairs with values 1 to ${w.cap}).`);
      }
    } catch(_){}
    return model;
  });

  // ------------------------------------------------------------------------
  // 10. Nested yes/no questions: say what the answer consists of.
  //     .da.rk.: "'is at least one of these true' … options: only 1 true / both
  //     true / both wrong / only 2 true … it should just be a true or false
  //     answer, not a concretisation". The options cannot change here (every
  //     option carries the YES/NO verdict for its pattern), but the line under
  //     the question now says so, and what the stem's connective means.
  // ------------------------------------------------------------------------
  const NESTED_ROOTS = [
    [/^\s*are both of these true/i, "YES only when (1) and (2) both hold"],
    [/^\s*is at least one of these true/i, "YES when (1) or (2) holds — or both; NO only when neither does"],
    [/^\s*is exactly one of these true/i, "YES when exactly one of (1)/(2) holds; NO when both or neither"],
    [/^\s*is at least one of these false/i, "YES unless (1) and (2) both hold"],
    [/^\s*are both of these false/i, "YES only when neither (1) nor (2) holds"]
  ];
  function nestedHint(){
    try {
      const el = $("metaQuestion"); if(!el || !hasState()) return;
      const info = State.trialInfo || {};
      let line = el.querySelector(".md-nested-hint");
      const nb = info.nestedBoolean || (info.payload && info.payload.nestedBoolean);
      if(!nb || info.kind !== "meta1" || !st().terms || R.audit){ if(line) line.remove(); return; }
      const q = String(info.question || (el.querySelector(".meta-q") || {}).textContent || "");
      const root = NESTED_ROOTS.find(r => r[0].test(q));
      if(!line){
        line = document.createElement("div"); line.className = "md-nested-hint";
        const anchor = el.querySelector(".md-scope-hint") || el.querySelector(".meta-hint") || el.querySelector(".meta-q");
        if(anchor && anchor.parentNode) anchor.parentNode.insertBefore(line, anchor.nextSibling); else el.appendChild(line);
      }
      line.innerHTML = `<b>Two-part answer:</b> decide <b>(1)</b> and <b>(2)</b> separately, then pick the option that names which of them hold — its YES/NO prefix is the verdict${root ? ` (${esc(root[1])})` : ""}.`;
    } catch(_){}
  }

  // ------------------------------------------------------------------------
  // Hooks
  // ------------------------------------------------------------------------
  wrap("showMetaQuestion", previous => function showMetaQuestionMR(){
    const out = previous.apply(this, arguments);
    try { if(!R.audit){ decorateQuestion(); restyleViewpoint(); fixInvalidPairMessage(); nestedHint(); markGraphCard(); boldenPunches(); } } catch(_){}
    return out;
  });
  wrap("showSingleStimulusQuestion", previous => function showSingleStimulusQuestionMR(){
    const out = previous.apply(this, arguments);
    try { decorateQuestion(); } catch(_){}
    return out;
  });
  wrap("setChoiceOptions", previous => function setChoiceOptionsMR(){
    const out = previous.apply(this, arguments);
    try { if(hasState() && State.status === "INPUT") decorateQuestion(); } catch(_){}
    return out;
  });
  wrap("h35ReviewRenderModel", previous => function h35ReviewRenderModelMR(){
    const out = previous.apply(this, arguments);
    try { decorateReview(); } catch(_){}
    return out;
  });
  wrap("setStatus", previous => function setStatusMR(status){
    const out = previous.apply(this, arguments);
    try {
      if(R.audit) return out;
      if(status === "INPUT"){ decorateQuestion(); restyleViewpoint(); nestedHint(); markGraphCard(); boldenPunches(); setTimeout(() => { if(!R.audit){ restyleViewpoint(); markGraphCard(); boldenPunches(); } }, 120); }
      else { hidePop(); if(status !== "REVIEW") hidePanel(); if(status !== "REVIEW" && status !== "INPUT"){ R.terms = []; renderChip(); } }
    } catch(_){}
    return out;
  });
  for(const name of ["runFeatureAudit", "auditL0CrossRepProjection", "auditConstructiveGenerationRuntime", "auditVisualReplayContractCoverage", "auditAutoTransformReplayFidelity"]){
    wrap(name, previous => function auditPassthroughMR(){ const prior = R.audit; R.audit = true; try { return previous.apply(this, arguments); } finally { R.audit = prior; } });
  }

  // ------------------------------------------------------------------------
  // Settings toggles (appended to the fork's Progression section)
  // ------------------------------------------------------------------------
  function installToggles(){
    const sec = $("mdProgressionSection"); if(!sec || $("mdToggleNeg")) return;
    const host = sec.querySelector(".md-toggles"); if(!host) return;
    const mk = (id, label, title) => { const b = document.createElement("button"); b.type = "button"; b.className = "md-toggle"; b.id = id; b.setAttribute("aria-pressed", "false"); b.textContent = label; b.title = title; host.appendChild(b); return b; };
    const neg = mk("mdToggleNeg", "Highlight negations", "not / neither / only / exactly one… stand out in the question");
    const trm = mk("mdToggleTerms", "Term hints (📖)", "jargon in the question gets a note: tap the word or the 📖 chip");
    const seal = mk("mdToggleSeal", "Summary shine", "a short shine on the logo when a block is sealed");
    const vis = mk("mdToggleVisuals", "Bigger diagrams", "larger directed graphs (thicker arrows) and paper-folding sheets");
    vis.addEventListener("click", ev => { ev.preventDefault(); ev.stopPropagation(); st().visuals = !st().visuals; save(); renderToggles(); });
    // Opened through the Files app on Android (content:// link): Chrome cannot re-read such a
    // file by itself, so a reload of the tab ends in "Your file couldn't be accessed". The fork
    // keeps every gesture that would reload the page away from the browser; this note says what
    // to do if it still happens.
    try {
      if(/^content:/i.test(String(location.protocol || "")) && !$("mdContentNote")){
        const n = document.createElement("div"); n.id = "mdContentNote"; n.className = "md-note";
        n.textContent = "Opened from the Files app: Chrome cannot reload a file opened this way. If this tab ever shows “Your file couldn't be accessed”, open the file again from Files — your progress is saved in the browser. A copy opened from Chrome's own Downloads list survives reloads.";
        host.parentNode.insertBefore(n, host.nextSibling);
      }
    } catch(_){}
    neg.addEventListener("click", ev => { ev.preventDefault(); ev.stopPropagation(); st().negations = !st().negations; save(); renderToggles(); });
    trm.addEventListener("click", ev => { ev.preventDefault(); ev.stopPropagation(); st().terms = !st().terms; save(); renderToggles(); renderChip(); });
    seal.addEventListener("click", ev => { ev.preventDefault(); ev.stopPropagation(); st().seal = !st().seal; save(); renderToggles(); });
    renderToggles();
  }
  function renderToggles(){
    const S = st();
    const set = (id, v) => { const b = $(id); if(b) b.setAttribute("aria-pressed", String(!!v)); };
    set("mdToggleNeg", S.negations); set("mdToggleTerms", S.terms); set("mdToggleSeal", S.seal); set("mdToggleVisuals", S.visuals);
  }
  wrap("updateMenu", previous => function updateMenuMR(){
    const out = previous.apply(this, arguments);
    try { installToggles(); renderToggles(); } catch(_){}
    return out;
  });

  // ------------------------------------------------------------------------
  // API + boot
  // ------------------------------------------------------------------------
  const api = {
    glossary:GLOSSARY.map(g => ({key:g.key, title:g.title, def:typeof g.def === "function" ? g.def(["", "N"]) : g.def, match:g.match ? g.match.slice() : null})),
    get state(){ return {...st()}; },
    set(key, v){ const S = st(); if(key in S && typeof S[key] === "boolean"){ S[key] = !!v; save(); renderToggles(); renderChip(); } return st()[key]; },
    decorate:decorateQuestion,
    terms(){ return R.terms.slice(); },
    explain(key){ const g = GLOSSARY.find(x => x.key === key); return g ? {title:g.title, def:defText(g, ["", "N"])} : null; },
    seal:playSeal,
    restyle:restyleViewpoint,
    rule:preciseRule,
    witness:pairWitness,
    paperClean:paperItemClean,
    paperDistinct,
    get paperRepairs(){ return {checked:R.paperChecked || 0, repaired:R.paperRepairs || 0, failed:R.paperRepairFailures || 0, log:(R.paperLog || []).slice()}; },
    repairPaper:repairPaperTrial,
    nestedHint,
    renderGraphPair(L, Rg){ return renderGraphPairBig(L, Rg, ["LEFT GRAPH", "RIGHT GRAPH"], "", "two directed graphs"); },
    renderPaper:renderPaperQuestionBig,
    reset(){ R.st = defaults(); save(); renderToggles(); return R.st; }
  };
  try { Object.defineProperty(globalThis, "EUCA_READING", {value:api, writable:false, configurable:false, enumerable:true}); } catch(_){ globalThis.EUCA_READING = api; }

  function boot(){
    reapplyWraps();
    installDomains();
    installToggles();
    ensureChip();
    window.addEventListener("load", () => { reapplyWraps(); installDomains(); installToggles(); }, {once:true});
    document.documentElement.dataset.eucaMdReading = "1";
  }
  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, {once:true}); else boot();
})();
