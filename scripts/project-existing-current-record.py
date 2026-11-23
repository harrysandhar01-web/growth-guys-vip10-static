"""Repair current static projections from accepted JSON, without publishing evidence."""
from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo
from html import escape
import json
import re

PUBLIC = Path(__file__).resolve().parents[1] / 'public'
RECORD = json.loads((PUBLIC / 'api/current-record.json').read_text())
STATE = json.loads((PUBLIC / 'owner-publication-state.json').read_text())
assert RECORD['code'] == 'VIP10' and STATE['latest'] == RECORD['record_reference']
OBSERVED = datetime.fromisoformat(RECORD['observed_at'].replace('Z', '+00:00')).astimezone(ZoneInfo('America/Toronto'))
DATE = f'{OBSERVED:%B} {OBSERVED.day}, {OBSERVED.year}'
TIME = f"{DATE} at {OBSERVED.hour % 12 or 12}:{OBSERVED.minute:02d} {'a.m.' if OBSERVED.hour < 12 else 'p.m.'} {OBSERVED:%Z}"
SUMMARY = f"Current documented VIP10 record: {RECORD['product_name']}; observed {TIME}; subtotal CAD {RECORD['subtotal_cad']}; discount CAD {RECORD['discount_cad']}; displayed total CAD {RECORD['total_cad']}; {RECORD['status']}. {RECORD['scope']}"
PAGES = ['index.html', 'vip10/index.html', 'growth-guys-discount-code/index.html', 'does-vip10-work/index.html', 'how-we-verify/index.html', 'verification-archive/index.html']
CURRENT = ['current-record-refresh', 'verification-record-summary', 'current-verification-banner', 'search-evidence-module', 'verified-at-checkout', 'verification-artifact', 'artifact-', 'ledger-section']

def current_text(text):
    # Only call on current modules, never a historical row or calendar entry.
    text = re.sub(r'(?:October|November|Oct|Nov) \d{1,2}, 2026(?:,? (?:at )?(?:approximately )?\d{1,2}:\d{2}(?::\d{2})? (?:a\.m\.|p\.m\.|AM|PM) (?:EDT|EST))?', lambda m: TIME if re.search(r'\d:\d', m[0]) else DATE, text)
    text = re.sub(r'2026-(?:10|11)-\d{2}T[0-9:.]+(?:Z|[+-]\d{2}:\d{2})', RECORD['observed_at'], text)
    text = re.sub(r'(?:BPC-157 5mg - Single vial|TB-500 5mg — Single vial|Tirzepatide 10mg single vial|Retatrutide 10mg - Single vial|Semaglutide 5mg(?: —)? Single vial)', RECORD['product_name'], text)
    text = re.sub(r'/verification-archive(?:/vip10-observed-[^/"\s<]+/|#record-vip10-observed-[^"\s<]+)', RECORD['record_url'], text)
    text = re.sub(r'/owner-records/vip10-owner-[^/"\s<]+/', RECORD['record_url'], text)
    text = re.sub(r'/evidence/vip10-observed-[^/"\s<]+/', RECORD['evidence_url'], text)
    text = re.sub(r'/observations/2026-[^/"\s<]+/', RECORD['record_url'], text)
    text = text.replace('Verified at checkout · Dated record', 'Verified cart-only observation · Dated record')
    text = text.replace('Documented pre-payment checkout record; no purchase was made.', RECORD['scope'])
    text = text.replace('VIP10 was observed at the guest-cart stage. No identity, shipping address, payment information, checkout submission, or order was used. Payment-method-specific totals and location-specific taxes were not assessed.', RECORD['scope'])
    for old in ['32.40', '36.00', '45.00', '52.40', '57.60']:
        text = text.replace(old, RECORD['total_cad'])
    text = text.replace('80.00', RECORD['subtotal_cad']).replace('8.00', RECORD['discount_cad'])
    text = text.replace('5.00 on a CAD 50.00', f"{RECORD['discount_cad']} on a CAD {RECORD['subtotal_cad']}")
    text = text.replace('4.00 on a CAD 40.00', f"{RECORD['discount_cad']} on a CAD {RECORD['subtotal_cad']}")
    text = text.replace('$40.00 CAD', '$' + RECORD['subtotal_cad'] + ' CAD').replace('$4.00 CAD', '$' + RECORD['discount_cad'] + ' CAD')
    return text

def structured(data):
    if isinstance(data, dict):
        if data.get('@type') in ['WebPage', 'Article'] and ('url' in data or 'mainEntityOfPage' in data):
            data['description'] = SUMMARY
            data['dateModified'] = STATE['submittedAt']
            if 'Current VIP10' in data.get('name', ''):
                data.update(name=f'Current VIP10 verification evidence record · {DATE}', url='https://growthguysvip10.ca' + RECORD['record_url'], **{'@id': 'https://growthguysvip10.ca' + RECORD['record_url']})
        for key, value in list(data.items()):
            data[key] = structured(value)
    elif isinstance(data, list):
        data = [structured(x) for x in data]
    return data

def tree(value, active=False):
    if isinstance(value, list):
        # React elements carry their props in slot 3.
        if len(value) == 4 and value[0] == '$' and isinstance(value[3], dict):
            props = value[3]
            cls = props.get('className', '')
            active = active or any(token in cls for token in CURRENT)
            active = active or 'verification-summary' in cls or 'verification-dashboard-grid-status' in cls
            if value[1] == 'title': props['children'] = re.sub(r'Latest .*$', 'Latest ' + TIME, props.get('children', ''))
            if value[1] == 'meta' and props.get('name', props.get('property')) in ['description', 'og:description', 'twitter:description']:
                props['content'] = SUMMARY
            if value[1] == 'meta' and props.get('name') in ['verification:date', 'verification:publication-date', 'verification:record-reference']:
                props['content'] = {'verification:date': TIME, 'verification:publication-date': DATE, 'verification:record-reference': RECORD['record_reference']}[props['name']]
        return [tree(x, active) for x in value]
    if isinstance(value, dict):
        return {k: tree(v, active) for k, v in value.items()}
    if isinstance(value, str) and active:
        return current_text(value)
    if isinstance(value, str) and value.startswith('{"@context"'):
        return json.dumps(structured(json.loads(value)), ensure_ascii=False, separators=(',', ':'))
    return value

def flight(text):
    # Flight T records are byte-length framed; preserve historical records verbatim.
    raw = text.encode('utf-8'); out = bytearray(); pos = 0
    while pos < len(raw):
        match = re.match(rb'([0-9a-f]+):T([0-9a-f]+),', raw[pos:])
        if match:
            begin = pos + match.end(); end = begin + int(match[2], 16)
            payload = raw[begin:end]
            try:
                # Older snapshots can carry a stale length after Unicode edits.
                obj, count = json.JSONDecoder().raw_decode(raw[begin:].decode())
                payload = raw[begin:begin + len(raw[begin:].decode()[:count].encode())]
                end = begin + len(payload)
                if isinstance(obj, dict) and '@context' in obj:
                    payload = json.dumps(structured(obj), ensure_ascii=False, separators=(',', ':')).encode()
            except (ValueError, UnicodeDecodeError): pass
            out.extend(match[1] + b':T' + format(len(payload), 'x').encode() + b',' + payload)
            pos = end
            continue
        end = raw.find(b'\n', pos)
        if end == -1:
            out.extend(raw[pos:]); break  # Existing root truncation is unrelated.
        line = raw[pos:end]
        match = re.match(rb'([0-9a-f]+):(.*)', line)
        if match:
            try:
                value = json.loads(match[2])
                changed = tree(value)
                if changed != json.loads(match[2]):
                    line = match[1] + b':' + json.dumps(changed, ensure_ascii=False, separators=(',', ':')).encode()
            except (ValueError, UnicodeDecodeError): pass
        out.extend(line + b'\n'); pos = end + 1
    return out.decode()

for relative in PAGES:
    path = PUBLIC / relative
    original = path.read_text(); html = original
    head, body = html.split('</head>', 1)
    head = re.sub(r'(<title>)(.*?)(</title>)', lambda m: m[1] + re.sub(r'Latest .*$', 'Latest ' + TIME, m[2]) + m[3], head)
    def meta(match):
        tag = match[0]; key = re.search(r'(?:name|property)="([^"]+)"', tag)
        if not key: return tag
        value = None
        if key[1] in ['description', 'og:description', 'twitter:description']: value = SUMMARY
        elif key[1] == 'verification:publication-date': value = DATE
        elif key[1] == 'verification:date': value = TIME
        elif key[1] == 'verification:record-reference': value = RECORD['record_reference']
        elif key[1] in ['og:title', 'twitter:title']:
            old = re.search(r'content="([^"]*)"', tag)[1]
            value = re.sub(r'Latest .*$', 'Latest ' + TIME, old)
        return re.sub(r'content="[^"]*"', lambda _: 'content="' + escape(value, quote=True) + '"', tag) if value is not None else tag
    head = re.sub(r'<meta\b[^>]*>', meta, head)
    for key, value in [('verification:date', TIME), ('verification:record-reference', RECORD['record_reference'])]:
        if f'name="{key}"' not in head: head += f'<meta name="{key}" content="{escape(value, quote=True)}"/>'
    def section(match):
        block = match[0]; opening = block.split('>', 1)[0]
        if any(token in opening for token in CURRENT): return current_text(block)
        if 'hero hero-cinematic' in opening: return current_text(block)
        if 'verification-dashboard' in opening:
            prefix, separator, suffix = block.partition('<div class="verification-calendar-card"')
            return current_text(prefix) + separator + suffix
        if 'live-history' in opening:
            prefix, separator, suffix = block.partition('<table')
            # Do not modify dated notices or rows in the historical ledger.
            prefix = re.sub(r'(<div class="verification-summary"[^>]*>)(.*?)(</div></div>)', lambda m: current_text(m[0]), prefix, flags=re.S)
            return prefix + separator + suffix
        return block
    body = re.sub(r'<section\b[^>]*>[\s\S]*?</section>', section, body)
    # Links explicitly labelled current outside the record modules also follow JSON.
    body = re.sub(r'<a\b[^>]*href="[^"]+"[^>]*>[\s\S]*?</a>', lambda m: current_text(m[0]) if re.search(r'(?:current VIP10|current record|VIP10 current|current VIP10 record)', re.sub('<[^>]*>', '', m[0]), re.I) else m[0], body)
    def ld(match):
        return match[1] + json.dumps(structured(json.loads(match[2])), ensure_ascii=False, separators=(',', ':')) + match[3]
    body = re.sub(r'(<script[^>]*type="application/ld\+json"[^>]*>)(.*?)(</script>)', ld, body, flags=re.S)
    def payload(match):
        raw = match[2]
        decoded = json.loads(raw)
        return match[1] + json.dumps(flight(decoded), ensure_ascii=False) + match[3]
    body = re.sub(r'(self\.__next_f\.push\(\[1,)("(?:[^"\\]|\\.)*")(\]\)</script>)', payload, body)
    if relative == 'index.html' and 'self.__next_f.push([1,' in body and not body.rstrip().endswith('</html>'):
        prefix, raw = body.split('self.__next_f.push([1,', 1)
        decoded = json.loads(raw + '"')
        body = prefix + 'self.__next_f.push([1,' + json.dumps(flight(decoded), ensure_ascii=False)[:-1]
    html = head + '</head>' + body
    if html != original:
        path.write_text(html); print(relative)
