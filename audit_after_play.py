import pathlib as _pl, os as _os
_ROOT = _pl.Path(__file__).resolve().parents[1]
for _d in ('shots/fork', 'shots/learn'): (_ROOT / _d).mkdir(parents=True, exist_ok=True)
_os.chdir(_ROOT)
import sys, json, asyncio, pathlib, functools
print = functools.partial(print, flush=True)
from playwright.async_api import async_playwright
STEP = open(_ROOT / 'bot.py').read().split('STEP_JS = r"""')[1].split('"""')[0]
AUDIT = r"""
() => { const r=runFeatureAudit('all', {allowPublicHarness:true, allowPublicHarnessRuntime:true, force:true}); const flat={}; const walk=(obj,prefix)=>{ if(!obj||typeof obj!=='object') return; for(const [k,v] of Object.entries(obj)){ if(!v||typeof v!=='object') continue; const key=prefix?prefix+'.'+k:k; if(typeof v.status==='string') flat[key]=v.status; if(v.results) walk(v.results,key); } }; walk(r&&r.results,''); const bad=Object.entries(flat).filter(([k,v])=>!['PASS','INFO','SKIP','pass'].includes(v)); return {top:r&&r.status, n:Object.keys(flat).length, nonPass:bad}; }
"""
async def main():
    file=sys.argv[1]; n=int(sys.argv[2]); manual = sys.argv[3] if len(sys.argv)>3 else None
    async with async_playwright() as p:
        b = await p.chromium.launch(); page = await (await b.new_context(viewport={"width":1100,"height":860})).new_page()
        await page.goto(pathlib.Path(file).resolve().as_uri()); await page.wait_for_timeout(1500)
        if await page.evaluate("()=>!!window.EUCA_PROGRESSION"): await page.evaluate("()=>EUCA_PROGRESSION.setMode('staircase')")
        t0 = await page.evaluate("()=>State.stats.trials")
        for i in range(60000):
            if (await page.evaluate("()=>State.stats.trials")) - t0 >= n: break
            r = await page.evaluate(STEP, {"pCorrect":0.97,"rtMs":600})
            if r.get('needKey'): await page.keyboard.press('Space')
            await page.wait_for_timeout(25 if r.get('action')=='answer' else 50)
        # open the menu (pause)
        for i in range(400):
            if await page.evaluate("()=>State.status") in ('INPUT','SUMMARY'): break
            r = await page.evaluate(STEP, {"pCorrect":0.97,"rtMs":600})
            if r.get('needKey'): await page.keyboard.press('Space')
            await page.wait_for_timeout(40)
        st = await page.evaluate("()=>State.status")
        if st=='SUMMARY': await page.click('#restBtn')
        else: await page.evaluate("()=>document.getElementById('pauseBtn').click()")
        await page.wait_for_timeout(600)
        print('state:', await page.evaluate("()=>({trials:State.stats.trials, tier:State.levelByMode.D, running:State.running, paused:State.paused, status:State.status, rel:!!State.autoCurriculum?.reachedRelational})"))
        if manual is not None and await page.evaluate("()=>!!window.EUCA_PROGRESSION"):
            print('manual:', await page.evaluate("(m)=>EUCA_PROGRESSION.manualMeta(m==='auto'?'auto':Number(m))", manual))
        a = await page.evaluate(AUDIT)
        print(pathlib.Path(file).name, 'manual', manual, '→', a['top'], a['n'], 'nonPass:', a['nonPass'])
        if manual is not None and await page.evaluate("()=>!!window.EUCA_PROGRESSION"):
            print('back to auto:', await page.evaluate("()=>EUCA_PROGRESSION.manualMeta('auto')"))
            a2 = await page.evaluate(AUDIT)
            print('  auto →', a2['top'], 'nonPass:', a2['nonPass'])
        await b.close()
asyncio.run(main())
