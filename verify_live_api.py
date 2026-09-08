"""
Live API Verification Script for MedLens AI Agent (Root Runner)
Delegates to backend.verify_live_api.
"""

from backend.verify_live_api import test_live_suite

if __name__ == "__main__":
    test_live_suite()
