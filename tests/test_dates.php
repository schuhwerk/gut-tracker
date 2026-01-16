<?php
require_once 'TestHelper.php';

$helper = new TestHelper();
echo "Running Date/Time Format Tests...\n";

try {
    // 1. Setup User
    $username = 'date_test_' . uniqid();
    $password = 'pass123';
    $helper->request('POST', 'create_user', ['username' => $username, 'password' => $password]);
    $helper->login($username, $password);

    // 2. Test event_at standardization (Frontend style T -> space)
    echo "--- Testing event_at Format ---\n";
    $recordedAtInput = '2026-01-15T14:30';
    $res = $helper->request('POST', 'entry', [
        'type' => 'food',
        'event_at' => $recordedAtInput,
        'data' => ['notes' => 'Test date format']
    ]);
    
    $helper->assertStatus($res, 200);
    $entryId = $res['body']['id'];

    // Fetch and check format
    $res = $helper->request('GET', 'entries', ['id' => $entryId]);
    $helper->assertStatus($res, 200);
    $savedRecordedAt = $res['body']['event_at'];
    $savedCreatedAt = $res['body']['created_at'];

    echo "Recorded At: $savedRecordedAt\n";
    echo "Created At: $savedCreatedAt\n";

    $helper->assert(
        preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/', $savedRecordedAt),
        "event_at matches YYYY-MM-DD HH:MM:SS"
    );
    
    $helper->assert(
        preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/', $savedCreatedAt),
        "created_at matches YYYY-MM-DD HH:MM:SS"
    );

    // 3. Test event_at fallback (gmdate)
    echo "--- Testing event_at Fallback ---\n";
    $res = $helper->request('POST', 'entry', [
        'type' => 'drink',
        // event_at omitted
        'data' => ['notes' => 'Test fallback']
    ]);
    $helper->assertStatus($res, 200);
    $fallbackId = $res['body']['id'];

    $res = $helper->request('GET', 'entries', ['id' => $fallbackId]);
    $helper->assert(
        preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/', $res['body']['event_at']),
        "Fallback event_at matches YYYY-MM-DD HH:MM:SS"
    );

    echo "\nAll Date/Time Tests Passed! ✅\n";

} catch (Exception $e) {
    echo "\n[ERROR] Date Test Failed: " . $e->getMessage() . "\n";
    exit(1);
}

