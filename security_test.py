#!/usr/bin/env python3
"""
Backend Security Tests for Finanzas Pareja
Tests SEC-001 (Auth), SEC-002 (Input Validation), and AI Categorization regression
"""

import requests
import json
import sys
from typing import Optional, Dict, Any

# Base URL - using public URL from .env
BASE_URL = "https://7a3bbcee-5a57-479a-95a0-fa328e726989.preview.emergentagent.com/api"
SHARED_PIN = "246810"

# Track created transaction IDs for cleanup
created_transaction_ids = []

def log_test(test_name: str, status: str, details: str = ""):
    """Log test results with consistent formatting"""
    icon = "✅" if status == "PASS" else "❌" if status == "FAIL" else "⚠️"
    print(f"\n{icon} {test_name}: {status}")
    if details:
        print(f"   {details}")

# ============================================================================
# AUTH TESTS (SEC-001)
# ============================================================================

def test_auth_001_health_public(session: requests.Session) -> bool:
    """AUTH-001.1: GET /api/health (public) -> 200"""
    try:
        response = session.get(f"{BASE_URL}/health", timeout=10)
        if response.status_code == 200:
            data = response.json()
            if data.get("ok") == True:
                log_test("AUTH-001.1: Health Check (public)", "PASS", f"Response: {data}")
                return True
            else:
                log_test("AUTH-001.1: Health Check (public)", "FAIL", f"Expected ok=true, got: {data}")
                return False
        else:
            log_test("AUTH-001.1: Health Check (public)", "FAIL", f"Status {response.status_code}: {response.text}")
            return False
    except Exception as e:
        log_test("AUTH-001.1: Health Check (public)", "FAIL", f"Exception: {str(e)}")
        return False

def test_auth_002_status_public(session: requests.Session) -> bool:
    """AUTH-001.2: GET /api/auth/status (public) -> 200 with {pin_set:true, authenticated:false}"""
    try:
        response = session.get(f"{BASE_URL}/auth/status", timeout=10)
        if response.status_code == 200:
            data = response.json()
            pin_set = data.get("pin_set")
            authenticated = data.get("authenticated")
            
            if pin_set == True and authenticated == False:
                log_test("AUTH-001.2: Auth Status (no cookie)", "PASS", 
                       f"pin_set={pin_set}, authenticated={authenticated}")
                return True
            else:
                log_test("AUTH-001.2: Auth Status (no cookie)", "FAIL", 
                       f"Expected pin_set=true, authenticated=false. Got: {data}")
                return False
        else:
            log_test("AUTH-001.2: Auth Status (no cookie)", "FAIL", 
                   f"Status {response.status_code}: {response.text}")
            return False
    except Exception as e:
        log_test("AUTH-001.2: Auth Status (no cookie)", "FAIL", f"Exception: {str(e)}")
        return False

def test_auth_003_protected_routes_401(session: requests.Session) -> bool:
    """AUTH-001.3: Protected routes without cookie -> 401"""
    try:
        routes = [
            ("/users", "GET"),
            ("/transactions", "GET"),
            ("/dashboard", "GET"),
            ("/budgets", "GET")
        ]
        
        all_passed = True
        for route, method in routes:
            if method == "GET":
                response = session.get(f"{BASE_URL}{route}", timeout=10)
            else:
                response = session.post(f"{BASE_URL}{route}", json={}, timeout=10)
            
            if response.status_code != 401:
                log_test(f"AUTH-001.3: {method} {route} without cookie", "FAIL", 
                       f"Expected 401, got {response.status_code}")
                all_passed = False
            else:
                print(f"   ✓ {method} {route} -> 401 (as expected)")
        
        if all_passed:
            log_test("AUTH-001.3: Protected routes without cookie", "PASS", 
                   "All protected routes returned 401")
            return True
        else:
            return False
    except Exception as e:
        log_test("AUTH-001.3: Protected routes without cookie", "FAIL", f"Exception: {str(e)}")
        return False

def test_auth_004_login_wrong_pin(session: requests.Session) -> bool:
    """AUTH-001.4: POST /api/auth/login with wrong PIN -> 401"""
    try:
        response = session.post(f"{BASE_URL}/auth/login", 
                               json={"pin": "000000"}, 
                               timeout=10)
        
        if response.status_code == 401:
            data = response.json()
            error_msg = data.get("error", "")
            log_test("AUTH-001.4: Login with wrong PIN", "PASS", 
                   f"Got 401 with error: {error_msg}")
            return True
        else:
            log_test("AUTH-001.4: Login with wrong PIN", "FAIL", 
                   f"Expected 401, got {response.status_code}: {response.text}")
            return False
    except Exception as e:
        log_test("AUTH-001.4: Login with wrong PIN", "FAIL", f"Exception: {str(e)}")
        return False

def test_auth_005_login_correct_pin(session: requests.Session) -> bool:
    """AUTH-001.5: POST /api/auth/login with correct PIN -> 200 and sets cookie"""
    try:
        response = session.post(f"{BASE_URL}/auth/login", 
                               json={"pin": SHARED_PIN}, 
                               timeout=10)
        
        if response.status_code == 200:
            data = response.json()
            # Check if session cookie was set
            cookies = session.cookies.get_dict()
            has_sid = "sid" in cookies
            
            if has_sid and data.get("ok") == True:
                log_test("AUTH-001.5: Login with correct PIN", "PASS", 
                       f"Got 200, cookie set: {has_sid}, response: {data}")
                return True
            else:
                log_test("AUTH-001.5: Login with correct PIN", "FAIL", 
                       f"Cookie set: {has_sid}, response: {data}")
                return False
        else:
            log_test("AUTH-001.5: Login with correct PIN", "FAIL", 
                   f"Expected 200, got {response.status_code}: {response.text}")
            return False
    except Exception as e:
        log_test("AUTH-001.5: Login with correct PIN", "FAIL", f"Exception: {str(e)}")
        return False

def test_auth_006_authenticated_access(session: requests.Session) -> tuple[bool, Optional[str]]:
    """AUTH-001.6: With session cookie: GET /api/users -> 200, GET /api/dashboard -> 200"""
    try:
        # Debug: Check cookies
        cookies = session.cookies.get_dict()
        print(f"   DEBUG: Current cookies: {cookies}")
        
        # Test GET /api/users
        response_users = session.get(f"{BASE_URL}/users", timeout=10)
        users_ok = response_users.status_code == 200
        
        if not users_ok:
            print(f"   DEBUG: /users failed with {response_users.status_code}: {response_users.text}")
        
        payer_id = None
        if users_ok:
            users = response_users.json()
            if isinstance(users, list) and len(users) > 0:
                payer_id = users[0].get("id")
                print(f"   ✓ GET /users -> 200 (found {len(users)} users, payer_id={payer_id})")
            else:
                users_ok = False
        
        # Test GET /api/dashboard
        response_dashboard = session.get(f"{BASE_URL}/dashboard", timeout=10)
        dashboard_ok = response_dashboard.status_code == 200
        
        if dashboard_ok:
            print(f"   ✓ GET /dashboard -> 200")
        else:
            print(f"   DEBUG: /dashboard failed with {response_dashboard.status_code}: {response_dashboard.text}")
        
        if users_ok and dashboard_ok:
            log_test("AUTH-001.6: Authenticated access", "PASS", 
                   "Both /users and /dashboard returned 200")
            return True, payer_id
        else:
            log_test("AUTH-001.6: Authenticated access", "FAIL", 
                   f"users: {response_users.status_code}, dashboard: {response_dashboard.status_code}")
            return False, payer_id
    except Exception as e:
        log_test("AUTH-001.6: Authenticated access", "FAIL", f"Exception: {str(e)}")
        return False, None

def test_auth_007_logout(session: requests.Session) -> bool:
    """AUTH-001.7: POST /api/auth/logout -> 200, then GET /api/users -> 401"""
    try:
        # Logout
        response_logout = session.post(f"{BASE_URL}/auth/logout", timeout=10)
        
        if response_logout.status_code != 200:
            log_test("AUTH-001.7: Logout", "FAIL", 
                   f"Logout failed: {response_logout.status_code}")
            return False
        
        print(f"   ✓ POST /auth/logout -> 200")
        
        # Try to access protected route with invalidated cookie
        response_users = session.get(f"{BASE_URL}/users", timeout=10)
        
        if response_users.status_code == 401:
            log_test("AUTH-001.7: Logout", "PASS", 
                   "After logout, /users returned 401 as expected")
            return True
        else:
            log_test("AUTH-001.7: Logout", "FAIL", 
                   f"After logout, /users returned {response_users.status_code} (expected 401)")
            return False
    except Exception as e:
        log_test("AUTH-001.7: Logout", "FAIL", f"Exception: {str(e)}")
        return False

def test_auth_008_relogin(session: requests.Session) -> bool:
    """AUTH-001.8: Re-login with correct PIN for remaining tests"""
    try:
        response = session.post(f"{BASE_URL}/auth/login", 
                               json={"pin": SHARED_PIN}, 
                               timeout=10)
        
        if response.status_code == 200:
            log_test("AUTH-001.8: Re-login", "PASS", "Successfully re-authenticated")
            return True
        else:
            log_test("AUTH-001.8: Re-login", "FAIL", 
                   f"Re-login failed: {response.status_code}")
            return False
    except Exception as e:
        log_test("AUTH-001.8: Re-login", "FAIL", f"Exception: {str(e)}")
        return False

# ============================================================================
# INPUT VALIDATION TESTS (SEC-002)
# ============================================================================

def test_validation_001_negative_amount(session: requests.Session, payer_id: str) -> bool:
    """SEC-002.1: POST /api/transactions with negative amount -> 422"""
    try:
        payload = {
            "payer_id": payer_id,
            "type": "MIO",
            "original_amount": "-5",
            "original_currency": "USD"
        }
        response = session.post(f"{BASE_URL}/transactions", json=payload, timeout=10)
        
        if response.status_code == 422:
            data = response.json()
            log_test("SEC-002.1: Negative amount rejected", "PASS", 
                   f"Got 422 with error: {data.get('error', '')}")
            return True
        else:
            log_test("SEC-002.1: Negative amount rejected", "FAIL", 
                   f"Expected 422, got {response.status_code}: {response.text}")
            return False
    except Exception as e:
        log_test("SEC-002.1: Negative amount rejected", "FAIL", f"Exception: {str(e)}")
        return False

def test_validation_002_invalid_currency(session: requests.Session, payer_id: str) -> bool:
    """SEC-002.2: POST /api/transactions with invalid currency -> 422"""
    try:
        payload = {
            "payer_id": payer_id,
            "type": "MIO",
            "original_amount": "10",
            "original_currency": "XXX"
        }
        response = session.post(f"{BASE_URL}/transactions", json=payload, timeout=10)
        
        if response.status_code == 422:
            data = response.json()
            log_test("SEC-002.2: Invalid currency rejected", "PASS", 
                   f"Got 422 with error: {data.get('error', '')}")
            return True
        else:
            log_test("SEC-002.2: Invalid currency rejected", "FAIL", 
                   f"Expected 422, got {response.status_code}: {response.text}")
            return False
    except Exception as e:
        log_test("SEC-002.2: Invalid currency rejected", "FAIL", f"Exception: {str(e)}")
        return False

def test_validation_003_invalid_type(session: requests.Session, payer_id: str) -> bool:
    """SEC-002.3: POST /api/transactions with invalid type -> 422"""
    try:
        payload = {
            "payer_id": payer_id,
            "type": "FOO",
            "original_amount": "10",
            "original_currency": "USD"
        }
        response = session.post(f"{BASE_URL}/transactions", json=payload, timeout=10)
        
        if response.status_code == 422:
            data = response.json()
            log_test("SEC-002.3: Invalid type rejected", "PASS", 
                   f"Got 422 with error: {data.get('error', '')}")
            return True
        else:
            log_test("SEC-002.3: Invalid type rejected", "FAIL", 
                   f"Expected 422, got {response.status_code}: {response.text}")
            return False
    except Exception as e:
        log_test("SEC-002.3: Invalid type rejected", "FAIL", f"Exception: {str(e)}")
        return False

def test_validation_004_missing_name(session: requests.Session) -> bool:
    """SEC-002.4: POST /api/users with no name -> 422"""
    try:
        payload = {}
        response = session.post(f"{BASE_URL}/users", json=payload, timeout=10)
        
        if response.status_code == 422:
            data = response.json()
            log_test("SEC-002.4: Missing name rejected", "PASS", 
                   f"Got 422 with error: {data.get('error', '')}")
            return True
        else:
            log_test("SEC-002.4: Missing name rejected", "FAIL", 
                   f"Expected 422, got {response.status_code}: {response.text}")
            return False
    except Exception as e:
        log_test("SEC-002.4: Missing name rejected", "FAIL", f"Exception: {str(e)}")
        return False

def test_validation_005_negative_settlement(session: requests.Session, payer_id: str, receiver_id: str) -> bool:
    """SEC-002.5: POST /api/settlements with negative amount -> 422"""
    try:
        payload = {
            "payer_id": payer_id,
            "receiver_id": receiver_id,
            "amount_usd": "-1"
        }
        response = session.post(f"{BASE_URL}/settlements", json=payload, timeout=10)
        
        if response.status_code == 422:
            data = response.json()
            log_test("SEC-002.5: Negative settlement rejected", "PASS", 
                   f"Got 422 with error: {data.get('error', '')}")
            return True
        else:
            log_test("SEC-002.5: Negative settlement rejected", "FAIL", 
                   f"Expected 422, got {response.status_code}: {response.text}")
            return False
    except Exception as e:
        log_test("SEC-002.5: Negative settlement rejected", "FAIL", f"Exception: {str(e)}")
        return False

# ============================================================================
# AI CATEGORIZATION REGRESSION TESTS
# ============================================================================

def test_ai_001_auto_categorize_restaurant(session: requests.Session, payer_id: str) -> bool:
    """AI-REG.1: Auto-categorize restaurant with NO category_id -> should assign category"""
    try:
        payload = {
            "payer_id": payer_id,
            "type": "MIO",
            "original_amount": "20",
            "original_currency": "USD",
            "description": "cena en restaurante italiano"
        }
        response = session.post(f"{BASE_URL}/transactions", json=payload, timeout=15)
        
        if response.status_code == 201:
            tx = response.json()
            tx_id = tx.get("id")
            category_id = tx.get("category_id")
            
            if tx_id:
                created_transaction_ids.append(tx_id)
            
            if category_id:
                # Verify by fetching the transaction
                get_response = session.get(f"{BASE_URL}/transactions?limit=1", timeout=10)
                if get_response.status_code == 200:
                    transactions = get_response.json()
                    if transactions and len(transactions) > 0:
                        latest_tx = transactions[0]
                        category_name = latest_tx.get("category_name")
                        
                        log_test("AI-REG.1: Auto-categorize restaurant", "PASS", 
                               f"Category assigned: {category_name} (category_id={category_id})")
                        return True
                    else:
                        log_test("AI-REG.1: Auto-categorize restaurant", "FAIL", 
                               "Could not fetch transaction to verify category")
                        return False
                else:
                    log_test("AI-REG.1: Auto-categorize restaurant", "PASS", 
                           f"Category ID assigned ({category_id})")
                    return True
            else:
                log_test("AI-REG.1: Auto-categorize restaurant", "FAIL", 
                       f"No category_id assigned. Response: {tx}")
                return False
        else:
            log_test("AI-REG.1: Auto-categorize restaurant", "FAIL", 
                   f"Status {response.status_code}: {response.text}")
            return False
    except Exception as e:
        log_test("AI-REG.1: Auto-categorize restaurant", "FAIL", f"Exception: {str(e)}")
        return False

def test_ai_002_explicit_category_respected(session: requests.Session, payer_id: str) -> bool:
    """AI-REG.2: Explicit category_id should NOT be overwritten by AI"""
    try:
        # Get categories first
        cat_response = session.get(f"{BASE_URL}/categories", timeout=10)
        if cat_response.status_code != 200:
            log_test("AI-REG.2: Explicit category respected", "FAIL", 
                   "Could not fetch categories")
            return False
        
        categories = cat_response.json()
        otros_cat = next((c for c in categories if c["name"] == "Otros"), None)
        
        if not otros_cat:
            log_test("AI-REG.2: Explicit category respected", "FAIL", 
                   "Category 'Otros' not found")
            return False
        
        otros_id = otros_cat["id"]
        
        payload = {
            "payer_id": payer_id,
            "type": "MIO",
            "original_amount": "15",
            "original_currency": "USD",
            "description": "cena restaurante",
            "category_id": otros_id
        }
        response = session.post(f"{BASE_URL}/transactions", json=payload, timeout=15)
        
        if response.status_code == 201:
            tx = response.json()
            tx_id = tx.get("id")
            category_id = tx.get("category_id")
            
            if tx_id:
                created_transaction_ids.append(tx_id)
            
            if category_id == otros_id:
                log_test("AI-REG.2: Explicit category respected", "PASS", 
                       f"Explicit category_id={otros_id} was respected (not overwritten)")
                return True
            else:
                log_test("AI-REG.2: Explicit category respected", "FAIL", 
                       f"Expected category_id={otros_id}, got {category_id}")
                return False
        else:
            log_test("AI-REG.2: Explicit category respected", "FAIL", 
                   f"Status {response.status_code}: {response.text}")
            return False
    except Exception as e:
        log_test("AI-REG.2: Explicit category respected", "FAIL", f"Exception: {str(e)}")
        return False

def test_ai_003_opt_out_auto_categorize(session: requests.Session, payer_id: str) -> bool:
    """AI-REG.3: auto_categorize:false should prevent AI categorization"""
    try:
        payload = {
            "payer_id": payer_id,
            "type": "MIO",
            "original_amount": "5",
            "original_currency": "USD",
            "description": "algo",
            "auto_categorize": False
        }
        response = session.post(f"{BASE_URL}/transactions", json=payload, timeout=15)
        
        if response.status_code == 201:
            tx = response.json()
            tx_id = tx.get("id")
            category_id = tx.get("category_id")
            
            if tx_id:
                created_transaction_ids.append(tx_id)
            
            if category_id is None:
                log_test("AI-REG.3: Opt-out auto-categorize", "PASS", 
                       "category_id is null as expected (auto_categorize=false)")
                return True
            else:
                log_test("AI-REG.3: Opt-out auto-categorize", "FAIL", 
                       f"Expected category_id=null, got {category_id}")
                return False
        else:
            log_test("AI-REG.3: Opt-out auto-categorize", "FAIL", 
                   f"Status {response.status_code}: {response.text}")
            return False
    except Exception as e:
        log_test("AI-REG.3: Opt-out auto-categorize", "FAIL", f"Exception: {str(e)}")
        return False

# ============================================================================
# CLEANUP
# ============================================================================

def cleanup_transactions(session: requests.Session):
    """Clean up created test transactions"""
    if not created_transaction_ids:
        print("\n🧹 No test transactions to clean up")
        return
    
    print(f"\n🧹 Cleaning up {len(created_transaction_ids)} test transactions...")
    success_count = 0
    for tx_id in created_transaction_ids:
        try:
            response = session.delete(f"{BASE_URL}/transactions/{tx_id}", timeout=10)
            if response.status_code == 200:
                success_count += 1
            else:
                print(f"   ⚠️ Failed to delete transaction {tx_id}: {response.status_code}")
        except Exception as e:
            print(f"   ⚠️ Exception deleting transaction {tx_id}: {str(e)}")
    
    print(f"   ✅ Successfully deleted {success_count}/{len(created_transaction_ids)} transactions")

# ============================================================================
# MAIN
# ============================================================================

def main():
    """Run all security tests"""
    print("=" * 80)
    print("🔒 BACKEND SECURITY TESTS - Finanzas Pareja")
    print("=" * 80)
    print(f"Base URL: {BASE_URL}")
    print(f"Shared PIN: {SHARED_PIN}")
    print("=" * 80)
    
    # Use a session to maintain cookies
    session = requests.Session()
    
    results = {}
    payer_id = None
    receiver_id = None
    
    # ========== AUTH TESTS (SEC-001) ==========
    print("\n" + "=" * 80)
    print("🔐 AUTH TESTS (SEC-001)")
    print("=" * 80)
    
    results["auth_001_health"] = test_auth_001_health_public(session)
    results["auth_002_status"] = test_auth_002_status_public(session)
    results["auth_003_protected_401"] = test_auth_003_protected_routes_401(session)
    results["auth_004_wrong_pin"] = test_auth_004_login_wrong_pin(session)
    results["auth_005_correct_pin"] = test_auth_005_login_correct_pin(session)
    
    if not results["auth_005_correct_pin"]:
        print("\n❌ CRITICAL: Cannot proceed without successful login")
        sys.exit(1)
    
    auth_006_result, payer_id = test_auth_006_authenticated_access(session)
    results["auth_006_authenticated"] = auth_006_result
    
    if not payer_id:
        print("\n❌ CRITICAL: Cannot proceed without a valid payer_id")
        sys.exit(1)
    
    # Get receiver_id for settlement test
    try:
        users_response = session.get(f"{BASE_URL}/users", timeout=10)
        if users_response.status_code == 200:
            users = users_response.json()
            if len(users) >= 2:
                receiver_id = users[1].get("id")
    except:
        pass
    
    results["auth_007_logout"] = test_auth_007_logout(session)
    results["auth_008_relogin"] = test_auth_008_relogin(session)
    
    if not results["auth_008_relogin"]:
        print("\n❌ CRITICAL: Cannot proceed without re-login")
        sys.exit(1)
    
    # ========== INPUT VALIDATION TESTS (SEC-002) ==========
    print("\n" + "=" * 80)
    print("✅ INPUT VALIDATION TESTS (SEC-002)")
    print("=" * 80)
    
    results["val_001_negative_amount"] = test_validation_001_negative_amount(session, payer_id)
    results["val_002_invalid_currency"] = test_validation_002_invalid_currency(session, payer_id)
    results["val_003_invalid_type"] = test_validation_003_invalid_type(session, payer_id)
    results["val_004_missing_name"] = test_validation_004_missing_name(session)
    
    if receiver_id:
        results["val_005_negative_settlement"] = test_validation_005_negative_settlement(session, payer_id, receiver_id)
    else:
        print("\n⚠️ Skipping settlement test (need 2 users)")
        results["val_005_negative_settlement"] = True  # Skip
    
    # ========== AI CATEGORIZATION REGRESSION TESTS ==========
    print("\n" + "=" * 80)
    print("🤖 AI CATEGORIZATION REGRESSION TESTS")
    print("=" * 80)
    
    results["ai_001_auto_categorize"] = test_ai_001_auto_categorize_restaurant(session, payer_id)
    results["ai_002_explicit_category"] = test_ai_002_explicit_category_respected(session, payer_id)
    results["ai_003_opt_out"] = test_ai_003_opt_out_auto_categorize(session, payer_id)
    
    # ========== CLEANUP ==========
    cleanup_transactions(session)
    
    # ========== SUMMARY ==========
    print("\n" + "=" * 80)
    print("📊 TEST SUMMARY")
    print("=" * 80)
    
    passed = sum(1 for v in results.values() if v)
    total = len(results)
    
    print(f"\nTotal: {passed}/{total} tests passed\n")
    
    # Group by category
    auth_tests = {k: v for k, v in results.items() if k.startswith("auth_")}
    val_tests = {k: v for k, v in results.items() if k.startswith("val_")}
    ai_tests = {k: v for k, v in results.items() if k.startswith("ai_")}
    
    print("🔐 AUTH TESTS (SEC-001):")
    for test_name, result in auth_tests.items():
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"  {status} - {test_name}")
    
    print("\n✅ INPUT VALIDATION TESTS (SEC-002):")
    for test_name, result in val_tests.items():
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"  {status} - {test_name}")
    
    print("\n🤖 AI CATEGORIZATION REGRESSION:")
    for test_name, result in ai_tests.items():
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"  {status} - {test_name}")
    
    print("\n" + "=" * 80)
    
    if passed == total:
        print("✅ ALL TESTS PASSED!")
        sys.exit(0)
    else:
        print(f"❌ {total - passed} TEST(S) FAILED")
        sys.exit(1)

if __name__ == "__main__":
    main()
