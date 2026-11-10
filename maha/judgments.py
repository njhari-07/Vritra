"""Extract reviewable legal mentions from UTF-8 judgment text."""
from functools import lru_cache
from pathlib import Path
import os

from .limits import ResourceLimitError


@lru_cache(maxsize=1)
def legal_pipeline(path):
    import spacy
    return spacy.load(path)


def judgment_records(content):
    text = content.decode('utf-8-sig')
    if not text.strip() or '\x00' in text:
        raise ValueError('Provide a nonempty UTF-8 judgment text file')
    if len(text) > 100_000:
        raise ResourceLimitError('Judgment text exceeds 100,000 characters')
    models = Path(__file__).resolve().parents[1] / 'data/private/models'
    default_path = models / 'en_legal_ner_sm-3.2.0-spacy-3.8.16'
    if not default_path.is_dir():
        default_path = models / 'en_legal_ner_sm-3.2.0'
    path = Path(os.getenv('MAHA_LEGAL_MODEL', str(default_path)))
    if not (path / 'config.cfg').is_file():
        raise FileNotFoundError('Legal NER model is unavailable. Configure MAHA_LEGAL_MODEL.')
    pipeline = legal_pipeline(path)
    version = pipeline.meta['version']
    for entity in pipeline(text).ents:
        yield {
            'locator': {'char_start': entity.start_char, 'char_end': entity.end_char,
                        'legal_label': entity.label_, 'offset_basis': 'decoded UTF-8 text'},
            'passage': entity.text,
            'method': 'en_legal_ner_sm',
            'extraction_version': version,
            'confidence': None,
            'confidence_basis': 'Unreviewed model output; no calibrated confidence',
            'facts': [],
        }
