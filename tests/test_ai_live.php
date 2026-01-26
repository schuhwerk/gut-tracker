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
    
    // Construct Prompt (Simplified version of JS logic)
    $systemPrompt = "Context:
- User Local Time: 2026-01-24 10:00:00
- Output: JSON Object containing a key 'items' which is a list.

Task: Parse input into structured data.

Rules:
1. Use USER LOCAL TIME for 'event_at'.
2. For 'sleep', 'event_at' is WAKE time.
3. Format 'event_at' strictly as "YYYY-MM-DD HH:MM:SS".
4. If time is unspecified for a relative date (e.g. 'yesterday'), default to 12:00:00.

Schema:
- { \"type\": \"sleep\", \"event_at\": \"YYYY-MM-DD HH:MM:SS\", \"data\": { \"duration_hours\": float, \"quality\": int(1-5), \"bedtime\": \"YYYY-MM-DD HH:MM:SS\" } }";

    $payload = [
        'model' => 'gpt-4o-mini',
        'messages' => [
            ['role' => 'system', 'content' => $systemPrompt],
            ['role' => 'user', 'content' => $text]
        ],
        'response_format' => ['type' => 'json_object'],
        'api_key' => $apiKey
    ];

    $res = $t->request('POST', 'ai_chat_proxy', $payload);

    if ($res['code'] !== 200) {
        echo "[FAIL] API Error: " . ($res['body']['error'] ?? json_encode($res['body'])) . "\n";
        return;
    }
    
    $aiResponse = $res['body'];
    $content = $aiResponse['choices'][0]['message']['content'] ?? '{}';
    $parsed = json_decode($content, true);
    $results = $parsed['items'] ?? $parsed ?? [];

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
    
    echo "AI Parsed -> Duration: {$duration}h\n";
    
    // Validate Duration (allow 0.5 margin)
    if (abs($duration - $expectedDuration) <= 0.5) {
        echo "[PASS] Duration is close to $expectedDuration\n";
    } else {
        echo "[FAIL] Duration mismatch. Expected ~$expectedDuration, got $duration\n";
    }
}

// Test Cases
runSleepTest($t, $apiKey, "I slept from 23:00 to 07:00", 8);
runSleepTest($t, $apiKey, "Slept for 6 hours", 6);
?>