<?php
// tests/test_api.php

require_once __DIR__ . '/TestHelper.php';

$t = new TestHelper();

echo "Starting Tests...\n";

// 1. Login
echo "\n--- Testing Login ---\n";
$res = $t->login('admin', 'admin');
$t->assertStatus($res, 200);
$t->assert(isset($res['body']['user_id']), 'User ID returned');

// 2. Add Food Entry
echo "\n--- Testing Food Entry ---\n";
$foodData = ['notes' => 'PHP Unit Test Apple'];
$postData = [
    'type' => 'food',
    'data' => json_encode($foodData)
];
// Sending as form-data (isJson=false) to simulate the app's FormData submission
$res = $t->request('POST', 'entry', $postData, false); 
$t->assertStatus($res, 200);
$t->assert(isset($res['body']['id']), 'Entry ID returned');

// 2.5. Add Drink Entry
echo "\n--- Testing Drink Entry ---\n";
$drinkData = ['notes' => 'Glass of water'];
$postData = [
    'type' => 'drink',
    'data' => json_encode($drinkData)
];
$res = $t->request('POST', 'entry', $postData, false);
$t->assertStatus($res, 200);

// 2.6. Add Symptom Entry
echo "\n--- Testing Symptom Entry ---\n";
$symptomData = [
    'notes' => 'Tummy ache',
    'severity' => 4
];
$postData = [
    'type' => 'symptom',
    'data' => json_encode($symptomData)
];
$res = $t->request('POST', 'entry', $postData, false);
$t->assertStatus($res, 200);

// 3. Add Sleep Entry (New Schema)
echo "\n--- Testing Sleep Entry ---\n";
$sleepData = [
    'duration_hours' => 8.0,
    'quality' => 4,
    'bedtime' => date('Y-m-d H:i:s', strtotime('-8 hours'))
];
$postData = [
    'type' => 'sleep',
    'data' => json_encode($sleepData)
];
$res = $t->request('POST', 'entry', $postData, false);
$t->assertStatus($res, 200);

// 4. Get Entries
echo "\n--- Testing Get Entries ---\n";
$res = $t->request('GET', 'entries');
$t->assertStatus($res, 200);
$t->assert(is_array($res['body']), 'Entries is array');
$t->assert(count($res['body']) >= 2, 'Expected at least 2 entries');

// 5. Test Updating All Entries
echo "\n--- Testing Update All Entries ---\n";
// Fetch all entries first
$res = $t->request('GET', 'entries');
$entries = $res['body'];

foreach ($entries as $entry) {
    $type = $entry['type'];
    $id = $entry['id'];
    echo "Updating Entry ID $id ($type)... ";
    
    $newData = [];
    if ($type === 'food') $newData = ['notes' => 'Updated Food Note'];
    if ($type === 'drink') $newData = ['notes' => 'Updated Drink Note'];
    if ($type === 'stool') $newData = ['bristol_score' => 5, 'notes' => 'Updated Stool'];
    if ($type === 'sleep') $newData = ['duration_hours' => 9, 'quality' => 5];
    if ($type === 'symptom') $newData = ['notes' => 'Updated Pain', 'severity' => 1];
    
    $postData = [
        'id' => $id,
        'type' => $type,
        'data' => json_encode($newData)
    ];
    
    $upRes = $t->request('POST', 'entry', $postData, false);
    if ($upRes['code'] === 200) {
        echo "[OK]\n";
    } else {
        echo "[FAIL] " . $upRes['raw'] . "\n";
        exit(1);
    }
}
$t->assert(true, 'All Updates Successful');

// 6. Export
echo "\n--- Testing Export ---\n";
$res = $t->request('GET', 'export');
$t->assertStatus($res, 200);
$t->assert(is_array($res['body']), 'Export is not array');
// Check if the export is valid json array
$t->assert(count($res['body']) > 0, 'Export empty');

echo "\nAll Tests Passed!\n";
?>
