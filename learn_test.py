import pathlib as _pl, os as _os
_ROOT = _pl.Path(__file__).resolve().parents[1]
for _d in ('shots/fork', 'shots/learn'): (_ROOT / _d).mkdir(parents=True, exist_ok=True)
_os.chdir(_ROOT)
import sys, json, asyncio, pathlib
from playwright.async_api import async_playwright
FILE = sys.argv[1]
MOBILE = '--mobile' in sys.argv
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        vp = {"width":412,"height":880} if MOBILE else {"width":1200,"height":900}
        ctx = await b.new_context(viewport=vp, device_scale_factor=1)
        page = await ctx.new_page()
        errs = []
        page.on("pageerror", lambda e: errs.append('[pageerror] ' + str(e)[:300]))
        page.on("console", lambda m: errs.append('[console.'+m.type+'] ' + m.text[:300]) if m.type in ('error','warning') and 'willReadFrequently' not in m.text else None)
        await page.goto(pathlib.Path(FILE).resolve().as_uri()); await page.wait_for_timeout(1500)
        tag = 'm_' if MOBILE else ''
        info = await page.evaluate("""() => ({
          title: document.title, ver: currentAppVersion(), label: document.querySelector('[data-app-version]')?.textContent,
          learnBtn: !!document.getElementById('mdLearnBtn'), welcome: getComputedStyle(document.getElementById('mdWelcome')).display,
          chip: !!document.getElementById('mdHelpChip'), coach: !!document.getElementById('mdCoach'),
          credit: document.querySelector('.md-credit')?.textContent.trim().slice(0,200),
          api: typeof EUCA_LEARN, prog: typeof EUCA_PROGRESSION, plabel: EUCA_PROGRESSION.label
        })""")
        print(json.dumps(info, indent=1))
        await page.screenshot(path=f"shots/learn/{tag}menu.png")
        # open via the welcome button
        await page.click("#mdWelcome .ml-btn.primary")
        await page.wait_for_timeout(400)
        print('open?', await page.evaluate("()=>EUCA_LEARN.isOpen"))
        await page.screenshot(path=f"shots/learn/{tag}l1_welcome.png")
        # Space must not start a block while Learn is open
        await page.keyboard.press("Space"); await page.wait_for_timeout(300)
        print('status after Space:', await page.evaluate("()=>State.status"), 'running:', await page.evaluate("()=>State.running"))
        # arrow right → lesson 2
        await page.keyboard.press("ArrowRight"); await page.wait_for_timeout(500)
        print('current lesson:', await page.evaluate("()=>EUCA_LEARN.progress.last"))
        await page.screenshot(path=f"shots/learn/{tag}l2_formats.png")
        # quiz: start and answer via keyboard with the right value (peek at the last drawn value through a hook: read from the status text)
        await page.click("#mdLearn .ml-demo-ctrls .ml-btn.primary"); await page.wait_for_timeout(300)
        st = await page.evaluate("()=>document.querySelector('.ml-demo-status').textContent")
        print('quiz status:', st)
        await page.keyboard.type("7"); await page.keyboard.press("Enter"); await page.wait_for_timeout(300)
        fb = await page.evaluate("()=>document.querySelector('.ml-feedback')?.textContent.slice(0,120)")
        print('quiz feedback:', fb)
        await page.screenshot(path=f"shots/learn/{tag}l2_quiz.png")
        # lesson 3 rhythm: set slider to 300 and play, answer
        await page.evaluate("()=>EUCA_LEARN.show('rhythm')"); await page.wait_for_timeout(300)
        await page.evaluate("()=>{const s=document.querySelector('.ml-demo-bar input[type=range]'); s.value=400; s.dispatchEvent(new Event('input'));}")
        await page.click("#mdLearn .ml-demo-ctrls .ml-btn.primary"); await page.wait_for_timeout(500)
        await page.screenshot(path=f"shots/learn/{tag}l3_flash.png")
        await page.wait_for_timeout(1400)
        print('rhythm status:', await page.evaluate("()=>document.querySelector('.ml-demo-status').textContent"))
        await page.screenshot(path=f"shots/learn/{tag}l3_ask.png")
        await page.keyboard.type("5"); await page.keyboard.press("Enter"); await page.wait_for_timeout(300)
        print('rhythm feedback:', await page.evaluate("()=>document.querySelector('.ml-feedback')?.textContent.slice(0,160)"))
        await page.screenshot(path=f"shots/learn/{tag}l3_feedback.png")
        # lesson 4 relational
        await page.evaluate("()=>EUCA_LEARN.show('relational')"); await page.wait_for_timeout(300)
        await page.screenshot(path=f"shots/learn/{tag}l4_relational.png")
        await page.click("#mdLearn .ml-demo-ctrls .ml-btn.primary"); await page.wait_for_timeout(900)
        await page.screenshot(path=f"shots/learn/{tag}l4_flash.png")
        await page.wait_for_timeout(1500)
        q = await page.evaluate("()=>document.querySelector('.ml-demo-msg .ml-q')?.textContent")
        print('relational q:', q)
        await page.screenshot(path=f"shots/learn/{tag}l4_ask.png")
        # answer whatever: click first answer button
        await page.click(".ml-answers button"); await page.wait_for_timeout(300)
        print('relational feedback:', await page.evaluate("()=>document.querySelector('.ml-feedback')?.textContent.slice(0,200)"))
        await page.screenshot(path=f"shots/learn/{tag}l4_feedback.png")
        # lesson 5 transform
        await page.evaluate("()=>EUCA_LEARN.show('transform')"); await page.wait_for_timeout(300)
        await page.screenshot(path=f"shots/learn/{tag}l5_transform.png")
        await page.click("#mdLearn .ml-demo-ctrls .ml-btn.primary"); await page.wait_for_timeout(2400)
        print('transform q:', await page.evaluate("()=>document.querySelector('.ml-demo-msg .ml-q')?.textContent"))
        await page.keyboard.type("3"); await page.keyboard.press("Enter"); await page.wait_for_timeout(300)
        print('transform feedback:', await page.evaluate("()=>document.querySelector('.ml-feedback')?.textContent.slice(0,200)"))
        await page.screenshot(path=f"shots/learn/{tag}l5_feedback.png")
        # lesson 6 meta chain
        await page.evaluate("()=>EUCA_LEARN.show('meta')"); await page.wait_for_timeout(300)
        await page.screenshot(path=f"shots/learn/{tag}l6_meta.png")
        await page.click("#mdLearn .ml-demo-ctrls .ml-btn.amber"); await page.wait_for_timeout(1000)
        await page.screenshot(path=f"shots/learn/{tag}l6_mem1.png")
        await page.wait_for_timeout(1500)
        print('chain q1:', await page.evaluate("()=>document.querySelector('.ml-demo-msg .ml-q')?.textContent"))
        await page.keyboard.press("y"); await page.wait_for_timeout(1300)
        await page.wait_for_timeout(2200)
        print('chain q2:', await page.evaluate("()=>document.querySelector('.ml-demo-msg .ml-q')?.textContent"))
        await page.keyboard.press("n"); await page.wait_for_timeout(1400)
        print('meta q:', await page.evaluate("()=>document.querySelector('.ml-demo-msg .ml-q')?.textContent"))
        await page.screenshot(path=f"shots/learn/{tag}l6_metaq.png")
        # answer: click first answer
        await page.click(".ml-answers button"); await page.wait_for_timeout(400)
        print('meta feedback:', await page.evaluate("()=>document.querySelector('.ml-feedback')?.textContent.slice(0,240)"))
        await page.screenshot(path=f"shots/learn/{tag}l6_feedback.png")
        # lesson 7, 8
        await page.evaluate("()=>EUCA_LEARN.show('levels')"); await page.wait_for_timeout(300)
        await page.screenshot(path=f"shots/learn/{tag}l7_levels.png")
        await page.evaluate("()=>EUCA_LEARN.show('controls')"); await page.wait_for_timeout(300)
        await page.screenshot(path=f"shots/learn/{tag}l8_controls.png")
        # Tab focus trap check: press Tab 3 times, focus must stay in modal
        for i in range(3): await page.keyboard.press("Tab")
        print('focus in modal:', await page.evaluate("()=>document.getElementById('mdLearn').contains(document.activeElement)"), await page.evaluate("()=>document.activeElement.textContent.slice(0,30)"))
        # Escape closes
        await page.keyboard.press("Escape"); await page.wait_for_timeout(300)
        print('open after Esc:', await page.evaluate("()=>EUCA_LEARN.isOpen"), 'pill:', await page.evaluate("()=>document.querySelector('#mdLearnBtn .ml-progress-pill').textContent"), 'welcome display:', await page.evaluate("()=>getComputedStyle(document.getElementById('mdWelcome')).display"))
        print('progress:', await page.evaluate("()=>JSON.stringify(EUCA_LEARN.progress)"))
        # Now start a block and check coach + chip
        await page.keyboard.press("Space"); await page.wait_for_timeout(2500)
        for i in range(40):
            st = await page.evaluate("()=>State.status")
            if st == 'INPUT': break
            if st in ('AUTO_BRIEFING','UX_HOLD'): await page.evaluate("()=>completeFlowHold({acknowledged:true, source:'test'})")
            await page.wait_for_timeout(200)
        print('status:', await page.evaluate("()=>State.status"), 'coach:', await page.evaluate("()=>document.getElementById('mdCoach').className + ' | ' + document.querySelector('#mdCoach .ml-coach-text').textContent"), 'chip visible:', await page.evaluate("()=>document.getElementById('mdHelpChip').classList.contains('visible')"))
        await page.screenshot(path=f"shots/learn/{tag}ingame_coach.png")
        # click help chip
        await page.evaluate("()=>document.getElementById('mdHelpChip').click()"); await page.wait_for_timeout(600)
        print('after chip: paused', await page.evaluate("()=>State.paused"), 'overlay', await page.evaluate("()=>modalIsOpen('overlay')"), 'learn open', await page.evaluate("()=>EUCA_LEARN.isOpen"), 'lesson', await page.evaluate("()=>EUCA_LEARN.progress.last"))
        await page.screenshot(path=f"shots/learn/{tag}chip_open.png")
        await page.keyboard.press("Escape"); await page.wait_for_timeout(300)
        print('resume btn visible:', await page.evaluate("()=>getComputedStyle(document.getElementById('resumeBtn')).display"))
        await page.click("#resumeBtn"); await page.wait_for_timeout(600)
        print('status after resume:', await page.evaluate("()=>State.status"), 'paused', await page.evaluate("()=>State.paused"))
        print('ERRORS:', errs[:12])
        await b.close()
asyncio.run(main())
