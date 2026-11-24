"""A statement-scoped view of saved payments and their source evidence."""

from collections import Counter
from decimal import Decimal
import re

from .statements import stored_statement_row
from .store import uid


UPI_ID = re.compile(r'[A-Za-z0-9._+\-]+@[A-Za-z][A-Za-z0-9.\-]*')
MASK = re.compile(r'x{3}|[*•]', re.IGNORECASE)
UPI_NARRATION = re.compile(r'\bUPI\s*/\s*(DR|CR)\s*/\s*\d{10,18}\s*/\s*', re.IGNORECASE)
BANK_CODE = re.compile(r'[A-Za-z]{4}(?:0[A-Za-z0-9]{6})?')
PRINTED_ALIAS = re.compile(r'[A-Za-z0-9._@*+\-]{3,48}')
PAYMENT_CHANNELS = (
    (re.compile(r'\bUPI\b', re.I), 'UPI'),
    (re.compile(r'\bIMPS\b', re.I), 'IMPS'),
    (re.compile(r'\bNEFT\b', re.I), 'NEFT'),
    (re.compile(r'\bRTGS\b', re.I), 'RTGS'),
    (re.compile(r'\b(?:POS|CARD|ECOM)\b', re.I), 'Card payments'),
    (re.compile(r'\bATM\b', re.I), 'ATM'),
    (re.compile(r'\b(?:CHQ|CHEQUE)\b', re.I), 'Cheque payments'),
    (re.compile(r'\bCASH\b', re.I), 'Cash transactions'),
    (re.compile(r'\b(?:CHRG|CHARGE|CHARGES|FEES?)\b', re.I), 'Bank charges'),
    (re.compile(r'\b(?:INT|INTEREST)\b', re.I), 'Interest'),
    (re.compile(r'\b(?:TFR|TRANSFER)\b', re.I), 'Other transfers'),
)


def statement_account(fields):
    bank = ' '.join(fields.get('bank', '').split())
    account = ''.join(fields.get('account', '').split())
    if not account or account in {'-', '—'}:
        return uid('statement-account'), bank or 'Statement account'
    safe_account = account if len(account) <= 4 or MASK.search(account) else '••••' + account[-4:]
    return uid('statement-account', bank.casefold(), account.casefold()), ' · '.join(filter(None, (bank, safe_account)))


def narrated_upi_party(narration, direction):
    # This layout prints a direction, transaction reference, label, bank code, and alias in that order.
    prefix = UPI_NARRATION.search(narration)
    expected = 'CR' if direction == 'credit' else 'DR'
    if not prefix or prefix[1].upper() != expected:
        return None
    segments = narration[prefix.end():].split('/', 3)
    if len(segments) != 4:
        return None
    label, bank, alias = (' '.join(part.split()) for part in segments[:3])
    if not (label and len(label) <= 48 and any(char.isalpha() for char in label)
            and BANK_CODE.fullmatch(bank) and PRINTED_ALIAS.fullmatch(alias)):
        return None
    token = alias.casefold()
    if UPI_ID.fullmatch(token) and not MASK.search(token):
        return uid('statement-counterparty', token), token, 'UPI identifier printed in narration', 'identifier'
    key = uid('statement-narration-label', label.casefold(), bank.casefold(), token)
    return key, f'{label} · {bank.upper()}', 'Printed UPI label · identity unconfirmed', 'narration'


def counterparty(fields, direction):
    identity_field = 'sender' if direction == 'credit' else 'receiver'
    label = ' '.join(fields.get(identity_field, '').split())
    token = label.partition('(')[0].strip().casefold()
    if UPI_ID.fullmatch(token) and not MASK.search(token):
        return uid('statement-counterparty', token), token, 'printed identifier', 'identifier'
    if label and label not in {'-', '—'}:
        return 'masked-counterparties', 'Unresolved payment parties', 'masked or incomplete identifiers', 'unresolved'
    narration = ' '.join(fields.get('narration', '').split())
    if party := narrated_upi_party(narration, direction):
        return party
    for marker, channel in PAYMENT_CHANNELS:
        if marker.search(narration):
            return uid('statement-payment-channel', channel), channel, 'Payment channel from narration', 'channel'
    return 'unknown-counterparties', 'Unknown counterparties', 'no party column or value', 'unresolved'


def statement_flow_rows(evidence, settings):
    for item in evidence:
        row = stored_statement_row(item, settings)
        if not row['normalized']:
            continue
        direction, amount = next(iter(row['normalized'].items()))
        key, label = statement_account(row['fields'])
        party, party_label, basis, party_kind = counterparty(row['fields'], direction)
        yield {**row, 'account_key': key, 'account_label': label, 'direction': direction, 'amount': amount,
               'counterparty_key': party, 'counterparty_label': party_label, 'counterparty_basis': basis,
               'counterparty_kind': party_kind}


def statement_flow(source_name, settings, owners, rows, *, account=None, start=None, end=None,
                   direction='all', status='completed', group=None, offset=0):
    accounts = {}
    for row in rows:
        key = row['account_key']
        accounts.setdefault(key, {'key': key, 'label': row['account_label'], 'owner': owners.get(key)})
    if account is None:
        account = next(iter(accounts), None)
    elif account not in accounts:
        raise KeyError(account)
    totals = {'credit': Decimal(0), 'debit': Decimal(0)}
    counts = Counter()
    groups = {}
    selected_rows = []
    for row in rows:
        day = row['event_time'][:10]
        if row['account_key'] != account or (start and day < start) or (end and day > end):
            continue
        if direction != 'all' and row['direction'] != direction:
            continue
        counts[row['payment_status']] += 1
        if status != 'all' and row['payment_status'] != status:
            continue
        group_key = uid(row['counterparty_key'], row['direction'])
        if row['payment_status'] == 'completed':
            key = row['direction']
            amount = Decimal(row['amount'])
            totals[key] += amount
            link = groups.setdefault(group_key, {'key': group_key, 'party_key': row['counterparty_key'],
                                                'label': row['counterparty_label'], 'basis': row['counterparty_basis'],
                                                'kind': row['counterparty_kind'], 'direction': key,
                                                'count': 0, 'total': Decimal(0)})
            link['count'] += 1
            link['total'] += amount
        if group is None or (row['payment_status'] == 'completed' and group_key == group):
            selected_rows.append(row)
    selected_rows.sort(key=lambda row: (row['event_time'][:10], row['printed_time'] or ''), reverse=True)
    ordered_groups = sorted(groups.values(), key=lambda item: (-item['total'], item['label'], item['direction']))
    return {'name': source_name, 'currency': settings['currency'], 'accounts': list(accounts.values()), 'account': account,
            'totals': {**{key: str(value) for key, value in totals.items()}, 'net': str(totals['credit'] - totals['debit'])},
            'status_counts': dict(counts), 'groups': [{**item, 'total': str(item['total'])} for item in ordered_groups],
            'row_count': len(selected_rows), 'rows': selected_rows[offset:offset + 25]}
