import pathlib as _pl, os as _os
_ROOT = _pl.Path(__file__).resolve().parents[1]
for _d in ('shots/fork', 'shots/learn'): (_ROOT / _d).mkdir(parents=True, exist_ok=True)
_os.chdir(_ROOT)
import sys, asyncio, pathlib
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); page = await (await b.new_context(viewport={"width":1200,"height":900})).new_page()
        errs=[]; page.on("pageerror", lambda e: errs.append(str(e)[:200]))
        await page.goto(pathlib.Path(sys.argv[1]).resolve().as_uri()); await page.wait_for_timeout(1200)
        await page.evaluate("()=>EUCA_LEARN.open('welcome')"); await page.wait_for_timeout(300)
        # focus Next lesson button and press Space
        await page.focus("#mdLearnFoot .ml-btn.primary"); await page.keyboard.press("Space"); await page.wait_for_timeout(300)
        print("after Space on Next:", await page.evaluate("()=>EUCA_LEARN.progress.last"), "status", await page.evaluate("()=>State.status"), "done:", await page.evaluate("()=>JSON.stringify(EUCA_LEARN.progress.done)"))
        # Enter on Previous
        await page.focus("#mdLearnFoot .ml-btn.ghost"); await page.keyboard.press("Enter"); await page.wait_for_timeout(300)
        print("after Enter on Prev:", await page.evaluate("()=>EUCA_LEARN.progress.last"))
        # shift-tab wraps inside modal
        await page.focus("#mdLearnClose"); await page.keyboard.press("Shift+Tab"); await page.wait_for_timeout(100)
        print("shift-tab from close → in modal:", await page.evaluate("()=>document.getElementById('mdLearn').contains(document.activeElement)"), await page.evaluate("()=>document.activeElement.textContent.trim().slice(0,20)"))
        # click on backdrop closes
        await page.mouse.click(20, 450); await page.wait_for_timeout(300)
        print("open after backdrop click:", await page.evaluate("()=>EUCA_LEARN.isOpen"))
        # Guide still works
        await page.click("#guideBtn"); await page.wait_for_timeout(500)
        print("guide open:", await page.evaluate("()=>modalIsOpen('guideModal')"))
        await page.keyboard.press("Escape"); await page.wait_for_timeout(500)
        print("guide open after Esc:", await page.evaluate("()=>modalIsOpen('guideModal')"))
        # About modal + learn independence
        await page.click("#mdAboutBtn"); await page.wait_for_timeout(200)
        print("about visible:", await page.evaluate("()=>document.getElementById('mdAboutModal').classList.contains('visible')"))
        await page.keyboard.press("Escape"); await page.wait_for_timeout(200)
        print("about visible after Esc:", await page.evaluate("()=>document.getElementById('mdAboutModal').classList.contains('visible')"))
        # profile switch keeps separate tutorial progress
        await page.evaluate("()=>{EUCA_LEARN.open('formats'); EUCA_LEARN.close();}")
        await page.click(".profileBtn[data-profile='2']"); await page.wait_for_timeout(2500); await page.wait_for_load_state(); await page.wait_for_timeout(800)
        print("P2 progress:", await page.evaluate("()=>JSON.stringify(EUCA_LEARN.progress)"), "pill:", await page.evaluate("()=>document.querySelector('#mdLearnBtn .ml-progress-pill').textContent"), "welcome:", await page.evaluate("()=>getComputedStyle(document.getElementById('mdWelcome')).display"))
        await page.click(".profileBtn[data-profile='1']"); await page.wait_for_timeout(2500); await page.wait_for_load_state(); await page.wait_for_timeout(800)
        print("P1 progress:", await page.evaluate("()=>JSON.stringify(EUCA_LEARN.progress)"), "pill:", await page.evaluate("()=>document.querySelector('#mdLearnBtn .ml-progress-pill').textContent"))
        # reload persistence
        await page.reload(); await page.wait_for_timeout(1500)
        print("after reload P1:", await page.evaluate("()=>JSON.stringify(EUCA_LEARN.progress)"))
        # start a block via Space with Learn closed
        await page.keyboard.press("Space"); await page.wait_for_timeout(1500)
        print("running:", await page.evaluate("()=>State.running"), "status:", await page.evaluate("()=>State.status"))
        print("errors:", errs)
        await b.close()
asyncio.run(main())
