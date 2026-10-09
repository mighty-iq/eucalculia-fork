"""Answer-tray overflow audit (Dark's report: "sometimes a bit out of frame at the bottom").
usage: python3 tray_audit.py <file.html> <width> <height> <trials> [tag] [coach=always|natural] [query]
Plays trials and, at every INPUT, measures whether anything inside the answer tray (#tray) is
clipped by the tray's own bounds or by the app/viewport bottom. Reports the worst cases per
(app mode, panel, coach visible)."""
import pathlib as _pl, os as _os
_ROOT = _pl.Path(__file__).resolve().parents[1]
for _d in ('shots/fork', 'shots/learn'): (_ROOT / _d).mkdir(parents=True, exist_ok=True)
_os.chdir(_ROOT)
import sys, json, asyncio, pathlib, collections, functools
print = functools.partial(print, flush=True)
from playwright.async_api import async_playwright
STEP = open(_ROOT / 'bot.py').read().split('STEP_JS = r"""')[1].split('"""')[0]
MEASURE = r"""
() => {
  const S = State, app = document.getElementById('app'), tray = document.getElementById('tray');
  if(!app || !tray) return null;
  const ar = app.getBoundingClientRect(), tr = tray.getBoundingClientRect();
  const cs = getComputedStyle(tray);
  const trayContentBottom = tr.bottom - parseFloat(cs.borderBottomWidth || 0) - parseFloat(cs.paddingBottom || 0);
  const trayInnerBottom = tr.bottom - parseFloat(cs.borderBottomWidth || 0);
  let maxBottom = -1e9, worst = null;
  const els = tray.querySelectorAll('button, canvas, input, select, textarea, [role="button"], .genPairSlot, .genL1Slot, .genInductSlot');
  for(const el of els){
    if(el.offsetParent === null && getComputedStyle(el).position !== 'fixed') continue;
    const r = el.getBoundingClientRect();
    if(r.width < 4 || r.height < 4) continue;
    if(r.bottom > maxBottom){ maxBottom = r.bottom; worst = (el.id || el.className || el.tagName).toString().slice(0, 40); }
  }
  const coach = document.getElementById('mdCoach');
  const coachVisible = !!(coach && coach.classList.contains('visible') && coach.offsetParent !== null);
  const modes = [...app.classList].filter(c => /-mode$/.test(c)).join('+') || 'plain';
  return {
    panel:S.pendingPanel, modes, kind:S.trialInfo && S.trialInfo.kind, lvl:S.currentTrialLevel, trials:S.stats.trials, bt:S.blockTrials,
    coachVisible, coachInTray:!!(coach && coach.parentNode === tray), coachH:coach ? Math.round(coach.getBoundingClientRect().height) : 0,
    trayH:Math.round(tr.height), trayVar:cs.getPropertyValue('--tray-h').trim(), scrollOver:Math.round(tray.scrollHeight - tray.clientHeight),
    overTray:Math.round(maxBottom - trayInnerBottom), overApp:Math.round(maxBottom - ar.bottom), overView:Math.round(maxBottom - innerHeight),
    appH:Math.round(ar.height), appBottom:Math.round(ar.bottom), vh:innerHeight, worst,
    gcH:Math.round(document.getElementById('game-container').getBoundingClientRect().height), reserved:app.classList.contains('md-has-coach')
  };
}
"""
async def main():
    file = sys.argv[1]; w = int(sys.argv[2]); h = int(sys.argv[3]); n = int(sys.argv[4])
    tag = sys.argv[5] if len(sys.argv) > 5 else 'x'; coach = sys.argv[6] if len(sys.argv) > 6 else 'natural'; query = sys.argv[7] if len(sys.argv) > 7 else ''
    async with async_playwright() as p:
        b = await p.chromium.launch(); page = await (await b.new_context(viewport={"width": w, "height": h}, device_scale_factor=1)).new_page()
        errs = []; page.on("pageerror", lambda e: errs.append(str(e)[:200]))
        await page.goto(pathlib.Path(file).resolve().as_uri() + query); await page.wait_for_timeout(1500)
        if await page.evaluate("()=>!!window.EUCA_PROGRESSION"): await page.evaluate("()=>EUCA_PROGRESSION.setMode('staircase')")
        # make the generative / constructive panels frequent so every tray layout gets measured
        await page.evaluate("()=>{ try { CONFIG.generativeL1InlineMinDLevel = 0; CONFIG.generativeL1InlineProbability = 0.5; CONFIG.generativeL1InlineCooldownTrials = 2; CONFIG.generativeL1InlineMaxPerBlock = 6; CONFIG.generativeInlineMinDLevel = 0; CONFIG.generativeInlineProbability = 0.5; CONFIG.generativeInlineCooldownTrials = 2; CONFIG.generativeInlineMaxPerBlock = 6; } catch(_){} }")
        worst = {}; seen = None; answered = 0; shots = set(); rows = []; flashH = {}; jumps = []; blockHeights = collections.defaultdict(set)
        t0 = await page.evaluate("()=>State.stats.trials")
        for i in range(60000):
            if (await page.evaluate("()=>State.stats.trials")) - t0 >= n: break
            st = await page.evaluate("()=>State.status")
            if st in ('FLASH', 'MASK', 'PREP'):
                fk = await page.evaluate("()=>[State.stats.trials+':'+State.blockTrials, Math.round(document.getElementById('game-container').getBoundingClientRect().height), State.progressHistory.length]")
                flashH[fk[0]] = fk[1]; blockHeights[fk[2]].add(fk[1])
            if st == 'INPUT':
                key = await page.evaluate("()=>State.stats.trials+':'+State.blockTrials+':'+State.pendingPanel")
                if key != seen:
                    seen = key
                    if coach == 'always':
                        await page.evaluate("()=>{ try { if(window.EUCA_LEARN){ const s = EUCA_LEARN.progress; s.seen = {}; s.coach = true; } setStatus('INPUT'); } catch(_){} }")
                    await page.wait_for_timeout(180)
                    m = await page.evaluate(MEASURE)
                    if m:
                        rows.append(m)
                        bid = await page.evaluate("()=>State.progressHistory.length")
                        blockHeights[bid].add(m['gcH'])
                        fh = flashH.get(key.rsplit(':', 1)[0])
                        if fh is not None and fh != m['gcH']: jumps.append((m['trials'], fh, m['gcH'], m['panel'], m['coachVisible']))
                        k = (m['modes'], m['panel'], m['coachVisible'])
                        over = max(m['overTray'], m['overApp'], m['overView'], m['scrollOver'])
                        if k not in worst or over > worst[k]['over']:
                            worst[k] = {'over': over, 'm': m}
                        if over > 1 and (k not in shots) and len(shots) < 8:
                            shots.add(k); await page.screenshot(path=f"shots/fork/tray_{tag}_{m['panel']}_{m['modes'][:18]}{'_coach' if m['coachVisible'] else ''}.png")
            r = await page.evaluate(STEP, {"pCorrect": 0.97, "rtMs": 600})
            if r.get('needKey'): await page.keyboard.press('Space')
            if r.get('action') == 'answer': answered += 1
            await page.wait_for_timeout(25 if r.get('action') == 'answer' else 50)
        print(f"{tag} {w}x{h} coach={coach} trials={len(rows)} panels={sorted(set(r['panel'] for r in rows))}")
        for k, v in sorted(worst.items(), key=lambda kv: -kv[1]['over']):
            m = v['m']
            print(f"  {'CLIP' if v['over'] > 1 else ' ok '} over={v['over']:>3}px  mode={k[0]:<28} panel={k[1]:<10} coach={k[2]!s:<5} trayH={m['trayH']} (--tray-h {m['trayVar']}) scrollOver={m['scrollOver']} overTray={m['overTray']} overApp={m['overApp']} overView={m['overView']} worst={m['worst']} coachInTray={m['coachInTray']}")
        print('  frame-height jumps FLASH→INPUT:', len(jumps), jumps[:6])
        print('  distinct frame heights per block:', {k: sorted(v) for k, v in list(blockHeights.items())[:12]})
        print('  errors', errs[:3])
        await b.close()
asyncio.run(main())
