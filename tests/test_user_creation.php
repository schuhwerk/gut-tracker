<?php
// tests/test_user_creation.php

require_once __DIR__ . '/TestHelper.php';

$t = new TestHelper();

echo "Starting User Creation Test...\n";

// Generate a random username to ensure uniqueness
$testUsername = 'testuser_' . uniqid();
$testPassword = 'password123';

echo "\n--- Testing Create User ($testUsername) ---\n";
$res = $t->request('POST', 'create_user', [
    'username' => $testUsername,
    'password' => $testPassword
]);

$t->assertStatus($res, 200);
$t->assert(isset($res['body']['message']) && $res['body']['message'] === 'User created', 'Success Message Correct');

// Try to login with the new user
echo "\n--- Testing Login with New User ---\n";
$res = $t->login($testUsername, $testPassword);

$t->assertStatus($res, 200);
$t->assert(isset($res['body']['user_id']), 'User ID returned');

// Try to create the same user again (should fail)
echo "\n--- Testing Duplicate User Creation ---\n";
$res = $t->request('POST', 'create_user', [
    'username' => $testUsername,
    'password' => $testPassword
]);

$t->assertStatus($res, 400);
$t->assert(isset($res['body']['error']) && $res['body']['error'] === 'User already exists', 'Error Message Correct');

echo "\nUser Creation Test Passed!\n";
?>
