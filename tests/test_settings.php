<?php
// tests/test_settings.php
require_once __DIR__ . '/TestHelper.php';

$t = new TestHelper();
$t->login('admin', 'admin');

echo "--- Testing Update Settings ---
";

// 1. Set API Key
$newKey = 'sk-test-key-12345';
$res = $t->request('POST', 'update_settings', ['api_key' => $newKey]);
$t->assertStatus($res, 200);

// Verify it persists (via check_auth or by checking DB if we could, but let's use check_auth as proxy)
$res = $t->request('GET', 'check_auth');
$t->assert($res['body']['api_key'] === $newKey, 'API Key updated successfully');

// 2. Clear API Key
$res = $t->request('POST', 'update_settings', ['api_key' => '']);
$t->assertStatus($res, 200);

$res = $t->request('GET', 'check_auth');
$t->assert(empty($res['body']['api_key']), 'API Key cleared successfully');


echo "\n--- Testing Delete All Data ---
";

// 1. Create some data first
$t->request('POST', 'entry', ['type' => 'food', 'data' => json_encode(['notes' => 'To be deleted'])]);
$t->request('POST', 'entry', ['type' => 'drink', 'data' => json_encode(['notes' => 'To be deleted'])]);

// Verify data exists
$res = $t->request('GET', 'entries');
$countBefore = count($res['body']);
$t->assert($countBefore >= 2, "Data exists before delete ($countBefore entries)");

// 2. Delete All
$res = $t->request('POST', 'delete_all');
$t->assertStatus($res, 200);

// Verify empty
$res = $t->request('GET', 'entries');
$countAfter = count($res['body']);
$t->assert($countAfter === 0, "All data deleted (Count: $countAfter)");

echo "\nSettings & Data Management Tests Passed.
";
