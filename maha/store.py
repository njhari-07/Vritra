"""Private observation ledger. Case authorization precedes every graph projection."""
import hashlib
import json
import os
import secrets
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone, timedelta
from pathlib import Path
from .limits import budget, check


def now():
    return datetime.now(timezone.utc).isoformat()


def uid(*parts):
    return hashlib.sha256(json.dumps(parts, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()[:32]


class Store:
    def __init__(self, root=None):
        default_dir = "/tmp/maha" if os.getenv("VERCEL") else "data/private/runtime"
        self.root = Path(root or os.getenv("MAHA_DATA", default_dir)).resolve()
        try:
            self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
            self.root.chmod(0o700)
        except OSError:
            pass
        self.path = self.root / "ledger.sqlite3"
        with self.db() as db:
            db.executescript('''
            CREATE TABLE IF NOT EXISTS users(name TEXT PRIMARY KEY, token_hash TEXT UNIQUE, cases TEXT);
            CREATE TABLE IF NOT EXISTS cases(id TEXT PRIMARY KEY, closed_at TEXT);
            CREATE TABLE IF NOT EXISTS sources(id TEXT PRIMARY KEY, name TEXT, content BLOB, dataset TEXT, synthetic INTEGER);
            CREATE TABLE IF NOT EXISTS imports(id TEXT PRIMARY KEY, source_id TEXT, case_id TEXT, created TEXT, summary TEXT);
            CREATE TABLE IF NOT EXISTS evidence(id TEXT PRIMARY KEY, source_id TEXT, case_id TEXT, data TEXT);
            CREATE TABLE IF NOT EXISTS facts(id TEXT PRIMARY KEY, case_id TEXT, evidence_id TEXT, data TEXT);
            CREATE INDEX IF NOT EXISTS facts_case ON facts(case_id);
            CREATE INDEX IF NOT EXISTS evidence_case ON evidence(case_id);
            CREATE INDEX IF NOT EXISTS imports_case ON imports(case_id);
            CREATE TABLE IF NOT EXISTS decisions(id TEXT PRIMARY KEY, case_scope TEXT, data TEXT);
            CREATE TABLE IF NOT EXISTS decision_events(id INTEGER PRIMARY KEY, decision_id TEXT, case_scope TEXT, data TEXT);
            CREATE TABLE IF NOT EXISTS reviews(id TEXT PRIMARY KEY, case_scope TEXT, data TEXT);
            CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, at TEXT, actor TEXT, action TEXT, case_id TEXT, object_id TEXT);
            CREATE INDEX IF NOT EXISTS audit_case ON audit(case_id);
            CREATE TABLE IF NOT EXISTS training_runs(case_id TEXT PRIMARY KEY, trained_at TEXT, data TEXT);
            ''')
            # A disk-backed duplicate index avoids rescanning all evidence on each import.
            db.execute('BEGIN IMMEDIATE')
            if not db.execute("SELECT 1 FROM sqlite_master WHERE name='record_fingerprints'").fetchone():
                db.execute('CREATE TABLE record_fingerprints(evidence_id TEXT PRIMARY KEY, case_id TEXT, dataset TEXT, fingerprint TEXT)')
                db.execute('CREATE INDEX fingerprint_lookup ON record_fingerprints(case_id,dataset,fingerprint)')
                for old in db.execute('SELECT id,case_id,data FROM evidence'):
                    prior = json.loads(old['data'])
                    if prior['extraction_method'] == 'csv-positional':
                        db.execute('INSERT INTO record_fingerprints VALUES(?,?,?,?)', (old['id'], old['case_id'], prior['dataset_id'], uid(prior['passage'])))
            
            # Auto-seed default investigator user if new database
            user_count = db.execute("SELECT COUNT(*) FROM users").fetchone()[0]
            if user_count == 0:
                default_token = "WT49DfCpDyYerqLF_cQI-hkzH7Et7UXGZNUrb_EcneA"
                token_hash = hashlib.sha256(default_token.encode()).hexdigest()
                default_cases = json.dumps(["DEMO-C01", "DEMO-C02", "DEMO-C03", "CASE-2026-TEST", "CASE-RIGOROUS-02"])
                db.execute("INSERT OR REPLACE INTO users VALUES(?,?,?)", ("investigator", token_hash, default_cases))
                for c in ["DEMO-C01", "DEMO-C02", "DEMO-C03", "CASE-2026-TEST", "CASE-RIGOROUS-02"]:
                    db.execute("INSERT OR IGNORE INTO cases(id) VALUES(?)", (c,))
                try:
                    access_file = self.root / "access.json"
                    access_file.write_text(json.dumps({"investigator": default_token}, indent=2))
                except OSError:
                    pass
        try:
            self.path.chmod(0o600)
        except OSError:
            pass


    @contextmanager
    def db(self):
        db = sqlite3.connect(self.path, timeout=30)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    def audit(self, actor, action, case_id="", object_id=""):
        with self.db() as db:
            db.execute("INSERT INTO audit(at,actor,action,case_id,object_id) VALUES(?,?,?,?,?)", (now(), actor, action, case_id, object_id))

    def create_user(self, name, cases):
        token = secrets.token_urlsafe(32)
        with self.db() as db:
            db.execute("INSERT OR REPLACE INTO users VALUES(?,?,?)", (name, hashlib.sha256(token.encode()).hexdigest(), json.dumps(sorted(set(cases)))))
            db.executemany("INSERT OR IGNORE INTO cases(id) VALUES(?)", [(c,) for c in cases])
        return token

    def authenticate(self, token):
        with self.db() as db:
            row = db.execute("SELECT name,cases FROM users WHERE token_hash=?", (hashlib.sha256(token.encode()).hexdigest(),)).fetchone()
        if not row:
            raise PermissionError("Invalid access token")
        return {"name": row["name"], "cases": json.loads(row["cases"])}

    def add_case_to_user(self, name, case_id):
        case_id = case_id.strip()
        with self.db() as db:
            db.execute("INSERT OR IGNORE INTO cases(id) VALUES(?)", (case_id,))
            row = db.execute("SELECT cases FROM users WHERE name=?", (name,)).fetchone()
            if row:
                current = json.loads(row["cases"])
                if case_id not in current:
                    current.append(case_id)
                    current = sorted(set(current))
                    db.execute("UPDATE users SET cases=? WHERE name=?", (json.dumps(current), name))
        return case_id

    def reset_case(self, case_id):
        with self.db() as db:
            db.execute("DELETE FROM facts WHERE case_id=?", (case_id,))
            db.execute("DELETE FROM evidence WHERE case_id=?", (case_id,))
            db.execute("DELETE FROM imports WHERE case_id=?", (case_id,))
            db.execute("DELETE FROM record_fingerprints WHERE case_id=?", (case_id,))
            db.execute("DELETE FROM training_runs WHERE case_id=?", (case_id,))

    def record_training_run(self, case_id, data):
        with self.db() as db:
            db.execute("INSERT OR REPLACE INTO training_runs VALUES(?,?,?)", (case_id, now(), json.dumps(data)))

    def get_training_run(self, case_id):
        with self.db() as db:
            row = db.execute("SELECT trained_at, data FROM training_runs WHERE case_id=?", (case_id,)).fetchone()
            if row:
                return {"trained_at": row["trained_at"], **json.loads(row["data"])}
        return None

    def case_status(self, cases):
        res = []
        with self.db() as db:
            for cid in cases:
                fc = db.execute("SELECT COUNT(*) FROM facts WHERE case_id=?", (cid,)).fetchone()[0]
                ec = db.execute("SELECT COUNT(*) FROM evidence WHERE case_id=?", (cid,)).fetchone()[0]
                tr = db.execute("SELECT trained_at, data FROM training_runs WHERE case_id=?", (cid,)).fetchone()
                res.append({
                    "case_id": cid,
                    "facts_count": fc,
                    "evidence_count": ec,
                    "is_trained": bool(tr),
                    "last_trained_at": tr["trained_at"] if tr else None,
                    "training_info": json.loads(tr["data"]) if tr else None
                })
        return res

    def evidence(self, evidence_id, cases):
        with self.db() as db:
            row = db.execute("SELECT * FROM evidence WHERE id=?", (evidence_id,)).fetchone()
        if not row or row["case_id"] not in cases:
            raise KeyError(evidence_id)
        return json.loads(row["data"])

    def facts(self, cases):
        if not cases:
            return []
        with self.db() as db:
            rows = db.execute(f"SELECT data FROM facts WHERE case_id IN ({','.join('?' for _ in cases)}) LIMIT ?", [*cases, budget('GRAPH_FACTS', 20000)+1]).fetchall()
        check(len(rows), 'GRAPH_FACTS', 20000)
        return [json.loads(r[0]) for r in rows]

    def source(self, source_id, cases):
        with self.db() as db:
            scopes = [r[0] for r in db.execute("SELECT DISTINCT case_id FROM imports WHERE source_id=?", (source_id,))]
            if not scopes or not set(scopes).issubset(cases):
                raise KeyError(source_id)
            row = db.execute("SELECT name,content FROM sources WHERE id=?", (source_id,)).fetchone()
        # A raw blob may contain rows belonging to multiple cases. Require all its grants.
        if not row or not scopes or not set(scopes).issubset(cases):
            raise KeyError(source_id)
        return row[0], row[1]

    def import_records(self, name, content, dataset, synthetic, case_id, records, actor="cli"):
        """Records are validated by an adapter; one atomic transaction per source import."""
        source_id = hashlib.sha256(content).hexdigest()
        import_id = secrets.token_hex(16)
        summary = {"rows_seen": 0, "accepted_new": 0, "recognized_repeat": 0, "quarantined": 0, "issues": []}
        with self.db() as db:
            db.execute("INSERT OR IGNORE INTO cases(id) VALUES(?)", (case_id,))
            db.execute("INSERT OR IGNORE INTO sources VALUES(?,?,?,?,?)", (source_id, Path(name).name, content, dataset, int(synthetic)))
            for record in records:
                summary["rows_seen"] += 1
                check(summary['rows_seen'], 'IMPORT_RECORDS', 5000)
                for warning in record.get('warnings',[]):
                    summary['issues'].append({'locator':record['locator'],'reason':warning,'severity':'warning'})
                if "error" in record:
                    summary["quarantined"] += 1
                    summary["issues"].append({"locator": record["locator"], "reason": record["error"]})
                    continue
                extraction_version=record.get('extraction_version','0.1')
                evidence_id = uid(dataset, source_id, case_id, record["locator"], extraction_version)
                if db.execute("SELECT 1 FROM evidence WHERE id=?", (evidence_id,)).fetchone():
                    summary["recognized_repeat"] += 1
                    continue
                ev = dict(id=evidence_id, source=Path(name).name, source_id=source_id,
                          source_locator=record["locator"], import_id=import_id,
                          extraction_method=record.get("method", "csv-positional"), extraction_version=extraction_version,
                          confidence=record.get("confidence", 1.0), event_time=record.get("event_time"),
                          time_basis=record.get("time_basis", "not_supplied"), ingestion_time=now(),
                          dataset_id=dataset, synthetic=synthetic, case_ids=[case_id], passage=record.get("passage", ""))
                ev['confidence_basis']=record.get('confidence_basis','deterministic extraction agreement, not source truth')
                db.execute("INSERT INTO evidence VALUES(?,?,?,?)", (evidence_id, source_id, case_id, json.dumps(ev)))
                if ev['extraction_method']=='csv-positional':
                    fp=uid(ev['passage'])
                    if db.execute('SELECT 1 FROM record_fingerprints WHERE case_id=? AND dataset=? AND fingerprint=? LIMIT 1', (case_id,dataset,fp)).fetchone():
                        summary['issues'].append({'locator':record['locator'],'reason':'possible_duplicate_retained','severity':'warning'})
                    db.execute('INSERT INTO record_fingerprints VALUES(?,?,?,?)', (evidence_id,case_id,dataset,fp))
                for fact in record["facts"]:
                    fact = {**fact, "case_id": case_id, "evidence_ids": [evidence_id], "synthetic": synthetic, "dataset_id": dataset}
                    fid = uid(evidence_id, fact)
                    fact["fact_id"] = fid
                    db.execute("INSERT OR IGNORE INTO facts VALUES(?,?,?,?)", (fid, case_id, evidence_id, json.dumps(fact)))
                summary["accepted_new"] += 1
            db.execute("INSERT INTO imports VALUES(?,?,?,?,?)", (import_id, source_id, case_id, now(), json.dumps(summary)))
            db.execute("INSERT INTO audit(at,actor,action,case_id,object_id) VALUES(?,?,?,?,?)", (now(), actor, "import", case_id, import_id))
        return {"import_id": import_id, "source_id": source_id, **summary}

    def history(self, table, cases):
        if table not in {"imports", "audit"}:
            raise ValueError("Unsupported history")
        if not cases:
            return []
        with self.db() as db:
            rows = db.execute(f"SELECT * FROM {table} WHERE case_id IN ({','.join('?' for _ in cases)}) ORDER BY rowid DESC LIMIT 200", cases).fetchall()
        return [dict(r) for r in rows]

    def decisions(self, cases):
        with self.db() as db:
            rows = db.execute("SELECT * FROM decisions").fetchall()
        return [json.loads(r["data"]) for r in rows if set(json.loads(r["case_scope"])).issubset(cases)]

    def save_decision(self, data, cases):
        with self.db() as db:
            db.execute("INSERT OR REPLACE INTO decisions VALUES(?,?,?)", (data["id"], json.dumps(sorted(cases)), json.dumps(data)))
            db.execute('INSERT INTO decision_events(decision_id,case_scope,data) VALUES(?,?,?)',(data['id'],json.dumps(sorted(cases)),json.dumps(data)))
        self.audit(data["actor"], "resolution_" + data["state"], sorted(cases)[0], data["id"])

    def close_case(self, case_id):
        with self.db() as db:
            db.execute("UPDATE cases SET closed_at=? WHERE id=?", (now(), case_id))
        self.audit("cli", "close_case", case_id)

    def purge(self, at=None):
        at = at or datetime.now(timezone.utc)
        cutoff = (at - timedelta(days=30)).isoformat()
        with self.db() as db:
            expired = [r[0] for r in db.execute("SELECT id FROM cases WHERE closed_at IS NOT NULL AND closed_at<=?", (cutoff,))]
            for c in expired:
                for table in ["facts", "evidence", "imports", "record_fingerprints"]:
                    db.execute(f"DELETE FROM {table} WHERE case_id=?", (c,))
                for table in ["decisions", "decision_events", "reviews"]:
                    for r in db.execute(f"SELECT id,case_scope FROM {table}").fetchall():
                        if c in json.loads(r[1]): db.execute(f"DELETE FROM {table} WHERE id=?", (r[0],))
                db.execute("DELETE FROM cases WHERE id=?", (c,))
            removed_names=[r[0] for r in db.execute('SELECT name FROM sources WHERE id NOT IN (SELECT source_id FROM imports)')]
            db.execute("DELETE FROM sources WHERE id NOT IN (SELECT source_id FROM imports)")
            db.execute("DELETE FROM audit WHERE at<?", ((at-timedelta(days=90)).isoformat(),))
        # Reclaim deleted blob pages instead of leaving recoverable source text in the ledger.
        with self.db() as db: db.execute("VACUUM")
        for name in removed_names:
            managed=self.root/'demo-sources'/Path(name).name
            if managed.is_file():managed.unlink()
        return expired

    def record_training_run(self, case_id, data):
        with self.db() as db:
            db.execute("INSERT OR REPLACE INTO training_runs VALUES(?,?,?)", (case_id, now(), json.dumps(data)))

    def get_training_run(self, case_id):
        with self.db() as db:
            row = db.execute("SELECT * FROM training_runs WHERE case_id=?", (case_id,)).fetchone()
        return json.loads(row["data"]) if row else None

    def add_case_to_user(self, username, case_id):
        with self.db() as db:
            db.execute("INSERT OR IGNORE INTO cases(id) VALUES(?)", (case_id,))
            u = db.execute("SELECT cases FROM users WHERE name=?", (username,)).fetchone()
            if u:
                cases = json.loads(u["cases"])
                if case_id not in cases:
                    cases.append(case_id)
                    db.execute("UPDATE users SET cases=? WHERE name=?", (json.dumps(cases), username))

    def reset_case(self, case_id):
        with self.db() as db:
            for table in ["facts", "evidence", "imports", "record_fingerprints", "training_runs"]:
                db.execute(f"DELETE FROM {table} WHERE case_id=?", (case_id,))
            for table in ["decisions", "decision_events", "reviews"]:
                for r in db.execute(f"SELECT id,case_scope FROM {table}").fetchall():
                    if case_id in json.loads(r[1]):
                        db.execute(f"DELETE FROM {table} WHERE id=?", (r[0],))
        self.audit("system", "case_reset", case_id)

    def case_status(self, cases):
        status_list = []
        with self.db() as db:
            for c in cases:
                f_count = db.execute("SELECT count(*) FROM facts WHERE case_id=?", (c,)).fetchone()[0]
                e_count = db.execute("SELECT count(*) FROM evidence WHERE case_id=?", (c,)).fetchone()[0]
                t_row = db.execute("SELECT trained_at, data FROM training_runs WHERE case_id=?", (c,)).fetchone()
                status_list.append({
                    "case_id": c,
                    "facts_count": f_count,
                    "evidence_count": e_count,
                    "is_trained": t_row is not None,
                    "last_trained_at": t_row["trained_at"] if t_row else None,
                    "training_metadata": json.loads(t_row["data"]) if t_row else None
                })
        return status_list
