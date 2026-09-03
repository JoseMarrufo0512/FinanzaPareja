#!/usr/bin/env python3
"""
Auth Flow Tests for Finanzas Pareja - Review Request
Tests authentication flows and protected routes with PIN 1234
"""

import requests
import json
import sys
from typing import Optional

# Base URL from environment
BASE_URL = "https://7a3bbcee-5a57-479a-95a0-fa328e726989.preview.emergentagent.com/api"
TEST_PIN = "1234"

# Track created transaction IDs for cleanup
created_transaction_ids = []

def log_test(test_name: str, status: str, details: str = ""):
    """Log test results with consistent formatting"""
    icon = "✅" if status == "PASS" else "❌" if status == "FAIL" else "⚠️"
    print(f"\n{icon} {test_name}: {status}")
    if details:
        print(f"   {details}")

# ============================================================================
# TEST 1: HEALTH CHECK
# ============================================================================

def test_health_check() -> bool:
    """Test 1: GET /api/health -> should return 200 with {ok: true}"""
    try:
        response = requests.get(f"{BASE_URL}/health", timeout=10)
        if response.status_code == 200:
            data = response.json()
            if data.get("ok") == True:
                log_test("1. Health Check", "PASS", f"Response: {data}")
                return True
            else:
                log_test("1. Health Check", "FAIL", f"Expected ok=true, got: {data}")
                return False
        else:
            log_test("1. Health Check", "FAIL", f"Status {response.status_code}: {response.text}")
            return False
    except Exception as e:
        log_test("1. Health Check", "FAIL", f"Exception: {str(e)}")
        return False

# ============================================================================
# TEST 2: AUTH FLOW
# ============================================================================

def test_auth_status_unauthenticated() -> bool:
    """Test 2a: GET /api/auth/status -> should return {pin_set: true, authenticated: false}"""
    try:
        response = requests.get(f"{BASE_URL}/auth/status", timeout=10)
        if response.status_code == 200:
            data = response.json()
            pin_set = data.get("pin_set")
            authenticated = data.get("authenticated")
            
            if pin_set == True and authenticated == False:
                log_test("2a. Auth Status (unauthenticated)", "PASS", 
                       f"pin_set={pin_set}, authenticated={authenticated}")
                return True
            else:
                log_test("2a. Auth Status (unauthenticated)", "FAIL", 
                       f"Expected pin_set=true, authenticated=false. Got: {data}")
                return False
        else:
            log_test("2a. Auth Status (unauthenticated)", "FAIL", 
                   f"Status {response.status_code}: {response.text}")
            return False
    except Exception as e:
        log_test("2a. Auth Status (unauthenticated)", "FAIL", f"Exception: {str(e)}")
        return False

def test_auth_login(session: requests.Session) -> bool:
    """Test 2b: POST /api/auth/login with {"pin": "1234"} -> should return 200 and set "sid" cookie"""
    try:
        response = session.post(f"{BASE_URL}/auth/login", 
                               json={"pin": TEST_PIN}, 
                               timeout=10)
        
        if response.status_code == 200:
            data = response.json()
            # Check if session cookie was set
            cookies = session.cookies.get_dict()
            has_sid = "sid" in cookies
            
            if has_sid:
                log_test("2b. Auth Login", "PASS", 
                       f"Got 200, sid cookie set, response: {data}")
                return True
            else:
                log_test("2b. Auth Login", "FAIL", 
                       f"Cookie 'sid' not set. Cookies: {cookies}, response: {data}")
                return False
        else:
            log_test("2b. Auth Login", "FAIL", 
                   f"Expected 200, got {response.status_code}: {response.text}")
            return False
    except Exception as e:
        log_test("2b. Auth Login", "FAIL", f"Exception: {str(e)}")
        return False

def test_auth_status_authenticated(session: requests.Session) -> bool:
    """Test 2c: GET /api/auth/status with cookie -> should return {pin_set: true, authenticated: true}"""
    try:
        response = session.get(f"{BASE_URL}/auth/status", timeout=10)
        if response.status_code == 200:
            data = response.json()
            pin_set = data.get("pin_set")
            authenticated = data.get("authenticated")
            
            if pin_set == True and authenticated == True:
                log_test("2c. Auth Status (authenticated)", "PASS", 
                       f"pin_set={pin_set}, authenticated={authenticated}")
                return True
            else:
                log_test("2c. Auth Status (authenticated)", "FAIL", 
                       f"Expected pin_set=true, authenticated=true. Got: {data}")
                return False
        else:
            log_test("2c. Auth Status (authenticated)", "FAIL", 
                   f"Status {response.status_code}: {response.text}")
            return False
    except Exception as e:
        log_test("2c. Auth Status (authenticated)", "FAIL", f"Exception: {str(e)}")
        return False

# ============================================================================
# TEST 3: PROTECTED ROUTES WITH AUTH
# ============================================================================

def test_protected_users(session: requests.Session) -> tuple[bool, Optional[str]]:
    """Test 3a: GET /api/users -> should return array of users (José, Aliexis)"""
    try:
        response = session.get(f"{BASE_URL}/users", timeout=10)
        if response.status_code == 200:
            users = response.json()
            if isinstance(users, list) and len(users) >= 2:
                user_names = [u.get("name") for u in users]
                payer_id = users[0].get("id")
                log_test("3a. Protected Route: GET /users", "PASS", 
                       f"Found {len(users)} users: {user_names}, payer_id={payer_id}")
                return True, payer_id
            else:
                log_test("3a. Protected Route: GET /users", "FAIL", 
                       f"Expected at least 2 users, got: {users}")
                return False, None
        else:
            log_test("3a. Protected Route: GET /users", "FAIL", 
                   f"Status {response.status_code}: {response.text}")
            return False, None
    except Exception as e:
        log_test("3a. Protected Route: GET /users", "FAIL", f"Exception: {str(e)}")
        return False, None

def test_protected_categories(session: requests.Session) -> bool:
    """Test 3b: GET /api/categories -> should return categories array"""
    try:
        response = session.get(f"{BASE_URL}/categories", timeout=10)
        if response.status_code == 200:
            categories = response.json()
            if isinstance(categories, list) and len(categories) > 0:
                cat_names = [c.get("name") for c in categories[:5]]
                log_test("3b. Protected Route: GET /categories", "PASS", 
                       f"Found {len(categories)} categories: {cat_names}...")
                return True
            else:
                log_test("3b. Protected Route: GET /categories", "FAIL", 
                       f"Expected categories array, got: {categories}")
                return False
        else:
            log_test("3b. Protected Route: GET /categories", "FAIL", 
                   f"Status {response.status_code}: {response.text}")
            return False
    except Exception as e:
        log_test("3b. Protected Route: GET /categories", "FAIL", f"Exception: {str(e)}")
        return False

def test_protected_dashboard(session: requests.Session) -> bool:
    """Test 3c: GET /api/dashboard -> should return dashboard data with net, totals, budgets, rates"""
    try:
        response = session.get(f"{BASE_URL}/dashboard", timeout=10)
        if response.status_code == 200:
            data = response.json()
            has_net = "net" in data
            has_totals = "totals" in data
            has_budgets = "budgets" in data
            has_rates = "rates" in data
            
            if has_net and has_totals and has_budgets and has_rates:
                log_test("3c. Protected Route: GET /dashboard", "PASS", 
                       f"Dashboard has all required fields: net, totals, budgets, rates")
                return True
            else:
                log_test("3c. Protected Route: GET /dashboard", "FAIL", 
                       f"Missing fields. Has: net={has_net}, totals={has_totals}, budgets={has_budgets}, rates={has_rates}")
                return False
        else:
            log_test("3c. Protected Route: GET /dashboard", "FAIL", 
                   f"Status {response.status_code}: {response.text}")
            return False
    except Exception as e:
        log_test("3c. Protected Route: GET /dashboard", "FAIL", f"Exception: {str(e)}")
        return False

def test_protected_rates(session: requests.Session) -> bool:
    """Test 3d: GET /api/rates -> should return exchange rates"""
    try:
        response = session.get(f"{BASE_URL}/rates", timeout=10)
        if response.status_code == 200:
            rates = response.json()
            if isinstance(rates, dict) and len(rates) > 0:
                log_test("3d. Protected Route: GET /rates", "PASS", 
                       f"Rates: {rates}")
                return True
            else:
                log_test("3d. Protected Route: GET /rates", "FAIL", 
                       f"Expected rates object, got: {rates}")
                return False
        else:
            log_test("3d. Protected Route: GET /rates", "FAIL", 
                   f"Status {response.status_code}: {response.text}")
            return False
    except Exception as e:
        log_test("3d. Protected Route: GET /rates", "FAIL", f"Exception: {str(e)}")
        return False

def test_protected_transactions(session: requests.Session) -> bool:
    """Test 3e: GET /api/transactions?limit=10 -> should return transactions array"""
    try:
        response = session.get(f"{BASE_URL}/transactions?limit=10", timeout=10)
        if response.status_code == 200:
            transactions = response.json()
            if isinstance(transactions, list):
                log_test("3e. Protected Route: GET /transactions", "PASS", 
                       f"Found {len(transactions)} transactions")
                return True
            else:
                log_test("3e. Protected Route: GET /transactions", "FAIL", 
                       f"Expected transactions array, got: {transactions}")
                return False
        else:
            log_test("3e. Protected Route: GET /transactions", "FAIL", 
                   f"Status {response.status_code}: {response.text}")
            return False
    except Exception as e:
        log_test("3e. Protected Route: GET /transactions", "FAIL", f"Exception: {str(e)}")
        return False

# ============================================================================
# TEST 4: PROTECTED ROUTES WITHOUT AUTH
# ============================================================================

def test_protected_without_auth_users() -> bool:
    """Test 4a: GET /api/users without cookie -> should return 401"""
    try:
        # Create a new session without cookies
        response = requests.get(f"{BASE_URL}/users", timeout=10)
        if response.status_code == 401:
            log_test("4a. Protected Route Without Auth: GET /users", "PASS", 
                   "Got 401 as expected")
            return True
        else:
            log_test("4a. Protected Route Without Auth: GET /users", "FAIL", 
                   f"Expected 401, got {response.status_code}: {response.text}")
            return False
    except Exception as e:
        log_test("4a. Protected Route Without Auth: GET /users", "FAIL", f"Exception: {str(e)}")
        return False

def test_protected_without_auth_dashboard() -> bool:
    """Test 4b: GET /api/dashboard without cookie -> should return 401"""
    try:
        # Create a new session without cookies
        response = requests.get(f"{BASE_URL}/dashboard", timeout=10)
        if response.status_code == 401:
            log_test("4b. Protected Route Without Auth: GET /dashboard", "PASS", 
                   "Got 401 as expected")
            return True
        else:
            log_test("4b. Protected Route Without Auth: GET /dashboard", "FAIL", 
                   f"Expected 401, got {response.status_code}: {response.text}")
            return False
    except Exception as e:
        log_test("4b. Protected Route Without Auth: GET /dashboard", "FAIL", f"Exception: {str(e)}")
        return False

# ============================================================================
# TEST 5: TRANSACTION CREATION WITH AUTH
# ============================================================================

def test_transaction_create_valid(session: requests.Session, payer_id: str) -> bool:
    """Test 5a: POST /api/transactions with valid data -> should return 201"""
    try:
        payload = {
            "payer_id": payer_id,
            "type": "MIO",
            "original_amount": "25.50",
            "original_currency": "USD",
            "description": "Test transaction - groceries"
        }
        response = session.post(f"{BASE_URL}/transactions", json=payload, timeout=15)
        
        if response.status_code == 201:
            tx = response.json()
            tx_id = tx.get("id")
            
            if tx_id:
                created_transaction_ids.append(tx_id)
                log_test("5a. Transaction Creation (valid)", "PASS", 
                       f"Created transaction with id={tx_id}")
                return True
            else:
                log_test("5a. Transaction Creation (valid)", "FAIL", 
                       f"No transaction id in response: {tx}")
                return False
        else:
            log_test("5a. Transaction Creation (valid)", "FAIL", 
                   f"Expected 201, got {response.status_code}: {response.text}")
            return False
    except Exception as e:
        log_test("5a. Transaction Creation (valid)", "FAIL", f"Exception: {str(e)}")
        return False

def test_transaction_create_missing_fields(session: requests.Session) -> bool:
    """Test 5b: POST /api/transactions with missing fields -> should return 422"""
    try:
        payload = {
            "type": "MIO",
            "original_amount": "10"
            # Missing payer_id and original_currency
        }
        response = session.post(f"{BASE_URL}/transactions", json=payload, timeout=10)
        
        if response.status_code == 422:
            data = response.json()
            log_test("5b. Transaction Creation (missing fields)", "PASS", 
                   f"Got 422 with error: {data.get('error', '')}")
            return True
        else:
            log_test("5b. Transaction Creation (missing fields)", "FAIL", 
                   f"Expected 422, got {response.status_code}: {response.text}")
            return False
    except Exception as e:
        log_test("5b. Transaction Creation (missing fields)", "FAIL", f"Exception: {str(e)}")
        return False

def test_transaction_create_negative_amount(session: requests.Session, payer_id: str) -> bool:
    """Test 5c: POST /api/transactions with negative amount -> should return 422"""
    try:
        payload = {
            "payer_id": payer_id,
            "type": "MIO",
            "original_amount": "-10",
            "original_currency": "USD"
        }
        response = session.post(f"{BASE_URL}/transactions", json=payload, timeout=10)
        
        if response.status_code == 422:
            data = response.json()
            log_test("5c. Transaction Creation (negative amount)", "PASS", 
                   f"Got 422 with error: {data.get('error', '')}")
            return True
        else:
            log_test("5c. Transaction Creation (negative amount)", "FAIL", 
                   f"Expected 422, got {response.status_code}: {response.text}")
            return False
    except Exception as e:
        log_test("5c. Transaction Creation (negative amount)", "FAIL", f"Exception: {str(e)}")
        return False

# ============================================================================
# TEST 6: LOGOUT
# ============================================================================

def test_logout(session: requests.Session) -> bool:
    """Test 6a: POST /api/auth/logout with cookie -> should return 200"""
    try:
        response = session.post(f"{BASE_URL}/auth/logout", timeout=10)
        
        if response.status_code == 200:
            log_test("6a. Logout", "PASS", "Logout successful")
            return True
        else:
            log_test("6a. Logout", "FAIL", 
                   f"Expected 200, got {response.status_code}: {response.text}")
            return False
    except Exception as e:
        log_test("6a. Logout", "FAIL", f"Exception: {str(e)}")
        return False

def test_after_logout_401(session: requests.Session) -> bool:
    """Test 6b: After logout, GET /api/users -> should return 401"""
    try:
        response = session.get(f"{BASE_URL}/users", timeout=10)
        
        if response.status_code == 401:
            log_test("6b. After Logout Access", "PASS", 
                   "Got 401 as expected after logout")
            return True
        else:
            log_test("6b. After Logout Access", "FAIL", 
                   f"Expected 401, got {response.status_code}: {response.text}")
            return False
    except Exception as e:
        log_test("6b. After Logout Access", "FAIL", f"Exception: {str(e)}")
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
    
    # Re-login to ensure we have a valid session for cleanup
    try:
        login_response = session.post(f"{BASE_URL}/auth/login", 
                                     json={"pin": TEST_PIN}, 
                                     timeout=10)
        if login_response.status_code != 200:
            print("   ⚠️ Failed to re-login for cleanup")
            return
    except Exception as e:
        print(f"   ⚠️ Exception during re-login: {str(e)}")
        return
    
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
    """Run all auth flow tests"""
    print("=" * 80)
    print("🧪 AUTH FLOW TESTS - Finanzas Pareja")
    print("=" * 80)
    print(f"Base URL: {BASE_URL}")
    print(f"Test PIN: {TEST_PIN}")
    print("=" * 80)
    
    results = {}
    payer_id = None
    
    # Test 1: Health Check
    print("\n" + "=" * 80)
    print("TEST 1: HEALTH CHECK")
    print("=" * 80)
    results["health"] = test_health_check()
    
    # Test 2: Auth Flow
    print("\n" + "=" * 80)
    print("TEST 2: AUTH FLOW")
    print("=" * 80)
    results["auth_status_unauth"] = test_auth_status_unauthenticated()
    
    # Create session for authenticated tests
    session = requests.Session()
    results["auth_login"] = test_auth_login(session)
    
    if not results["auth_login"]:
        print("\n❌ CRITICAL: Cannot proceed without successful login")
        sys.exit(1)
    
    results["auth_status_auth"] = test_auth_status_authenticated(session)
    
    # Test 3: Protected Routes with Auth
    print("\n" + "=" * 80)
    print("TEST 3: PROTECTED ROUTES WITH AUTH")
    print("=" * 80)
    users_result, payer_id = test_protected_users(session)
    results["protected_users"] = users_result
    
    if not payer_id:
        print("\n❌ CRITICAL: Cannot proceed without a valid payer_id")
        sys.exit(1)
    
    results["protected_categories"] = test_protected_categories(session)
    results["protected_dashboard"] = test_protected_dashboard(session)
    results["protected_rates"] = test_protected_rates(session)
    results["protected_transactions"] = test_protected_transactions(session)
    
    # Test 4: Protected Routes Without Auth
    print("\n" + "=" * 80)
    print("TEST 4: PROTECTED ROUTES WITHOUT AUTH")
    print("=" * 80)
    results["unauth_users"] = test_protected_without_auth_users()
    results["unauth_dashboard"] = test_protected_without_auth_dashboard()
    
    # Test 5: Transaction Creation with Auth
    print("\n" + "=" * 80)
    print("TEST 5: TRANSACTION CREATION WITH AUTH")
    print("=" * 80)
    results["tx_valid"] = test_transaction_create_valid(session, payer_id)
    results["tx_missing_fields"] = test_transaction_create_missing_fields(session)
    results["tx_negative_amount"] = test_transaction_create_negative_amount(session, payer_id)
    
    # Test 6: Logout
    print("\n" + "=" * 80)
    print("TEST 6: LOGOUT")
    print("=" * 80)
    results["logout"] = test_logout(session)
    results["after_logout"] = test_after_logout_401(session)
    
    # Cleanup
    cleanup_transactions(session)
    
    # Summary
    print("\n" + "=" * 80)
    print("📊 TEST SUMMARY")
    print("=" * 80)
    
    passed = sum(1 for v in results.values() if v)
    total = len(results)
    
    print(f"\nTotal: {passed}/{total} tests passed\n")
    
    for test_name, result in results.items():
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
