"""Evaluate pretrained spaCy models on a local InLegalNER test parquet."""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import warnings

import pyarrow.parquet as pq
import spacy

SOURCE = 'https://huggingface.co/datasets/opennyaiorg/InLegalNER'
PERSON_ROLES = {'JUDGE', 'PETITIONER', 'RESPONDENT', 'LAWYER', 'WITNESS'}


def score(counts):
    tp, fp, fn = counts
    return {
        'tp': tp, 'fp': fp, 'fn': fn,
        'precision': tp / (tp + fp) if tp + fp else 0.0,
        'recall': tp / (tp + fn) if tp + fn else 0.0,
        'f1': 2 * tp / (2 * tp + fp + fn) if tp + fp + fn else 0.0,
    }


def add(counts, gold, predicted):
    for index, value in enumerate((gold & predicted, predicted - gold, gold - predicted)):
        counts[index] += len(value)


def person_spans(entities, labels):
    return {(start, end) for start, end, label in entities if label in labels}


def evaluate(path, legal_model):
    models = {'en_core_web_sm': spacy.load('en_core_web_sm'),
              'en_legal_ner_sm': spacy.load(legal_model)}
    counts = {name: [0, 0, 0] for name in models}
    legal_counts = [0, 0, 0]
    per_label = {}
    rows = 0
    for batch in pq.ParquetFile(path).iter_batches(batch_size=64):
        examples = batch.to_pylist()
        texts = [row['data']['text'] for row in examples]
        predictions = {name: model.pipe(texts, batch_size=32) for name, model in models.items()}
        for row, text in zip(examples, texts, strict=True):
            rows += 1
            annotations, = row['annotations']
            gold = set()
            for item in annotations['result']:
                value = item['value']
                start, end = value['start'], value['end']
                if not 0 <= start < end <= len(text) or text[start:end] != value['text']:
                    raise ValueError(f'Invalid gold span at row {rows}')
                gold.update((start, end, label) for label in value['labels'])
            for name, docs in predictions.items():
                predicted = {(e.start_char, e.end_char, e.label_) for e in next(docs).ents}
                labels = {'PERSON'} if name == 'en_core_web_sm' else PERSON_ROLES
                add(counts[name], person_spans(gold, PERSON_ROLES), person_spans(predicted, labels))
                if name == 'en_legal_ner_sm':
                    add(legal_counts, gold, predicted)
                    for label in {entity[2] for entity in gold | predicted}:
                        add(per_label.setdefault(label, [0, 0, 0]),
                            {e for e in gold if e[2] == label},
                            {e for e in predicted if e[2] == label})
    with path.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    return {
        'source': SOURCE, 'split': 'published test', 'rows': rows, 'sha256': digest,
        'spacy_version': spacy.__version__,
        'models': {name: model.meta['version'] for name, model in models.items()},
        'comparison': 'Exact span match on five legal person roles pooled into one category; generic PERSON predictions outside the gold role spans count as false positives.',
        'person_roles': sorted(PERSON_ROLES),
        'person_span_scores': {name: score(values) for name, values in counts.items()},
        'legal_span_and_label_micro': score(legal_counts),
        'legal_span_and_label_by_type': {label: score(per_label[label]) for label in sorted(per_label)},
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('test_file', type=Path)
    parser.add_argument('--legal-model', type=Path, required=True)
    args = parser.parse_args()
    with warnings.catch_warnings(record=True) as notices:
        warnings.simplefilter('always')
        report = evaluate(args.test_file, args.legal_model)
    report['runtime_warnings'] = sorted({str(item.message) for item in notices})
    target = Path('artifacts/evaluation/inlegalner-evaluation.json')
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({k: v for k, v in report.items() if k != 'legal_span_and_label_by_type'}, indent=2))
