<?php
// tests/test_ai_live.php

require_once __DIR__ . '/TestHelper.php';

$apiKey = $argv[1] ?? '';

if (!$apiKey) {
    echo "Usage: php tests/test_ai_live.php <api_key>\n";
    exit(1);
}

$t = new TestHelper();

echo "1. Logging in...\n";
$res = $t->login('admin', 'admin');
$t->assertStatus($res, 200);

// Helper to run a test case
function runSleepTest($t, $apiKey, $text, $expectedDuration) {
    echo "\n---------------------------------------------------\n";
    echo "Testing Input: \"$text\"\n";
    
    $res = $t->request('POST', 'ai_parse', [
        'text' => $text,
        'api_key' => $apiKey
    ]);

    if ($res['code'] !== 200) {
        echo "[FAIL] API Error: " . ($res['body']['error'] ?? 'Unknown') . "\n";
        return;
    }
    
    $results = $res['body'];
    if (!is_array($results) || empty($results)) {
        echo "[FAIL] Unexpected response format or empty result.\n";
        return;
    }

    $body = null;
    foreach ($results as $item) {
        if (($item['type'] ?? '') === 'sleep') {
            $body = $item;
            break;
        }
    }

    if (!$body) {
        echo "[FAIL] No 'sleep' item found in AI response.\n";
        return;
    }
    
    $duration = $body['data']['duration_hours'] ?? 0;
    $wakeTime = $body['event_at'] ?? '';
    $bedTime = $body['data']['bedtime'] ?? '';
    
    echo "AI Parsed -> Duration: {$duration}h\n";
    echo "Wake: $wakeTime\n";
    echo "Bed:  $bedTime\n";
    
    // Validate Duration (allow 0.5 margin)
    if (abs($duration - $expectedDuration) <= 0.5) {
        echo "[PASS] Duration is close to $expectedDuration\n";
    } else {
        echo "[FAIL] Duration mismatch. Expected ~$expectedDuration, got $duration\n";
    }
    
    // Validate Bedtime exists
    if ($bedTime) {
         echo "[PASS] Bedtime calculated: $bedTime\n";
    } else {
         echo "[FAIL] Bedtime missing!\n";
    }
}

// Test Cases
runSleepTest($t, $apiKey, "I slept from 23:00 to 07:00", 8);
runSleepTest($t, $apiKey, "Slept for 6 hours", 6);
?>
