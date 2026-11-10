# InLegalNER evaluation

The benchmark reads the published InLegalNER test Parquet obtained through the
[dataset access page](https://huggingface.co/datasets/opennyaiorg/InLegalNER).
It records the file SHA-256 and publishes aggregate scores only.

The comparison pools five labeled legal person roles and measures exact character
spans. Generic PERSON predictions outside those gold spans count as false
positives, including mentions annotated as OTHER_PERSON. Interpret this score
as retrieval of the five selected roles, not as a general person-recognition
score. The legal model also receives exact span-and-label scores across all
gold types. The benchmark uses the publisher's test split without fine-tuning.

Run with spaCy, the MAHA baseline model and PyArrow available, and pass the
extracted model directory from the [official model wheel](https://huggingface.co/opennyaiorg/en_legal_ner_sm).
The run used the model repository revision
`1d172dff01f1dc5cb85c8016eecb3f4c6d0461d6`. Its published wheel filename
contains an invalid version for current pip, so the model data was loaded
directly from the wheel contents.

```bash
.venv/bin/python -m maha.inlegalner_benchmark /path/to/test.parquet \
  --legal-model /path/to/en_legal_ner_sm-3.2.0
```

The run writes `artifacts/evaluation/inlegalner-evaluation.json`.
This evaluates English Indian court text. FIRs, phone numbers, account numbers
and identity resolution require separate evaluation.

## Local runtime compatibility

The published weights declare spaCy 3.2 compatibility. The local default
artifact was loaded and reserialized with MAHA's pinned spaCy 3.8.16.
Its metadata retains the original version range. Exact predicted spans and
labels matched the original artifact on all 4,501 test records and the
reserialized artifact loads without W095. This validates the pinned runtime.
The loader also supports the original artifact and explicit
`MAHA_LEGAL_MODEL` overrides for other installations.
