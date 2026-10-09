# Eucalculia Fork

**A fork of Eucalculia v7.1.22 by Alberto Flaño Lombardo, built with his permission.**
Ideas and changes: **mighty_elf and .da.rk.** (Discord).

Eucalculia is a single-file cognitive trainer (numerical sense, relational reasoning, retained-pair META chains). This fork keeps Alberto's file untouched and appends four patch blocks on top of it: a progression layer, a tutorial, a transfer & mastery layer, and reading aids. Everything the fork adds comes from feedback in the community Discord.

Current build: **Eucalculia Fork v1.5 (base v7.1.22)** — in-app version string `v7.1.22-fork.1.5`.

## Play

- **Download and open:** [`dist/Eucalculia Fork v1.5 (base v7.1.22).html`](dist/) — one file, works offline in any modern browser. Progress is stored in the browser (per profile), not in the file.
- **Hosted (recommended on phones):** enable GitHub Pages for this repository (Settings → Pages → *Deploy from a branch* → `main`, folder `/ (root)`). `index.html` is the same build, so the game is at `https://<user>.github.io/<repo>/`. A page served over https can always be reloaded; a file opened from Android's Files app cannot (Chrome gets a one-time `content://` permission — see changelog v1.5 §14).

Where things are inside the app: **Settings → Progression** (modes Baseline / Staircase / Rating, continuous META chain, MEM banner hold, Peek, reading aids, bigger diagrams, stimulus size) · the **level card** on the menu (manual tier / META spacing / META layer) · **Learn** (ten lessons with live practice, Vocabulary, the `? HELP` button inside a block).

## What the fork adds

| Version | Added |
|---|---|
| v1.0 | Progression modes **Baseline / Staircase / Rating**; v6.8.88-style MEM cue restored with a banner hold; adaptive META spacing; continuous META chain. |
| v1.1 | **Learn** tutorial (lessons with live practice on the game's own renderers, welcome card, `? HELP`, coach strip); fork identity in the About card. |
| v1.2 | **Transfer & mastery layer:** short exposure staircases, held-out formats with probe blocks and a transfer index, coverage cap, focus blocks, divided-attention marker, calendar & boosters. |
| v1.3 | Blank first META¹ question fixed (base defect); level card with "what moves it now" and milestones; fair reaction-time tile; META¹ scope hint. |
| v1.4 / v1.4.1 | Bigger LEFT/RIGHT stimuli (Normal / Large / Max); manual tier and META spacing steps; **manual META layer** (Auto / No META / META¹ / META² / META³); auto block grows with the spacing; coach strip in its own row (fixes a clipped READY button on PC). |
| v1.5 | 🔍 **Peek** on META questions (counts half for the rating and as a *missed* memory for spacing and META unlocks); META²/³ say which answers they are about; the "weird hold" fixed; **term hints + glossary** (67 entries, Learn → Vocabulary) and **negation highlighting**; recursive-rule / finite-state-machine cards state the actual rule; build-a-pair domain messages ("divides by 1") and a **worked pair in the correction card**; rotation-card viewpoint in white; summary "seal" shine; **bigger directed graphs**; **paper-folding candidates in one row** and items with visually identical candidates (a base defect, 20–27 % of items) rebuilt before display; two-part-answer line under nested yes/no questions; Android: no gesture can trigger a page reload any more. |

Each version has a detailed changelog with the reasoning and the verification in [`changelog/`](changelog/). Previews in [`docs/previews/`](docs/previews/).

## How it is built

```
src/v7.1.22.html      Alberto's base — never edited
patch/md-progression.js + md-style.css     progression modes, META spacing, level card, Peek, manual META layer
patch/md-learn.js      + md-learn.css      Learn tutorial, coach strip, ? HELP
patch/md-transfer.js   + md-transfer.css   transfer & mastery layer
patch/md-reading.js    + md-reading.css    glossary, negations, diagrams, paper-folding repair, witness, nested hint
build.py               base + patches → dist/… and index.html
```

```
python3 build.py
```

Design rules the patches follow:

- Every hook is an **outermost wrapper** of a global function (`globalThis[name] = wrapped`, re-entry guard, the base's marker properties copied so its own installers do not re-wrap it; `reapplyWraps()` at boot/load). Nothing in `src/` is touched.
- The base's audit entry points (`runFeatureAudit`, the replay/projection audits) set a pass-through flag so Alberto's audits see the untouched behaviour.
- The spatial families (paper folding, rotations, nets, views…) are started by the base's coordinator outside the start-hook chain, so hooks that must see them go on `beginInputPhase`.
- Fork state lives in `localStorage` under `euca:md:*`, per profile. Public APIs for tests: `EUCA_PROGRESSION`, `EUCA_LEARN`, `EUCA_TRANSFER`, `EUCA_READING`.

## Testing

Headless Chromium through Playwright:

```
pip install playwright && python -m playwright install chromium
python3 bot.py "dist/Eucalculia Fork v1.5 (base v7.1.22).html" --trials 300 --acc 0.95 --mode staircase     # automated player: runtime errors, flow violations
python3 audit_run.py "dist/Eucalculia Fork v1.5 (base v7.1.22).html" out/fork.json                           # Alberto's full feature-audit suite + every handler
python3 tests/audit_diff.py "tests/audit_base (untouched v7.1.22).json" out/fork.json                         # diff against the untouched base
python3 tests/v15b_unit.py "dist/Eucalculia Fork v1.5 (base v7.1.22).html"                                    # unit checks for the v1.5 features
```

Run the test scripts from the repository root; screenshots land in `shots/` (ignored by git). `tests/` also holds the live-play checks (Peek accounting, manual META phases, Learn and keyboard, display, tray clipping, paper-folding candidates). Known noise when the whole audit suite runs at once: a few timing/sampling audits (mask symbol cloud, choice entropy, spatial families, visible-candidate induction) warn and pass when re-run alone.

## Known limits / ideas

- Separate progression axes for the memory load and the question complexity of META (the spacing staircase is the memory axis today; peeks only lower it).
- Plain YES/NO nested questions as a lower META level and the four-way "which branches hold" version higher — a generator-level change with its own chance level, evidence and audits.
- The paper-folding rebuild covers the full-unfold items of the visual-predict family; the masked-paper family already filters in the base.
- The glossary grows from screenshots: a term without an underline just needs an entry in `patch/md-reading.js`.

## Credits and use

Eucalculia and everything in `src/` is Alberto Flaño Lombardo's work, included here with his permission so the fork can be built and played; please respect his terms for it. The fork's additions (`patch/`, `build.py`, the test harness, the changelogs) are by mighty_elf and .da.rk., for the community.
