<?php
require_once __DIR__ . '/TestHelper.php';

// Mock the sanitization logic here first to verify it works, then we'll move it to api.php

function sanitizeAiResponse($items) {
    if (!is_array($items)) return $items;
    
    foreach ($items as &$item) {
        if (isset($item['type']) && $item['type'] === 'sleep' && isset($item['event_at']) && isset($item['data']['duration_hours'])) {
            try {
                // event_at is WAKE time in UTC
                $wakeTime = new DateTime($item['event_at'], new DateTimeZone('UTC'));
                $duration = floatval($item['data']['duration_hours']);
                
                // Calculate bedtime: Wake Time - Duration
                // We use seconds for precision
                $bedtimeTimestamp = $wakeTime->getTimestamp() - ($duration * 3600);
                $bedtime = new DateTime('@' . $bedtimeTimestamp);
                $bedtime->setTimezone(new DateTimeZone('UTC')); // Ensure UTC
                
                // Enforce calculated bedtime
                $item['data']['bedtime'] = $bedtime->format('Y-m-d H:i:s');
                
            } catch (Exception $e) {
                // Invalid date, ignore or log
            }
        }
    }
    return $items;
}

echo "--- Testing Sleep Sanitization Logic ---
";

// Scenario: "woke up at 9 and slept 8 hours" on 16.01.2026
// AI returned bad start time (future)
$badInput = [
    [
        "type" => "sleep",
        "event_at" => "2026-01-16 09:00:00", // Wake time
        "data" => [
            "duration_hours" => 8,
            "quality" => 4,
            "bedtime" => "2026-01-17 01:00:00" // INCORRECT from AI (Future)
        ]
    ]
];

echo "Input Bedtime: " . $badInput[0]['data']['bedtime'] . "
";

$sanitized = sanitizeAiResponse($badInput);

$expectedBedtime = "2026-01-16 01:00:00"; // 09:00 - 8h = 01:00 same day
echo "Output Bedtime: " . $sanitized[0]['data']['bedtime'] . "
";

if ($sanitized[0]['data']['bedtime'] === $expectedBedtime) {
    echo "SUCCESS: Bedtime corrected.
";
} else {
    echo "FAILURE: Bedtime NOT corrected.
";
}

// Scenario 2: Crossing midnight backwards
// Woke up 16.01 06:00, slept 8 hours. Bedtime should be 15.01 22:00.
$midnightInput = [
    [
        "type" => "sleep",
        "event_at" => "2026-01-16 06:00:00", 
        "data" => [
            "duration_hours" => 8,
            "bedtime" => "2026-01-16 22:00:00" // Wrong, AI forgot to roll back date
        ]
    ]
];
$sanitized2 = sanitizeAiResponse($midnightInput);
$expectedBedtime2 = "2026-01-15 22:00:00";

echo "
Scenario 2 (Midnight rollover):
";
echo "Output: " . $sanitized2[0]['data']['bedtime'] . "
";
if ($sanitized2[0]['data']['bedtime'] === $expectedBedtime2) {
    echo "SUCCESS: Date rollover handled.
";
} else {
    echo "FAILURE: Date rollover failed.
";
}

