<?php

require_once __DIR__ . '/../../services/AiService.php';

class MockAiService extends AiService {
    public $mockResponse;
    public $lastRequest = [];

    protected function makeRequest($endpoint, $payload, $isMultipart = false) {
        $this->lastRequest = [
            'endpoint' => $endpoint,
            'payload' => $payload,
            'isMultipart' => $isMultipart
        ];
        return $this->mockResponse;
    }
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

// Test 1: Sanitize Response
$service = new MockAiService('dummy-key');
$input = [
    [
        'type' => 'sleep',
        'event_at' => '2023-10-10 08:00:00', // Wake time UTC
        'data' => ['duration_hours' => 8]
    ]
];
$sanitized = $service->sanitizeAiResponse($input);
assertTest(isset($sanitized[0]['data']['bedtime']), "Bedtime calculated");
assertTest($sanitized[0]['data']['bedtime'] === '2023-10-10 00:00:00', "Bedtime correct (08:00 - 8h = 00:00)");

// Test 2: Parse JSON
$json = '```json [{"type":"food"}] ```';
$parsed = $service->parseAiJsonContent($json);
assertTest($parsed[0]['type'] === 'food', "JSON parsed with markdown");

// Test 3: Parse Text (Mocked API)
$service->mockResponse = [
    'choices' => [
        ['message' => ['content' => '[{"type":"drink", "data":{"notes":"water"}}]']]
    ]
];
$result = $service->parseText("I drank water", "2023-10-10 12:00:00", 0);
assertTest($result[0]['type'] === 'drink', "ParseText returned parsed type");
assertTest($service->lastRequest['endpoint'] === 'chat/completions', "Correct endpoint called");

echo "All AiService unit tests passed.\n";

