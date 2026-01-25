<?php

require_once __DIR__ . '/../../services/AiService.php';

class MockAiService extends AiService {
    // Just extending to ensure we can instantiate it and it's the right class
}

// Test Suite
function assertTest($condition, $message) {
    if ($condition) {
        echo "[PASS] $message\n";
    } else {
        echo "[FAIL] $message\n";
        exit(1);
    }
}

echo "Running AiService Unit Tests...\n";

// Test 1: Instantiation
$service = new MockAiService(['api_key' => 'dummy-key', 'model' => 'gpt-test']);
assertTest($service !== null, "AiService instantiated");

// Test 2: Method Check
assertTest(method_exists($service, 'request'), "request method exists");
assertTest(method_exists($service, 'verifyKey'), "verifyKey method exists");

echo "All AiService unit tests passed.\n";