"""Evidence-linked person dossiers for case review and Kingpin identification."""
from collections import defaultdict
import re

MASTERMIND_CUES = re.compile(
    r'\b(?:prime accused|mastermind\w*|syndicate controller|kingpin\w*|orchestrat\w+|chief conspirat\w+|beneficial owner|head of the|prime syndicate|bodymaster|cartel head|syndicate head)\b',
    re.I
)
CO_ACCUSED_CUES = re.compile(
    r'\b(?:accused|co-accused|conspirat\w+|managing partner|enforcer|architect|lieutenant|hitman)\b',
    re.I
)
MULE_CUES = re.compile(
    r'\b(?:mule|dummy director|hawala|smurfing|shell operator|structuring operator|conduit)\b',
    re.I
)
WITNESS_ROLES = re.compile(
    r'\b(?:witness|investigating officer|inquest witness|police officer|fbi agent)\b',
    re.I
)
VICTIM_ROLES = re.compile(
    r'\b(?:victim|target|exploited pawn)\b',
    re.I
)
SEVERE_WARRANT_CUES = re.compile(
    r'\b(?:look\s*out\s*circular|loc\b|abscond\w+|proclaimed\s*offender|section\s*82|interpol|red\s*corner)\b',
    re.I
)
MODERATE_WARRANT_CUES = re.compile(
    r'\b(?:non[- ]bailable\s*warrant|nbw\b|rico\b|special\s*syndicate|active\s*charge[- ]sheet)\b',
    re.I
)


def score_kingpin_features(dossier):
    """
    Computes a forensic, multi-modal Kingpin Index (0.0 - 100.0) across:
    1. Judicial & Legal Roles (Court Proceedings) [0-30 pts]
    2. Financial Laundering Cycles & Wire Flows [0-30 pts]
    3. Crime Registry & Statutory Warrants (FIRs, LOC, Absconder) [0-25 pts]
    4. Telecom CDR Communications Hierarchy & Outgoing Control [0-15 pts]
    5. Graph Topology & Centrality (PageRank, Betweenness) [0-10 pts]
    """
    roles_text = " ".join(dossier.get('source_roles', []) + [dossier.get('role') or ''])
    records = dossier['key_details'].get('crime_records', [])
    records_text = " ".join([r.get('record', '') + " " + str(r.get('status', '')) for r in records])

    reasons = []
    # A person is a witness only if explicitly given a witness role or witness status
    has_mastermind_role = bool(MASTERMIND_CUES.search(roles_text))
    is_witness = False
    if not has_mastermind_role:
        if WITNESS_ROLES.search(roles_text) or any('witness' in str(r.get('status', '')).casefold() or 'complainant' in str(r.get('status', '')).casefold() for r in records):
            is_witness = True
        elif VICTIM_ROLES.search(roles_text) or any('victim' in str(r.get('status', '')).casefold() for r in records):
            is_witness = True

    # 1. Judicial Modality (0-30 pts)
    score_judicial = 0.0
    if not is_witness:
        if MASTERMIND_CUES.search(roles_text) or MASTERMIND_CUES.search(records_text):
            score_judicial = 30.0
            reasons.append("Court Proceedings: Named Syndicate Mastermind / Prime Accused in judicial filings")
        elif CO_ACCUSED_CUES.search(roles_text) or CO_ACCUSED_CUES.search(records_text):
            score_judicial = 16.0
            reasons.append("Court Proceedings: Named Co-Accused / Syndicate Operative in court records")
        elif MULE_CUES.search(roles_text) or MULE_CUES.search(records_text):
            score_judicial = 8.0
            reasons.append("Court Proceedings: Identified as transactional conduit / front nominee")
    else:
        reasons.append("Exonerating Factor: Formally designated as Witness / Investigating Officer")

    # 2. Financial Laundering & Wire Flow Modality (0-30 pts)
    score_financial = 0.0
    fund_leads = [f for f in dossier.get('findings', []) if 'fund_flow' in f.get('techniques', []) or 'cycle' in f.get('reason', '').lower()]
    accounts = {acc['account_id'] for acc in dossier['key_details'].get('accounts', [])}
    if fund_leads and accounts:
        score_financial = 25.0
        reasons.append(f"Financial Wires: Originator or primary hub in {len(fund_leads)} closed-loop laundering cycles")
    elif fund_leads:
        score_financial = 15.0
        reasons.append("Financial Wires: Intermediary conduit in structured laundering cycles")

    anom_leads = [f for f in dossier.get('findings', []) if 'isolation_forest' in f.get('techniques', [])]
    if anom_leads:
        score_financial = min(30.0, score_financial + 5.0)
        reasons.append(f"Financial Wires: Linked to {len(anom_leads)} high-velocity nocturnal/volume anomaly transactions")
    if accounts:
        score_financial = min(30.0, score_financial + min(5.0, len(accounts) * 2.5))

    # 3. Crime Registry & Warrant Modality (0-25 pts)
    score_crime = 0.0
    if SEVERE_WARRANT_CUES.search(records_text):
        score_crime = 22.0
        reasons.append("Crime Registry: Critical flight risk with active Look-Out Circular (LOC) or Proclaimed Offender warrant")
    elif MODERATE_WARRANT_CUES.search(records_text):
        score_crime = 16.0
        reasons.append("Crime Registry: Subject to Non-Bailable Warrant (NBW) or Organized Crime indictment")
    elif dossier['key_details'].get('crime_records'):
        score_crime = 8.0
        reasons.append(f"Crime Registry: {len(dossier['key_details']['crime_records'])} recorded police/agency FIRs")

    # 4. Telecom CDR Communications Hierarchy (0-15 pts)
    score_telecom = 0.0
    calls = dossier['key_details'].get('communications', [])
    outgoing = [c for c in calls if c.get('direction') == 'Outgoing']
    if outgoing:
        score_telecom = min(12.0, 5.0 + len(outgoing) * 2.5)
        reasons.append(f"Telecom CDR: Initiated {len(outgoing)} command & coordination calls to syndicate subordinates")
    if len(calls) >= 3:
        score_telecom = min(15.0, score_telecom + 3.0)

    # 5. Network Centrality (0-10 pts)
    score_network = 0.0
    net = dossier['key_details'].get('network', {})
    pr = net.get('pagerank', 0.0)
    bc = net.get('betweenness', 0.0)
    deg = net.get('degree', 0.0)
    score_network = min(10.0, round((pr * 45.0) + (bc * 40.0) + (deg * 15.0), 1))

    raw_total = score_judicial + score_financial + score_crime + score_telecom + score_network
    if is_witness:
        final_score = min(10.0, round(raw_total * 0.1, 1))
    else:
        final_score = min(100.0, max(0.0, round(raw_total, 1)))

    breakdown = {
        'judicial': round(score_judicial, 1),
        'financial': round(score_financial, 1),
        'crime': round(score_crime, 1),
        'telecom': round(score_telecom, 1),
        'network': round(score_network, 1),
        'total': final_score,
    }
    return final_score, is_witness, breakdown, reasons


def compute_suspect_dossiers(graph, leads, metrics=None):
    metrics = metrics or {}
    nodes = {node['id']: node for node in graph['nodes']}
    related = defaultdict(list)
    for edge in graph['edges']:
        related[edge['source']].append(edge)
        if edge['target'] != edge['source']:
            related[edge['target']].append(edge)

    dossiers = []
    for person in nodes.values():
        pid = person['id']
        if person['type'] != 'Person' or pid.startswith('mention:'):
            continue
        evidence = set(person['evidence_ids'])
        roles, accounts, records, calls, neighbors = set(), {}, [], [], set()
        for assertion in person.get('assertions', []):
            attrs = assertion['attrs']
            role = attrs.get('case_role') or attrs.get('role')
            if role:
                roles.add(role)
        for edge in related[pid]:
            attrs = edge['attrs']
            other = edge['target'] if edge['source'] == pid else edge['source']
            neighbors.add(other)
            if edge['type'] == 'OWNS_ACCOUNT' and edge['source'] == pid:
                account = nodes[other]
                accounts[other] = {'account_id': other, 'label': account['label']}
            elif edge['type'] == 'COMMUNICATED_WITH':
                calls.append({
                    'partner_id': other, 'partner_name': nodes[other]['label'],
                    'direction': 'Outgoing' if edge['source'] == pid else 'Incoming',
                    'duration_seconds': attrs.get('duration_seconds'),
                    'event_time': attrs.get('event_time'),
                    'evidence_ids': edge['evidence_ids'],
                })
            elif edge['type'] == 'INVOLVED_IN_CASE' and attrs.get('source_text'):
                if str(attrs.get('source_record_status', '')).strip().casefold() == 'witness':
                    roles.add('Witness (source record)')
                if attrs.get('role'):
                    roles.add(attrs['role'])
                if attrs.get('case_role'):
                    roles.add(attrs['case_role'])
                if attrs.get('source_record_status'):
                    records.append({
                        'record': attrs['source_text'], 'status': attrs.get('source_record_status'),
                        'date': attrs.get('record_date'), 'evidence_ids': edge['evidence_ids'],
                    })
            else:
                continue
            evidence.update(edge['evidence_ids'])

        subjects = {pid, *accounts}
        findings = [
            {'id': lead['id'], 'category': lead['category'], 'reason': lead['reason'],
             'evidence_ids': lead['evidence_ids'], 'techniques': lead.get('techniques', [])}
            for lead in leads if subjects.intersection(lead['subject_ids'])
        ]
        for finding in findings:
            evidence.update(finding['evidence_ids'])

        dossier = {
            'id': pid, 'name': person['label'], 'title': 'Person dossier',
            'authoritative_id': person['attrs'].get('authoritative_id'),
            'role': ', '.join(sorted(roles)) or None,
            'source_roles': sorted(roles),
            'findings': findings,
            'why_flagged': [finding['reason'] for finding in findings],
            'key_details': {
                'accounts': list(accounts.values()), 'case_ids': person['case_ids'],
                'crime_records': records, 'communications': calls,
                'ego_neighbors': sorted(neighbors), 'network': metrics.get(pid, {}),
            },
            'evidence_ids': sorted(evidence),
        }
        dossiers.append(dossier)

    # Compute multi-modal Kingpin scoring & classifications
    scored_candidates = []
    for d in dossiers:
        score, is_witness, breakdown, reasons = score_kingpin_features(d)
        d['kingpin_score'] = score
        d['is_witness'] = is_witness
        d['kingpin_breakdown'] = breakdown
        d['kingpin_reasons'] = reasons
        if not is_witness:
            scored_candidates.append(d)

    # Designate Kingpin (highest non-witness score >= 40)
    top_candidate = max(scored_candidates, key=lambda x: x['kingpin_score']) if scored_candidates else None
    kingpin_threshold = 40.0

    for d in dossiers:
        if top_candidate and d['id'] == top_candidate['id'] and top_candidate['kingpin_score'] >= kingpin_threshold:
            d['is_kingpin'] = True
            d['syndicate_role'] = 'Kingpin / Prime Syndicate Mastermind'
            d['role_badge'] = 'KINGPIN'
        else:
            d['is_kingpin'] = False
            if d['is_witness']:
                d['syndicate_role'] = 'Witness / Investigating Officer'
                d['role_badge'] = 'WITNESS'
            elif d['kingpin_score'] >= 45.0:
                d['syndicate_role'] = 'Syndicate Lieutenant / Co-Accused'
                d['role_badge'] = 'LIEUTENANT'
            elif d['kingpin_score'] >= 25.0:
                d['syndicate_role'] = 'Financial Conduit / Mule Coordinator'
                d['role_badge'] = 'CONDUIT'
            elif d['kingpin_score'] >= 12.0:
                d['syndicate_role'] = 'Front Nominee / Account Holder'
                d['role_badge'] = 'NOMINEE'
            else:
                d['syndicate_role'] = 'Peripheral Contact / Associate'
                d['role_badge'] = 'CONTACT'

    # Sort so Kingpin is always at Rank #1, followed by descending risk score
    dossiers.sort(key=lambda d: (not d.get('is_kingpin', False), -d.get('kingpin_score', 0), d['name'].casefold()))
    for rank, d in enumerate(dossiers, 1):
        d['kingpin_rank'] = rank

    return dossiers
