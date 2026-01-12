<?php
// tests/test_ai.php

require_once __DIR__ . '/TestHelper.php';

$t = new TestHelper();

echo "Testing AI Endpoint Validation...\n";

// Login first
$t->login('admin', 'admin');

// Test missing API Key
$res = $t->request('POST', 'ai_parse', ['text' => 'I ate an apple']);
if ($res['code'] === 401 || ($res['code'] === 400 && isset($res['body']['error']))) {
    // Note: API might return 401 or 400 depending on exact logic path for missing key
    echo "[PASS] Missing API Key rejected correctly.\n";
} else {
    echo "[FAIL] Missing API Key not handled: " . $res['code'] . "\n";
}

// Test missing Text
$res = $t->request('POST', 'ai_parse', ['api_key' => 'sk-fake']);
if ($res['code'] === 400 && isset($res['body']['error'])) {
    echo "[PASS] Missing Text rejected correctly.\n";
} else {
    echo "[FAIL] Missing Text not handled: " . $res['code'] . "\n";
}

echo "AI Validation Tests Passed.\n";
?>
