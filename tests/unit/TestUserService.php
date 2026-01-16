<?php

require_once __DIR__ . '/../../services/UserService.php';
require_once __DIR__ . '/../../services/DatabaseService.php';

function assertTest($condition, $message) {
    if ($condition) {
        echo "[PASS] $message\n";
    } else {
        echo "[FAIL] $message\n";
        exit(1);
    }
}

echo "Running UserService Unit Tests...\n";

// Initialize in-memory DB
$pdo = new PDO('sqlite::memory:');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
DatabaseService::initializeSchema($pdo);

$service = new UserService($pdo);

// Test 1: Create User
$service->createUser('testuser', 'password123');
$stmt = $pdo->prepare("SELECT id FROM users WHERE username = 'testuser'");
$stmt->execute();
assertTest($stmt->fetch(), "User created successfully");

// Test 2: Duplicate User
try {
    $service->createUser('testuser', 'password123');
    assertTest(false, "Should have thrown exception for duplicate user");
} catch (Exception $e) {
    assertTest(true, "Exception thrown for duplicate user");
}

// Test 3: Verify Login
$userId = $service->verifyLogin('testuser', 'password123');
assertTest($userId !== false, "Login verified successfully");
assertTest($service->verifyLogin('testuser', 'wrongpass') === false, "Login failed with wrong password");

// Test 4: Settings
$service->updateSettings($userId, 'test-api-key', 1);
$user = $service->getUser($userId);
assertTest($user['api_key'] === 'test-api-key', "API key updated");
assertTest($user['debug_mode'] == 1, "Debug mode updated");

echo "All UserService unit tests passed.\n";

