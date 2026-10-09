import pathlib as _pl, os as _os
_ROOT = _pl.Path(__file__).resolve().parents[1]
for _d in ('shots/fork', 'shots/learn'): (_ROOT / _d).mkdir(parents=True, exist_ok=True)
_os.chdir(_ROOT)
import sys, json, asyncio, pathlib, collections
from playwright.async_api import async_playwright
STEP = open(_ROOT / 'bot.py').read().split('STEP_JS = r"""')[1].split('"""')[0]
PRE = r"""
() => { const S=State, i=S.trialInfo||{}; const X=EUCA_TRANSFER; const d=X.da;
  const out = {st:S.status, blockTrials:S.blockTrials, trials:S.stats.trials, et:Math.round(currentET()), base:Math.round(S.etByMode.D), baseA:null, lvl:S.currentTrialLevel, kind:i.kind, reps:[i.repA,i.repB,i.rep].filter(Boolean), hud:document.getElementById('modeLabel')?.textContent, block:X.block?{probe:X.block.probe,focus:X.block.focus}:null, da:d?{shown:d.shown, answered:d.answered, idx:d.idx, resolved:!!d.resolved}:null, panel:S.pendingPanel, single:(i.statsMode==='A'||i.renderMode==='single')};
  return out; }
"""
async def main():
    file = sys.argv[1]; n = int(sys.argv[2]); mode = sys.argv[3] if len(sys.argv)>3 else 'staircase'
    async with async_playwright() as p:
        b = await p.chromium.launch(); page = await (await b.new_context(viewport={"width":1100,"height":860})).new_page()
        errs=[]; page.on("pageerror", lambda e: errs.append('[pageerror] '+str(e)[:300]))
        page.on("console", lambda m: errs.append('[console.'+m.type+'] '+m.text[:300]) if m.type in ('error','warning') and 'willReadFrequently' not in m.text else None)
        await page.goto(pathlib.Path(file).resolve().as_uri()); await page.wait_for_timeout(1500)
        print('boot:', await page.evaluate("()=>({xfer:typeof EUCA_TRANSFER, sec:!!document.getElementById('mdTransferSection'), toggles:EUCA_TRANSFER.toggles, hold:EUCA_TRANSFER.holdout()})"))
        await page.evaluate("(m)=>EUCA_PROGRESSION.setMode(m)", mode)
        await page.evaluate("()=>EUCA_TRANSFER.set('da', true)")
        answered=0; rows=[]; seen_trial=None; blocks=collections.OrderedDict(); daAns=0; daHit=0; summaries=[]
        for i in range(12000):
            if answered>=n: break
            st = await page.evaluate("()=>State.status")
            if st=='INPUT':
                info = await page.evaluate(PRE)
                key=(info['trials'], info['blockTrials'])
                if key!=seen_trial:
                    seen_trial=key
                    rows.append(info)
                    if info['da'] and info['da']['shown'] and info['da']['answered'] is None:
                        import random
                        idx = info['da']['idx'] if random.random()<0.85 else (info['da']['idx']+1)%8
                        await page.evaluate("(k)=>EUCA_TRANSFER.daAnswer(k)", idx); daAns+=1; daHit += (idx==info['da']['idx'])
                        await page.wait_for_timeout(30)
            if st=='SUMMARY':
                txt = await page.evaluate("()=>({p:document.getElementById('mdSummaryLine')?.textContent, x:document.getElementById('mdTransferSummary')?.textContent})")
                if not summaries or summaries[-1]!=txt: summaries.append(txt)
            r = await page.evaluate(STEP, {"pCorrect":0.93,"rtMs":600})
            if r.get('needKey'): await page.keyboard.press('Space')
            if r.get('action')=='answer': answered+=1
            await page.wait_for_timeout(35 if r.get('action')=='answer' else 80)
        snap = await page.evaluate("()=>EUCA_TRANSFER.snapshot()")
        print('answered', answered, 'da answered', daAns, 'da hits', daHit)
        print('snapshot:', json.dumps(snap, default=str)[:1500])
        # ET multipliers at block starts (relational only)
        rel=[r for r in rows if r['lvl']==0 and not r['single'] and r['kind'] in ('posner','scalar_witness_inline')]
        by_bt=collections.defaultdict(list)
        for r in rel: by_bt[min(r['blockTrials'],5)].append(r['et']/max(1,r['base']))
        print('ET/base by block trial index (relational):', {k: round(sum(v)/len(v),2) for k,v in sorted(by_bt.items())})
        hud=set(r['hud'] for r in rows if r['block'] and (r['block']['probe'] or r['block']['focus']))
        print('HUD during probe/focus blocks:', list(hud)[:6])
        probe_rows=[r for r in rel if r['block'] and r['block']['probe']]
        hold=set(snap['holdout'])
        bad=[r['reps'] for r in probe_rows if not all(x in hold for x in r['reps'])]
        print('probe trials:', len(probe_rows), 'non-holdout reps in probe trials:', bad[:5])
        train_rows=[r for r in rel if r['block'] and not r['block']['probe']]
        leak=[r['reps'] for r in train_rows if any(x in hold for x in r['reps'])]
        print('training trials:', len(train_rows), 'holdout leaks in training:', len(leak), leak[:3])
        print('summaries:'); [print(' ', s) for s in summaries[-6:]]
        print('ERRORS:', errs[:10])
        await page.evaluate("()=>{document.getElementById('pauseBtn').click();}"); await page.wait_for_timeout(600)
        await page.evaluate("()=>{document.getElementById('settingsPanel').open=true; document.getElementById('mdTransferSection').scrollIntoView({block:'center'})}"); await page.wait_for_timeout(300)
        await page.screenshot(path='shots/fork/xfer_settings.png')
        await b.close()
asyncio.run(main())
