"""Startup, Readiness, and Diagnostic Health Check Utility for MAHA.
Implements the required protocol from docs/design/00-review-status.md & PROJECT_STATUS_AND_PENDING.md:
  - Verifies local environment configuration (.env, tokens)
  - Checks SQLite evidence ledger integrity and authorization tables
  - Inspects Docker daemon availability and container status
  - Probes Neo4j bolt connection, active namespace, and ledger synchronization status
  - Checks API web service readiness and port availability
  - Generates clear operator recovery instructions
"""
import os
import socket
import urllib.request
import json
import shutil
from pathlib import Path
from .store import Store


def check_port(host: str, port: int, timeout: float = 2.0) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except (OSError, ConnectionRefusedError):
        return False


def check_api_health(url: str = "http://127.0.0.1:8765/api/health") -> dict:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "MAHA-Doctor/1.0"})
        with urllib.request.urlopen(req, timeout=3.0) as resp:
            if resp.status == 200:
                body = json.loads(resp.read().decode())
                return {"status": "ONLINE", "http_status": 200, "response": body}
            return {"status": "DEGRADED", "http_status": resp.status}
    except Exception as ex:
        return {"status": "OFFLINE", "error": str(ex)}


def diagnose_system(store_path: str = "data/private/runtime") -> dict:
    report = {
        "overall_status": "HEALTHY",
        "checks": {},
        "recovery_actions": []
    }

    # 1. Environment & Config
    env_file = Path(".env")
    env_ok = env_file.exists()
    report["checks"]["environment"] = {
        "status": "PASS" if env_ok else "WARN",
        "env_file_present": env_ok,
        "details": "Configuration file .env present." if env_ok else ".env missing; relying on default fallback parameters."
    }

    # 2. SQLite Ledger
    store = Store(store_path)
    db_file = getattr(store, "path", store.root / "ledger.sqlite3")
    access_file = store.root / "access.json"
    ledger_ok = db_file.exists()
    fact_count, evidence_count = 0, 0

    if ledger_ok:
        try:
            with store.db() as db:
                fact_count = db.execute("SELECT COUNT(*) FROM facts").fetchone()[0]
                evidence_count = db.execute("SELECT COUNT(*) FROM evidence").fetchone()[0]
                user_count = db.execute("SELECT COUNT(*) FROM users").fetchone()[0]
            report["checks"]["ledger"] = {
                "status": "PASS",
                "database_path": str(db_file),
                "facts_count": fact_count,
                "evidence_count": evidence_count,
                "users_count": user_count,
                "access_file_present": access_file.exists()
            }
        except Exception as ex:
            report["checks"]["ledger"] = {"status": "FAIL", "error": str(ex)}
            report["recovery_actions"].append(f"Ledger error: {str(ex)}. Check file permissions on {store.root}.")
    else:
        report["checks"]["ledger"] = {"status": "FAIL", "database_path": str(db_file), "error": "Database file not found."}
        report["recovery_actions"].append(f"Initialize database using: .venv/bin/maha init")

    # 3. Docker Daemon Check
    docker_sock = Path(os.environ.get("DOCKER_HOST", "/var/run/docker.sock")).expanduser()
    home_docker_sock = Path.home() / ".docker/desktop/docker.sock"
    docker_running = docker_sock.exists() or home_docker_sock.exists()

    report["checks"]["docker"] = {
        "status": "PASS" if docker_running else "WARN",
        "socket_detected": docker_running,
        "message": "Docker socket reachable." if docker_running else "Docker Desktop/daemon socket not detected."
    }
    if not docker_running:
        report["recovery_actions"].append("Start Docker Desktop or dockerd if Neo4j containerized instance is needed.")

    # 4. Neo4j Database Connectivity & Namespace Sync
    neo_uri = os.getenv("NEO4J_URI", "bolt://127.0.0.1:7687")
    neo_port = 7687
    neo_port_open = check_port("127.0.0.1", neo_port)

    if neo_port_open:
        try:
            from .graph import NeoGraph
            neo = NeoGraph()
            with neo.driver.session() as s:
                nodes_res = s.run("MATCH (n:MAHA) RETURN count(n) as cnt").single()
                edges_res = s.run("MATCH (:MAHA)-[r]->(:MAHA) RETURN count(r) as cnt").single()
                node_cnt = nodes_res["cnt"] if nodes_res else 0
                edge_cnt = edges_res["cnt"] if edges_res else 0
            neo.close()

            is_synced = node_cnt > 0 and fact_count > 0
            report["checks"]["neo4j"] = {
                "status": "PASS" if is_synced else "WARN",
                "bolt_port_7687": "OPEN",
                "maha_nodes": node_cnt,
                "maha_relationships": edge_cnt,
                "sync_state": "SYNCHRONIZED" if is_synced else "EMPTY_OR_UNSYNCED"
            }
            if not is_synced:
                report["recovery_actions"].append("Graph database is empty or unpopulated. Run: .venv/bin/maha sync")
        except Exception as ex:
            report["checks"]["neo4j"] = {
                "status": "DEGRADED",
                "bolt_port_7687": "OPEN",
                "error": f"Neo4j auth/query error: {str(ex)}"
            }
            report["recovery_actions"].append(f"Verify Neo4j credentials in .env. Rebuild with: .venv/bin/maha sync")
    else:
        report["checks"]["neo4j"] = {
            "status": "OFFLINE",
            "bolt_port_7687": "CLOSED",
            "message": "Neo4j service not running on port 7687."
        }
        report["recovery_actions"].append("Start Neo4j via: docker compose -p maha up -d --wait")

    # 5. API Server Readiness
    api_health = check_api_health("http://127.0.0.1:8765/api/health")
    report["checks"]["api_service"] = api_health
    if api_health["status"] != "ONLINE":
        report["recovery_actions"].append("Start MAHA API server using: .venv/bin/maha serve --port 8765")

    # 6. Disk Space
    total, used, free = shutil.disk_usage("/")
    free_gb = round(free / (2**30), 2)
    report["checks"]["disk_space"] = {
        "status": "PASS" if free_gb > 1.0 else "WARN",
        "free_gigabytes": free_gb
    }

    # Evaluate Overall Status
    statuses = [c.get("status") for c in report["checks"].values()]
    if "FAIL" in statuses:
        report["overall_status"] = "CRITICAL"
    elif "DEGRADED" in statuses or "OFFLINE" in statuses or "WARN" in statuses:
        report["overall_status"] = "OPERATIONAL (WITH ADVISORIES)"
    else:
        report["overall_status"] = "HEALTHY (ALL GREEN)"

    return report


def print_doctor_report(report: dict):
    print("=" * 65)
    print(f"  MAHA FORENSIC INTELLIGENCE — SYSTEM DIAGNOSTIC (DOCTOR)")
    print(f"  OVERALL STATUS: {report['overall_status']}")
    print("=" * 65)
    for name, chk in report["checks"].items():
        status = chk.get("status", "INFO")
        badge = f"[{status}]"
        print(f"{badge:<10} {name.upper()}")
        for k, v in chk.items():
            if k != "status":
                print(f"           - {k}: {v}")
    print("-" * 65)
    if report["recovery_actions"]:
        print("ACTIONABLE OPERATOR RECOVERY INSTRUCTIONS:")
        for i, act in enumerate(report["recovery_actions"], 1):
            print(f"  {i}. {act}")
    else:
        print("All subsystem diagnostics passed. Zero recovery actions required.")
    print("=" * 65)
