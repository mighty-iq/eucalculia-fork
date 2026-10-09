import pathlib as _pl, os as _os
_ROOT = _pl.Path(__file__).resolve().parents[1]
for _d in ('shots/fork', 'shots/learn'): (_ROOT / _d).mkdir(parents=True, exist_ok=True)
_os.chdir(_ROOT)
import sys, asyncio, pathlib, json
from playwright.async_api import async_playwright
OPTS = ["Both previous questions used same-named side readout (LEFT-with-LEFT or RIGHT-with-RIGHT).", "Only the second previous question used same-named side readout.", "Only the first previous question used same-named side readout.", "Neither previous question used same-named side readout."]
JS = r"""
(opts) => {
  State.mode = "D"; State.running = true; State.status = "INPUT"; State.pendingPanel = "choice";
  State.trialInfo = {kind:"meta2", level:2, options:opts.map((t,i)=>({text:t, correct:i===0})), question:"Which previous questions used same-named side readout (LEFT-with-LEFT or RIGHT-with-RIGHT)?", relationQuestion:"Which previous questions used same-named side readout (LEFT-with-LEFT or RIGHT-with-RIGHT)?"};
  State.currentTrialLevel = 2;
  try { document.getElementById('overlay').classList.remove('open'); } catch(_){}
  try { closeModal && closeModal('overlay'); } catch(_){}
  setChoiceOptions(State.trialInfo.options);
  showMetaQuestion(2, State.trialInfo.question, "", State.trialInfo.options);
  showPanel("choice");
  try { setStatus("INPUT"); } catch(_){}
  const coach = document.getElementById('mdCoach'); const cr = coach ? coach.getBoundingClientRect() : null;
  const tray = document.getElementById('tray').getBoundingClientRect(), gc = document.getElementById('game-container').getBoundingClientRect();
  window.__lay = {coachVisible:!!(coach && coach.classList.contains('visible')), coachParent:coach&&coach.parentNode.id, coachH:cr?Math.round(cr.height):0, coachTop:cr?Math.round(cr.top):0, trayTop:Math.round(tray.top), trayH:Math.round(tray.height), frameBottom:Math.round(gc.bottom), appH:Math.round(document.getElementById('app').getBoundingClientRect().height), hasClass:document.getElementById('app').classList.contains('md-has-coach')};
  const btns = [...document.querySelectorAll('.choiceBtn')].filter(b => b.style.display !== 'none');
  return {lay:window.__lay, btns:btns.map(b => { const r = b.getBoundingClientRect(); const t = b.querySelector('.choiceText, .choiceLabel, span:last-child') || b; const tr = t.getBoundingClientRect(); return {btnH:Math.round(r.height), btnW:Math.round(r.width), textH:Math.round(t.scrollHeight), textVisibleH:Math.round(tr.height), overflow:t.scrollHeight > r.height + 2, cls:t.className}; })};
}
"""
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        for f in sys.argv[1:]:
            for (w,h,tag) in [(412,880,'phone'),(1100,860,'desk')]:
                page = await (await b.new_context(viewport={"width":w,"height":h}, device_scale_factor=1)).new_page()
                await page.goto(pathlib.Path(f).resolve().as_uri()); await page.wait_for_timeout(1200)
                r = await page.evaluate(JS, OPTS)
                await page.wait_for_timeout(300)
                name = 'base' if 'v7.1.22.html' in f and 'Fork' not in f else 'fork'
                await page.screenshot(path=f"shots/fork/choice_{name}_{tag}.png")
                print(name, tag, json.dumps(r))
                await page.close()
        await b.close()
asyncio.run(main())
