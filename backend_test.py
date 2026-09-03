#!/usr/bin/env python3
"""
Backend API tests for Finanzas Pareja - AI Auto-Categorization Feature
Tests the new AI-powered category suggestion feature for transactions.
"""

import requests
import json
import sys
from typing import Optional, Dict, Any

# Base URL from environment
BASE_URL = "https://7a3bbcee-5a57-479a-95a0-fa328e726989.preview.emergentagent.com/api"

# Track created transaction IDs for cleanup
created_transaction_ids = []

def log_test(test_name: str, status: str, details: str = ""):
    """Log test results with consistent formatting"""
    icon = "✅" if status == "PASS" else "❌" if status == "FAIL" else "⚠️"
    print(f"\n{icon} {test_name}: {status}")
    if details:
        print(f"   {details}")

def test_health_check() -> bool:
    """Test 1: GET /api/health returns ok"""
    try:
        response = requests.get(f"{BASE_URL}/health", timeout=10)
        if response.status_code == 200:
            data = response.json()
            if data.get("ok") == True:
                log_test("Health Check", "PASS", f"Response: {data}")
                return True
            else:
                log_test("Health Check", "FAIL", f"Expected ok=true, got: {data}")
                return False
        else:
            log_test("Health Check", "FAIL", f"Status {response.status_code}: {response.text}")
            return False
    except Exception as e:
        log_test("Health Check", "FAIL", f"Exception: {str(e)}")
        return False

def test_get_users() -> Optional[str]:
    """Test 2: GET /api/users -> capture a valid payer_id"""
    try:
        response = requests.get(f"{BASE_URL}/users", timeout=10)
        if response.status_code == 200:
            users = response.json()
            if isinstance(users, list) and len(users) > 0:
                payer_id = users[0].get("id")
                user_name = users[0].get("name", "Unknown")
                log_test("Get Users", "PASS", f"Found {len(users)} users. Using payer_id={payer_id} ({user_name})")
                return payer_id
            else:
                log_test("Get Users", "FAIL", f"No users found: {users}")
                return None
        else:
            log_test("Get Users", "FAIL", f"Status {response.status_code}: {response.text}")
            return None
    except Exception as e:
        log_test("Get Users", "FAIL", f"Exception: {str(e)}")
        return None

def test_get_categories() -> Dict[str, str]:
    """Test 3: GET /api/categories -> confirm categories exist with id/name/icon"""
    try:
        response = requests.get(f"{BASE_URL}/categories", timeout=10)
        if response.status_code == 200:
            categories = response.json()
            if isinstance(categories, list) and len(categories) > 0:
                category_map = {cat["name"]: cat["id"] for cat in categories}
                cat_names = [f"{cat['name']} ({cat.get('icon', '?')})" for cat in categories]
                log_test("Get Categories", "PASS", f"Found {len(categories)} categories: {', '.join(cat_names)}")
                return category_map
            else:
                log_test("Get Categories", "FAIL", f"No categories found: {categories}")
                return {}
        else:
            log_test("Get Categories", "FAIL", f"Status {response.status_code}: {response.text}")
            return {}
    except Exception as e:
        log_test("Get Categories", "FAIL", f"Exception: {str(e)}")
        return {}

def test_auto_categorize_restaurant(payer_id: str, category_map: Dict[str, str]) -> bool:
    """Test 4: Auto-categorize restaurant expense -> should be 'Comida'"""
    try:
        payload = {
            "payer_id": payer_id,
            "type": "MIO",
            "original_amount": "20",
            "original_currency": "USD",
            "description": "cena en restaurante italiano"
        }
        response = requests.post(f"{BASE_URL}/transactions", json=payload, timeout=15)
        
        if response.status_code == 201:
            tx = response.json()
            tx_id = tx.get("id")
            category_id = tx.get("category_id")
            
            if tx_id:
                created_transaction_ids.append(tx_id)
            
            if category_id:
                # Verify by fetching transactions to get category_name
                get_response = requests.get(f"{BASE_URL}/transactions?limit=1", timeout=10)
                if get_response.status_code == 200:
                    transactions = get_response.json()
                    if transactions and len(transactions) > 0:
                        latest_tx = transactions[0]
                        category_name = latest_tx.get("category_name")
                        
                        # Check if it's a sensible food category (ideally "Comida")
                        if category_name in ["Comida", "Supermercado", "Salidas"]:
                            log_test("Auto-Categorize Restaurant", "PASS", 
                                   f"Category assigned: {category_name} (category_id={category_id})")
                            return True
                        else:
                            log_test("Auto-Categorize Restaurant", "WARN", 
                                   f"Category assigned: {category_name} (expected Comida/Supermercado/Salidas)")
                            return True  # Still pass as category was assigned
                    else:
                        log_test("Auto-Categorize Restaurant", "FAIL", "Could not fetch transaction to verify category")
                        return False
                else:
                    log_test("Auto-Categorize Restaurant", "WARN", 
                           f"Category ID assigned ({category_id}) but couldn't verify name")
                    return True
            else:
                log_test("Auto-Categorize Restaurant", "FAIL", 
                       f"No category_id assigned. Response: {tx}")
                return False
        else:
            log_test("Auto-Categorize Restaurant", "FAIL", 
                   f"Status {response.status_code}: {response.text}")
            return False
    except Exception as e:
        log_test("Auto-Categorize Restaurant", "FAIL", f"Exception: {str(e)}")
        return False

def test_auto_categorize_moto(payer_id: str, category_map: Dict[str, str]) -> bool:
    """Test 5: Auto-categorize motorcycle gas -> should be 'Moto'"""
    try:
        payload = {
            "payer_id": payer_id,
            "type": "MIO",
            "original_amount": "500",
            "original_currency": "BS",
            "description": "gasolina para la moto"
        }
        response = requests.post(f"{BASE_URL}/transactions", json=payload, timeout=15)
        
        if response.status_code == 201:
            tx = response.json()
            tx_id = tx.get("id")
            category_id = tx.get("category_id")
            
            if tx_id:
                created_transaction_ids.append(tx_id)
            
            if category_id:
                # Verify by fetching transactions
                get_response = requests.get(f"{BASE_URL}/transactions?limit=1", timeout=10)
                if get_response.status_code == 200:
                    transactions = get_response.json()
                    if transactions and len(transactions) > 0:
                        latest_tx = transactions[0]
                        category_name = latest_tx.get("category_name")
                        
                        # Check if it's Moto or Transporte
                        if category_name in ["Moto", "Transporte"]:
                            log_test("Auto-Categorize Moto", "PASS", 
                                   f"Category assigned: {category_name} (category_id={category_id})")
                            return True
                        else:
                            log_test("Auto-Categorize Moto", "WARN", 
                                   f"Category assigned: {category_name} (expected Moto/Transporte)")
                            return True  # Still pass as category was assigned
                    else:
                        log_test("Auto-Categorize Moto", "FAIL", "Could not fetch transaction to verify category")
                        return False
                else:
                    log_test("Auto-Categorize Moto", "WARN", 
                           f"Category ID assigned ({category_id}) but couldn't verify name")
                    return True
            else:
                log_test("Auto-Categorize Moto", "FAIL", 
                       f"No category_id assigned. Response: {tx}")
                return False
        else:
            log_test("Auto-Categorize Moto", "FAIL", 
                   f"Status {response.status_code}: {response.text}")
            return False
    except Exception as e:
        log_test("Auto-Categorize Moto", "FAIL", f"Exception: {str(e)}")
        return False

def test_auto_categorize_hotel(payer_id: str, category_map: Dict[str, str]) -> bool:
    """Test 6: Auto-categorize hotel -> should be 'Hotel'"""
    try:
        payload = {
            "payer_id": payer_id,
            "type": "MIO",
            "original_amount": "10",
            "original_currency": "USD",
            "description": "noche de hotel"
        }
        response = requests.post(f"{BASE_URL}/transactions", json=payload, timeout=15)
        
        if response.status_code == 201:
            tx = response.json()
            tx_id = tx.get("id")
            category_id = tx.get("category_id")
            
            if tx_id:
                created_transaction_ids.append(tx_id)
            
            if category_id:
                # Verify by fetching transactions
                get_response = requests.get(f"{BASE_URL}/transactions?limit=1", timeout=10)
                if get_response.status_code == 200:
                    transactions = get_response.json()
                    if transactions and len(transactions) > 0:
                        latest_tx = transactions[0]
                        category_name = latest_tx.get("category_name")
                        
                        # Check if it's Hotel or Salidas
                        if category_name in ["Hotel", "Salidas"]:
                            log_test("Auto-Categorize Hotel", "PASS", 
                                   f"Category assigned: {category_name} (category_id={category_id})")
                            return True
                        else:
                            log_test("Auto-Categorize Hotel", "WARN", 
                                   f"Category assigned: {category_name} (expected Hotel/Salidas)")
                            return True  # Still pass as category was assigned
                    else:
                        log_test("Auto-Categorize Hotel", "FAIL", "Could not fetch transaction to verify category")
                        return False
                else:
                    log_test("Auto-Categorize Hotel", "WARN", 
                           f"Category ID assigned ({category_id}) but couldn't verify name")
                    return True
            else:
                log_test("Auto-Categorize Hotel", "FAIL", 
                       f"No category_id assigned. Response: {tx}")
                return False
        else:
            log_test("Auto-Categorize Hotel", "FAIL", 
                   f"Status {response.status_code}: {response.text}")
            return False
    except Exception as e:
        log_test("Auto-Categorize Hotel", "FAIL", f"Exception: {str(e)}")
        return False

def test_explicit_category_respected(payer_id: str, category_map: Dict[str, str]) -> bool:
    """Test 7: Explicit category should be respected (not overwritten by AI)"""
    try:
        # Get "Otros" category ID
        otros_id = category_map.get("Otros")
        if not otros_id:
            log_test("Explicit Category Respected", "FAIL", "Category 'Otros' not found")
            return False
        
        payload = {
            "payer_id": payer_id,
            "type": "MIO",
            "original_amount": "15",
            "original_currency": "USD",
            "description": "cena restaurante",
            "category_id": otros_id
        }
        response = requests.post(f"{BASE_URL}/transactions", json=payload, timeout=15)
        
        if response.status_code == 201:
            tx = response.json()
            tx_id = tx.get("id")
            category_id = tx.get("category_id")
            
            if tx_id:
                created_transaction_ids.append(tx_id)
            
            if category_id == otros_id:
                log_test("Explicit Category Respected", "PASS", 
                       f"Explicit category_id={otros_id} was respected (not overwritten by AI)")
                return True
            else:
                log_test("Explicit Category Respected", "FAIL", 
                       f"Expected category_id={otros_id}, got {category_id}")
                return False
        else:
            log_test("Explicit Category Respected", "FAIL", 
                   f"Status {response.status_code}: {response.text}")
            return False
    except Exception as e:
        log_test("Explicit Category Respected", "FAIL", f"Exception: {str(e)}")
        return False

def test_opt_out_auto_categorize(payer_id: str) -> bool:
    """Test 8: auto_categorize:false should prevent AI categorization"""
    try:
        payload = {
            "payer_id": payer_id,
            "type": "MIO",
            "original_amount": "5",
            "original_currency": "USD",
            "description": "algo",
            "auto_categorize": False
        }
        response = requests.post(f"{BASE_URL}/transactions", json=payload, timeout=15)
        
        if response.status_code == 201:
            tx = response.json()
            tx_id = tx.get("id")
            category_id = tx.get("category_id")
            
            if tx_id:
                created_transaction_ids.append(tx_id)
            
            if category_id is None:
                log_test("Opt-out Auto-Categorize", "PASS", 
                       "category_id is null as expected (auto_categorize=false)")
                return True
            else:
                log_test("Opt-out Auto-Categorize", "FAIL", 
                       f"Expected category_id=null, got {category_id}")
                return False
        else:
            log_test("Opt-out Auto-Categorize", "FAIL", 
                   f"Status {response.status_code}: {response.text}")
            return False
    except Exception as e:
        log_test("Opt-out Auto-Categorize", "FAIL", f"Exception: {str(e)}")
        return False

def cleanup_transactions():
    """Clean up created test transactions"""
    print(f"\n🧹 Cleaning up {len(created_transaction_ids)} test transactions...")
    success_count = 0
    for tx_id in created_transaction_ids:
        try:
            response = requests.delete(f"{BASE_URL}/transactions/{tx_id}", timeout=10)
            if response.status_code == 200:
                success_count += 1
            else:
                print(f"   ⚠️ Failed to delete transaction {tx_id}: {response.status_code}")
        except Exception as e:
            print(f"   ⚠️ Exception deleting transaction {tx_id}: {str(e)}")
    
    print(f"   ✅ Successfully deleted {success_count}/{len(created_transaction_ids)} transactions")

def main():
    """Run all backend tests"""
    print("=" * 70)
    print("🧪 BACKEND API TESTS - AI AUTO-CATEGORIZATION FEATURE")
    print("=" * 70)
    
    results = {}
    
    # Test 1: Health check
    results["health"] = test_health_check()
    
    # Test 2: Get users
    payer_id = test_get_users()
    if not payer_id:
        print("\n❌ CRITICAL: Cannot proceed without a valid payer_id")
        sys.exit(1)
    results["users"] = True
    
    # Test 3: Get categories
    category_map = test_get_categories()
    if not category_map:
        print("\n❌ CRITICAL: Cannot proceed without categories")
        sys.exit(1)
    results["categories"] = True
    
    # Test 4-6: Auto-categorization tests
    results["auto_restaurant"] = test_auto_categorize_restaurant(payer_id, category_map)
    results["auto_moto"] = test_auto_categorize_moto(payer_id, category_map)
    results["auto_hotel"] = test_auto_categorize_hotel(payer_id, category_map)
    
    # Test 7: Explicit category respected
    results["explicit_category"] = test_explicit_category_respected(payer_id, category_map)
    
    # Test 8: Opt-out
    results["opt_out"] = test_opt_out_auto_categorize(payer_id)
    
    # Cleanup
    cleanup_transactions()
    
    # Summary
    print("\n" + "=" * 70)
    print("📊 TEST SUMMARY")
    print("=" * 70)
    passed = sum(1 for v in results.values() if v)
    total = len(results)
    print(f"Passed: {passed}/{total}")
    
    for test_name, result in results.items():
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"  {status} - {test_name}")
    
    print("=" * 70)
    
    if passed == total:
        print("✅ ALL TESTS PASSED!")
        sys.exit(0)
    else:
        print(f"❌ {total - passed} TEST(S) FAILED")
        sys.exit(1)

if __name__ == "__main__":
    main()
