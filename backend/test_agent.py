"""
MedLens AI Agent Backend Test Suite
Tests all 4 features and endpoints according to specification:
- Scenario A: Normal/stable glucose -> LOW risk
- Scenario B: Moderate-risk context -> MODERATE risk
- Scenario C: Falling glucose + insulin + activity -> HIGH risk
- Action approval workflow
- Action dismissal workflow
- History retrieval & Feature 4 Adaptive Pattern Recommendation
"""

import os
import sys
import json
import tempfile
import unittest

# Ensure both repository root and backend directory are in sys.path
current_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.dirname(current_dir)
for p in [parent_dir, current_dir]:
    if p not in sys.path:
        sys.path.insert(0, p)

# Ensure we use a clean temporary SQLite database for tests
temp_db_fd, temp_db_path = tempfile.mkstemp(suffix=".db")
os.close(temp_db_fd)
os.environ["MEDLENS_DB_PATH"] = temp_db_path

try:
    import backend.db as db
    from backend.app import app
except ImportError:
    import db
    from app import app

db.DEFAULT_DB_PATH = temp_db_path
db.init_db(temp_db_path)


class TestMedLensAgent(unittest.TestCase):

    def setUp(self):
        self.client = app.test_client()

    def test_01_health_check(self):
        res = self.client.get("/api/health")
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertEqual(data["status"], "healthy")
        self.assertEqual(data["service"], "MedLens AI Agent Backend")
        self.assertIn("disclaimer", data)
        self.assertIn("MedLens", data["disclaimer"])
        print("\n[PASS] Health check endpoint OK (MedLens)")

    def test_01b_insufficient_history_pattern(self):
        """Feature 4: Test insufficient history (< 3 records) returns pattern_detected=False"""
        rec_res = self.client.get("/api/recommendation")
        self.assertEqual(rec_res.status_code, 200)
        rec_data = rec_res.get_json()
        self.assertFalse(rec_data["pattern_detected"])
        self.assertIn("Keep logging", rec_data["message"])
        print(f"\n[PASS] Insufficient History check: {rec_data['message']}")

    def test_02_scenario_a_low_risk(self):
        """Scenario A: Normal/stable glucose -> LOW risk"""
        payload = {
            "current_glucose": 110,
            "trend": "stable",
            "insulin_taken": False,
            "insulin_dose": 0,
            "time_since_insulin": 0,
            "recent_meal": True,
            "carb_intake": 45,
            "activity_level": "none",
            "time_of_day": "morning"
        }
        res = self.client.post("/api/analyze", json=payload)
        self.assertEqual(res.status_code, 200)
        data = res.get_json()

        self.assertEqual(data["risk_level"], "LOW", f"Expected LOW risk, got {data['risk_level']}")
        self.assertLess(data["risk_score"], 40, f"Expected risk_score < 40, got {data['risk_score']}")
        self.assertIn("prediction", data)
        self.assertIn("trajectory", data["prediction"])
        self.assertEqual(len(data["prediction"]["trajectory"]), 4)
        self.assertIn("proposed_action", data)
        self.assertEqual(data["proposed_action"]["status"], "pending")
        print(f"\n[PASS] Scenario A (LOW Risk): Score={data['risk_score']}, Level={data['risk_level']}")

    def test_03_scenario_b_moderate_risk(self):
        """Scenario B: Moderate-risk context -> MODERATE risk"""
        payload = {
            "current_glucose": 88,
            "trend": "stable",
            "insulin_taken": True,
            "insulin_dose": 2.5,
            "time_since_insulin": 60,
            "recent_meal": False,
            "carb_intake": 0,
            "activity_level": "low",
            "time_of_day": "afternoon"
        }
        res = self.client.post("/api/analyze", json=payload)
        self.assertEqual(res.status_code, 200)
        data = res.get_json()

        self.assertEqual(data["risk_level"], "MODERATE", f"Expected MODERATE risk, got {data['risk_level']}")
        self.assertTrue(40 <= data["risk_score"] < 70, f"Expected 40 <= score < 70, got {data['risk_score']}")
        self.assertTrue(len(data["factors"]) > 0)
        print(f"\n[PASS] Scenario B (MODERATE Risk): Score={data['risk_score']}, Level={data['risk_level']}")

    def test_04_scenario_c_high_risk(self):
        """Scenario C: Falling glucose + insulin + activity -> HIGH risk"""
        payload = {
            "current_glucose": 82,
            "trend": "falling",
            "insulin_taken": True,
            "insulin_dose": 4.0,
            "time_since_insulin": 45,
            "recent_meal": False,
            "carb_intake": 0,
            "activity_level": "moderate",
            "time_of_day": "afternoon"
        }
        res = self.client.post("/api/analyze", json=payload)
        self.assertEqual(res.status_code, 200)
        data = res.get_json()

        self.assertEqual(data["risk_level"], "HIGH", f"Expected HIGH risk, got {data['risk_level']}")
        self.assertGreaterEqual(data["risk_score"], 70, f"Expected score >= 70, got {data['risk_score']}")
        
        # Verify contributing factors contain falling trend, insulin, activity
        factors_text = " ".join(data["factors"]).lower()
        self.assertIn("falling", factors_text)
        self.assertIn("insulin", factors_text)
        self.assertIn("activity", factors_text)

        # Verify 30-minute prediction
        prediction = data["prediction"]
        self.assertEqual(prediction["current_glucose"], 82)
        self.assertLess(prediction["predicted_glucose"], 82)
        self.assertEqual(prediction["direction"], "falling")

        # Verify proposed action
        action = data["proposed_action"]
        self.assertTrue(action["requires_approval"])
        self.assertEqual(action["status"], "pending")
        self.assertEqual(action["action"], "glucose_recheck_reminder")
        self.assertIn("MedLens", action["message"])

        print(f"\n[PASS] Scenario C (HIGH Risk): Score={data['risk_score']}, Level={data['risk_level']}, Predicted={prediction['predicted_glucose']}")

    def test_05_action_approval(self):
        """Test Action Approval Workflow: User approves -> Agent executes"""
        res = self.client.post("/api/analyze", json={
            "current_glucose": 80,
            "trend": "falling",
            "insulin_taken": True,
            "insulin_dose": 3,
            "time_since_insulin": 40,
            "recent_meal": False,
            "carb_intake": 0,
            "activity_level": "moderate",
            "time_of_day": "afternoon"
        })
        action = res.get_json()["proposed_action"]
        action_id = action["id"]

        # User approves action
        approve_res = self.client.post("/api/action/approve", json={"action_id": action_id})
        self.assertEqual(approve_res.status_code, 200)
        approved_data = approve_res.get_json()

        self.assertTrue(approved_data["success"])
        self.assertEqual(approved_data["status"], "approved")
        self.assertIn("execution_details", approved_data)
        self.assertEqual(approved_data["execution_details"]["reminder_status"], "active")
        self.assertIn("scheduled_reminder_time", approved_data["execution_details"])
        print(f"\n[PASS] Action Approval: Action {action_id} approved and executed successfully")

    def test_06_action_dismissal(self):
        """Test Action Dismissal Workflow: User dismisses -> Status set to dismissed"""
        res = self.client.post("/api/analyze", json={
            "current_glucose": 95,
            "trend": "stable",
            "insulin_taken": False,
            "recent_meal": True,
            "carb_intake": 30,
            "activity_level": "none"
        })
        action = res.get_json()["proposed_action"]
        action_id = action["id"]

        dismiss_res = self.client.post("/api/action/dismiss", json={"action_id": action_id})
        self.assertEqual(dismiss_res.status_code, 200)
        dismiss_data = dismiss_res.get_json()

        self.assertTrue(dismiss_data["success"])
        self.assertEqual(dismiss_data["status"], "dismissed")
        print(f"\n[PASS] Action Dismissal: Action {action_id} dismissed successfully")

    def test_07_history_and_pattern_recommendation(self):
        """Test History and Feature 4 Adaptive Pattern Recommendation"""
        # 1. Fetch history
        hist_res = self.client.get("/api/history")
        self.assertEqual(hist_res.status_code, 200)
        hist_data = hist_res.get_json()
        self.assertGreaterEqual(hist_data["count"], 4)
        print(f"\n[PASS] History retrieved: {hist_data['count']} entries present")

        # 2. Pattern Recommendation
        rec_res = self.client.get("/api/recommendation")
        self.assertEqual(rec_res.status_code, 200)
        rec_data = rec_res.get_json()
        self.assertTrue(rec_data["success"])
        self.assertTrue(rec_data["pattern_detected"])
        self.assertIn("message", rec_data)
        self.assertIn("recommendation", rec_data)
        self.assertIn("MedLens", rec_data["recommendation"] + rec_data["message"])
        print(f"[PASS] Adaptive Pattern: {rec_data['message']}")


if __name__ == "__main__":
    unittest.main()
