"""
MedLens AI Agent Core Logic
Implements the 4 Core Features:
1. Hypoglycaemia Risk Assessment
2. 30-Minute Glucose Prediction
3. Smart Action Proposal & Approval Workflow
4. Adaptive Pattern Recommendation
"""

import uuid
from datetime import datetime, timedelta

DISCLAIMER = (
    "MedLens is a prototype decision-support system and is not a medical device "
    "or a substitute for professional medical advice."
)


def normalize_context(data):
    """
    Sanitizes and normalizes input context from API requests.
    Supports flexible field names and formats.
    """
    # Glucose
    glucose = data.get("current_glucose")
    if glucose is None:
        glucose = data.get("glucose", 100.0)
    try:
        glucose = float(glucose)
    except (ValueError, TypeError):
        glucose = 100.0

    # Trend
    trend = str(data.get("trend") or data.get("glucose_trend") or "stable").strip().lower()
    if trend not in ["rising", "stable", "falling"]:
        if "fall" in trend or "down" in trend:
            trend = "falling"
        elif "rise" in trend or "up" in trend:
            trend = "rising"
        else:
            trend = "stable"

    # Insulin taken
    insulin_raw = data.get("insulin_taken")
    if insulin_raw is None:
        insulin_raw = data.get("insulin", False)
    insulin_taken = insulin_raw in [True, "yes", "true", "1", 1]

    # Insulin dose (units)
    try:
        insulin_dose = float(data.get("insulin_dose", 0.0) or 0.0)
    except (ValueError, TypeError):
        insulin_dose = 0.0

    # Time since insulin (minutes)
    # If user passes hours (e.g. 1.5), normalize to minutes
    try:
        time_since_raw = float(data.get("time_since_insulin", 0.0) or 0.0)
        unit = str(data.get("time_unit", "")).lower()
        if unit in ["hours", "hr", "h"]:
            time_since_insulin = time_since_raw * 60
        else:
            time_since_insulin = time_since_raw
    except (ValueError, TypeError):
        time_since_insulin = 0.0

    # Recent meal
    meal_raw = data.get("recent_meal")
    if meal_raw is None:
        meal_raw = data.get("meal", False)
    recent_meal = meal_raw in [True, "yes", "true", "1", 1]

    # Carb intake (grams)
    try:
        carb_intake = float(data.get("carb_intake", 0.0) or data.get("carbs", 0.0) or 0.0)
    except (ValueError, TypeError):
        carb_intake = 0.0

    # Activity level
    activity = str(data.get("activity_level") or data.get("activity") or "none").strip().lower()
    if activity not in ["none", "low", "moderate", "high"]:
        if "high" in activity or "vigorous" in activity or "intense" in activity or "run" in activity:
            activity = "high"
        elif "mod" in activity or "walk" in activity or "exercise" in activity or "gym" in activity:
            activity = "moderate"
        elif "light" in activity or "low" in activity:
            activity = "low"
        else:
            activity = "none"

    # Time of day
    time_of_day = str(data.get("time_of_day") or "afternoon").strip().lower()

    return {
        "glucose": glucose,
        "trend": trend,
        "insulin_taken": insulin_taken,
        "insulin_dose": insulin_dose,
        "time_since_insulin": time_since_insulin,
        "recent_meal": recent_meal,
        "carb_intake": carb_intake,
        "activity_level": activity,
        "time_of_day": time_of_day
    }


# ==============================================================================
# FEATURE 1: HYPOGLYCAEMIA RISK ASSESSMENT
# ==============================================================================

def assess_hypoglycaemia_risk(context):
    """
    Evaluates context factors and returns:
    - risk_level: LOW | MODERATE | HIGH
    - risk_score: 0 to 100
    - factors: list of contributing factors
    - explanation: plain-English explanation
    """
    glucose = context["glucose"]
    trend = context["trend"]
    insulin_taken = context["insulin_taken"]
    insulin_dose = context["insulin_dose"]
    time_since_insulin = context["time_since_insulin"]
    recent_meal = context["recent_meal"]
    carb_intake = context["carb_intake"]
    activity = context["activity_level"]
    time_of_day = context["time_of_day"]

    score = 0
    factors = []

    # 1. Glucose baseline
    if glucose < 55:
        score += 85
        factors.append(f"Critical low glucose ({glucose:.0f} mg/dL)")
    elif glucose < 70:
        score += 65
        factors.append(f"Borderline hypoglycaemic glucose ({glucose:.0f} mg/dL)")
    elif glucose <= 85:
        score += 40
        factors.append(f"Low-normal baseline glucose ({glucose:.0f} mg/dL)")
    elif glucose <= 100:
        score += 20
        factors.append(f"Lower-tier target glucose ({glucose:.0f} mg/dL)")
    elif glucose <= 140:
        score += 8
    else:
        score += 2

    # 2. Glucose Trend
    if trend == "falling":
        score += 26
        factors.append("Rapidly falling glucose trend")
    elif trend == "stable":
        score += 0
    elif trend == "rising":
        score -= 15
        factors.append("Rising glucose trajectory provides protective upward momentum")

    # 3. Active Insulin
    if insulin_taken:
        # Rapid-acting insulin peak is roughly 30-120 mins
        if 0 <= time_since_insulin <= 120:
            dose_factor = min(28, max(15, int(insulin_dose * 3.5 + 12)))
            score += dose_factor
            dose_str = f" ({insulin_dose}U)" if insulin_dose > 0 else ""
            factors.append(f"Active insulin in peak absorption window{dose_str} administered {time_since_insulin:.0f}m ago")
        elif 120 < time_since_insulin <= 240:
            score += 10
            factors.append(f"Residual active insulin tail ({time_since_insulin:.0f}m post-dose)")
        else:
            score += 4

    # 4. Physical Activity
    if activity == "high":
        score += 24
        factors.append("High-intensity physical activity accelerating glucose uptake")
    elif activity == "moderate":
        score += 16
        factors.append("Moderate physical activity increasing muscular glucose utilization")
    elif activity == "low":
        score += 6

    # 5. Meal & Carbohydrate Buffering
    if recent_meal:
        if carb_intake >= 40:
            score -= 22
            factors.append(f"Substantial carbohydrate intake ({carb_intake:.0f}g) offsetting drop risk")
        elif carb_intake >= 20:
            score -= 14
            factors.append(f"Moderate carbohydrate intake ({carb_intake:.0f}g) buffering glucose levels")
        else:
            score -= 6
    else:
        if insulin_taken and (glucose < 90 or trend == "falling"):
            score += 10
            factors.append("No recent meal to counteract active insulin")

    # 6. Nocturnal / Time of Day risk
    if time_of_day in ["night", "bedtime", "late night", "sleep"]:
        score += 8
        factors.append("Nighttime context carries increased risk of undetected nocturnal drops")

    # Clamp score
    risk_score = max(5, min(98, score))

    # Categorize Risk Level
    if risk_score >= 70:
        risk_level = "HIGH"
    elif risk_score >= 40:
        risk_level = "MODERATE"
    else:
        risk_level = "LOW"

    # Generate plain-English explanation
    explanation = generate_explanation(risk_level, risk_score, factors, context)

    return {
        "risk_level": risk_level,
        "risk_score": risk_score,
        "factors": factors,
        "explanation": explanation
    }


def generate_explanation(risk_level, risk_score, factors, context):
    """Builds a clear, plain-English explanation for the user."""
    glucose = context["glucose"]
    trend = context["trend"]

    if risk_level == "HIGH":
        key_reasons = []
        if trend == "falling":
            key_reasons.append("a falling trend")
        if context["insulin_taken"]:
            key_reasons.append("active insulin")
        if context["activity_level"] in ["moderate", "high"]:
            key_reasons.append(f"{context['activity_level']} physical activity")

        reason_text = " combined with " + " and ".join(key_reasons) if key_reasons else ""
        return (
            f"The current context suggests elevated near-term hypoglycaemia risk (Score: {risk_score}/100). "
            f"Your current glucose of {glucose:.0f} mg/dL{reason_text} creates heightened sensitivity "
            f"to rapid downward glucose shifts."
        )
    elif risk_level == "MODERATE":
        return (
            f"Your current context indicates moderate hypoglycaemia risk (Score: {risk_score}/100). "
            f"Current glucose is {glucose:.0f} mg/dL with {trend} momentum. Close monitoring is advisable "
            f"as physiological factors could accelerate downward drift."
        )
    else:
        return (
            f"Your current context suggests low near-term hypoglycaemia risk (Score: {risk_score}/100). "
            f"Glucose level ({glucose:.0f} mg/dL) is within a stable buffer zone with sufficient counter-regulatory support."
        )


# ==============================================================================
# FEATURE 2: 30-MINUTE GLUCOSE PREDICTION
# ==============================================================================

def predict_30min_glucose(context):
    """
    Lightweight, transparent prototype prediction/simulation.
    Calculates estimated glucose after approximately 30 minutes with trajectory points.
    """
    current_glucose = context["glucose"]
    trend = context["trend"]
    insulin_taken = context["insulin_taken"]
    insulin_dose = context["insulin_dose"]
    time_since_insulin = context["time_since_insulin"]
    recent_meal = context["recent_meal"]
    carb_intake = context["carb_intake"]
    activity = context["activity_level"]

    # Baseline velocity in mg/dL per minute
    if trend == "falling":
        velocity = -0.75
    elif trend == "rising":
        velocity = 0.55
    else:
        velocity = 0.0

    # Active insulin downward pull
    if insulin_taken and time_since_insulin <= 180:
        active_fraction = max(0.2, (180 - time_since_insulin) / 180.0)
        dose_rate = (insulin_dose * 0.06 + 0.15) * active_fraction
        velocity -= dose_rate

    # Activity downward pull
    if activity == "high":
        velocity -= 0.35
    elif activity == "moderate":
        velocity -= 0.20
    elif activity == "low":
        velocity -= 0.08

    # Carbohydrate upward pull
    if recent_meal and carb_intake > 0:
        carb_rate = min(0.65, carb_intake * 0.015)
        velocity += carb_rate

    # Calculate 10-minute interval trajectory
    trajectory = []
    for minute in [0, 10, 20, 30]:
        if minute == 0:
            val = current_glucose
        else:
            damping = 1.0
            projected = current_glucose + (velocity * minute * damping)
            val = round(max(38.0, min(380.0, projected)))
        trajectory.append({"minute": minute, "glucose": int(val)})

    predicted_glucose = trajectory[-1]["glucose"]

    delta = predicted_glucose - current_glucose
    if delta <= -4:
        direction = "falling"
    elif delta >= 4:
        direction = "rising"
    else:
        direction = "stable"

    return {
        "current_glucose": int(current_glucose),
        "predicted_glucose": int(predicted_glucose),
        "direction": direction,
        "trajectory": trajectory
    }


# ==============================================================================
# FEATURE 3: SMART ACTION AGENT WITH USER APPROVAL
# ==============================================================================

def decide_action(context, risk_assessment, prediction):
    """
    Decides whether a safe follow-up action should be proposed based on risk assessment.
    Returns proposed action object requiring explicit user approval.
    """
    risk_level = risk_assessment["risk_level"]
    risk_score = risk_assessment["risk_score"]
    predicted_glucose = prediction["predicted_glucose"]

    action_id = f"act_{uuid.uuid4().hex[:8]}"

    if risk_level == "HIGH" or predicted_glucose < 75:
        action_type = "glucose_recheck_reminder"
        message = (
            f"High risk detected (Score: {risk_score}, predicted {predicted_glucose} mg/dL). "
            f"Would you like MedLens to set a 15-minute glucose re-check reminder and remind you to keep fast-acting carbs ready?"
        )
        recommended_interval = 15
        suggested_steps = [
            "Set a 15-minute timer for rapid glucose re-check",
            "Keep 15g of fast-acting carbohydrates accessible (e.g. 4oz fruit juice or glucose tablets)",
            "Pause strenuous physical activity while glucose stabilizes"
        ]
        requires_approval = True

    elif risk_level == "MODERATE" or predicted_glucose < 90:
        action_type = "scheduled_recheck_reminder"
        message = (
            f"Moderate risk identified (Score: {risk_score}). "
            f"Would you like MedLens to set a 30-minute follow-up glucose re-check reminder?"
        )
        recommended_interval = 30
        suggested_steps = [
            "Set a 30-minute follow-up re-check timer",
            "Monitor for subtle symptoms such as shakiness, sweating, or lightheadedness"
        ]
        requires_approval = True

    else:
        action_type = "routine_monitoring"
        message = (
            f"Current glycemic context is stable (Score: {risk_score}). "
            f"Would you like to schedule your standard routine check in 2 hours?"
        )
        recommended_interval = 120
        suggested_steps = [
            "Maintain regular routine",
            "Next scheduled check in approximately 2 hours"
        ]
        requires_approval = True

    return {
        "id": action_id,
        "action_id": action_id,
        "action": action_type,
        "message": message,
        "requires_approval": requires_approval,
        "status": "pending",
        "recommended_interval_minutes": recommended_interval,
        "suggested_steps": suggested_steps,
        "created_at": datetime.now().isoformat()
    }


def execute_action(action_data):
    """
    Executes an action ONLY after user approval.
    Creates reminder details, execution timestamp, and notification parameters.
    """
    interval = action_data.get("recommended_interval_minutes", 15)
    now = datetime.now()
    scheduled_time = (now + timedelta(minutes=interval)).strftime("%H:%M:%S")

    execution_details = {
        "action_type": action_data.get("action"),
        "executed_at": now.isoformat(),
        "scheduled_reminder_time": scheduled_time,
        "interval_minutes": interval,
        "reminder_status": "active",
        "confirmation_message": (
            f"Action confirmed. Glucose re-check reminder scheduled for {scheduled_time} "
            f"({interval} minutes from now)."
        )
    }
    return execution_details


# ==============================================================================
# FEATURE 4: ADAPTIVE PATTERN RECOMMENDATION
# ==============================================================================

def analyze_patterns(history_records):
    """
    Analyzes historical records to identify recurring patterns.
    Requires at least 3 records to formulate genuine patterns.
    """
    count = len(history_records)

    if count < 3:
        return get_insufficient_data_recommendation(count)

    activity_and_insulin_high_risk = 0
    falling_trend_entries = 0
    night_entries = 0
    stable_entries = 0

    for r in history_records:
        r_level = r.get("risk_level", "").upper()
        r_act = str(r.get("activity_level", "")).lower()
        r_ins = bool(r.get("insulin_taken"))
        r_trend = str(r.get("trend", "")).lower()
        r_time = str(r.get("time_of_day", "")).lower()

        if (r_act in ["moderate", "high"]) and r_ins and (r_level in ["HIGH", "MODERATE"]):
            activity_and_insulin_high_risk += 1

        if r_trend == "falling":
            falling_trend_entries += 1

        if r_time in ["night", "bedtime", "evening"]:
            night_entries += 1

        if r_level == "LOW":
            stable_entries += 1

    # Evaluate patterns
    if activity_and_insulin_high_risk >= 2:
        return {
            "pattern_detected": True,
            "total_records_analyzed": count,
            "pattern_type": "activity_plus_insulin_sensitivity",
            "message": (
                "A recurring combination of physical activity and recent insulin "
                "has appeared in previous elevated-risk entries."
            ),
            "recommendation": (
                "Continue logging glucose around activity so MedLens can better understand your pattern. "
                "Consider reviewing pre-exercise carbohydrate buffering with your healthcare team."
            )
        }

    if falling_trend_entries >= 2 and night_entries >= 2:
        return {
            "pattern_detected": True,
            "total_records_analyzed": count,
            "pattern_type": "nocturnal_downward_drift",
            "message": (
                "Multiple evening entries demonstrate a falling glucose trend leading into rest hours."
            ),
            "recommendation": (
                "Ensure consistent bedtime glucose checks to avoid undetected overnight drops."
            )
        }

    if stable_entries >= (count * 0.7):
        return {
            "pattern_detected": True,
            "total_records_analyzed": count,
            "pattern_type": "consistent_glycemic_stability",
            "message": (
                "Your recent entries demonstrate strong glycemic stability across your logged activities and meals."
            ),
            "recommendation": (
                "Keep up your consistent logging routine to maintain predictive baseline accuracy."
            )
        }

    return {
        "pattern_detected": True,
        "total_records_analyzed": count,
        "pattern_type": "adaptive_baseline_active",
        "message": (
            f"MedLens has compiled {count} entries. Glycemic responses show expected post-meal and activity dynamics."
        ),
        "recommendation": (
            "Continue logging context before meals and exercise to enhance personalized follow-up accuracy."
        )
    }


def get_insufficient_data_recommendation(count):
    return {
        "pattern_detected": False,
        "total_records_analyzed": count,
        "message": "Keep logging a few more entries to unlock personalized patterns.",
        "recommendation": f"Currently {count}/3 required entries logged. MedLens needs at least 3 entries to identify recurring patterns."
    }
