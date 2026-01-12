<?php
// tests/test_delete_robust.php

require_once __DIR__ . '/TestHelper.php';

$t = new TestHelper();

// Login
echo "Logging in...\n";
$t->login('admin', 'admin');

// Create Entry (JSON)
echo "Creating entry...\n";
$res = $t->request('POST', 'entry', ['type' => 'food', 'data' => ['notes' => 'Robust Test']]);
$id = $res['body']['id'] ?? null;
echo "Created ID: $id\n";

if (!$id) {
    echo "FAIL: Could not create entry.\n";
    exit(1);
}

// Delete Entry via Form Data (Not JSON) to test fallback
echo "Deleting using Form Data (x-www-form-urlencoded)...\n";
$res = $t->request('POST', 'delete', ['id' => $id], false);
echo "Delete Code: " . $res['code'] . "\n";

if ($res['code'] === 200) {
    echo "PASS: Deleted via Form Data\n";
} else {
    echo "FAIL: " . print_r($res['body'], true) . "\n";
    exit(1);
}
?>

