"""Ground-Truth Adjudication and Precision@K Evaluation Engine.
Implements the required protocol from docs/design/04-evaluation.md.
Adjudicates investigative leads into:
  - relevant
  - not_relevant
  - insufficient_evidence
Calculates Precision@K (P@5, P@10, P@20) and per-category precision.
"""
import json
from datetime import datetime, timezone


def now():
    return datetime.now(timezone.utc).isoformat()


def adjudicate_all_leads(ledger, active_cases, actor=None):
    raise RuntimeError('Automated adjudication is retired; use independent human review.')


def compute_precision_at_k(adjudicated_records):
    """Computes Precision@5, Precision@10, Precision@20 overall and per category.
    Per protocol: 'insufficient_evidence' counts as NOT relevant (conservative standard).
    """
    total = len(adjudicated_records)
    if total == 0:
        return {}

    def calc_pk(recs, k):
        sample = recs[:k]
        if not sample:
            return None
        relevant_count = sum(1 for r in sample if r['state'] == 'relevant')
        return round(relevant_count / len(sample), 4)

    # Overall P@K
    p_at_5 = calc_pk(adjudicated_records, 5)
    p_at_10 = calc_pk(adjudicated_records, 10)
    p_at_20 = calc_pk(adjudicated_records, 20)
    p_overall = calc_pk(adjudicated_records, total)

    # Category breakdowns
    connections = [r for r in adjudicated_records if r['category'] == 'connection']
    behaviors = [r for r in adjudicated_records if r['category'] == 'flagged_behavior']

    conn_p_at_10 = calc_pk(connections, 10)
    behav_p_at_10 = calc_pk(behaviors, 10)

    # Counts
    states = [r['state'] for r in adjudicated_records]
    relevant_total = states.count('relevant')
    not_relevant_total = states.count('not_relevant')
    insufficient_total = states.count('insufficient_evidence')

    return {
        "total_adjudicated": total,
        "counts": {
            "relevant": relevant_total,
            "not_relevant": not_relevant_total,
            "insufficient_evidence": insufficient_total
        },
        "precision_at_5": p_at_5,
        "precision_at_10": p_at_10,
        "precision_at_20": p_at_20,
        "overall_precision": p_overall,
        "category_metrics": {
            "connection_precision_at_10": conn_p_at_10,
            "behavior_precision_at_10": behav_p_at_10
        },
        "treatment_of_insufficient_evidence": "Treated as not established relevant (conservative forensic standard)"
    }


def get_adjudication_metrics(ledger, active_cases):
    """Retrieves existing human reviews and computes Precision@K without re-adjudicating."""
    from .graph import snapshot
    from .analytics import analyze
    g = snapshot(ledger, active_cases)
    res = analyze(g)
    leads = res.get('leads', [])
    with ledger.db() as db:
        reviews = {r['id']: json.loads(r['data']) for r in db.execute('SELECT * FROM reviews') if set(json.loads(r['case_scope'])).issubset(active_cases)}

    adjudicated_records = []
    for lead in leads:
        lid = lead['id']
        if lid in reviews:
            rev = reviews[lid]
            adjudicated_records.append({
                "id": lid,
                "category": lead.get('category', 'connection'),
                "state": rev.get('state', 'insufficient_evidence'),
                "rationale": rev.get('reason', ''),
                "techniques": lead.get('techniques', [])
            })
    return compute_precision_at_k(adjudicated_records)
