"""
MedLens Database Module (SQLite)
Minimal schema for logging demo history and tracking user-approved actions.
"""

import sqlite3
import os
import json
from datetime import datetime

DEFAULT_DB_PATH = os.environ.get(
    "MEDLENS_DB_PATH",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "medlens.db")
)


def get_connection(db_path=None):
    if db_path is None:
        db_path = DEFAULT_DB_PATH
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn


def init_db(db_path=None):
    """Initializes history and actions tables if they do not exist."""
    conn = get_connection(db_path)
    cursor = conn.cursor()

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            glucose REAL NOT NULL,
            trend TEXT NOT NULL,
            insulin_taken INTEGER NOT NULL,
            insulin_dose REAL,
            time_since_insulin REAL,
            recent_meal INTEGER NOT NULL,
            carb_intake REAL,
            activity_level TEXT,
            time_of_day TEXT,
            risk_score INTEGER NOT NULL,
            risk_level TEXT NOT NULL,
            predicted_glucose REAL,
            factors_json TEXT,
            action_id TEXT
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS actions (
            id TEXT PRIMARY KEY,
            timestamp TEXT NOT NULL,
            action TEXT NOT NULL,
            message TEXT NOT NULL,
            status TEXT NOT NULL,
            execution_details TEXT
        )
    """)

    conn.commit()
    conn.close()


def insert_history(record, db_path=None):
    """Inserts a health context analysis record into history."""
    conn = get_connection(db_path)
    cursor = conn.cursor()

    timestamp = record.get("timestamp") or datetime.now().isoformat()
    factors_json = json.dumps(record.get("factors", []))

    cursor.execute("""
        INSERT INTO history (
            timestamp, glucose, trend, insulin_taken, insulin_dose,
            time_since_insulin, recent_meal, carb_intake, activity_level,
            time_of_day, risk_score, risk_level, predicted_glucose,
            factors_json, action_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        timestamp,
        float(record.get("glucose", 0)),
        str(record.get("trend", "stable")).lower(),
        1 if record.get("insulin_taken") in [True, "yes", 1] else 0,
        float(record.get("insulin_dose", 0)) if record.get("insulin_dose") is not None else 0.0,
        float(record.get("time_since_insulin", 0)) if record.get("time_since_insulin") is not None else 0.0,
        1 if record.get("recent_meal") in [True, "yes", 1] else 0,
        float(record.get("carb_intake", 0)) if record.get("carb_intake") is not None else 0.0,
        str(record.get("activity_level", "none")).lower(),
        str(record.get("time_of_day", "unspecified")),
        int(record.get("risk_score", 0)),
        str(record.get("risk_level", "LOW")),
        float(record.get("predicted_glucose", 0)) if record.get("predicted_glucose") is not None else None,
        factors_json,
        record.get("action_id")
    ))

    conn.commit()
    inserted_id = cursor.lastrowid
    conn.close()
    return inserted_id


def get_history(limit=50, db_path=None):
    """Fetches past history records sorted by timestamp descending."""
    conn = get_connection(db_path)
    cursor = conn.cursor()

    cursor.execute("""
        SELECT * FROM history ORDER BY id DESC LIMIT ?
    """, (limit,))

    rows = cursor.fetchall()
    results = []
    for r in rows:
        item = dict(r)
        if item.get("factors_json"):
            try:
                item["factors"] = json.loads(item["factors_json"])
            except Exception:
                item["factors"] = []
        else:
            item["factors"] = []
        item["insulin_taken"] = bool(item["insulin_taken"])
        item["recent_meal"] = bool(item["recent_meal"])
        results.append(item)

    conn.close()
    return results


def insert_action(action_data, db_path=None):
    """Inserts a new proposed action."""
    conn = get_connection(db_path)
    cursor = conn.cursor()

    timestamp = action_data.get("timestamp") or datetime.now().isoformat()
    exec_details = action_data.get("execution_details")
    if isinstance(exec_details, (dict, list)):
        exec_details = json.dumps(exec_details)

    cursor.execute("""
        INSERT OR REPLACE INTO actions (
            id, timestamp, action, message, status, execution_details
        ) VALUES (?, ?, ?, ?, ?, ?)
    """, (
        action_data["id"],
        timestamp,
        action_data["action"],
        action_data["message"],
        action_data.get("status", "pending"),
        exec_details
    ))

    conn.commit()
    conn.close()


def update_action_status(action_id, status, execution_details=None, db_path=None):
    """Updates the status and execution details of an action."""
    conn = get_connection(db_path)
    cursor = conn.cursor()

    if isinstance(execution_details, (dict, list)):
        execution_details = json.dumps(execution_details)

    cursor.execute("""
        UPDATE actions
        SET status = ?, execution_details = COALESCE(?, execution_details)
        WHERE id = ?
    """, (status, execution_details, action_id))

    conn.commit()
    updated = cursor.rowcount > 0
    conn.close()
    return updated


def get_action(action_id, db_path=None):
    """Retrieves an action by ID."""
    conn = get_connection(db_path)
    cursor = conn.cursor()

    cursor.execute("SELECT * FROM actions WHERE id = ?", (action_id,))
    row = cursor.fetchone()
    conn.close()
    if row:
        data = dict(row)
        if data.get("execution_details"):
            try:
                data["execution_details"] = json.loads(data["execution_details"])
            except Exception:
                pass
        return data
    return None
