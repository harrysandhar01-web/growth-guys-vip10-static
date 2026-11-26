"""Keep current VIP10 snapshot pages complete and progressively enhanced.

The source snapshot contains meaningful rendered HTML, but its Next.js runtime
is not a reproducible application build: the root Flight stream is truncated and
hydrating current owner-projected pages can erase their metadata/body. Preserve
the rendered HTML, schema, canonical-host redirect and archived record regions.
Replace only framework hydration with native copy/menu enhancement. Original
evidence and dated historical routes are never changed.
"""
from pathlib import Path
import importlib.util
import re
import sys

public = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[1] / 'public'
projector_path = Path(__file__).with_name('project-existing-current-record.py')
spec = importlib.util.spec_from_file_location('vip10_current_projector', projector_path)
projector = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = projector
spec.loader.exec_module(projector)
marker = 'data-vip10-static-runtime="1"'
runtime = Path(__file__).with_name('static-root-runtime.js').read_text()
assert '</script' not in runtime.lower()
scripts = re.compile(r'<script\b(?P<attrs>[^>]*)>(?P<body>[\s\S]*?)(?:</script>|$)', re.I)
changed = []

for relative in projector.routes(public):
    page = public / relative
    original = page.read_text()
    if marker in original:
        continue
    removed = [0]
    def keep_or_remove(match):
        if re.search(r'\bsrc=["\x27]/_next/', match['attrs']) or '__next_f' in match['body']:
            removed[0] += 1
            return ''
        return match[0]
    result = scripts.sub(keep_or_remove, original)
    result = re.sub(r'<link\b(?=[^>]*\bas=["\x27]script["\x27])(?=[^>]*\bhref=["\x27]/_next/)[^>]*>', '', result, flags=re.I)
    assert '__next_f' not in result, relative + ': incomplete Flight runtime remains'
    for pattern in (
        r'<tr\b[\s\S]*?</tr>',
        r'<section class="historical-record-refresh"[\s\S]*?</section>',
        r'<div class="verification-calendar"[\s\S]*?</div></div>',
        r'<!--\s*OWNER_RECORD_START\s*-->[\s\S]*?<!--\s*OWNER_RECORD_END\s*-->',
    ):
        assert re.findall(pattern, result) == re.findall(pattern, original), relative + ': historical/owner region changed'
    result = re.sub(r'</body>\s*</html>\s*$', '', result, flags=re.I).rstrip()
    result = re.sub(r'</html>\s*$', '', result, flags=re.I)
    result = re.sub(r'</body>\s*$', '', result, flags=re.I)
    result += '\n<script ' + marker + '>' + runtime + '</script>\n</body></html>\n'
    assert result.lower().rstrip().endswith('</body></html>')
    changed.append((page, result, removed[0]))

for page, result, count in changed:
    page.write_text(result)
    print(f'{page.relative_to(public)}: complete static page; replaced {count} hydration scripts')
print(f'{len(changed)} current-equivalent VIP10 pages repaired; static history/owner blocks retained')
