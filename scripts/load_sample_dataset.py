"""Loader for multi-modal interconnected sample datasets (Dataset 1 and Dataset 2).
Ingests court proceedings, banking wires, police history sheets, and telecom CDR logs
into the immutable evidence store under an authorized case.
"""
import argparse
import io
import json
import os
import sys
from pathlib import Path

# Ensure repo root is on sys.path
REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

from maha.store import Store
from maha.ingestion import (
    ibm_records, narrative_records, cdr_records, history_records
)


def load_dataset(dataset_version: int, case_id: str, store: Store = None):
    store = store or Store()
    if dataset_version == 3:
        data_dir = REPO_ROOT / "data/novel_dataset_the_exchange"
    else:
        data_dir = REPO_ROOT / f"data/sample_datasets{'_2' if dataset_version == 2 else ''}"
    if not data_dir.exists():
        raise FileNotFoundError(f"Dataset directory not found: {data_dir}")

    print(f"Loading Dataset {dataset_version} into case '{case_id}' from {data_dir}...")

    # Ensure case exists
    with store.db() as db:
        db.execute("INSERT OR IGNORE INTO cases(id, closed_at) VALUES (?, NULL)", (case_id,))

    # 1. Court Proceedings (JSON)
    court_file = data_dir / "court_proceedings.json" if dataset_version == 3 else (data_dir / f"court_proceedings_sample{'_2' if dataset_version == 2 else ''}.json")
    if court_file.exists():
        content = court_file.read_text(encoding="utf-8")
        # Replace case_id references to bind to target case
        orig_cid = "CASE-THE-EXCHANGE" if dataset_version == 3 else "DEMO-C01"
        if case_id != orig_cid:
            content = content.replace(f'"case_id": "{orig_cid}"', f'"case_id": "{case_id}"')
            content = content.replace(f'"case_id":"{orig_cid}"', f'"case_id":"{case_id}"')
        content_bytes = content.encode("utf-8")
        res = store.import_records(
            court_file.name, content_bytes, "court-proceedings", True,
            case_id, narrative_records(content_bytes), "dataset-loader"
        )
        print(f"  [OK] Ingested {court_file.name}: {res.get('rows_seen', 0)} entities/facts parsed.")

    # 2. Police Crime Records (CSV)
    crime_file = data_dir / "crime_records.csv" if dataset_version == 3 else (data_dir / f"crime_records_sample{'_2' if dataset_version == 2 else ''}.csv")
    if crime_file.exists():
        content = crime_file.read_text(encoding="utf-8")
        orig_cid = "CASE-THE-EXCHANGE" if dataset_version == 3 else "DEMO-C01"
        if case_id != orig_cid:
            content = content.replace(f",{orig_cid},", f",{case_id},")
        content_bytes = content.encode("utf-8")
        res = store.import_records(
            crime_file.name, content_bytes, "crime-registry", True,
            case_id, history_records(content_bytes, case_id), "dataset-loader"
        )
        print(f"  [OK] Ingested {crime_file.name}: {res.get('rows_seen', 0)} crime records parsed.")

    # 3. Telecom Call Detail Records (CSV)
    cdr_file = data_dir / "telecom_cdr.csv" if dataset_version == 3 else (data_dir / f"telecom_cdr_sample{'_2' if dataset_version == 2 else ''}.csv")
    if cdr_file.exists():
        content_bytes = cdr_file.read_bytes()
        res = store.import_records(
            cdr_file.name, content_bytes, "cdr-records", True,
            case_id, cdr_records(content_bytes), "dataset-loader"
        )
        print(f"  [OK] Ingested {cdr_file.name}: {res.get('rows_seen', 0)} calls parsed.")

    # 4. Financial Wires (CSV)
    wires_file = data_dir / "financial_wires.csv" if dataset_version == 3 else (data_dir / f"financial_wires_sample{'_2' if dataset_version == 2 else ''}.csv")
    if wires_file.exists():
        content_bytes = wires_file.read_bytes()
        res = store.import_records(
            wires_file.name, content_bytes, "financial-wires", True,
            case_id, ibm_records(content_bytes), "dataset-loader"
        )
        print(f"  [OK] Ingested {wires_file.name}: {res.get('rows_seen', 0)} wire transactions parsed.")

    # 5. Raw Police FIR / Memo Text (Informative note)
    fir_file = data_dir / "raw_hostage_complaint.txt" if dataset_version == 3 else (data_dir / f"raw_police_fir_sample{'_2' if dataset_version == 2 else ''}.txt")
    if fir_file.exists():
        print(f"  [INFO] Raw narrative memo available at {fir_file}. Can be pasted into Web UI Free-Text Intake.")

    print(f"\nSuccessfully populated case '{case_id}' with Dataset {dataset_version}!")


def main():
    parser = argparse.ArgumentParser(description="Ingest fully interconnected multi-modal sample datasets.")
    parser.add_argument("--dataset", type=int, choices=[1, 2, 3], default=3,
                        help="Dataset version: 1 (Baseline 4-actor syndicate), 2 (Operation Cyber-Phantom), 3 (The Exchange - John Grisham).")
    parser.add_argument("--case", type=str, default="DEMO-C01",
                        help="Target case ID (e.g., DEMO-C01, CASE-THE-EXCHANGE).")
    args = parser.parse_args()

    load_dataset(args.dataset, args.case)


if __name__ == "__main__":
    main()
