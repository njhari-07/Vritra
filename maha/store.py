"""Private observation ledger. Case authorization precedes every graph projection."""
import hashlib
import json
import os
import secrets
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone, timedelta
from pathlib import Path
from .limits import ResourceLimitError, budget, check


def now():
    return datetime.now(timezone.utc).isoformat()


def uid(*parts):
    return hashlib.sha256(json.dumps(parts, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()[:32]


class ImportSettingsConflict(ValueError):
    pass


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
            CREATE TABLE IF NOT EXISTS workspace_preferences(username TEXT PRIMARY KEY, active_case TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS cases(id TEXT PRIMARY KEY, closed_at TEXT);
            CREATE TABLE IF NOT EXISTS sources(id TEXT PRIMARY KEY, name TEXT, content BLOB, dataset TEXT, synthetic INTEGER);
            CREATE TABLE IF NOT EXISTS imports(id TEXT PRIMARY KEY, source_id TEXT, case_id TEXT, created TEXT, summary TEXT);
            CREATE TABLE IF NOT EXISTS evidence(id TEXT PRIMARY KEY, source_id TEXT, case_id TEXT, data TEXT);
            CREATE TABLE IF NOT EXISTS facts(id TEXT PRIMARY KEY, case_id TEXT, evidence_id TEXT, data TEXT);
            CREATE TABLE IF NOT EXISTS graph_state (
                singleton INTEGER PRIMARY KEY CHECK(singleton=1),
                ledger_id TEXT NOT NULL,
                revision INTEGER NOT NULL
            );
            INSERT OR IGNORE INTO graph_state VALUES (1, lower(hex(randomblob(16))), 0);
            CREATE TRIGGER IF NOT EXISTS graph_facts_insert AFTER INSERT ON facts
            BEGIN
                UPDATE graph_state SET revision=revision+1 WHERE singleton=1;
            END;
            CREATE TRIGGER IF NOT EXISTS graph_facts_update AFTER UPDATE ON facts
            BEGIN
                UPDATE graph_state SET revision=revision+1 WHERE singleton=1;
            END;
            CREATE TRIGGER IF NOT EXISTS graph_facts_delete AFTER DELETE ON facts
            BEGIN
                UPDATE graph_state SET revision=revision+1 WHERE singleton=1;
            END;
            CREATE TRIGGER IF NOT EXISTS graph_evidence_insert AFTER INSERT ON evidence
            BEGIN
                UPDATE graph_state SET revision=revision+1 WHERE singleton=1;
            END;
            CREATE TRIGGER IF NOT EXISTS graph_evidence_update AFTER UPDATE ON evidence
            BEGIN
                UPDATE graph_state SET revision=revision+1 WHERE singleton=1;
            END;
            CREATE TRIGGER IF NOT EXISTS graph_evidence_delete AFTER DELETE ON evidence
            BEGIN
                UPDATE graph_state SET revision=revision+1 WHERE singleton=1;
            END;
            CREATE INDEX IF NOT EXISTS facts_case ON facts(case_id);
            CREATE TABLE IF NOT EXISTS judgment_reviews (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                evidence_id TEXT NOT NULL,
                data TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS judgment_reviews_evidence ON judgment_reviews(evidence_id,id);
            CREATE TRIGGER IF NOT EXISTS judgment_review_retention AFTER DELETE ON evidence
            BEGIN
                DELETE FROM judgment_reviews WHERE evidence_id=OLD.id;
            END;
            CREATE INDEX IF NOT EXISTS evidence_case ON evidence(case_id);
            CREATE INDEX IF NOT EXISTS imports_case ON imports(case_id);
            CREATE TABLE IF NOT EXISTS decisions(id TEXT PRIMARY KEY, case_scope TEXT, data TEXT);
            CREATE TABLE IF NOT EXISTS decision_events(id INTEGER PRIMARY KEY, decision_id TEXT, case_scope TEXT, data TEXT);
            CREATE TABLE IF NOT EXISTS reviews(id TEXT PRIMARY KEY, case_scope TEXT, data TEXT);
            CREATE TABLE IF NOT EXISTS review_events(id INTEGER PRIMARY KEY, review_id TEXT, case_scope TEXT, data TEXT);
            CREATE INDEX IF NOT EXISTS review_events_lead ON review_events(review_id);
            CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, at TEXT, actor TEXT, action TEXT, case_id TEXT, object_id TEXT);
            CREATE INDEX IF NOT EXISTS audit_case ON audit(case_id);
            CREATE TABLE IF NOT EXISTS training_runs(case_id TEXT PRIMARY KEY, trained_at TEXT, data TEXT);
            ''')
            # A disk-backed duplicate index avoids rescanning all evidence on each import.
            db.execute('BEGIN IMMEDIATE')
            if not db.execute("SELECT 1 FROM sqlite_master WHERE name='record_fingerprints'").fetchone():
                db.execute('CREATE TABLE record_fingerprints(evidence_id TEXT PRIMARY KEY, case_id TEXT, dataset TEXT, fingerprint TEXT)')
                db.execute('CREATE INDEX fingerprint_lookup ON record_fingerprints(case_id,dataset,fingerprint)')
                # Back-fill from existing evidence whenever the fingerprint table is (re)created.
                for old in db.execute('SELECT id,case_id,data FROM evidence'):
                    prior = json.loads(old['data'])
                    if prior.get('extraction_method') == 'csv-positional':
                        db.execute('INSERT OR IGNORE INTO record_fingerprints VALUES(?,?,?,?)', (old['id'], old['case_id'], prior['dataset_id'], uid(prior['passage'])))
            # Migration: add review_events table for existing databases lacking it.
            if not db.execute("SELECT 1 FROM sqlite_master WHERE name='review_events'").fetchone():
                db.execute('CREATE TABLE review_events(id INTEGER PRIMARY KEY, review_id TEXT, case_scope TEXT, data TEXT)')
                db.execute('CREATE INDEX review_events_lead ON review_events(review_id)')
            
        try:
            self.path.chmod(0o600)
        except OSError:
            pass
        self.sync_access_tokens()

    def sync_access_tokens(self):
        access_file = self.root / "access.json"
        if not access_file.exists():
            return
        try:
            with open(access_file, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, dict):
                with self.db() as db:
                    for name, tok in data.items():
                        if isinstance(tok, str) and tok.strip():
                            t_hash = hashlib.sha256(tok.strip().encode()).hexdigest()
                            existing = db.execute("SELECT cases FROM users WHERE name=?", (name,)).fetchone()
                            if existing:
                                db.execute("UPDATE users SET token_hash=? WHERE name=?", (t_hash, name))
                            else:
                                cases = [r[0] for r in db.execute("SELECT id FROM cases").fetchall()] or ["DEMO-C01", "CASE-THE-EXCHANGE"]
                                db.execute("INSERT OR REPLACE INTO users VALUES(?,?,?)", (name, t_hash, json.dumps(cases)))
        except Exception:
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
        t_hash = hashlib.sha256(token.encode()).hexdigest()
        with self.db() as db:
            row = db.execute("SELECT name,cases FROM users WHERE token_hash=?", (t_hash,)).fetchone()
        if not row:
            self.sync_access_tokens()
            with self.db() as db:
                row = db.execute("SELECT name,cases FROM users WHERE token_hash=?", (t_hash,)).fetchone()
        if not row:
            raise PermissionError("Invalid access token")
        return {"name": row["name"], "cases": json.loads(row["cases"])}

    def workspace_case(self, username, cases):
        with self.db() as db:
            row = db.execute(
                """SELECT p.active_case FROM workspace_preferences p
                   JOIN cases c ON c.id=p.active_case WHERE p.username=?""", (username,)
            ).fetchone()
        return row['active_case'] if row and row['active_case'] in cases else None

    def remember_workspace_case(self, username, case_id):
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            user = db.execute('SELECT cases FROM users WHERE name=?', (username,)).fetchone()
            if not user or case_id not in json.loads(user['cases']):
                raise PermissionError('Case access required')
            if not db.execute('SELECT 1 FROM cases WHERE id=?', (case_id,)).fetchone():
                raise KeyError(case_id)
            self._save_workspace_case(db, username, case_id)

    @staticmethod
    def _save_workspace_case(db, username, case_id):
        db.execute(
            """INSERT INTO workspace_preferences(username,active_case) VALUES(?,?)
               ON CONFLICT(username) DO UPDATE SET active_case=excluded.active_case""",
            (username, case_id),
        )

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
        data = json.loads(row["data"])
        data.pop("review_excerpt", None)
        return data

    def graph_revision(self, db=None):
        if db is None:
            with self.db() as connection:
                return self.graph_revision(connection)
        row = db.execute('SELECT ledger_id,revision FROM graph_state WHERE singleton=1').fetchone()
        return row['ledger_id'], row['revision']

    def graph_export(self):
        """Read the revision and both projected tables from one SQLite snapshot."""
        with self.db() as db:
            db.execute('BEGIN')
            revision = self.graph_revision(db)
            facts = [json.loads(row[0]) for row in db.execute('SELECT data FROM facts')]
            evidence = [json.loads(row[0]) for row in db.execute('SELECT data FROM evidence')]
        return revision, facts, evidence

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

    def import_records(self, name, content, dataset, synthetic, case_id, records, actor="cli", *,
                       statement_settings=None, statement_scope=None):
        """Records are validated by an adapter; one atomic transaction per source import."""
        source_id = hashlib.sha256(content).hexdigest()
        import_id = secrets.token_hex(16)
        summary = {"rows_seen": 0, "accepted_new": 0, "recognized_repeat": 0, "quarantined": 0, "issues": []}
        with self.db() as db:
            db.execute("INSERT OR IGNORE INTO cases(id) VALUES(?)", (case_id,))
            if statement_settings is not None:
                self.check_statement_settings(db, source_id, case_id, statement_settings, statement_scope)
                summary["statement_settings"] = statement_settings
                if statement_scope is not None:
                    summary["statement_scope"] = statement_scope
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
                if record.get('method') == 'en_legal_ner_sm':
                    summary.setdefault('legal_mentions', []).append({
                        'evidence_id': evidence_id, 'label': record['locator']['legal_label']
                    })
                if 'text_label' in record['locator']:
                    summary.setdefault('text_mentions', []).append({
                        'evidence_id': evidence_id, 'label': record['locator']['text_label']
                    })
                if 'statement_label' in record and len(summary.get('statement_rows', [])) < 25:
                    summary.setdefault('statement_rows', []).append({
                        'evidence_id': evidence_id, 'label': record['statement_label'],
                    })
                previous_evidence = db.execute("SELECT data FROM evidence WHERE id=?", (evidence_id,)).fetchone()
                if previous_evidence:
                    if record.get('statement_correction') and (
                        json.loads(previous_evidence['data']).get('statement_correction', {}).get('fields')
                        != record['statement_correction']
                    ):
                        raise ImportSettingsConflict('This statement row already has a different recorded interpretation')
                    summary["recognized_repeat"] += 1
                    continue
                ev = dict(id=evidence_id, source=Path(name).name, source_id=source_id,
                          source_locator=record["locator"], import_id=import_id,
                          extraction_method=record.get("method", "csv-positional"), extraction_version=extraction_version,
                          confidence=record.get("confidence", 1.0), event_time=record.get("event_time"),
                          time_basis=record.get("time_basis", "not_supplied"), ingestion_time=now(),
                          dataset_id=dataset, synthetic=synthetic, case_ids=[case_id], passage=record.get("passage", ""))
                if 'review_excerpt' in record:
                    ev['review_excerpt'] = record['review_excerpt']
                if 'statement_correction' in record:
                    ev['statement_correction'] = {
                        'fields': record['statement_correction'], 'actor': actor, 'at': ev['ingestion_time'],
                    }
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
            if statement_settings is not None and summary['accepted_new']:
                counts = db.execute(
                    """SELECT COUNT(*) AS facts,
                              COUNT(DISTINCT CASE WHEN json_extract(data, '$.kind')='node'
                                                  THEN json_extract(data, '$.id') END) AS nodes
                       FROM facts WHERE case_id=?""", (case_id,)
                ).fetchone()
                for kind, default in [('facts', 20_000), ('nodes', 2_000)]:
                    limit = budget('GRAPH_' + kind.upper(), default)
                    if counts[kind] > limit:
                        raise ResourceLimitError(
                            f'This upload would exceed the case limit of {limit:,} graph {kind}. '
                            'Try a shorter PDF page range or select a different case. No rows were imported.'
                        )
            db.execute("INSERT INTO imports VALUES(?,?,?,?,?)", (import_id, source_id, case_id, now(), json.dumps(summary)))
            db.execute("INSERT INTO audit(at,actor,action,case_id,object_id) VALUES(?,?,?,?,?)", (now(), actor, "import", case_id, import_id))
        return {"import_id": import_id, "source_id": source_id, **summary}

    def check_statement_settings(self, db, source_id, case_id, settings, scope):
        accepted_pages = set((scope or {}).get('accepted_pages', []))
        for row in db.execute(
            """SELECT id, summary FROM imports
               WHERE source_id=? AND case_id=? AND json_extract(summary, '$.statement_settings') IS NOT NULL""",
            (source_id, case_id),
        ):
            previous = json.loads(row['summary'])
            original = previous['statement_settings']
            if any(original.get(field) != settings.get(field) for field in ('currency', 'date_order')):
                raise ImportSettingsConflict('This statement already exists in this case with different currency or date settings')
            if original.get('column_mapping') == settings.get('column_mapping') or not previous['accepted_new']:
                continue
            earlier_pages = (previous.get('statement_scope') or {}).get('accepted_pages')
            if earlier_pages is None:
                # Older imports did not persist page coverage. Recover it from the retained records.
                earlier_pages = [item['page'] for item in db.execute(
                    """SELECT DISTINCT json_extract(data, '$.source_locator.page') AS page FROM evidence
                       WHERE source_id=? AND case_id=? AND json_extract(data, '$.import_id')=?""",
                    (source_id, case_id, row['id']),
                ) if item['page'] is not None]
            if not accepted_pages or not earlier_pages or accepted_pages.intersection(earlier_pages):
                raise ImportSettingsConflict(
                    'This statement already has rows with a different column mapping in the selected pages'
                )

    def history(self, table, cases):
        if table not in {"imports", "audit"}:
            raise ValueError("Unsupported history")
        if not cases:
            return []
        with self.db() as db:
            rows = db.execute(f"SELECT * FROM {table} WHERE case_id IN ({','.join('?' for _ in cases)}) ORDER BY rowid DESC LIMIT 200", cases).fetchall()
        return [dict(r) for r in rows]

    def statement_batch(self, db, import_id, cases):
        batch = db.execute("SELECT * FROM imports WHERE id=?", (import_id,)).fetchone()
        if not batch or batch['case_id'] not in cases:
            raise KeyError(import_id)
        summary = json.loads(batch['summary'])
        if 'statement_settings' not in summary:
            raise KeyError(import_id)
        return batch, summary

    def statement_import_source(self, import_id, cases):
        with self.db() as db:
            batch, summary = self.statement_batch(db, import_id, cases)
        name, content = self.source(batch['source_id'], cases)
        return batch['case_id'], name, content, summary['statement_settings']

    def statement_import_review(self, import_id, cases, offset, limit):
        with self.db() as db:
            batch, summary = self.statement_batch(db, import_id, cases)
            scope = [batch['case_id'], batch['source_id'], import_id]
            filter_sql = "case_id=? AND source_id=? AND json_extract(data, '$.import_id')=?"
            found = db.execute(
                f"SELECT data FROM evidence WHERE {filter_sql} ORDER BY rowid LIMIT ? OFFSET ?",
                (*scope, limit, offset),
            ).fetchall()
            pages = db.execute(
                f"""SELECT json_extract(data, '$.source_locator.page') AS page, count(*) AS count
                    FROM evidence WHERE {filter_sql} GROUP BY page ORDER BY page""",
                scope,
            ).fetchall()
            covered = {
                row['page'] for row in db.execute(
                    """SELECT DISTINCT json_extract(data, '$.source_locator.page') AS page FROM evidence
                       WHERE case_id=? AND source_id=?""", scope[:2],
                ) if row['page'] is not None
            }
        next_page = 1
        while next_page in covered:
            next_page += 1
        return (summary, [json.loads(row['data']) for row in found],
                [dict(row) for row in pages if row['page'] is not None], next_page if covered else None)

    def decisions(self, cases):
        with self.db() as db:
            rows = db.execute("SELECT * FROM decisions").fetchall()
        return [json.loads(r["data"]) for r in rows if set(json.loads(r["case_scope"])).issubset(cases)]

    def save_decision(self, data, cases):
        with self.db() as db:
            db.execute("INSERT OR REPLACE INTO decisions VALUES(?,?,?)", (data["id"], json.dumps(sorted(cases)), json.dumps(data)))
            db.execute('INSERT INTO decision_events(decision_id,case_scope,data) VALUES(?,?,?)',(data['id'],json.dumps(sorted(cases)),json.dumps(data)))
        self.audit(data["actor"], "resolution_" + data["state"], sorted(cases)[0], data["id"])

    def save_review(self, lead_id, case_scope_list, data):
        scope_json = json.dumps(sorted(case_scope_list))
        with self.db() as db:
            db.execute('INSERT OR REPLACE INTO reviews VALUES(?,?,?)', (lead_id, scope_json, json.dumps(data)))
            db.execute('INSERT INTO review_events(review_id,case_scope,data) VALUES(?,?,?)', (lead_id, scope_json, json.dumps(data)))

    def review_history(self, lead_id, cases):
        """Return all review event records for a lead, visible to the given case set."""
        with self.db() as db:
            rows = db.execute(
                'SELECT data,case_scope FROM review_events WHERE review_id=? ORDER BY id ASC', (lead_id,)
            ).fetchall()
        result = []
        for r in rows:
            if set(json.loads(r['case_scope'])).issubset(set(cases)):
                result.append(json.loads(r['data']))
        return result

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
            db.execute('BEGIN IMMEDIATE')
            user = db.execute('SELECT cases FROM users WHERE name=?', (username,)).fetchone()
            if user is None:
                raise PermissionError('User unavailable')
            cases = json.loads(user['cases'])
            if case_id not in cases:
                inserted = db.execute('INSERT OR IGNORE INTO cases(id) VALUES(?)', (case_id,))
                if not inserted.rowcount:
                    raise ValueError('Case identifier unavailable')
                cases.append(case_id)
                db.execute('UPDATE users SET cases=? WHERE name=?', (json.dumps(cases), username))
            self._save_workspace_case(db, username, case_id)
        return cases

    def reset_case(self, case_id):
        with self.db() as db:
            for table in ["facts", "evidence", "imports", "record_fingerprints", "training_runs"]:
                db.execute(f"DELETE FROM {table} WHERE case_id=?", (case_id,))
            for table in ["decisions", "decision_events", "reviews"]:
                for r in db.execute(f"SELECT id,case_scope FROM {table}").fetchall():
                    if case_id in json.loads(r[1]):
                        db.execute(f"DELETE FROM {table} WHERE id=?", (r[0],))
            for r in db.execute("SELECT id,case_scope FROM review_events").fetchall():
                if case_id in json.loads(r[1]):
                    db.execute("DELETE FROM review_events WHERE id=?", (r[0],))
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
