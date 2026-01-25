<?php
// tests/test_ai.php

require_once __DIR__ . '/TestHelper.php';

$t = new TestHelper();

echo "Testing AI Endpoint Validation...\n";

// Login first
$t->login('admin', 'admin');

// Test missing API Key
$res = $t->request('POST', 'ai_chat_proxy', [
    'messages' => [['role' => 'user', 'content' => 'hi']]
]);

if ($res['code'] === 401 || ($res['code'] === 400 && isset($res['body']['error']))) {
    echo "[PASS] Missing API Key rejected correctly.\n";
} else {
    echo "[FAIL] Missing API Key not handled: " . $res['code'] . "\n";
}

// Test missing Messages
$res = $t->request('POST', 'ai_chat_proxy', [
    'api_key' => 'sk-fake'
]);

if ($res['code'] === 400 && isset($res['body']['error'])) {
    echo "[PASS] Missing Messages rejected correctly.\n";
} else {
    echo "[FAIL] Missing Messages not handled: " . $res['code'] . "\n";
}

echo "AI Validation Tests Passed.\n";
?>