# MedLens — AI Decision-Support Agent Backend

MedLens is an AI agent backend designed to identify potential hypoglycaemia risk from a user's glycemic and physiological context, simulate near-term glucose trajectories, and propose safe, user-approved follow-up actions.

> **Disclaimer**: MedLens is a prototype decision-support system and is not a medical device or a substitute for professional medical advice.

---

## 4 Core AI Agent Features

1. **Hypoglycaemia Risk Assessment (`POST /api/analyze`)**
   - Evaluates current glucose, trend velocity, active insulin dosage & timing (peak absorption window), physical activity level, and carbohydrate buffering.
   - Categorizes risk into `LOW`, `MODERATE`, or `HIGH` with a calibrated score (0–100), contributing factors, and plain-English explanation.

2. **30-Minute Glucose Prediction**
   - Lightweight rate-of-change simulation ($\Delta G$) calculating 10-minute interval trajectory points (minutes 0, 10, 20, 30) and directional momentum (`rising`, `stable`, `falling`).

3. **Smart Action Agent with User Approval (`POST /api/action/propose`, `/approve`, `/dismiss`)**
   - Decision-support follow-up actions proposed based on risk context:
     - **HIGH risk**: `glucose_recheck_reminder` (15-min timer + rapid carb advisory).
     - **MODERATE risk**: `scheduled_recheck_reminder` (30-min timer).
     - **LOW risk**: `routine_monitoring` (120-min routine check).
   - User approval workflow: actions remain `pending` until explicitly approved via `POST /api/action/approve` or dismissed via `POST /api/action/dismiss`.

4. **Adaptive Pattern Recommendation (`GET /api/recommendation`)**
   - Analyzes logged SQLite history entries to identify recurring patterns (e.g., exercise + active insulin leading to downward drift).
   - Requires at least 3 entries to formulate genuine patterns without fabricating conclusions.

---

## Architecture & API Endpoints

```
[User Context] ──> POST /api/analyze
                         │
                         ├── 1. Assess Hypo Risk (0-100 Score & Level)
                         ├── 2. Simulate 30-min Trajectory Points
                         ├── 3. Propose User-Approved Action
                         └── 4. Persist to SQLite Database (medlens.db)
```

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/api/health` | `GET` | Health check & service status |
| `/api/analyze` | `POST` | Core agent endpoint for context analysis & action proposal |
| `/api/action/propose` | `POST` | Explicitly propose follow-up action |
| `/api/action/approve` | `POST` | Approve action (transitions to `approved` and schedules reminder) |
| `/api/action/dismiss` | `POST` | Dismiss action (transitions to `dismissed`) |
| `/api/history` | `GET` | Retrieve logged context history |
| `/api/recommendation` | `GET` | Extract recurring glycemic patterns from history |

---

## Quickstart & Local Setup

### 1. Requirements
- Python 3.10+
- Dependencies listed in `backend/requirements.txt`:
  ```bash
  pip install -r backend/requirements.txt
  ```

### 2. Start Backend Server
```bash
python -m backend.app
```
The server will start on port `5000` with CORS enabled for frontend clients.

### 3. Run Automated Tests
```bash
python backend/test_agent.py
# or
python test_agent.py
```

### 4. Run Live API Verification
```bash
python backend/verify_live_api.py
```