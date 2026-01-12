<?php
// tests/test_delete.php

require_once __DIR__ . '/TestHelper.php';

$t = new TestHelper();

// Login
$t->login('admin', 'admin');

// Create
$res = $t->request('POST', 'entry', ['type' => 'food', 'data' => ['notes' => 'To delete']]);
$id = $res['body']['id'] ?? null;
echo "Created ID: $id\n";

if (!$id) {
    echo "FAIL: Could not create entry.\n";
    exit(1);
}

// Delete
$res = $t->request('POST', 'delete', ['id' => $id]);
echo "Delete Code: " . $res['code'] . "\n";

if ($res['code'] === 200) {
    echo "PASS: Deleted\n";
} else {
    echo "FAIL: " . print_r($res['body'], true) . "\n";
    exit(1);
}
?>
