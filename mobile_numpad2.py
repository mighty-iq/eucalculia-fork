import pathlib as _pl, os as _os
_ROOT = _pl.Path(__file__).resolve().parents[1]
for _d in ('shots/fork', 'shots/learn'): (_ROOT / _d).mkdir(parents=True, exist_ok=True)
_os.chdir(_ROOT)
import sys, asyncio, pathlib
from playwright.async_api import async_playwright
STEP = open(_ROOT / 'bot.py').read().split('STEP_JS = r"""')[1].split('"""')[0]
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        for (w,hh,tag) in [(412,880,'m880'),(375,700,'m700'),(390,844,'m844')]:
            page = await (await b.new_context(viewport={"width":w,"height":hh}, device_scale_factor=1)).new_page()
            await page.goto(pathlib.Path(sys.argv[1]).resolve().as_uri()); await page.wait_for_timeout(1200)
            n=0
            for i in range(400):
                st = await page.evaluate("()=>State.status")
                if st=='INPUT' and n>=2 and (await page.evaluate("()=>State.pendingPanel"))=='numpad':
                    await page.evaluate("()=>{const c=document.getElementById('mdCoach'); c.querySelector('.ml-coach-text').textContent='META¹ asks about the two 🧠 pairs you retained (Pair 1, then Pair 2). Values as shown unless the hint says TRANSFORMED.'; c.classList.add('visible'); document.getElementById('app').classList.add('md-has-coach');}")
                    await page.wait_for_timeout(300)
                    m = await page.evaluate("()=>{const btns=[...document.querySelectorAll('.numBtn')].map(b=>b.getBoundingClientRect().bottom); return {maxBtnBottom:Math.max(...btns), vh:innerHeight, coachH:document.getElementById('mdCoach').getBoundingClientRect().height, gcH:document.getElementById('game-container').getBoundingClientRect().height}}")
                    print(tag, m); break
                r = await page.evaluate(STEP, {"pCorrect":0.95,"rtMs":500})
                if r.get('needKey'): await page.keyboard.press('Space')
                if r.get('action')=='answer': n+=1
                await page.wait_for_timeout(60 if r.get('action')=='answer' else 90)
            await page.close()
        await b.close()
asyncio.run(main())
