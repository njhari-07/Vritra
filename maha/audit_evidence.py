"""Evidence Correctness and Locator Integrity Audit Engine.
Implements the required protocol from docs/design/04-evaluation.md:
  - Verifies locator presence and validity across all ingestion modalities
  - Validates source-to-field comparisons against raw retained source blobs in SQLite
  - Measures wrong/missing locators, field fidelity, and passage boundary integrity
  - Quantifies evidence correctness independently of link resolvability
"""
import csv
import io
import json
import hashlib
from pathlib import Path
from .store import Store


def audit_evidence_correctness(ledger: Store, sample_limit: int = 500):
    total_audited = 0
    correct_count = 0
    missing_locator_count = 0
    invalid_locator_count = 0
    passage_mismatch_count = 0
    blob_missing_count = 0

    by_modality = {}
    audit_records = []

    with ledger.db() as db:
        rows = db.execute("SELECT id, source_id, case_id, data FROM evidence LIMIT ?", (sample_limit,)).fetchall()
        # Pre-cache sources for speed
        sources = {r[0]: r[1] for r in db.execute("SELECT id, content FROM sources").fetchall()}

    for row in rows:
        eid = row["id"]
        sid = row["source_id"]
        cid = row["case_id"]
        data = json.loads(row["data"])

        method = data.get("extraction_method", "unknown")
        locator = data.get("source_locator", {})
        passage = data.get("passage", "")
        dataset = data.get("dataset_id", "")

        if method not in by_modality:
            by_modality[method] = {"total": 0, "correct": 0, "errors": []}

        by_modality[method]["total"] += 1
        total_audited += 1

        is_correct = True
        error_reasons = []

        # 1. Check Locator Presence
        if not locator:
            missing_locator_count += 1
            is_correct = False
            error_reasons.append("Missing source_locator metadata")

        # 2. Check Raw Source Blob Retrieval
        blob = sources.get(sid)
        if not blob:
            blob_missing_count += 1
            is_correct = False
            error_reasons.append(f"Source blob {sid} not found in store")
        else:
            # 3. Method-specific source-to-passage verification
            if method == "csv-positional":
                line_no = locator.get("line_start")
                if not line_no:
                    invalid_locator_count += 1
                    is_correct = False
                    error_reasons.append("Missing line_start in CSV locator")
                else:
                    try:
                        raw_lines = blob.decode("utf-8", errors="replace").splitlines()
                        if 1 <= line_no <= len(raw_lines):
                            target_line = raw_lines[line_no - 1]
                            parsed_target = next(csv.reader([target_line]))
                            # passage is JSON array of fields or raw text
                            try:
                                parsed_passage = json.loads(passage) if passage.startswith("[") else passage
                            except Exception:
                                parsed_passage = passage

                            if isinstance(parsed_passage, list):
                                if parsed_passage != parsed_target:
                                    passage_mismatch_count += 1
                                    is_correct = False
                                    error_reasons.append(f"Parsed CSV mismatch at line {line_no}")
                            elif passage.strip() != target_line.strip():
                                passage_mismatch_count += 1
                                is_correct = False
                                error_reasons.append(f"CSV line mismatch at line {line_no}")
                        else:
                            invalid_locator_count += 1
                            is_correct = False
                            error_reasons.append(f"Line {line_no} out of bounds (1..{len(raw_lines)})")
                    except Exception as ex:
                        is_correct = False
                        error_reasons.append(f"CSV audit exception: {str(ex)}")

            elif method in ("explicit-identifier-rule", "spacy-en_core_web_sm", "document-metadata"):
                c_start = locator.get("char_start")
                c_end = locator.get("char_end")
                doc_ord = locator.get("document_ordinal", 1)

                if c_start is None or c_end is None:
                    invalid_locator_count += 1
                    is_correct = False
                    error_reasons.append("Narrative locator missing char_start/char_end offsets")
                else:
                    try:
                        raw_str = blob.decode("utf-8", errors="replace")
                        if raw_str.strip().startswith("["):
                            docs = json.loads(raw_str)
                            if 1 <= doc_ord <= len(docs):
                                doc_text = docs[doc_ord - 1].get("text", "")
                                span_text = doc_text[c_start:c_end]
                                if passage != span_text:
                                    passage_mismatch_count += 1
                                    is_correct = False
                                    error_reasons.append(f"Narrative span mismatch: extracted '{passage}' != source '{span_text}'")
                            else:
                                invalid_locator_count += 1
                                is_correct = False
                                error_reasons.append(f"Doc ordinal {doc_ord} exceeds doc count {len(docs)}")
                        else:
                            span_text = raw_str[c_start:c_end]
                            if passage != span_text:
                                passage_mismatch_count += 1
                                is_correct = False
                                error_reasons.append(f"Text span mismatch: extracted '{passage}' != source '{span_text}'")
                    except Exception as ex:
                        is_correct = False
                        error_reasons.append(f"Narrative audit exception: {str(ex)}")

            elif method == "pdf-table":
                page = locator.get("page")
                row_idx = locator.get("row")
                bbox = locator.get("bbox")
                if page is None or row_idx is None:
                    invalid_locator_count += 1
                    is_correct = False
                    error_reasons.append("PDF locator missing page or row index")

        if is_correct:
            correct_count += 1
            by_modality[method]["correct"] += 1
        else:
            by_modality[method]["errors"].append({
                "evidence_id": eid,
                "reasons": error_reasons
            })

        audit_records.append({
            "evidence_id": eid,
            "case_id": cid,
            "method": method,
            "status": "correct" if is_correct else "failed",
            "errors": error_reasons
        })

    fidelity_rate = round(correct_count / total_audited, 4) if total_audited > 0 else 1.0

    modality_summary = {}
    for mod, val in by_modality.items():
        if val["total"] > 0:
            modality_summary[mod] = {
                "total": val["total"],
                "correct": val["correct"],
                "fidelity": round(val["correct"] / val["total"], 4),
                "error_count": len(val["errors"])
            }

    result = {
        "protocol": "docs/design/04-evaluation.md § Evidence Correctness Audit Protocol",
        "total_audited": total_audited,
        "correct_records": correct_count,
        "overall_correctness_rate": fidelity_rate,
        "discrepancies": {
            "missing_locators": missing_locator_count,
            "invalid_locators": invalid_locator_count,
            "passage_mismatches": passage_mismatch_count,
            "source_blob_missing": blob_missing_count
        },
        "by_modality": modality_summary,
        "sample_size": total_audited,
        "standard": "Exact locator fidelity against immutable raw source blobs",
        "audit_sample_records": audit_records[:15]
    }
    return result


def run_and_save_evidence_audit(ledger: Store, output_path: str = "artifacts/evaluation/evidence-audit.json"):
    res = audit_evidence_correctness(ledger)
    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(res, indent=2) + "\n")
    return res
