<?php
// tests/test_update_bug.php

require_once __DIR__ . '/TestHelper.php';

$t = new TestHelper();

echo "1. Login...\n";
$t->login('admin', 'admin');

echo "2. Create Food Entry...\n";
$foodData = ['notes' => 'Original Food'];
$res = $t->request('POST', 'entry', [
    'type' => 'food',
    'data' => json_encode($foodData)
], false);
$entryId = $res['body']['id'] ?? null;
echo "Entry Created: ID $entryId\n";

if (!$entryId) {
    echo "FAIL: Entry creation failed.\n";
    exit(1);
}

echo "3. Update Food Entry (Simulate Frontend)...";
// Frontend sends 'recorded_at' as '2026-01-11T12:00' (from datetime-local)
// And it sends FormData (multipart/form-data)
$updateData = ['notes' => 'Updated Food'];
$postData = [
    'id' => $entryId,
    'type' => 'food',
    'recorded_at' => '2026-01-11T12:00', 
    'data' => json_encode($updateData)
];

$res = $t->request('POST', 'entry', $postData, false); 

echo "3. Testing Update on Entry without Image (Potential Crash)...\n";
// Create a Drink entry (no image)
$res = $t->request('POST', 'entry', [
    'type' => 'drink',
    'data' => json_encode(['notes' => 'Water'])
], false);
$drinkId = $res['body']['id'];

// Update it
$res = $t->request('POST', 'entry', [
    'id' => $drinkId,
    'type' => 'drink',
    'data' => json_encode(['notes' => 'More Water'])
], false);

require_once __DIR__ . '/../db_config.php';

echo "4. Testing Update on Entry with NULL Data (Crash Test)...\n";
// Force insert a row with NULL data directly
$pdo->exec("INSERT INTO entries (user_id, type, recorded_at, data) VALUES (1, 'test', date('now'), NULL)");
$nullId = $pdo->lastInsertId();

// Try to update it via API
$res = $t->request('POST', 'entry', [
    'id' => $nullId,
    'type' => 'test',
    'data' => json_encode(['notes' => 'Updated'])
], false);

echo "Null Data Update HTTP Code: " . $res['code'] . "\n";
echo "Response: " . substr($res['raw'], 0, 100) . "...\n";

if ($res['code'] === 200) {
    echo "[PASS] Null data update successful.\n";
} else {
    echo "[FAIL] Null data update failed.\n";
}
?>
