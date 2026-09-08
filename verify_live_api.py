"""
Live API Verification Script for DiaEase AI Agent
Tests HTTP endpoints on running Flask server (port 5000).
"""

import requests
import json
import sys

BASE_URL = "http://127.0.0.1:5000"

def test_live_suite():
    print("=" * 60)
    print("DIAEASE AI AGENT LIVE API VERIFICATION")
    print("=" * 60)

    # 1. Health check
    print("\n1. Testing GET /api/health...")
    r = requests.get(f"{BASE_URL}/api/health")
    assert r.status_code == 200, f"Health failed: {r.text}"
    print(f"   [SUCCESS] Status: {r.json()['status']}, Service: {r.json()['service']}")

    # 2. Scenario A: Normal / Stable Glucose -> LOW Risk
    print("\n2. Testing Scenario A (Normal / Stable Glucose -> LOW Risk)...")
    payload_a = {
        "current_glucose": 110,
        "trend": "stable",
        "insulin_taken": "no",
        "insulin_dose": 0,
        "time_since_insulin": 0,
        "recent_meal": "yes",
        "carb_intake": 50,
        "activity_level": "none",
        "time_of_day": "morning"
    }
    r = requests.post(f"{BASE_URL}/api/analyze", json=payload_a)
    assert r.status_code == 200, f"Scenario A failed: {r.text}"
    res_a = r.json()
    print(f"   [SUCCESS] Risk Level: {res_a['risk_level']} (Score: {res_a['risk_score']}/100)")
    print(f"   Prediction: {res_a['prediction']['current_glucose']} -> {res_a['prediction']['predicted_glucose']} mg/dL ({res_a['prediction']['direction']})")
    print(f"   Explanation: {res_a['explanation']}")
    assert res_a["risk_level"] == "LOW", f"Expected LOW, got {res_a['risk_level']}"

    # 3. Scenario B: Moderate Risk Context -> MODERATE Risk
    print("\n3. Testing Scenario B (Moderate Risk Context -> MODERATE Risk)...")
    payload_b = {
        "current_glucose": 88,
        "trend": "stable",
        "insulin_taken": "yes",
        "insulin_dose": 2.5,
        "time_since_insulin": 60,
        "recent_meal": "no",
        "carb_intake": 0,
        "activity_level": "low",
        "time_of_day": "afternoon"
    }
    r = requests.post(f"{BASE_URL}/api/analyze", json=payload_b)
    assert r.status_code == 200, f"Scenario B failed: {r.text}"
    res_b = r.json()
    print(f"   [SUCCESS] Risk Level: {res_b['risk_level']} (Score: {res_b['risk_score']}/100)")
    print(f"   Factors: {res_b['factors']}")
    assert res_b["risk_level"] == "MODERATE", f"Expected MODERATE, got {res_b['risk_level']}"

    # 4. Scenario C: Falling Glucose + Insulin + Activity -> HIGH Risk
    print("\n4. Testing Scenario C (Falling Glucose + Insulin + Activity -> HIGH Risk)...")
    payload_c = {
        "current_glucose": 82,
        "trend": "falling",
        "insulin_taken": "yes",
        "insulin_dose": 4.0,
        "time_since_insulin": 45,
        "recent_meal": "no",
        "carb_intake": 0,
        "activity_level": "moderate",
        "time_of_day": "afternoon"
    }
    r = requests.post(f"{BASE_URL}/api/analyze", json=payload_c)
    assert r.status_code == 200, f"Scenario C failed: {r.text}"
    res_c = r.json()
    print(f"   [SUCCESS] Risk Level: {res_c['risk_level']} (Score: {res_c['risk_score']}/100)")
    print(f"   Prediction: {res_c['prediction']['current_glucose']} -> {res_c['prediction']['predicted_glucose']} mg/dL ({res_c['prediction']['direction']})")
    print(f"   Trajectory: {res_c['prediction']['trajectory']}")
    print(f"   Proposed Action: {res_c['proposed_action']['action']} (Status: {res_c['proposed_action']['status']})")
    print(f"   Message: {res_c['proposed_action']['message']}")
    assert res_c["risk_level"] == "HIGH", f"Expected HIGH, got {res_c['risk_level']}"
    assert res_c["proposed_action"]["requires_approval"] is True
    action_id_to_approve = res_c["proposed_action"]["id"]

    # 5. Testing Action Approval: User Approves -> Agent Executes
    print(f"\n5. Testing Action Approval for {action_id_to_approve}...")
    r = requests.post(f"{BASE_URL}/api/action/approve", json={"action_id": action_id_to_approve})
    assert r.status_code == 200, f"Approve failed: {r.text}"
    res_appr = r.json()
    print(f"   [SUCCESS] Action Status: {res_appr['status']}")
    print(f"   Execution Details: {res_appr['execution_details']}")
    assert res_appr["status"] == "approved"
    assert res_appr["execution_details"]["reminder_status"] == "active"

    # 6. Testing Action Dismissal: User Dismisses
    print("\n6. Testing Action Dismissal...")
    # Propose another action
    r = requests.post(f"{BASE_URL}/api/action/propose", json=payload_b)
    action_id_to_dismiss = r.json()["action"]["id"]
    r = requests.post(f"{BASE_URL}/api/action/dismiss", json={"action_id": action_id_to_dismiss})
    assert r.status_code == 200, f"Dismiss failed: {r.text}"
    res_dism = r.json()
    print(f"   [SUCCESS] Action Status: {res_dism['status']} for {res_dism['action_id']}")
    assert res_dism["status"] == "dismissed"

    # 7. Testing History Retrieval: GET /api/history
    print("\n7. Testing GET /api/history...")
    r = requests.get(f"{BASE_URL}/api/history")
    assert r.status_code == 200, f"History failed: {r.text}"
    res_hist = r.json()
    print(f"   [SUCCESS] History records returned: {res_hist['count']}")
    assert res_hist["count"] >= 3

    # 8. Testing Feature 4: Adaptive Pattern Recommendation
    print("\n8. Testing Feature 4: GET /api/recommendation...")
    r = requests.get(f"{BASE_URL}/api/recommendation")
    assert r.status_code == 200, f"Recommendation failed: {r.text}"
    res_rec = r.json()
    print(f"   [SUCCESS] Pattern Detected: {res_rec['pattern_detected']}")
    print(f"   Message: {res_rec.get('message')}")
    print(f"   Recommendation: {res_rec.get('recommendation')}")
    assert res_rec["pattern_detected"] is True

    print("\n" + "=" * 60)
    print("ALL LIVE REST API TESTS PASSED SUCCESSFULLY!")
    print("=" * 60)

if __name__ == "__main__":
    try:
        test_live_suite()
    except Exception as e:
        print(f"\n[FAILED] Error during live verification: {e}")
        sys.exit(1)
