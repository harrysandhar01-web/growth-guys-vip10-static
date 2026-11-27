"""Project accepted current JSON into existing public routes; never publish evidence.

Usage: python3 scripts/project-existing-current-record.py [--public-dir PATH] [--dry-run]
Only HTML routes with existing current modules are considered. Accepted JSON, owner
blocks, dated archive routes, original evidence, rows and calendars are read-only.
"""
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from html import escape, unescape
from html.parser import HTMLParser
from pathlib import Path
from zoneinfo import ZoneInfo
import argparse
import json
import re

BASE_PAGES = (
    'index.html', 'vip10/index.html', 'growth-guys-discount-code/index.html',
    'does-vip10-work/index.html', 'how-we-verify/index.html',
    'verification-archive/index.html',
)
MODULES = {
    'current-record-refresh', 'verification-record-summary',
    'current-verification-banner', 'search-evidence-module',
    'verification-artifact', 'ledger-section', 'evidence-visual-summary',
    'verification-dashboard-grid-status', 'verification-summary',
    'system-status-grid', 'status-band', 'btc-savings-notice',
}
PROTECTED_CLASSES = {
    'historical-record-refresh', 'verification-calendar',
    'verification-calendar-card', 'verification-calendar-day',
}
VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
        'link', 'meta', 'param', 'source', 'track', 'wbr'}
OWNER = re.compile(r'<!--\s*OWNER_RECORD_START\s*-->[\s\S]*?<!--\s*OWNER_RECORD_END\s*-->')
HOST = 'https://growthguysvip10.ca'


class Raw(str):
    """An unchanged literal from the original HTML, not generated text."""


def dumps(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))


@dataclass
class Element:
    tag: str
    props: dict = field(default_factory=dict)
    key: object = None
    opening: str = None
    closing: str = None
    original_props: dict = None

    @property
    def children(self):
        value = self.props.get('children', [])
        return value if isinstance(value, list) else [value]

    @property
    def classes(self):
        return set(str(self.props.get('className', '')).split())

    def put(self, *children):
        if isinstance(self.key, str) and self.key == plain(self.children):
            self.key = plain(children)
        self.props['children'] = list(children)


def el(tag, *children, **props):
    props['children'] = list(children)
    return Element(tag, props)


def descendants(node):
    for child in node.children:
        if isinstance(child, Element):
            yield child
            yield from descendants(child)


def plain(value):
    if isinstance(value, Element):
        return ''.join(plain(x) for x in value.children)
    if isinstance(value, (list, tuple)):
        return ''.join(plain(x) for x in value)
    return unescape(str(value)) if value is not None else ''


def decode(value):
    if isinstance(value, list):
        if len(value) == 4 and value[0] == '$' and isinstance(value[3], dict):
            return Element(value[1], {k: decode(v) for k, v in value[3].items()}, value[2])
        return [decode(x) for x in value]
    if isinstance(value, dict):
        return {k: decode(v) for k, v in value.items()}
    return value


def encode(value):
    if isinstance(value, Element):
        return ['$', value.tag, value.key, {k: encode(v) for k, v in value.props.items()}]
    if isinstance(value, list):
        return [encode(x) for x in value]
    if isinstance(value, dict):
        return {k: encode(v) for k, v in value.items()}
    return value


class Document(HTMLParser):
    """Keep original tag spelling/attributes/text; unlike a DOM serializer, no churn."""
    def __init__(self, source):
        super().__init__(convert_charrefs=False)
        self.source = source
        self.lines = [0] + [m.end() for m in re.finditer('\n', source)]
        self.root = Element('document', {'children': []})
        self.stack = [self.root]
        self.feed(source)
        self.close()

    def literal(self):
        line, col = self.getpos()
        start = self.lines[line - 1] + col
        return self.source[start:self.source.find('>', start) + 1]

    def add(self, value):
        if isinstance(value, str):
            value = Raw(value)
        self.stack[-1].props['children'].append(value)

    def handle_starttag(self, tag, attrs):
        props = {('className' if k == 'class' else k): v for k, v in attrs}
        original_props = dict(props)
        props['children'] = []
        node = Element(tag, props, opening=self.get_starttag_text(),
                       closing='', original_props=original_props)
        self.add(node)
        if tag not in VOID:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in VOID:
            self.stack.pop()

    def handle_endtag(self, tag):
        for index in range(len(self.stack) - 1, 0, -1):
            if self.stack[index].tag == tag:
                self.stack[index].closing = self.literal()
                del self.stack[index:]
                return
        self.add(self.literal())

    def handle_data(self, text):
        self.add(text)

    def handle_entityref(self, name):
        self.add('&' + name + ';')

    def handle_charref(self, name):
        self.add('&#' + name + ';')

    def handle_comment(self, text):
        self.add('<!--' + text + '-->')

    def handle_decl(self, text):
        self.add('<!' + text + '>')


def render(value):
    if isinstance(value, list):
        return ''.join(render(x) for x in value)
    if not isinstance(value, Element):
        return str(value) if isinstance(value, Raw) else escape(str(value), quote=False) if value is not None else ''
    if value.tag == 'document':
        return render(value.children)
    props = {k: v for k, v in value.props.items() if k != 'children'}
    if value.opening is not None:
        opening = value.opening
        for key, item in props.items():
            if value.original_props.get(key) == item:
                continue
            attr = 'class' if key == 'className' else key
            replacement = attr + '="' + escape(str(item), quote=True) + '"'
            pattern = re.compile(r'\b' + re.escape(attr) + r'\s*=\s*(?:"[^"]*"|\x27[^\x27]*\x27)', re.I)
            if pattern.search(opening):
                opening = pattern.sub(lambda _: replacement, opening, count=1)
            else:
                opening = re.sub(r'(/?>)$', lambda m: ' ' + replacement + m[1], opening)
        closing = value.closing
    else:
        opening = '<' + value.tag + ''.join(
            ' ' + ('class' if k == 'className' else k) + '="' + escape(str(v), quote=True) + '"'
            for k, v in props.items()) + '>'
        closing = '' if value.tag in VOID else '</' + value.tag + '>'
    if value.tag == 'script':
        return opening + ''.join(str(x) for x in value.children) + closing
    return opening + render(value.children) + closing


class Projection:
    def __init__(self, record, state, relative):
        assert record['code'] == 'VIP10' and state['latest'] == record['record_reference']
        self.record, self.state, self.relative = record, state, relative
        self.checkout = record.get('observation_type') == 'checkout' or record['status'] == 'Verified at checkout'
        self.observed = datetime.fromisoformat(record['observed_at'].replace('Z', '+00:00')).astimezone(ZoneInfo('America/Toronto'))
        self.date = f'{self.observed:%B} {self.observed.day}, {self.observed.year}'
        self.time = f"{self.date} at {self.observed.hour % 12 or 12}:{self.observed.minute:02d}:{self.observed.second:02d} {'a.m.' if self.observed.hour < 12 else 'p.m.'} {self.observed:%Z}"
        self.product = record['product_name']
        self.subtotal = self.amount('subtotal_cad')
        self.discount = self.amount('discount_cad')
        self.total = self.amount('total_cad')
        self.method = 'Checkout verification' if record['method'] == 'Automated laptop checkout verification' else record['method']
        self.status = record['status']
        self.scope = record['scope'].replace('Automated verification stopped at the checkout/payment screen.', 'Checked before payment.')
        self.benefit = f'VIP10 saved CAD {self.discount} (10%) on {self.product}.'
        self.breakdown = f'CAD {self.subtotal} item subtotal − CAD {self.discount} VIP10 code discount'
        if self.checkout:
            # These are separate checkout fields, not a product-price substitution.
            self.shipping = self.amount('shipping_cad')
            self.adjustment = self.amount('currency_fee_discount_cad')
            self.charge = self.amount('charge_usd')
            self.bitcoin = self.amount('bitcoin_adjustment_cad', '0.00')
            self.breakdown += f' + CAD {self.shipping} shipping − CAD {self.adjustment} separate currency-fee adjustment = CAD {self.total} final checkout total. Displayed charge: USD {self.charge}. Bitcoin adjustment: CAD {self.bitcoin}.'
            self.summary = f'VIP10: 10% off {self.product}, verified at checkout {self.date}. CAD {self.total} final total includes shipping and a separate adjustment.'
        else:
            self.breakdown += f'; CAD {self.total} displayed total. Separate Bitcoin adjustment: CAD {self.amount("bitcoin_adjustment_cad", "0.00")}.'
            self.summary = f'VIP10: 10% off {self.product}, cart observed {self.date}. CAD {self.total} displayed total; see the separate adjustment and evidence.'
        self.title = ''
        self.answers = {
            'What is the Growth Guys discount code?': self.benefit + ' ' + self.summary,
            'What does verified at checkout mean here?': f'{self.method} retained the code response, item, discount and final order-summary fields on {self.time}. {self.scope} This is evidence for that session, not a guarantee for every product or future checkout.',
            'How should a reader use a current verification record?': self.benefit + ' Observed ' + self.time + '. ' + self.breakdown + ' Compare the retained record with the merchant’s live checkout and current terms for your own session.',
        }

    def amount(self, key, default=None):
        value = self.record.get(key, default)
        if value is None:
            raise ValueError('Accepted current record is missing ' + key)
        return format(Decimal(str(value)), '.2f')

    def clean_title(self, value):
        value = value.split(' | The VIP10 Verification Desk')[0]
        value = re.sub(r'\s*[·|—]\s*Latest .*$', '', value)
        value = re.sub(r'\s*[·|]\s*(?:October|November) \d{1,2}, 2026.*$', '', value)
        if '10% Off Site-wide' in value or '10% Off Site-wide,…' in value:
            value = 'Growth Guys VIP10 — 10% item discount verified at checkout' if self.checkout else 'Growth Guys VIP10 — dated cart discount evidence'
        if self.checkout:
            value = value.replace('documented cart results', 'documented checkout evidence')
            value = value.replace('What a dated cart record can show', '10% item discount checkout evidence')
        return value

    def record_link(self, href):
        if re.search(r'/(?:owner-records|observations)/|/verification-archive(?:/[^/]+/|#record-)', str(href)):
            return self.record['record_url']
        if str(href).startswith('/evidence/'):
            return self.record['evidence_url']
        return href

    def links(self, node):
        found = []
        for child in descendants(node):
            if child.props.get('href'):
                child.props['href'] = self.record_link(child.props['href'])
                found.append(child)
        if not any(x.props.get('href') == self.record['record_url'] for x in found):
            found.insert(0, el('a', 'View current VIP10 record', href=self.record['record_url'], className='text-link'))
        return found

    def card(self, node):
        links = self.links(node)
        heading_id = node.props.get('aria-labelledby')
        heading = el('h2', 'VIP10: 10% item discount verified at checkout' if self.checkout else 'VIP10: dated cart discount evidence', **({'id': heading_id} if heading_id else {}))
        node.put(el('div', heading,
                    el('p', el('strong', self.status + ' · Dated record')),
                    el('p', self.benefit),
                    el('p', self.method + ' · ', el('time', self.time, dateTime=self.record['observed_at'])),
                    el('p', self.breakdown), el('p', self.scope),
                    el('div', *links, className='reader-notice-links'),
                    className='current-projection-card'))
        node.props['data-observed-at'] = self.record['observed_at']

    def structured(self, value):
        if isinstance(value, list):
            return [self.structured(x) for x in value]
        if not isinstance(value, dict):
            return value
        result = dict(value)
        kind = result.get('@type')
        if kind in ('WebPage', 'Article', 'WebSite'):
            if kind != 'WebSite' or result.get('url') == HOST:
                result['description'] = self.summary
                result['dateModified'] = self.state['submittedAt']
            for key in ('headline', 'name'):
                if isinstance(result.get(key), str) and ('VIP10' in result[key] or 'Growth Guys' in result[key]):
                    result[key] = self.clean_title(result[key])
            identity = str(result.get('@id', ''))
            if 'Current VIP10' in str(result.get('name', '')) or re.search(r'/(?:owner-records|observations)/', identity):
                result.update({'name': 'Current VIP10 checkout evidence · ' + self.date if self.checkout else 'Current VIP10 cart evidence · ' + self.date,
                               '@id': HOST + self.record['record_url'], 'url': HOST + self.record['record_url'],
                               'description': self.summary, 'dateModified': self.state['submittedAt']})
        if kind == 'Question' and result.get('name') in self.answers:
            result['acceptedAnswer'] = {'@type': 'Answer', 'text': self.answers[result['name']]}
        if kind == 'ListItem' and result.get('item') == HOST + '/' + ('' if self.relative == 'index.html' else self.relative.removesuffix('index.html')):
            result['name'] = self.title
        return {k: self.structured(v) for k, v in result.items()}

    def policy(self, node, active=False, parent_classes=None):
        parent_classes = parent_classes or set()
        classes = node.classes
        if node.tag == 'tr' or classes & PROTECTED_CLASSES or node.props.get('aria-labelledby') == 'october-10-status-heading':
            return node
        active = active or bool(classes & MODULES) or 'verified-at-checkout' in classes
        if node.props.get('href') and re.search(r'current VIP10|current record|VIP10 current', plain(node), re.I):
            node.props['href'] = self.record_link(node.props['href'])
        if active:
            for key in ('href',):
                if key in node.props:
                    node.props[key] = self.record_link(node.props[key])
            for key in ('data-observed-at', 'dateTime', 'datetime'):
                if key in node.props:
                    node.props[key] = self.record['observed_at']
        if classes & {'current-record-refresh', 'verification-record-summary', 'current-verification-banner', 'search-evidence-module'}:
            self.card(node)
            return node
        if node.tag == 'title':
            node.put(self.title + ' | The VIP10 Verification Desk')
        if node.tag == 'section' and any(isinstance(x, Element) and x.tag == 'strong' and plain(x).startswith('Latest verified checkout record —') for x in node.children):
            self.card(node)
            return node
        if node.tag in ('h1', 'strong', 'a') or (str(node.tag).startswith('$L') and node.props.get('href')):
            text = plain(node)
            if '10% Off Site-wide' in text and not any(isinstance(x, Element) for x in node.children):
                node.put(self.clean_title(text))
        if node.tag == 'meta':
            key = node.props.get('name', node.props.get('property'))
            values = {'description': self.summary, 'og:description': self.summary, 'twitter:description': self.summary,
                      'og:title': self.title, 'twitter:title': self.title,
                      'verification:date': self.time, 'verification:publication-date': self.date,
                      'verification:record-reference': self.record['record_reference']}
            if key in values:
                node.props['content'] = values[key]
        if 'verification-artifact' in classes:
            node.props['aria-label'] = 'VIP10 checkout discount evidence' if self.checkout else 'VIP10 documented cart result'
        if 'verified-at-checkout' in classes:
            node.props['href'] = self.record['record_url']
            node.put(el('strong', self.status + ' · Last verified'),
                     el('span', 'Observed: ' + self.date, className='verified-date'),
                     el('span', self.time, className='verified-timestamp'),
                     el('em', 'View record'))
            return node
        if 'promo-proof-card' in classes:
            for item in descendants(node):
                if item.tag == 'div':
                    label = next((plain(x) for x in item.children if isinstance(x, Element) and x.tag == 'dt'), '')
                    for child in item.children:
                        if isinstance(child, Element) and child.tag == 'dd':
                            if label == 'Observed subtotal':
                                child.put('CAD $' + self.subtotal)
                            elif label == 'Observed discount':
                                child.put('CAD $' + self.discount)
        if node.props.get('href') and re.match(r'^View the (?:[A-Za-z]+ \\d{1,2}|latest) VIP10 record', plain(node)):
            node.props['href'] = self.record['record_url']
            node.put('View the latest VIP10 record →')
        if 'artifact-result-line' in classes:
            node.put(el('strong', self.status + ': '), self.benefit)
        if 'artifact-status' in classes:
            for child in node.children:
                if isinstance(child, Element) and child.tag == 'strong':
                    child.put(f'Save CAD {self.discount} (10%) on the CAD {self.subtotal} item subtotal')
                if isinstance(child, Element) and child.tag == 'small':
                    child.put(self.breakdown + ' ' + self.scope)
        if 'artifact-merchant-context' in classes:
            node.put('This record verifies the 10% code discount on the named item in that checkout session. Product eligibility, shipping, adjustments and future checkout conditions can differ; read the merchant’s current terms.')
        if 'artifact-evidence-link' in classes and '/evidence/' in str(node.props.get('href', '')):
            node.put('Open checkout evidence ↗' if self.checkout else 'Open cart evidence ↗')
        if classes & {'verification-dashboard-grid-status', 'system-status-grid'}:
            for card in node.children:
                if not isinstance(card, Element):
                    continue
                label = plain(card.children[0]) if card.children else ''
                values = {
                    'VIP10 code': (self.status, self.method + ' · ' + self.time),
                    'Verification method': (self.method, 'Method behind the current accepted record'),
                    'Latest recorded code event': (self.time, self.status),
                    'Latest code event': (self.time, self.status),
                }
                if label in values:
                    for child in card.children:
                        if isinstance(child, Element) and child.tag in ('strong', 'small'):
                            child.put(values[label][0 if child.tag == 'strong' else 1])
        if 'verification-summary' in classes:
            for card in node.children:
                if not isinstance(card, Element):
                    continue
                for child in card.children:
                    if isinstance(child, Element) and child.tag == 'strong':
                        child.put(self.time)
                    if isinstance(child, Element) and child.tag == 'small':
                        child.put(self.method if not child.classes else self.status)
        if 'status-band-copy' in classes:
            node.put(el('p', el('strong', self.status + ' · ' + self.method)),
                     el('p', self.benefit + ' Observed ' + self.time + '. ' + self.breakdown + ' ' + self.scope))
        if 'btc-savings-notice' in classes and self.checkout:
            node.props['aria-label'] = 'Current VIP10 checkout adjustments'
            node.put(el('span', 'Checkout adjustments', className='btc-savings-notice__label'),
                     el('strong', 'Bitcoin adjustment in this observed checkout: CAD ' + self.bitcoin + '.'),
                     el('p', 'The 10% VIP10 code discount is separate from shipping and the CAD ' + self.adjustment + ' currency-fee adjustment. No Bitcoin savings are attributed to this run.'))
        if 'btc-savings-notice__label' in classes and self.checkout:
            node.put('Checkout adjustments')
        if 'ledger-copy' in classes:
            for child in node.children:
                if isinstance(child, Element) and child.tag == 'h2':
                    child.put('VIP10 saved 10% on the verified item.')
                if isinstance(child, Element) and child.tag == 'p' and 'eyebrow' not in child.classes:
                    child.put(self.benefit + ' Observed ' + self.time + '. ' + self.breakdown)
        if 'ledger-paper' in parent_classes and node.tag == 'em':
            node.put('−CAD ' + self.discount)
        if 'ledger-paper' in parent_classes and node.tag == 'i':
            node.put('VIP10 item discount')
        if 'hero-content' in parent_classes and node.tag == 'h1':
            node.put('Growth Guys VIP10 — 10% item discount verified at checkout' if self.checkout else 'Growth Guys VIP10 — dated cart discount evidence')
        if 'hero-deck' in classes:
            node.put(self.benefit + ' ' + self.status + ' on ' + self.date + '; the final total includes separate checkout charges and adjustments.' if self.checkout else self.benefit + ' ' + self.scope)
        if 'hero-trust' in parent_classes and plain(node) == 'Cart event logged':
            node.put('Automated checkout observed' if self.checkout else 'Cart event logged')
        if 'evidence-matrix' in classes:
            facts = {'Code': 'VIP10 · ' + self.status + ' · ' + self.date,
                     'Cart context': self.product + ' · CAD ' + self.subtotal + ' item subtotal',
                     'Discount': self.benefit,
                     'Limits': self.breakdown + ' ' + self.scope}
            for cell in node.children:
                if isinstance(cell, Element):
                    label = next((plain(x) for x in cell.children if isinstance(x, Element) and x.tag == 'strong'), '')
                    if label in facts:
                        for child in cell.children:
                            if isinstance(child, Element) and child.tag == 'p':
                                child.put(facts[label])
        if node.tag in ('details', 'section'):
            headings = [plain(x) for x in node.children if isinstance(x, Element) and x.tag in ('summary', 'h2', 'h3')]
            for heading in headings:
                if heading in self.answers:
                    for child in node.children:
                        if isinstance(child, Element) and child.tag == 'p':
                            child.put(self.answers[heading])
        # Exact current-method paragraphs only; never rewrite product cards or history.
        if self.checkout and node.tag == 'p':
            text = plain(node)
            if text.startswith('Daily cart-evidence review:') and 'The latest confirmed record observed' in text:
                node.put(self.method + ' · ' + self.time + '. ' + self.benefit + ' ' + self.breakdown + ' ' + self.scope)
            elif text.startswith('The check stays at the cart stage.'):
                node.put(self.method + ' verified the 10% discount at checkout. ' + self.breakdown + ' ' + self.scope)
            elif text.startswith('VIP10 provides a documented 10% cart discount record with no minimum'):
                node.put(self.benefit + ' The latest accepted checkout record provides the exact Toronto timestamp, separate order-summary fields and retained evidence. This item check does not establish a universal minimum-order or site-wide eligibility policy.')
            elif text.startswith('The record is limited to the visible guest-cart response.'):
                node.put(self.method + ' records the named item, accepted code, shipping, separate adjustment and displayed final total. ' + self.scope)
            elif text.startswith('Verification records are classified as Documented cart result or Documented manual record'):
                node.put('The current result is labeled ' + self.status + ' and ' + self.method + '. Historical records keep their original labels. Incomplete records do not create a new verification date.')
            elif text.startswith('This sequence is intentionally simple. It does not require account creation, payment details, an order submission'):
                node.put('The current record uses ' + self.method + '. The retained evidence distinguishes the 10% item discount from shipping, the separate currency-fee adjustment and the final checkout total. ' + self.scope)
            elif text.startswith('How should a reader use a current verification record?'):
                node.put(self.summary)
        def visit(value):
            if isinstance(value, Element):
                return self.policy(value, active, classes)
            if isinstance(value, list):
                return [visit(x) for x in value]
            return value
        if 'children' in node.props:
            node.props['children'] = visit(node.props['children'])
        if node.tag == 'script' and node.props.get('type') == 'application/ld+json':
            raw = node.props.get('dangerouslySetInnerHTML', {}).get('__html')
            if raw is not None:
                if raw.lstrip().startswith('{'):
                    node.props['dangerouslySetInnerHTML']['__html'] = dumps(self.structured(json.loads(raw)))
            else:
                node.put(dumps(self.structured(json.loads(plain(node)))))
        return node

    def tree(self, value):
        if isinstance(value, Element):
            return self.policy(value)
        if isinstance(value, list):
            result = [self.tree(x) for x in value]
            if any(isinstance(x, Element) and x.tag == 'title' for x in result):
                for key, item in [('verification:date', self.time), ('verification:publication-date', self.date), ('verification:record-reference', self.record['record_reference'])]:
                    if not any(isinstance(x, Element) and x.tag == 'meta' and x.props.get('name') == key for x in result):
                        result.append(el('meta', name=key, content=item))
            return result
        if isinstance(value, dict):
            return {k: self.tree(v) for k, v in value.items()}
        return value

    def partial_flight(self, text):
        """Update complete elements inside an already-truncated legacy JSON row.

        A successfully decoded historical element is skipped as a whole. Never
        replace numbers, dates or product strings indiscriminately in raw JSON.
        """
        output = []
        cursor = 0
        decoder = json.JSONDecoder()
        for match in re.finditer(r'\["\$",', text):
            if match.start() < cursor:
                continue
            try:
                value, count = decoder.raw_decode(text[match.start():])
            except ValueError:
                continue
            if not (isinstance(value, list) and len(value) == 4 and value[0] == '$' and isinstance(value[3], dict)):
                continue
            changed = encode(self.tree(decode(value)))
            output.append(text[cursor:match.start()])
            output.append(dumps(changed) if changed != value else text[match.start():match.start() + count])
            cursor = match.start() + count
        output.append(text[cursor:])
        result = ''.join(output)
        if self.checkout and '"className":"btc-savings-notice"' in result:
            # The original homepage ends mid-string in this final component.
            # Correct the visible prefix, but do not invent missing React rows.
            result = result.replace('"aria-label":"VIP10 Bitcoin savings notice"', '"aria-label":"Current VIP10 checkout adjustments"')
            result = re.sub(r'("children":")Pay with Bitcoin for 20% off$',
                            lambda m: m[1] + 'Bitcoin adjustment in this observed checkout: CAD ' + self.bitcoin + '.', result)
        return result

    def flight(self, text):
        """Respect UTF-8 byte-length T frames and JSON record boundaries."""
        raw = text.encode('utf-8')
        out = bytearray()
        pos = 0
        decoder = json.JSONDecoder()
        while pos < len(raw):
            frame = re.match(rb'([0-9a-f]+):T([0-9a-f]+),', raw[pos:])
            if frame:
                begin = pos + frame.end()
                end = begin + int(frame[2], 16)
                payload = raw[begin:end]
                try:
                    # Older snapshots have lengths left stale by Unicode edits.
                    remainder = raw[begin:].decode('utf-8')
                    obj, count = decoder.raw_decode(remainder)
                    end = begin + len(remainder[:count].encode('utf-8'))
                    payload = raw[begin:end]
                    if isinstance(obj, dict) and '@context' in obj:
                        payload = dumps(self.structured(obj)).encode('utf-8')
                except (ValueError, UnicodeDecodeError):
                    pass
                out.extend(frame[1] + b':T' + format(len(payload), 'x').encode() + b',' + payload)
                pos = end
                continue
            end = raw.find(b'\n', pos)
            if end == -1:
                end = len(raw)
            line = raw[pos:end]
            record = re.match(rb'([0-9a-f]+):(.*)', line)
            if record:
                try:
                    original = json.loads(record[2])
                    changed = encode(self.tree(decode(original)))
                    if changed != original:
                        line = record[1] + b':' + dumps(changed).encode('utf-8')
                except (ValueError, UnicodeDecodeError):
                    if record[2].startswith((b'[', b'{')):
                        line = record[1] + b':' + self.partial_flight(record[2].decode('utf-8')).encode('utf-8')
            out.extend(line)
            if end < len(raw):
                out.extend(b'\n')
            pos = end + 1
        return out.decode('utf-8')

    def html(self, original):
        title = re.search(r'<title>(.*?)</title>', original, re.S)
        self.title = self.clean_title(unescape(title[1] if title else 'VIP10 verification evidence')) + ' · ' + self.date
        blocks = []
        def protect(match):
            blocks.append(match[0])
            return f'<!--VIP10_PRESERVED_OWNER_{len(blocks) - 1}-->'
        source = OWNER.sub(protect, original)
        # Transform concatenated Flight chunks so byte frames split across pushes work.
        pattern = re.compile(r'(self\.__next_f\.push\(\[1,)("(?:[^"\\]|\\.)*")(\]\))')
        matches = list(pattern.finditer(source))
        if matches:
            decoded = [json.loads(m[2]) for m in matches]
            changed = self.flight(''.join(decoded))
            if changed != ''.join(decoded):
                chunks = []
                offset = 0
                for i, chunk in enumerate(decoded):
                    end = offset + len(chunk) if i < len(decoded) - 1 else len(changed)
                    chunks.append(changed[offset:end])
                    offset = end
                for match, chunk in reversed(list(zip(matches, chunks))):
                    source = source[:match.start(2)] + json.dumps(chunk, ensure_ascii=False) + source[match.end(2):]
        # The original homepage has a truncated trailing payload; preserve that shape.
        if 'self.__next_f.push([1,' in source and not source.rstrip().endswith('</html>'):
            start = source.rfind('self.__next_f.push([1,') + len('self.__next_f.push([1,')
            tail = source[start:]
            try:
                decoded = json.loads(tail + '"')
                source = source[:start] + json.dumps(self.flight(decoded), ensure_ascii=False)[:-1]
            except (ValueError, UnicodeDecodeError):
                pass
        document = Document(source)
        self.policy(document.root)
        # Existing metadata may lack these tags, including hydration-side metadata.
        head = next((x for x in descendants(document.root) if x.tag == 'head'), None)
        if head:
            for key, value in [('verification:date', self.time), ('verification:publication-date', self.date), ('verification:record-reference', self.record['record_reference'])]:
                if not any(x.tag == 'meta' and x.props.get('name') == key for x in head.children if isinstance(x, Element)):
                    head.props['children'].append(el('meta', name=key, content=value))
        result = render(document.root)
        for i, block in enumerate(blocks):
            result = result.replace(f'<!--VIP10_PRESERVED_OWNER_{i}-->', block)
        for pattern in (r'<tr\b[\s\S]*?</tr>', r'<section class="historical-record-refresh"[\s\S]*?</section>', r'<div class="verification-calendar"[\s\S]*?</div></div>'):
            assert re.findall(pattern, result) == re.findall(pattern, original), self.relative + ': historical region changed'
        assert OWNER.findall(result) == OWNER.findall(original), self.relative + ': owner block changed'
        return result


def routes(public):
    paths = set(BASE_PAGES)
    for path in public.rglob('*.html'):
        relative = path.relative_to(public)
        if any(part in {'evidence', 'owner-records', 'observations', '_next'} for part in relative.parts):
            continue
        if relative.parts[0] == 'verification-archive' and relative.as_posix() != 'verification-archive/index.html':
            continue
        source = path.read_text()
        openings = re.findall(r'<(?:section|div)\b[^>]*>', source)
        if OWNER.search(source) or any(re.search(r'class="[^"]*\b(?:' + '|'.join(sorted(MODULES)) + r')\b', tag) for tag in openings):
            paths.add(relative.as_posix())
    return sorted(paths)


def sync_current_sitemap(public, record, dry_run=False):
    """Project accepted current publication dates; dated archive URLs stay intact."""
    sitemap_path = public / 'sitemap.xml'
    source = sitemap_path.read_text()
    current = {HOST + '/' + relative.removesuffix('index.html') for relative in routes(public)}
    modified = record['published_at']
    updated_count = 0
    def current_url(match):
        nonlocal updated_count
        block = match[0]
        location = re.search(r'<loc>(.*?)</loc>', block)
        if not location or unescape(location[1]) not in current:
            return block
        if '<lastmod>' in block:
            projected = re.sub(r'<lastmod>.*?</lastmod>', '<lastmod>' + modified + '</lastmod>', block)
        else:
            projected = block.replace('</url>', '<lastmod>' + modified + '</lastmod></url>')
        if projected != block:
            updated_count += 1
        return projected
    projected = re.sub(r'<url\b[^>]*>[\s\S]*?</url>', current_url, source)
    if projected != source and not dry_run:
        sitemap_path.write_text(projected)
    print(f'{updated_count} current sitemap modification dates {"would be synchronized" if dry_run else "synchronized"}; historical URLs untouched')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--public-dir', type=Path, default=Path(__file__).resolve().parents[1] / 'public')
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    public = args.public_dir.resolve()
    record = json.loads((public / 'api/current-record.json').read_text())
    state = json.loads((public / 'owner-publication-state.json').read_text())
    # Compute all pages before writing, so a malformed input fails without partial edits.
    changed = []
    for relative in routes(public):
        path = public / relative
        original = path.read_text()
        projected = Projection(record, state, relative).html(original)
        if projected != original:
            changed.append((path, projected))
    for path, projected in changed:
        if not args.dry_run:
            path.write_text(projected)
        print(path.relative_to(public).as_posix())
    print(f'{len(changed)} existing routes {"would be updated" if args.dry_run else "updated"}; accepted JSON/evidence, owner blocks and history untouched')
    sync_current_sitemap(public, record, args.dry_run)


if __name__ == '__main__':
    main()
