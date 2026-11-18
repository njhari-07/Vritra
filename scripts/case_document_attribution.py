"""Rank case passages and propose evidence-linked actor roles."""
import re

from case_news_attribution import cited_judges, quoted_judicial_links
from case_paragraph_attribution import (
    DATELINE, admitted_operator_links, direct_operator_plea_links, explicit_sentencing_role_links,
    named_role_links, paragraph_link, possessive_scheme_links, reported_finding_links, stated_operator_links,
)
from evaluate_case_actor_attribution import LINE_WRAP, subject_links
from evaluate_case_role_retrieval import ROLE_QUERY
from train_case_actor_linker import actor_candidates, model_links
from train_case_passage_ranker import features, keyword_scores


INLINE_FOOTNOTE = re.compile(r'(?<=[a-z]\.)\d{1,2}(?=\s+[A-Z][a-z])')
FOOTNOTE_LABEL = re.compile(r'^\s*(\d{1,2})[ \t]+[A-Z]', re.M)


def normalize_page(text, *, court_page=False):
    removed = {i for match in LINE_WRAP.finditer(text) for i in range(*match.span())}
    if court_page:
        labels = {match[1] for match in FOOTNOTE_LABEL.finditer(text)}
        removed.update(i for match in INLINE_FOOTNOTE.finditer(text) if match[0] in labels
                       for i in range(*match.span()))
    offsets = [i for i in range(len(text)) if i not in removed]
    return ''.join(text[i] for i in offsets), offsets


def page_links(links, offsets):
    seen = set()
    for name, sentence in links:
        key = name, offsets[sentence.start_char], offsets[sentence.end_char - 1] + 1
        if key in seen:
            continue
        seen.add(key)
        yield key


def predict_document(units, kind, nlp, model, vectorizer, actor_model, top_k, *,
                     paragraph_context=False, compare_baselines=False):
    """Apply the models to source units without evaluation annotations."""
    texts = [unit['text'] for unit in units]
    weights = {
        'learned': model.decision_function(features({'texts': texts, 'topic': 'role'}, vectorizer)),
    }
    if compare_baselines:
        weights['keyword'] = keyword_scores(texts, ROLE_QUERY)
    rankings = {
        method: [i for i in sorted(range(len(units)), key=lambda i: (-scores[i], i))
                 if texts[i].strip() and (method != 'keyword' or scores[i] > 0)][:top_k]
        for method, scores in weights.items()
    }
    indexed = sorted({i for ranking in rankings.values() for i in ranking})
    paragraph_units = paragraph_context and kind == 'agency_report' and all(
        'paragraph' in unit for unit in units
    )
    judges = cited_judges(texts) if paragraph_context and kind == 'news' else {}
    parse_indices = sorted({
        j for i in indexed for j in range(max(0, i - 3), min(i + 4, len(units)))
    }) if paragraph_units else indexed
    normalized = {
        i: normalize_page(texts[i], court_page='page' in units[i]) for i in parse_indices
    }
    docs = dict(zip(parse_indices, nlp.pipe(normalized[i][0] for i in parse_indices), strict=True))
    named_offsets = {}
    if paragraph_units:
        for i in indexed:
            if m := DATELINE.match(normalized[i][0]):
                named_offsets[i] = m.end()
    stripped_docs = dict(zip(named_offsets,
                             nlp.pipe(normalized[i][0][start:] for i, start in named_offsets.items()),
                             strict=True))
    predictions = {'rules': {}, 'hybrid': {}}
    proposed = {}
    cross_paragraph = {}
    judicial_attribution = {}
    for i in indexed:
        doc = docs[i]
        _, offsets = normalized[i]
        if compare_baselines:
            predictions['rules'][i] = list(page_links(subject_links(doc, include_affirmed_findings=True), offsets))
        actor_options = list(actor_candidates(doc))
        proposed[i] = list(page_links(((option.actor, option.sentence) for option in actor_options), offsets))
        hybrid = list(model_links(actor_model, actor_options))
        if paragraph_units:
            hybrid.extend(named_role_links(doc))
            hybrid.extend(stated_operator_links(doc))
            hybrid.extend(admitted_operator_links(doc))
        predictions['hybrid'][i] = list(page_links(hybrid, offsets))
        if judges:
            for name, sentence, judge, (j, start, end) in quoted_judicial_links(doc, judges, i):
                candidate, = page_links([(name, sentence)], offsets)
                if j == i and end > candidate[2]:
                    continue
                if candidate not in predictions['hybrid'][i]:
                    predictions['hybrid'][i].append(candidate)
                judicial_attribution[i, candidate] = {
                    'speaker': judge,
                    'basis': 'news_report_direct_judicial_quote',
                    'speaker_locator': {'paragraph': units[j]['paragraph'], 'char_start': start, 'char_end': end},
                    'speaker_evidence': texts[j][start:end],
                }
        if paragraph_units:
            sentence_doc = stripped_docs.get(i, doc)
            explicit = page_links(
                [*explicit_sentencing_role_links(sentence_doc), *direct_operator_plea_links(sentence_doc)],
                offsets[named_offsets.get(i, 0):],
            )
            predictions['hybrid'][i] = list(dict.fromkeys([*predictions['hybrid'][i], *explicit]))
        contextual = []
        if paragraph_units:
            if link := paragraph_link(i, docs):
                contextual.append(link)
            contextual.extend(possessive_scheme_links(i, docs))
            contextual.extend(reported_finding_links(i, doc))
        for name, role_sentence, evidence in contextual:
            candidate, = page_links([(name, role_sentence)], offsets)
            if candidate not in predictions['hybrid'][i]:
                predictions['hybrid'][i].append(candidate)
            cross_paragraph[i, candidate] = []
            for j, sentence in evidence:
                (_, start, end), = page_links([(name, sentence)], normalized[j][1])
                cross_paragraph[i, candidate].append({
                    'locator': {'paragraph': units[j]['paragraph'], 'char_start': start, 'char_end': end},
                    'evidence_sentence': texts[j][start:end],
                })
    return rankings, predictions, proposed, cross_paragraph, judicial_attribution


def candidate_record(unit, rank, link, identity_evidence, attribution):
    actor, start, end = link
    return {
        'actor': actor, 'rank': rank,
        'locator': {**{k: v for k, v in unit.items() if k != 'text'},
                    'char_start': start, 'char_end': end},
        'evidence_sentence': unit['text'][start:end],
        **({'identity_evidence': identity_evidence} if identity_evidence else {}),
        **({'attribution': attribution} if attribution else {}),
    }
