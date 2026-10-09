import pathlib as _pl, os as _os
_ROOT = _pl.Path(__file__).resolve().parents[1]
for _d in ('shots/fork', 'shots/learn'): (_ROOT / _d).mkdir(parents=True, exist_ok=True)
_os.chdir(_ROOT)
import sys, json, asyncio, pathlib, collections
from playwright.async_api import async_playwright
STEP = open(_ROOT / 'bot.py').read().split('STEP_JS = r"""')[1].split('"""')[0]
CHECK = r"""
() => {
  const S = State, i = S.trialInfo || {};
  const q = document.getElementById('metaQuestion');
  const cs = q ? getComputedStyle(q) : null;
  const rect = q ? q.getBoundingClientRect() : null;
  const qText = q ? (q.querySelector('.meta-q')?.textContent || '').trim() : '';
  const qVisible = !!(q && cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0.2 && rect.width > 10 && rect.height > 10);
  const prompt = (document.getElementById('promptText')?.textContent || '').trim();
  const gc = document.getElementById('game-container');
  const stage = gc ? gc.querySelector('[data-g082-stage],[data-g083-stage],[data-spa02-stage],[data-spa03-stage],[data-spa04-stage],[data-spa05-stage]') : null;
  const banner = document.getElementById('mdMemBanner');
  const bannerVisible = !!(banner && banner.classList.contains('visible'));
  return {trials:S.stats.trials, bt:S.blockTrials, lvl:S.currentTrialLevel, kind:i.kind, panel:S.pendingPanel, qText:qText.slice(0,90), qVisible, prompt, stage:!!stage, owner:gc?.dataset.renderOwner||null, bannerVisible,
          hasPrompt:!!(i.delayedPrompt||i.question||i.relationQuestion), mem:!!i.memoryActive, memLevel:i.memLureTargetLevel||null, optionsN:Array.isArray(i.options)?i.options.length:0,
          metaOpts:(document.querySelector('#metaQuestion .meta-options')?.children.length)||0, single:(i.statsMode==='A'||i.renderMode==='single')};
}
"""
async def main():
    file=sys.argv[1]; n=int(sys.argv[2]); mode=sys.argv[3] if len(sys.argv)>3 else None; tag=sys.argv[4] if len(sys.argv)>4 else 'x'
    async with async_playwright() as p:
        b = await p.chromium.launch(); page = await (await b.new_context(viewport={"width":412,"height":880}, device_scale_factor=1)).new_page()
        errs=[]; page.on("pageerror", lambda e: errs.append('[pageerror] '+str(e)[:300]))
        page.on("console", lambda m: errs.append('[console.'+m.type+'] '+m.text[:200]) if m.type=='error' and 'willReadFrequently' not in m.text else None)
        await page.goto(pathlib.Path(file).resolve().as_uri()); await page.wait_for_timeout(1500)
        if mode: await page.evaluate("(m)=>{ if(window.EUCA_PROGRESSION) EUCA_PROGRESSION.setMode(m); }", mode)
        answered=0; seen=None; blanks=[]; metas=collections.Counter(); shots=set(); rows=[]
        for i in range(20000):
            if answered>=n: break
            st = await page.evaluate("()=>State.status")
            if st=='INPUT':
                info = await page.evaluate(CHECK)
                key=(info['trials'], info['bt'])
                if key!=seen:
                    seen=key
                    # give the DOM a moment then re-check
                    await page.wait_for_timeout(150)
                    info = await page.evaluate(CHECK)
                    rows.append(info)
                    lv = info['lvl']
                    if lv>=1: metas[lv]+=1
                    blank = (not info['qVisible'] or not info['qText']) and not info['single'] and not info['stage'] and info['owner']!='dom' and info['panel'] not in ('genpair','geninduct','xrep')
                    if blank:
                        blanks.append(info)
                        if len(blanks)<=4:
                            await page.screenshot(path=f"shots/fork/blank_{tag}_{len(blanks)}.png")
                    if lv==2 and 'meta2' not in shots:
                        shots.add('meta2'); await page.screenshot(path=f"shots/fork/first_meta2_{tag}.png"); print('first META2:', json.dumps(info)[:400])
                    if lv==1 and info['mem'] and 'meta1mem' not in shots:
                        shots.add('meta1mem'); await page.screenshot(path=f"shots/fork/first_meta1mem_{tag}.png"); print('first META1+mem:', json.dumps(info)[:400])
            r = await page.evaluate(STEP, {"pCorrect":0.97,"rtMs":600})
            if r.get('needKey'): await page.keyboard.press('Space')
            if r.get('action')=='answer': answered+=1
            await page.wait_for_timeout(30 if r.get('action')=='answer' else 60)
        print('answered', answered, 'meta counts', dict(metas), 'blank displays:', len(blanks))
        for bk in blanks[:8]: print('  BLANK', json.dumps(bk)[:300])
        print('errors', errs[:5])
        await b.close()
asyncio.run(main())
