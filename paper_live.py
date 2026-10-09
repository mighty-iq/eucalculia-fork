"""Play Auto until N natural paper-folding trials have been dealt; for each record whether the
one-row layout rendered, whether the item is clean, and the repair counters."""
import pathlib as _pl, os as _os
_ROOT = _pl.Path(__file__).resolve().parents[1]
for _d in ('shots/fork', 'shots/learn'): (_ROOT / _d).mkdir(parents=True, exist_ok=True)
_os.chdir(_ROOT)
import sys, json, asyncio, pathlib, functools
print = functools.partial(print, flush=True)
from playwright.async_api import async_playwright
STEP = open(_ROOT / 'bot.py').read().split('STEP_JS = r"""')[1].split('"""')[0]
PROBE = r"""
() => { const i = State.trialInfo || {}; const it = i.visualPredict; const svg = document.querySelector('#metaQuestion svg.visual-predict-paper');
  return {variant:it && it.variant, big:!!(svg && svg.classList.contains('md-paper-big')), cards:svg ? svg.querySelectorAll('rect[width="130"]').length : 0, clean:it ? EUCA_READING.paperClean(it) : null, repaired:i.__mdPaperRepaired || null, checked:i.__mdPaperChecked || false, counters:EUCA_READING.paperRepairs, seed:it && it.seed, target:State.targetValue, correct:it && it.correctIndex, optN:(i.options||[]).length, padN:document.querySelectorAll('#choicepad .choiceBtn').length}; }
"""
async def main():
    file = sys.argv[1]; want = int(sys.argv[2]) if len(sys.argv) > 2 else 4; mode = sys.argv[3] if len(sys.argv) > 3 else 'staircase'
    async with async_playwright() as p:
        b = await p.chromium.launch(); page = await (await b.new_context(viewport={"width":1366,"height":768})).new_page()
        errs = []; page.on("pageerror", lambda e: errs.append(str(e)[:200]))
        await page.goto(pathlib.Path(file).resolve().as_uri()); await page.wait_for_timeout(1500)
        await page.evaluate("(m)=>{ if(window.EUCA_PROGRESSION) window.EUCA_PROGRESSION.setMode(m); }", mode)
        seen = 0; answered = 0; last = None
        for i in range(12000):
            st = await page.evaluate("()=>State.status")
            if st == 'INPUT':
                kind = await page.evaluate("()=>State.trialInfo && State.trialInfo.kind")
                if kind == 'visual_predict_complete_state':
                    pr = await page.evaluate(PROBE)
                    key = (pr['seed'], pr['variant'])
                    if key != last:
                        last = key
                        if pr['variant'] == 'paper_full_unfold':
                            seen += 1; print(f"paper #{seen} at trial {answered}:", json.dumps(pr))
                            if seen == 1: await page.screenshot(path="shots/fork/paper_live_1.png")
                            if seen >= want: break
            r = await page.evaluate(STEP, {"pCorrect":0.95, "rtMs":550})
            if r.get('needKey'): await page.keyboard.press('Space')
            if r.get('action') == 'answer': answered += 1
            await page.wait_for_timeout(30)
        fin = await page.evaluate("()=>({errs:(State.productionMonitor.runtimeErrors||[]).length, flow:(State.flowAudit&&State.flowAudit.violations||[]).length, trials:State.stats.trials, counters:EUCA_READING.paperRepairs, log:EUCA_READING.paperRepairs.log})")
        print('FINAL', fin, 'page errors', errs[:3])
        await b.close()
asyncio.run(main())
