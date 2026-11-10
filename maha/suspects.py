"""Evidence-linked person dossiers for case review."""
from collections import defaultdict


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
             'evidence_ids': lead['evidence_ids']}
            for lead in leads if subjects.intersection(lead['subject_ids'])
        ]
        for finding in findings:
            evidence.update(finding['evidence_ids'])
        dossiers.append({
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
        })
    return sorted(dossiers, key=lambda dossier: (dossier['name'].casefold(), dossier['id']))
