import pathlib as _pl, os as _os
_ROOT = _pl.Path(__file__).resolve().parents[1]
for _d in ('shots/fork', 'shots/learn'): (_ROOT / _d).mkdir(parents=True, exist_ok=True)
_os.chdir(_ROOT)
import sys, json, asyncio, pathlib
from playwright.async_api import async_playwright
STEP = open(_ROOT / 'bot.py').read().split('STEP_JS = r"""')[1].split('"""')[0]
SIZING = "() => { const m=State.mainCache&&State.mainCache.__eucaR320PairSizing, s=State.secCache&&State.secCache.__eucaR320PairSizing; const f=x=>x?{w:Math.round(x.inkAfter?x.inkAfter.width:0), h:Math.round(x.inkAfter?x.inkAfter.height:0), half:x.profile.width, band:x.profile.band.height, scale:x.scale, key:x.profile.cacheKey.slice(-12)}:null; return {main:f(m), sec:f(s), st:State.status, kind:State.trialInfo?.kind, reps:[State.trialInfo?.repA,State.trialInfo?.repB]}; }"
async def main():
    file=sys.argv[1]
    async with async_playwright() as p:
        b = await p.chromium.launch()
        for (w,hh,tag) in [(1100,860,''),(412,880,'m_')]:
            page = await (await b.new_context(viewport={"width":w,"height":hh}, device_scale_factor=1)).new_page()
            errs=[]; page.on("pageerror", lambda e: errs.append(str(e)[:200]))
            await page.goto(pathlib.Path(file).resolve().as_uri()); await page.wait_for_timeout(1200)
            await page.evaluate("()=>EUCA_PROGRESSION.setMode('staircase')")
            sizes={}; n=0; reached=False
            for size in ['normal','large','max']:
                await page.evaluate("(s)=>EUCA_PROGRESSION.setPairSize(s)", size)
                got=0; tries=0
                while got<3 and tries<3000:
                    tries+=1
                    st = await page.evaluate("()=>State.status")
                    if st=='FLASH':
                        info = await page.evaluate(SIZING)
                        if info['main'] and info['sec'] and info['kind']=='posner':
                            sizes.setdefault(size,[]).append(info); got+=1
                            if got==1: await page.screenshot(path=f"shots/fork/{tag}pair_{size}.png")
                            await page.wait_for_timeout(700)
                    r = await page.evaluate(STEP, {"pCorrect":0.95,"rtMs":500})
                    if r.get('needKey'): await page.keyboard.press('Space')
                    if r.get('action')=='answer': n+=1
                    await page.wait_for_timeout(30 if r.get('action')=='answer' else 60)
            for size, rows in sizes.items():
                print(tag, size, [ (r['main']['w'], r['main']['h'], 'half', r['main']['half'], 'band', r['main']['band'], r['reps']) for r in rows])
            # manual tier from the menu — wait for the real relational handoff first
            for i in range(4000):
                if await page.evaluate("()=>!!(State.autoCurriculum&&State.autoCurriculum.reachedRelational)"): break
                r = await page.evaluate(STEP, {"pCorrect":0.95,"rtMs":500})
                if r.get('needKey'): await page.keyboard.press('Space')
                await page.wait_for_timeout(30 if r.get('action')=='answer' else 60)
            for i in range(200):
                if await page.evaluate("()=>State.status") in ('INPUT','SUMMARY'): break
                await page.wait_for_timeout(50)
            st = await page.evaluate("()=>State.status")
            if st=='SUMMARY': await page.click('#restBtn')
            else: await page.evaluate("()=>document.getElementById('pauseBtn').click()")
            await page.wait_for_timeout(900)
            before = await page.evaluate("()=>({tier:State.levelByMode.D, lv:EUCA_PROGRESSION.snapshot().level, allowed:!document.querySelector('#mdLevelCard .md-lc-btn').disabled, running:State.running, paused:State.paused, status:State.status, overlay:modalIsOpen('overlay'), rel:!!(State.autoCurriculum&&State.autoCurriculum.reachedRelational)})")
            print(tag, 'pre-click state:', before)
            if not before['allowed']:
                await page.evaluate("()=>EUCA_PROGRESSION.renderLevelCard()"); await page.wait_for_timeout(200)
                print(tag, 'after rerender allowed:', await page.evaluate("()=>!document.querySelector('#mdLevelCard .md-lc-btn').disabled"))
            await page.click('#mdLevelCard .md-lc-btn[data-act="tier-up"]'); await page.wait_for_timeout(300)
            after = await page.evaluate("()=>({tier:State.levelByMode.D, lv:EUCA_PROGRESSION.snapshot().level, note:document.querySelector('#mdLevelCard .md-lc-note').textContent, hud:document.getElementById('modeLabel').textContent, val:document.querySelector('#mdLevelCard [data-val=tier]').textContent})")
            print(tag, 'manual tier up:', before, '->', after)
            await page.screenshot(path=f"shots/fork/{tag}manual_card.png")
            await page.click('#mdLevelCard .md-lc-btn[data-act="sp-up"]'); await page.wait_for_timeout(200)
            print(tag, 'spacing:', await page.evaluate("()=>EUCA_PROGRESSION.snapshot().spacing"))
            # resume and play a bit more
            if await page.evaluate("()=>getComputedStyle(document.getElementById('resumeBtn')).display!=='none'"): await page.click('#resumeBtn')
            else: await page.click('#startBtn')
            await page.wait_for_timeout(500)
            k=0
            for i in range(1500):
                if k>=25: break
                r = await page.evaluate(STEP, {"pCorrect":0.95,"rtMs":500})
                if r.get('needKey'): await page.keyboard.press('Space')
                if r.get('action')=='answer': k+=1
                await page.wait_for_timeout(30 if r.get('action')=='answer' else 60)
            print(tag, 'after resume tier:', await page.evaluate("()=>({tier:State.levelByMode.D, errs:(State.productionMonitor.runtimeErrors||[]).length, flow:(State.flowAudit&&State.flowAudit.violations||[]).length})"), 'errors', errs[:3])
            # baseline: buttons disabled?
            await page.evaluate("()=>{document.getElementById('pauseBtn').click();}"); await page.wait_for_timeout(600)
            await page.evaluate("()=>EUCA_PROGRESSION.setMode('baseline')"); await page.wait_for_timeout(200)
            print(tag, 'baseline disabled:', await page.evaluate("()=>document.querySelector('#mdLevelCard .md-lc-btn').disabled"), await page.evaluate("()=>document.querySelector('#mdLevelCard .md-lc-manual-hint').textContent.slice(0,60)"))
            await page.close()
        await b.close()
asyncio.run(main())
