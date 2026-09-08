"""
DiaEase Flask Application
REST API server for DiaEase AI Agent.
Enables seamless communication with the frontend teammate's interface.
"""

import os
from flask import Flask, request, jsonify
from flask_cors import CORS

from backend.db import (
    init_db,
    insert_history,
    get_history,
    insert_action,
    update_action_status,
    get_action
)
from backend.agent import (
    normalize_context,
    assess_hypoglycaemia_risk,
    predict_30min_glucose,
    decide_action,
    execute_action,
    analyze_patterns,
    DISCLAIMER
)

app = Flask(__name__)
# Enable CORS for all routes and origins so the frontend teammate can easily connect
CORS(app, resources={r"/api/*": {"origins": "*"}})

# Ensure database is initialized on startup
init_db()


@app.route("/api/health", methods=["GET"])
def health_check():
    """Health check endpoint for frontend verification."""
    return jsonify({
        "status": "healthy",
        "service": "DiaEase AI Agent Backend",
        "version": "1.0.0",
        "disclaimer": DISCLAIMER
    }), 200


@app.route("/api/analyze", methods=["POST"])
def analyze():
    """
    Main AI Agent Endpoint:
    1. Receives & validates health context
    2. Performs Hypoglycaemia Risk Assessment (Feature 1)
    3. Generates 30-Minute Glucose Prediction (Feature 2)
    4. Decides whether to propose follow-up action (Feature 3)
    5. Saves entry to SQLite history
    6. Returns combined decision-support payload
    """
    data = request.get_json() or {}

    # 1. Normalize and sanitize input context
    context = normalize_context(data)

    # 2. Feature 1: Assess Hypoglycaemia Risk
    risk_assessment = assess_hypoglycaemia_risk(context)

    # 3. Feature 2: Predict 30-Minute Glucose Trajectory
    prediction = predict_30min_glucose(context)

    # 4. Feature 3: Decide Action Proposal
    action_proposal = decide_action(context, risk_assessment, prediction)

    # Store proposed action in DB
    insert_action(action_proposal)

    # 5. Store history record in DB
    history_record = {
        "glucose": context["glucose"],
        "trend": context["trend"],
        "insulin_taken": context["insulin_taken"],
        "insulin_dose": context["insulin_dose"],
        "time_since_insulin": context["time_since_insulin"],
        "recent_meal": context["recent_meal"],
        "carb_intake": context["carb_intake"],
        "activity_level": context["activity_level"],
        "time_of_day": context["time_of_day"],
        "risk_score": risk_assessment["risk_score"],
        "risk_level": risk_assessment["risk_level"],
        "predicted_glucose": prediction["predicted_glucose"],
        "factors": risk_assessment["factors"],
        "action_id": action_proposal["id"]
    }
    history_id = insert_history(history_record)

    # 6. Response payload
    response_data = {
        "success": True,
        "history_id": history_id,
        "risk_level": risk_assessment["risk_level"],
        "risk_score": risk_assessment["risk_score"],
        "factors": risk_assessment["factors"],
        "explanation": risk_assessment["explanation"],
        "prediction": prediction,
        "proposed_action": action_proposal,
        "context_received": context,
        "disclaimer": DISCLAIMER
    }

    return jsonify(response_data), 200


@app.route("/api/action/propose", methods=["POST"])
def propose_action():
    """
    Explicit endpoint to propose an action based on context or manual request.
    """
    data = request.get_json() or {}
    context = normalize_context(data)
    risk_assessment = assess_hypoglycaemia_risk(context)
    prediction = predict_30min_glucose(context)
    action_proposal = decide_action(context, risk_assessment, prediction)

    insert_action(action_proposal)

    return jsonify({
        "success": True,
        "action": action_proposal,
        "disclaimer": DISCLAIMER
    }), 200


@app.route("/api/action/approve", methods=["POST"])
def approve_action():
    """
    User approves proposed action:
    - Status set to 'approved'
    - Agent executes the action (creates active reminder schedule)
    - Returns confirmation
    """
    data = request.get_json() or {}
    action_id = data.get("action_id") or data.get("id")

    if not action_id:
        return jsonify({"error": "action_id is required"}), 400

    existing = get_action(action_id)
    if not existing:
        return jsonify({"error": f"Action with id '{action_id}' not found"}), 404

    # Execute action
    execution_details = execute_action(existing)

    # Update in database
    update_action_status(action_id, "approved", execution_details)

    updated = get_action(action_id)

    return jsonify({
        "success": True,
        "status": "approved",
        "action_id": action_id,
        "action": updated["action"],
        "execution_details": updated["execution_details"],
        "message": "Action successfully approved and executed by agent.",
        "disclaimer": DISCLAIMER
    }), 200


@app.route("/api/action/dismiss", methods=["POST"])
def dismiss_action():
    """
    User dismisses proposed action:
    - Status set to 'dismissed'
    - No follow-up executed
    """
    data = request.get_json() or {}
    action_id = data.get("action_id") or data.get("id")

    if not action_id:
        return jsonify({"error": "action_id is required"}), 400

    existing = get_action(action_id)
    if not existing:
        return jsonify({"error": f"Action with id '{action_id}' not found"}), 404

    update_action_status(action_id, "dismissed")
    updated = get_action(action_id)

    return jsonify({
        "success": True,
        "status": "dismissed",
        "action_id": action_id,
        "action": updated["action"],
        "message": "Action proposal dismissed by user.",
        "disclaimer": DISCLAIMER
    }), 200


@app.route("/api/history", methods=["GET"])
def history():
    """Returns recent analysis history records."""
    limit = request.args.get("limit", 50, type=int)
    records = get_history(limit=limit)
    return jsonify({
        "success": True,
        "count": len(records),
        "history": records,
        "disclaimer": DISCLAIMER
    }), 200


@app.route("/api/recommendation", methods=["GET"])
def recommendation():
    """
    Feature 4: Adaptive Pattern Recommendation.
    Analyzes historical records to extract recurring glycemic patterns.
    """
    records = get_history(limit=100)
    result = analyze_patterns(records)

    return jsonify({
        "success": True,
        **result,
        "disclaimer": DISCLAIMER
    }), 200


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print(f"Starting DiaEase AI Agent Backend on port {port}...")
    app.run(host="0.0.0.0", port=port, debug=False)
