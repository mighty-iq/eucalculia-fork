"""Fork v1.5 (round four) — unit checks: paper distinctness + repair, build-a-pair witness,
nested-boolean hint, status glossary, bigger graph/paper renderers, toggle."""
import pathlib as _pl, os as _os
_ROOT = _pl.Path(__file__).resolve().parents[1]
for _d in ('shots/fork', 'shots/learn'): (_ROOT / _d).mkdir(parents=True, exist_ok=True)
_os.chdir(_ROOT)
import sys, json, asyncio, pathlib, functools
print = functools.partial(print, flush=True)
from playwright.async_api import async_playwright
JS = r"""
() => {
  const out = {};
  const api = globalThis.EUCALCULIA_G08_VISUAL_PREDICT, RD = globalThis.EUCA_READING;
  out.api = ['witness','paperClean','paperDistinct','repairPaper','nestedHint','renderGraphPair','renderPaper'].map(k => typeof RD[k]);
  // 1. distinctness metric
  const sq = [{x:0.2,y:0.2},{x:0.8,y:0.2},{x:0.5,y:0.7}];
  out.distinctSame = RD.paperDistinct(sq, sq.map(p => ({x:p.x + 0.0004, y:p.y})));          // identical up to rounding → false
  out.distinctMirror = RD.paperDistinct(sq, sq.map(p => ({x:1 - p.x, y:p.y})));               // mirror of a symmetric-ish set: moves only one point? (0.5,0.7) stays → 2 moved
  out.distinctFar = RD.paperDistinct(sq, sq.map(p => ({x:p.x, y:1 - p.y})));
  // 2. find a bad seed and repair a synthetic live trial
  let bad = null, badSeed = null;
  for(let s = 1; s < 400 && !bad; s++){ const it = api.build({variant:"paper_full_unfold", seed:s}); if(it && !RD.paperClean(it)){ bad = it; badSeed = s; } }
  out.badSeed = badSeed;
  if(bad){
    State.status = "INPUT"; State.pendingPanel = "choice";
    document.getElementById("app").classList.add("visual-predict-mode");
    State.trialInfo = {kind:"visual_predict_complete_state", level:0, catId:"g08_paper_full_unfold", question:"Which pattern appears when the paper is fully unfolded?", options:bad.options, visualPredict:bad, answer:bad.correctIndex, correctIndex:bad.correctIndex, semanticCorrectIndex:bad.correctIndex, targetOutcome:bad.correctIndex, countsForMetaHistory:false};
    State.targetValue = bad.correctIndex;
    setChoiceOptions(bad.options); showMetaQuestion(0, State.trialInfo.question, "", null);
    const before = RD.paperRepairs.repaired;
    const r = RD.repairPaper();
    const info = State.trialInfo, it = info.visualPredict;
    out.repair = {returned:r, counted:RD.paperRepairs.repaired - before, clean:RD.paperClean(it), newSeed:it.seed, sameObject:info === State.trialInfo, target:State.targetValue === it.correctIndex, answer:info.answer === it.correctIndex && info.correctIndex === it.correctIndex && info.semanticCorrectIndex === it.correctIndex && info.targetOutcome === it.correctIndex,
      optionsN:(info.options || []).length, optionsAreNew:info.options === it.options, verify:api.verify(it, it.correctIndex), geom:api.geometryValid(it), repaired:info.__mdPaperRepaired,
      domBig:!!document.querySelector('#metaQuestion svg.md-paper-big'), cards:document.querySelectorAll('#metaQuestion svg.md-paper-big rect[width="130"]').length, sheets:document.querySelectorAll('#metaQuestion svg.md-paper-big rect[width="100"]').length,
      padBtns:[...document.querySelectorAll('#choicepad .choiceBtn .choiceText')].map(b => b.textContent.trim()).slice(0,4), candidates:document.querySelector('#metaQuestion .visual-predict-svg')?.dataset.candidates};
    // no repair needed on a clean item
    const r2 = RD.repairPaper(); out.repairClean = r2;
    // base renderer with visuals off
    RD.set('visuals', false); const svgOff = metaStimulusSVGForTrialInfo(State.trialInfo); out.paperOff = {big:/md-paper-big/.test(svgOff), base:/visual-predict-paper/.test(svgOff)}; RD.set('visuals', true);
    document.getElementById("app").classList.remove("visual-predict-mode");
  }
  // 3. witness for Dark's question
  const cat = dPosnerCatById('two_property_square_multiple3_DD');
  out.catExists = !!cat;
  State.maxValue = 10;
  const infoW = {kind:"generative_inline", sourceCatId:"two_property_square_multiple3_DD", catId:"construct_two_property_square_multiple3_DD", cap:10, m:10, targetTruth:true, constructiveTargetTruth:true, userPair:{a:9,b:4}, pairs:[{phase:1, pair:{a:9,b:4}, targetTruth:true, actualTruth:false, correct:false}], constructiveVerdict:"opposite_target", constructiveActualTruth:false, question:"Choose LEFT and RIGHT so the answer is YES: Do the two numbers have different square-number status and different multiple-of-3 status?"};
  const w = RD.witness(infoW); out.witness = w && {pair:w.pair, count:w.count, why:w.why, verify:cat && cat.verify(w.pair.a, w.pair.b)};
  State.trialInfo = infoW; State.status = "REVIEW";
  const model = h35ReviewBuildModel(infoW); out.model = {correct:model.correctAnswer, reasons:model.reasons.slice(-2)};
  // witness respects the domain rule (smaller > 1) for sum_divisible_by_smaller
  const infoD = {kind:"generative_inline", sourceCatId:"sum_divisible_by_smaller", cap:10, m:10, targetTruth:true, constructiveTargetTruth:true, userPair:{a:1,b:10}, constructiveVerdict:"opposite_target"};
  const wd = RD.witness(infoD); out.witnessDomain = wd && {pair:wd.pair, minGt1:Math.min(wd.pair.a, wd.pair.b) > 1, verify:dPosnerCatById('sum_divisible_by_smaller').verify(wd.pair.a, wd.pair.b, 10)};
  // a matched (correct) trial leaves the model alone
  const okModel = h35ReviewBuildModel({...infoW, constructiveVerdict:"matched_target"}); out.modelMatched = okModel.correctAnswer;
  // 4. nested hint
  State.status = "INPUT"; State.trialInfo = {kind:"meta1", level:1, nestedBoolean:{specId:"d2", opId:"nb_d2", patternKey:"TF", depth:2}, question:"Is at least one of these true: (1) Pair 1 left is even; (2) the two gaps are equal?"};
  showMetaQuestion(1, State.trialInfo.question, "");
  setChoiceOptions([{text:"YES — both (1) and (2) hold", correct:false},{text:"YES — only (1) holds", correct:true},{text:"YES — only (2) holds", correct:false},{text:"NO — neither (1) nor (2) holds", correct:false}]);
  const nh = document.querySelector('#metaQuestion .md-nested-hint'); out.nested = {present:!!nh, text:nh && nh.textContent, afterScope:nh && nh.previousElementSibling && nh.previousElementSibling.className};
  const q = document.querySelector('#metaQuestion .meta-q'); out.nestedTerms = [...q.querySelectorAll('.md-term')].map(t => t.dataset.term + ':' + t.className);
  // non-nested META¹ → no line
  State.trialInfo = {kind:"meta1", level:1, question:"Which pair had the larger LEFT value?"}; showMetaQuestion(1, State.trialInfo.question, ""); out.nestedGone = !document.querySelector('#metaQuestion .md-nested-hint');
  // 5. status glossary
  q.textContent = "Do the two numbers have different square-number status and different multiple-of-3 status? Are they mismatched on being a square?"; RD.decorate();
  out.statusTerms = [...q.querySelectorAll('.md-term')].map(t => t.dataset.term);
  out.qTextIntact = q.textContent;
  // 6. graphs
  const pair = graphBuildConditionalPair("different", 6);
  const big = graphConditionalRenderPairSVG(pair.graphLeft, pair.graphRight);
  out.graph = {big:/md-graph-big/.test(big), viewBox:(big.match(/viewBox="([^"]+)"/) || [])[1], paths:(big.match(/<path d=/g) || []).length, edges:pair.graphLeft.edges.length + pair.graphRight.edges.length, marker:/mdGraphArrow/.test(big), labels:/LEFT GRAPH/.test(big) && /RIGHT GRAPH/.test(big)};
  const marks = graphConditionalRenderPairSVG(Object.assign({}, pair.graphLeft, {marks:{square:0, ring:1}}), Object.assign({}, pair.graphRight, {marks:{square:1, ring:2}}));
  out.graphMarks = {roles:/LEFT ROLES/.test(marks) && /square role/.test(marks), rects:(marks.match(/<rect x="[^"]+" y="[^"]+" width="[^"]+" height="[^"]+" rx="3.4"/g) || []).length};
  const gate = graphRelationGateRenderSVG(pair.graphLeft, 0, 2); out.gate = {big:/md-graph-big/.test(gate), selector:/GRAPH RULE SELECTOR/.test(gate), legend:/first node/.test(gate)};
  RD.set('visuals', false); const baseSvg = graphConditionalRenderPairSVG(pair.graphLeft, pair.graphRight); out.graphOff = {big:/md-graph-big/.test(baseSvg), viewBox:(baseSvg.match(/viewBox="([^"]+)"/) || [])[1]}; RD.set('visuals', true);
  // under audit → base
  let auditSvg = null; const prevAudit = runFeatureAudit;
  out.toggle = !!document.getElementById('mdToggleVisuals');
  out.glossaryN = RD.glossary.length;
  return out;
}
"""
async def main():
    file = sys.argv[1]
    async with async_playwright() as p:
        b = await p.chromium.launch(); page = await (await b.new_context(viewport={"width":1100,"height":860})).new_page()
        errs = []; page.on("pageerror", lambda e: errs.append(str(e)[:300]))
        page.on("console", lambda m: errs.append('[console.error] ' + m.text[:200]) if m.type == 'error' and 'willReadFrequently' not in m.text else None)
        await page.goto(pathlib.Path(file).resolve().as_uri()); await page.wait_for_timeout(1500)
        out = await page.evaluate(JS)
        for k, v in out.items(): print(k, '=', json.dumps(v, ensure_ascii=False)[:600])
        print('errors', errs[:5])
        await b.close()
asyncio.run(main())
