"""Screenshots of the directed-graph question (synthesized) and the paper-folding question (forced)
at several viewports. usage: visual_shots.py file tag"""
import pathlib as _pl, os as _os
_ROOT = _pl.Path(__file__).resolve().parents[1]
for _d in ('shots/fork', 'shots/learn'): (_ROOT / _d).mkdir(parents=True, exist_ok=True)
_os.chdir(_ROOT)
import sys, json, asyncio, pathlib, functools
print = functools.partial(print, flush=True)
from playwright.async_api import async_playwright
STEP = open(_ROOT / 'bot.py').read().split('STEP_JS = r"""')[1].split('"""')[0]
GRAPH_JS = r"""
(variant) => {
  const pair = graphBuildConditionalPair("different", 6);
  State.status = "INPUT"; State.pendingPanel = "choice";
  if(variant === "marks"){
    State.trialInfo = {kind:"meta1", level:1, graphConditional:{graphLeft:Object.assign({}, pair.graphLeft, {marks:{square:0, ring:1}}), graphRight:Object.assign({}, pair.graphRight, {marks:{square:1, ring:2}})}};
    showMetaQuestion(1, "Does the RIGHT claim keep the LEFT roles?\nIf YES: answer YES when LEFT is even.\nIf NO: answer YES when RIGHT is even.", "");
  } else if(variant === "gate"){
    State.trialInfo = {kind:"meta1", level:1, graphRelationGate:{graph:pair.graphLeft, markA:0, markB:2}};
    showMetaQuestion(1, "Is there an arrow from the square node to the ringed node?\nIf YES: answer YES when LEFT is even.\nIf NO: answer YES when RIGHT is even.", "");
  } else {
    State.trialInfo = {kind:"meta1", level:1, graphConditional:pair};
    showMetaQuestion(1, "Do the two directed graphs MATCH in structure?\nIf YES: answer YES when LEFT is even.\nIf NO: answer YES when RIGHT is even.", "");
  }
  setChoiceOptions([{text:"YES", correct:true},{text:"NO", correct:false}]);
  const svg = document.querySelector('#metaQuestion .meta-stimulus svg');
  const r = svg && svg.getBoundingClientRect(); const mq = document.getElementById('metaQuestion').getBoundingClientRect(); const gc = document.getElementById('game-container').getBoundingClientRect();
  return {svg:r && {w:Math.round(r.width), h:Math.round(r.height)}, mq:{top:Math.round(mq.top), bottom:Math.round(mq.bottom), h:Math.round(mq.height)}, frame:{top:Math.round(gc.top), bottom:Math.round(gc.bottom)}, cls:svg && svg.getAttribute('class')};
}
"""
async def main():
    file = sys.argv[1]; tag = sys.argv[2]
    async with async_playwright() as p:
        b = await p.chromium.launch()
        for (w, h, name) in [(1366, 768, 'pc'), (1920, 1080, 'fhd'), (412, 880, 'phone')]:
            ctx = await b.new_context(viewport={"width":w, "height":h}, device_scale_factor=1)
            page = await ctx.new_page(); errs = []; page.on("pageerror", lambda e: errs.append(str(e)[:200]))
            await page.goto(pathlib.Path(file).resolve().as_uri()); await page.wait_for_timeout(1500)
            await page.evaluate("()=>{ history.replaceState(null,'','?g08Visual=force&g08Variant=paper_full_unfold'); const prev=globalThis.maybeStartInlineGenerativeTrialAfterReset; const w=function(a,f){ if(!window.__forced && State.blockTrials>=2){ try{ if(EUCALCULIA_G08_VISUAL_PREDICT.start(a,f)){ window.__forced=true; return true; } }catch(e){ console.log('force err', e.message); } } return prev.apply(this, arguments); }; Object.assign(w, prev); globalThis.maybeStartInlineGenerativeTrialAfterReset=w; }")
            # play until a paper question shows
            got = None
            for i in range(600):
                st = await page.evaluate("()=>State.status")
                if st == 'INPUT':
                    kind = await page.evaluate("()=>State.trialInfo && State.trialInfo.kind")
                    if kind == 'visual_predict_complete_state':
                        got = await page.evaluate("()=>{ const s=document.querySelector('#metaQuestion .meta-stimulus svg.visual-predict-paper'); const r=s&&s.getBoundingClientRect(); const sh=[...document.querySelectorAll('#metaQuestion .meta-stimulus svg.visual-predict-paper rect')].filter(x=>x.getAttribute('width')==='98')[0]; const rs=sh&&sh.getBoundingClientRect(); const seq=document.querySelector('.visual-predict-sequence svg'); const rq=seq&&seq.getBoundingClientRect(); return {cand:r&&{w:Math.round(r.width),h:Math.round(r.height)}, sheet:rs&&Math.round(rs.width), seq:rq&&{w:Math.round(rq.width),h:Math.round(rq.height)}, minH:(()=>{const c=State.trialInfo.visualPredict.candidates; const nd=(p,pts)=>Math.min(...pts.map(q=>Math.hypot(p.x-q.x,p.y-q.y))); let m=9; for(let i=0;i<4;i++)for(let j=i+1;j<4;j++){const a=c[i].state,b=c[j].state; m=Math.min(m, Math.max(...a.map(p=>nd(p,b)),...b.map(p=>nd(p,a))));} return +m.toFixed(3);})()}; }")
                        await page.wait_for_timeout(300)
                        await page.screenshot(path=f"shots/fork/{tag}_paper_{name}.png")
                        await page.evaluate("()=>{ try{ processInput(State.targetValue, null); }catch(e){} }"); await page.wait_for_timeout(400)
                        break
                r = await page.evaluate(STEP, {"pCorrect":0.95, "rtMs":500})
                if r.get('needKey'): await page.keyboard.press('Space')
                await page.wait_for_timeout(40)
            print(name, 'paper', json.dumps(got))
            for variant in ['pair', 'marks', 'gate']:
                for i in range(400):
                    st = await page.evaluate("()=>State.status")
                    if st == 'INPUT': break
                    r = await page.evaluate(STEP, {"pCorrect":0.95, "rtMs":500})
                    if r.get('needKey'): await page.keyboard.press('Space')
                    await page.wait_for_timeout(40)
                info = await page.evaluate(GRAPH_JS, variant); await page.wait_for_timeout(150)
                await page.screenshot(path=f"shots/fork/{tag}_graph_{variant}_{name}.png")
                print(name, 'graph', variant, json.dumps(info))
                await page.evaluate("()=>{ try{ processInput(State.targetValue, null); }catch(e){} }"); await page.wait_for_timeout(100)
            print(name, 'errors', errs[:3])
            await ctx.close()
        await b.close()
asyncio.run(main())
