<?php
require_once __DIR__ . '/TestHelper.php';

$t = new TestHelper();

// 1. Create unique user
$username = 'repro_' . uniqid();
$password = 'password';
$t->request('POST', 'create_user', ['username' => $username, 'password' => $password]);
$t->login($username, $password);

// 2. Add Entry with data
$originalData = [
    'notes' => 'Test "quotes" & symbols!',
    'score' => 123,
    'precise' => 12.34,
    'bool' => true,
    'nested' => ['a' => 1]
];

// Sending data as JSON string inside the form field 'data'
$postData = [
    'type' => 'food',
    'data' => json_encode($originalData)
];

$res = $t->request('POST', 'entry', $postData, false);
$id = $res['body']['id'];

// 3. Fetch Entries
$res = $t->request('GET', 'entries');
$entries = $res['body'];

// Find our entry
$found = null;
foreach ($entries as $entry) {
    if ($entry['id'] == $id) {
        $found = $entry;
        break;
    }
}

if (!$found) {
    echo "Entry not found!\n";
    exit(1);
}

// 4. Inspect Data
echo "Data returned from API:\n";
var_dump($found);

// Compare
// Note: JSON decode/encode might change types (object vs array)
$data = $found['data']; // This is an array in PHP because TestHelper uses json_decode(..., true)

// But wait! public/api.php returns data as an object (stdClass) or object-like structure in JSON.
// When TestHelper decodes the response with true, it becomes associative array.
// So we should expect $data to be an array matching $originalData.

// Check specific fields
if ($data['notes'] !== $originalData['notes']) {
    echo "FAIL: Notes mismatch. Expected '{$originalData['notes']}', got '{$data['notes']}'\n";
    exit(1);
}
if ($data['score'] !== $originalData['score']) {
    echo "FAIL: Score mismatch. Expected {$originalData['score']}, got {$data['score']}\n";
    exit(1);
}

echo "PASS: Data loaded correctly.\n";

