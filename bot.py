"""Automated Eucalculia player for progression testing.

usage: python3 bot.py <file.html> --trials N [--acc 0.9] [--rt 900] [--seed 1]
       [--shot out.png] [--mode original|staircase|rating] [--pre js] [--post js]
       [--log path] [--continuous] [--storage path]
Plays through blocks answering with the given accuracy, records level/state changes.
"""
import sys, json, asyncio, pathlib, random, time, argparse
from playwright.async_api import async_playwright

STEP_JS = r"""
(args) => {
  const {pCorrect, rtMs} = args;
  const S = State;
  const st = S.status;
  const out = {status: st, action: null};
  const badge = document.getElementById('levelBadge');
  const badgeVisible = badge && badge.classList.contains('visible') && badge.classList.contains('persistent');
  if (S.flowHold || st === 'AUTO_BRIEFING' || st === 'UX_HOLD') {
    if (typeof completeFlowHold === 'function') completeFlowHold({acknowledged:true, source:'bot'});
    out.action = 'flowhold';
    return out;
  }
  if (st === 'INPUT') {
    const info = S.trialInfo || {};
    const tv = S.targetValue;
    let val = tv;
    if (Math.random() > pCorrect) {
      // produce a plausible wrong answer
      if (S.pendingPanel === 'bool') val = !tv;
      else if (S.pendingPanel === 'choice') {
        const n = Array.isArray(info.options) ? info.options.length : 4;
        if (typeof tv === 'number') { val = (tv + 1 + Math.floor(Math.random()*(n-1))) % n; }
        else val = tv; // multi-select: give up, answer right
      } else if (typeof tv === 'number') { val = tv + (Math.random() < 0.5 ? 1 : -1); if (val < 0) val = tv + 1; }
    }
    out.action = 'answer';
    out.level = S.currentTrialLevel;
    out.kind = info.kind || null;
    out.catId = info.catId || (info.op && info.op.id) || null;
    out.panel = S.pendingPanel;
    out.correct = (val === tv) || (String(val) === String(tv));
    out.mem = !!info.memoryActive;
    out.memLabel = document.querySelector('#memoryCue .memory-text')?.textContent || null;
    out.memVisible = document.getElementById('memoryCue')?.classList.contains('visible') || false;
    out.question = (info.question || info.delayedPrompt || info.relationQuestion || '').slice(0,160);
    if (!args.dryRun) processInput(val, null);
    return out;
  }
  if (st === 'REVIEW') {
    const b = document.getElementById('reviewContinueBtn');
    if (b && b.offsetParent !== null) { b.click(); out.action = 'review_continue'; }
    else { out.action = 'review_space'; out.needKey = 'Space'; }
    return out;
  }
  if (st === 'SUMMARY') {
    const b = document.getElementById('continueBtn');
    if (b) { b.click(); out.action = 'summary_continue'; }
    return out;
  }
  if (st === 'MENU') {
    const b = document.getElementById('startBtn');
    if (b) { b.click(); out.action = 'start'; }
    return out;
  }
  if (badgeVisible) { badge.click(); out.action = 'badge_click'; return out; }
  return out;
}
"""

SNAP_JS = r"""
() => ({
  status: State.status,
  lvlD: State.levelByMode.D, lvlA: State.levelByMode.A,
  metaCap: (typeof effectiveMetaLevel==='function') ? effectiveMetaLevel() : null,
  autoPhase: State.autoPhase,
  et: Math.round(State.etByMode.D),
  trials: State.stats.trials, correct: State.stats.correct, streak: State.stats.streak,
  blockTrials: State.blockTrials, blockSize: State.blockSize,
  hud: document.getElementById('modeLabel')?.textContent,
  prog: (typeof window.EUCA_PROGRESSION==='object' && window.EUCA_PROGRESSION) ? window.EUCA_PROGRESSION.snapshot?.() : null
})
"""

async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('file'); ap.add_argument('--trials', type=int, default=60)
    ap.add_argument('--acc', type=float, default=0.9); ap.add_argument('--rt', type=int, default=900)
    ap.add_argument('--seed', type=int, default=1); ap.add_argument('--shot', default=None)
    ap.add_argument('--pre', default=None); ap.add_argument('--post', default=None)
    ap.add_argument('--log', default=None); ap.add_argument('--mode', default=None)
    ap.add_argument('--storage', default=None, help='persist localStorage json between runs')
    ap.add_argument('--quiet', action='store_true')
    ap.add_argument('--shot-on-mem', default=None, help='screenshot the first time a MEM cue is visible during INPUT')
    a = ap.parse_args()
    random.seed(a.seed)
    path = pathlib.Path(a.file).resolve()
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={"width": 1100, "height": 860})
        page = await ctx.new_page()
        logs = []
        page.on("console", lambda m: logs.append(f"[{m.type}] {m.text[:300]}") if (m.type in ('error','warning') and 'willReadFrequently' not in m.text) else None)
        page.on("pageerror", lambda e: logs.append(f"[pageerror] {str(e)[:300]}"))
        # restore storage
        if a.storage and pathlib.Path(a.storage).exists():
            data = json.loads(pathlib.Path(a.storage).read_text())
            await page.goto(path.as_uri())
            await page.evaluate("(d)=>{for(const k in d) localStorage.setItem(k,d[k]);}", data)
        await page.goto(path.as_uri())
        await page.wait_for_timeout(1500)
        if a.mode:
            await page.evaluate("(m)=>{ if(window.EUCA_PROGRESSION) window.EUCA_PROGRESSION.setMode(m); }", a.mode)
        if a.pre:
            r = await page.evaluate(a.pre); print("PRE:", json.dumps(r, default=str)[:2000])
        events = []
        answered = 0
        last_snap = await page.evaluate(SNAP_JS)
        t0 = time.time(); idle = 0
        while answered < a.trials and time.time() - t0 < 900:
            if a.shot_on_mem:
                probe = await page.evaluate(STEP_JS, {"pCorrect": a.acc, "rtMs": a.rt, "dryRun": True})
                if probe.get('action') == 'answer' and probe.get('mem'):
                    await page.wait_for_timeout(300)
                    await page.screenshot(path=a.shot_on_mem); a.shot_on_mem = None
            r = await page.evaluate(STEP_JS, {"pCorrect": a.acc, "rtMs": a.rt})
            if r.get('needKey'):
                await page.wait_for_timeout(200)
                await page.keyboard.press(r['needKey'])
            if r.get('action') == 'answer':
                answered += 1
                snap = await page.evaluate(SNAP_JS)
                ev = {"n": answered, **{k: r.get(k) for k in ('level','kind','catId','panel','correct','mem','memLabel','memVisible','question')}}
                ch = {}
                for k in ('lvlD','lvlA','metaCap','autoPhase','blockSize'):
                    if snap.get(k) != last_snap.get(k): ch[k] = (last_snap.get(k), snap.get(k))
                if ch: ev['change'] = ch
                ev['et'] = snap['et']; ev['prog'] = snap.get('prog')
                events.append(ev)
                if not a.quiet:
                    flag = '✓' if r.get('correct') else '✗'
                    memtxt = f" MEM[{r.get('memLabel')}]" if r.get('mem') else ''
                    chtxt = f"  >>> {ch}" if ch else ''
                    progtxt = f" prog={json.dumps(snap.get('prog'))[:90]}" if snap.get('prog') else ''
                    print(f"{answered:4d} L{r.get('level')} {flag} {r.get('panel'):7s} {str(r.get('catId'))[:34]:34s} et={snap['et']} lvlD={snap['lvlD']} meta={snap['metaCap']} {snap['hud']}{memtxt}{chtxt}{progtxt}")
                last_snap = snap
                if False:
                    await page.screenshot(path=a.shot_on_mem); a.shot_on_mem = None
                await page.wait_for_timeout(max(40, min(a.rt, 400)))
                idle = 0
            else:
                idle += 1
                await page.wait_for_timeout(120)
                if idle in (25, 60, 120, 200):
                    try:
                        await page.keyboard.press('Space')
                        await page.click('#game-container', timeout=1000)
                    except Exception: pass
                if idle > 400:
                    snap = await page.evaluate(SNAP_JS)
                    print("STUCK at", snap); break
        snap = await page.evaluate(SNAP_JS)
        print("FINAL:", json.dumps(snap, default=str)[:1500])
        if a.post:
            r = await page.evaluate(a.post); print("POST:", json.dumps(r, default=str)[:4000])
        if a.shot:
            await page.screenshot(path=a.shot)
        if a.storage:
            try:
                await page.evaluate("()=>{ try{ if(typeof _saveImmediate==='function') _saveImmediate(true,'bot_flush'); }catch(e){} try{ window.EUCA_PROGRESSION && window.EUCA_PROGRESSION.save(); }catch(e){} }")
            except Exception: pass
            data = await page.evaluate("()=>{const o={};for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);o[k]=localStorage.getItem(k);}return o;}")
            pathlib.Path(a.storage).write_text(json.dumps(data))
        if a.log:
            pathlib.Path(a.log).write_text(json.dumps(events, indent=0, default=str))
        await b.close()
        if logs: print("\n".join(logs[-30:]))

asyncio.run(main())
