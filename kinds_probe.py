import pathlib as _pl, os as _os
_ROOT = _pl.Path(__file__).resolve().parents[1]
for _d in ('shots/fork', 'shots/learn'): (_ROOT / _d).mkdir(parents=True, exist_ok=True)
_os.chdir(_ROOT)
import sys, json, asyncio, pathlib, collections
from playwright.async_api import async_playwright
STEP = open(_ROOT / 'bot.py').read().split('STEP_JS = r"""')[1].split('"""')[0]
INFO = r"""
() => { const S=State, i=S.trialInfo||{}; return {st:S.status, kind:i.kind||null, phase:i.autoPhase||S.autoPhase||null, rm:i.renderMode||null, sm:i.statsMode||null, panel:S.pendingPanel||null, lvl:S.currentTrialLevel, mem:!!i.memoryActive, lure:!!i.isMemInterferenceLure, xrep:i.xrepPhase||null, q:(i.question||i.delayedPrompt||i.relationQuestion||'').slice(0,90), prompt:(document.getElementById('promptRow')?.textContent||'').trim().slice(0,90), transform:!!(i.representationTransform||i.transform), keys:Object.keys(i).slice(0,40)}; }
"""
async def main():
    n = int(sys.argv[2]) if len(sys.argv)>2 else 200
    async with async_playwright() as p:
        b = await p.chromium.launch(); page = await (await b.new_context(viewport={"width":1100,"height":860})).new_page()
        await page.goto(pathlib.Path(sys.argv[1]).resolve().as_uri()); await page.wait_for_timeout(1500)
        combos = collections.OrderedDict(); answered = 0; keys=set()
        for i in range(6000):
            if answered >= n: break
            st = await page.evaluate("()=>State.status")
            if st == 'INPUT':
                info = await page.evaluate(INFO)
                key = (info['kind'], info['phase'], info['rm'], info['sm'], info['panel'], info['lvl'], info['mem'], info['lure'], info['xrep'], info['transform'])
                if key not in combos: combos[key] = (answered, info['q'], info['prompt'])
                keys.update(info['keys'])
            r = await page.evaluate(STEP, {"pCorrect":0.93,"rtMs":600})
            if r.get('needKey'): await page.keyboard.press('Space')
            if r.get('action') == 'answer': answered += 1
            await page.wait_for_timeout(40 if r.get('action')=='answer' else 80)
        for k,v in combos.items(): print(v[0], k, '|', v[1], '|', v[2])
        print('trialInfo keys:', sorted(keys))
        await b.close()
asyncio.run(main())
