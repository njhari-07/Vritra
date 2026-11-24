import sys
from pathlib import Path
REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

import sqlite3
from maha.store import Store

s = Store()
print("Store initialized and synced.")

# Verify authenticate
user = s.authenticate("abc")
print("SUCCESSFULLY AUTHENTICATED WITH 'abc':", user)

conn = sqlite3.connect("data/private/runtime/ledger.sqlite3")
cursor = conn.cursor()
rows = cursor.execute("SELECT name, token_hash, cases FROM users").fetchall()
print("\nUSERS IN SQLITE TABLE:")
for r in rows:
    print(f"Name: {r[0]}, Hash prefix: {r[1][:12]}..., Cases: {r[2]}")
