"""Build "Eucalculia Fork vX.Y (base v7.1.22).html" from Alberto's v7.1.22 base
plus the fork patches (progression + learn + transfer + reading aids), appended at the end of the file.
Alberto's code is never edited in place."""
import pathlib, hashlib, datetime, re
ROOT = pathlib.Path(__file__).resolve().parent
BASE_VERSION = "v7.1.22"
base = (ROOT / "src" / f"{BASE_VERSION}.html").read_text(encoding="utf-8")
prog_js = (ROOT / "patch" / "md-progression.js").read_text(encoding="utf-8")
prog_css = (ROOT / "patch" / "md-style.css").read_text(encoding="utf-8")
learn_js = (ROOT / "patch" / "md-learn.js").read_text(encoding="utf-8")
learn_css = (ROOT / "patch" / "md-learn.css").read_text(encoding="utf-8")
xfer_js = (ROOT / "patch" / "md-transfer.js").read_text(encoding="utf-8")
xfer_css = (ROOT / "patch" / "md-transfer.css").read_text(encoding="utf-8")
read_js = (ROOT / "patch" / "md-reading.js").read_text(encoding="utf-8")
read_css = (ROOT / "patch" / "md-reading.css").read_text(encoding="utf-8")
for js in (prog_js, learn_js, xfer_js, read_js): assert "</script>" not in js
for css in (prog_css, learn_css, xfer_css, read_css): assert "</style>" not in css
fork = re.search(r'const FORK_VERSION = "([^"]+)"', prog_js).group(1)
assert re.search(r'const BASE_VERSION = "([^"]+)"', prog_js).group(1) == BASE_VERSION
base_sha = hashlib.sha256(base.encode("utf-8")).hexdigest().upper()
built = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
block = (
    f"\n<!-- ===== Eucalculia Fork v{fork} (base {BASE_VERSION}) · appended community patches ===== -->\n"
    f'<style id="euca-md-progression-style">\n{prog_css}\n</style>\n'
    f'<script id="euca-md-progression-patch">\n{prog_js}\n</script>\n'
    f'<style id="euca-md-learn-style">\n{learn_css}\n</style>\n'
    f'<script id="euca-md-learn-patch">\n{learn_js}\n</script>\n'
    f'<style id="euca-md-transfer-style">\n{xfer_css}\n</style>\n'
    f'<script id="euca-md-transfer-patch">\n{xfer_js}\n</script>\n'
    f'<style id="euca-md-reading-style">\n{read_css}\n</style>\n'
    f'<script id="euca-md-reading-patch">\n{read_js}\n</script>\n'
    '<div id="euca-md-progression-marker" hidden\n'
    f'  data-build="Eucalculia Fork v{fork}"\n'
    f'  data-version="{BASE_VERSION}-fork.{fork}"\n'
    f'  data-base="{BASE_VERSION}"\n'
    f'  data-base-sha256="{base_sha}"\n'
    f'  data-built-at="{built}"\n'
    '  data-credit="A fork of Eucalculia by Alberto Flaño Lombardo, built with his permission. Ideas and changes: mighty_elf and .da.rk. (Discord)."\n'
    '  data-changes="progression modes (baseline/staircase/rating), v6.8.88-style MEM cue restored, MEM banner hold, META¹ retained-value hint, adaptive META spacing, continuous META chain, Learn tutorial system (lessons, practice demos, welcome card, ? HELP chip, coach strip), level card with manual tier / META spacing / META layer, bigger LEFT/RIGHT stimuli, fair RT tile, peek on META questions, term hints & glossary, negation highlighting, bigger graph & paper-folding diagrams, distinct paper-folding candidates, build-a-pair witness in the correction card, nested yes/no answer line, transfer & mastery layer (short staircases, held-out probes, coverage cap, focus blocks, divided-attention marker, calendar & boosters)"></div>\n'
)
out_dir = ROOT / "dist"; out_dir.mkdir(exist_ok=True)
out = out_dir / f"Eucalculia Fork v{fork} (base {BASE_VERSION}).html"
out.write_text(base + block, encoding="utf-8")
(ROOT / "index.html").write_text(base + block, encoding="utf-8")   # same build, for GitHub Pages
print("wrote", out, "and index.html;", len(base + block), "chars; base sha256", base_sha[:16])
