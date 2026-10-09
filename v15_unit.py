"""Fork v1.5 — unit-style checks that need no long play: glossary decoration, negation
highlight, recursive-rule phrasing, build-a-pair domain messages, viewpoint restyle, seal."""
import pathlib as _pl, os as _os
_ROOT = _pl.Path(__file__).resolve().parents[1]
for _d in ('shots/fork', 'shots/learn'): (_ROOT / _d).mkdir(parents=True, exist_ok=True)
_os.chdir(_ROOT)
import sys, json, asyncio, pathlib, functools
print = functools.partial(print, flush=True)
from playwright.async_api import async_playwright
JS = r"""
() => {
  const out = {};
  out.reading = !!window.EUCA_READING; out.glossaryN = EUCA_READING.glossary.length;
  // 1. decoration on a synthetic question + options
  State.status = "INPUT"; State.trialInfo = {kind:"meta2", level:2};
  const q = document.querySelector('#metaQuestion .meta-q'), h = document.querySelector('#metaQuestion .meta-hint');
  q.textContent = "Which previous questions used same-named side readout (LEFT-with-LEFT or RIGHT-with-RIGHT)? Count down RIGHT according to what LEFT leaves after groups of 3. Is the sum not divisible by the smaller value?";
  h.textContent = "Neither previous question was a role-based task; only the first used side transfer."; h.style.display = "";
  setChoiceOptions([{text:"Neither previous question was a role-based task.", correct:false},{text:"Only the first previous question was a role-based task.", correct:true},{text:"Both used cross-pair side transfer.", correct:false},{text:"Exactly one finished in remainder state 1.", correct:false}]);
  EUCA_READING.decorate();
  out.qText = q.textContent; out.terms = [...q.querySelectorAll('.md-term')].map(t => t.dataset.term + ':' + t.textContent);
  out.negsQ = [...q.querySelectorAll('.md-neg')].map(t => t.textContent);
  out.negsHint = [...h.querySelectorAll('.md-neg')].map(t => t.textContent);
  out.hintTerms = [...h.querySelectorAll('.md-term')].map(t => t.dataset.term);
  out.optTerms = [...document.querySelectorAll('#choicepad .md-term')].map(t => t.dataset.term);
  out.optNegs = [...document.querySelectorAll('#choicepad .md-neg')].map(t => t.textContent);
  out.chip = document.getElementById('mdTermsChip') && document.getElementById('mdTermsChip').textContent;
  out.chipVisible = document.getElementById('mdTermsChip') && document.getElementById('mdTermsChip').classList.contains('visible');
  out.currentTerms = EUCA_READING.terms().map(t => t.key);
  // popover
  const first = q.querySelector('.md-term'); first.click();
  const pop = document.getElementById('mdTermPop'); out.popVisible = pop && pop.classList.contains('visible'); out.popTitle = pop && pop.querySelector('.md-term-pop-title').textContent; out.popDef = pop && pop.querySelector('.md-term-pop-def').textContent.slice(0, 80);
  document.body.click(); out.popAfterOutside = pop.classList.contains('visible');
  // panel
  document.getElementById('mdTermsChip').click(); const panel = document.getElementById('mdTermPanel'); out.panelVisible = panel && panel.classList.contains('visible'); out.panelRows = panel && panel.querySelectorAll('.md-term-row').length;
  document.getElementById('mdTermPanel').querySelector('.md-term-panel-close').click(); out.panelAfterClose = panel.classList.contains('visible');
  // idempotent re-decoration
  EUCA_READING.decorate(); out.termsAfterRedecorate = q.querySelectorAll('.md-term').length; out.qTextAfter = q.textContent;
  // 2. recursive rule phrasing
  out.ruleCounted = renderStructuredQuestionHTML("Run counted halving on LEFT. Is the final step-count exactly 2?", {recursiveTrace:{opId:"counted_iteration", seedLabel:"LEFT"}, catId:"rec_counted_halving_count_eq2"});
  out.ruleFa = renderStructuredQuestionHTML("Feed the LEFT digit first, then the RIGHT digit, to the division-by-3 machine. Does it finish in remainder state 1?", {recursiveTrace:{opId:"finite_automaton", seedLabel:"LEFT then RIGHT"}, catId:"rec_fa_div3_final_remainder1"});
  out.ruleFaParity = renderStructuredQuestionHTML("Feed the LEFT digit first, then the RIGHT digit, to the even/odd machine. Does it finish in the even state?", {recursiveTrace:{opId:"finite_automaton", seedLabel:"LEFT then RIGHT"}, catId:"rec_fa_parity_accept"});
  out.ruleOther = renderStructuredQuestionHTML("Start from LEFT. While the current value is even, divide it by 2; stop when it becomes odd. Were there more than one divide-by-2 step?", {recursiveTrace:{opId:"halving_to_odd", seedLabel:"LEFT"}, catId:"rec_halving_more_than_one"});
  // 3. domains
  const c1 = dPosnerCatById('sum_divisible_by_smaller'), c2 = dPosnerCatById('larger_multiple_of_gap');
  out.domain = {c1valid1_10:c1 && c1.valid ? c1.valid(1,10) : null, c1valid3_9:c1 && c1.valid ? c1.valid(3,9) : null, c1verify3_9:c1.verify(3,9), c1verify1_10:c1.verify(1,10), c2valid5_6:c2 && c2.valid ? c2.valid(5,6) : null, c2valid4_8:c2 && c2.valid ? c2.valid(4,8) : null, frozen:Object.isFrozen(c1)};
  State.trialInfo = {kind:"generative_inline", sourceCatId:"sum_divisible_by_smaller", catId:"sum_divisible_by_smaller", constructiveInvalidPair:{a:1, b:10, message:"That LEFT/RIGHT pair is not valid for this construction prompt."}};
  showMetaQuestion(0, "Choose LEFT and RIGHT so the answer is YES: Can the sum be divided by the smaller number with no remainder?", "That LEFT/RIGHT pair is not valid for this construction prompt.");
  out.domainHint = document.querySelector('#metaQuestion .meta-hint').textContent;
  // 4. viewpoint restyle
  const host = document.querySelector('#metaQuestion .meta-stimulus'); host.style.display = ""; host.innerHTML = '<svg viewBox="0 0 600 300"><text x="412" y="103" fill="#f3f0ff">Quarter-turn counterclockwise</text><text x="412" y="134" font-size="12" fill="#9b8cff">FROM BEHIND THE FIGURE</text><text x="412" y="170" fill="#aaa3c7">Apply it to every cube</text></svg>';
  EUCA_READING.restyle();
  const vt = [...host.querySelectorAll('text')].find(t => t.textContent === 'FROM BEHIND THE FIGURE'); out.viewpoint = {fill:vt.getAttribute('fill'), weight:vt.getAttribute('font-weight'), size:vt.getAttribute('font-size')};
  out.otherLine = [...host.querySelectorAll('text')].find(t => t.textContent === 'Apply it to every cube').getAttribute('fill');
  // 5. seal
  try { h37EnsureSummaryHero(); } catch(_){} EUCA_READING.seal(); const seal = document.getElementById('summaryCrest'); out.seal = {exists:!!seal, play:seal && seal.classList.contains('play'), ring:!!(seal && seal.querySelector('.md-seal-ring')), logos:document.querySelectorAll('#summaryCard img').length};
  // 6. toggles present in settings
  out.toggles = ['mdToggleNeg','mdToggleTerms','mdToggleSeal','mdTogglePeek'].map(id => !!document.getElementById(id));
  // 7. negation toggle off → no .md-neg on fresh decoration
  EUCA_READING.set('negations', false); q.textContent = "Is the sum not divisible by the smaller value?"; EUCA_READING.decorate(); out.negOff = q.querySelectorAll('.md-neg').length; EUCA_READING.set('negations', true);
  // 8. learn vocabulary lesson
  out.learnLessons = EUCA_LEARN.lessons.map(l => l.id);
  return out;
}
"""
async def main():
    file = sys.argv[1]
    async with async_playwright() as p:
        b = await p.chromium.launch(); page = await (await b.new_context(viewport={"width":1100,"height":860})).new_page()
        errs = []; page.on("pageerror", lambda e: errs.append(str(e)[:300]))
        page.on("console", lambda m: errs.append('[console.error] ' + m.text[:200]) if m.type == 'error' and 'willReadFrequently' not in m.text else None)
        await page.goto(pathlib.Path(file).resolve().as_uri()); await page.wait_for_timeout(1500)
        out = await page.evaluate(JS)
        for k, v in out.items():
            if k.startswith('rule'): print(k, '→', ('…' + v[v.find('Recursive rule'):v.find('Recursive rule')+260]) if isinstance(v, str) and 'Recursive rule' in v else str(v)[:120])
            else: print(k, '=', json.dumps(v, ensure_ascii=False)[:400])
        # open the vocabulary lesson and screenshot
        await page.evaluate("()=>EUCA_LEARN.open('vocabulary')"); await page.wait_for_timeout(400)
        await page.screenshot(path="shots/fork/v15_vocab.png")
        print('vocab rows', await page.evaluate("()=>document.querySelectorAll('.ml-vocab-row').length"))
        await page.evaluate("()=>{ document.querySelector('.ml-input').value='groups'; document.querySelector('.ml-input').dispatchEvent(new Event('input')); }")
        print('vocab search groups →', await page.evaluate("()=>[...document.querySelectorAll('.ml-vocab-row b')].map(b=>b.textContent)"))
        print('errors', errs[:5])
        await b.close()
asyncio.run(main())
