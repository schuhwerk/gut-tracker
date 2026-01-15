<?php
require_once __DIR__ . '/TestHelper.php';

$t = new TestHelper('http://127.0.0.1:8085/api.php');

// 0. Create User & Login
$username = 'test_type_' . time();
$password = 'pass';
$res = $t->request('POST', 'create_user', ['username' => $username, 'password' => $password]);
if ($res['code'] !== 200) die("Failed to create user");

$res = $t->login($username, $password);
if ($res['code'] !== 200) die("Failed to login");

// 1. Create a Food Entry
echo "Creating Food Entry...\n";
$res = $t->request('POST', 'entry', [
    'type' => 'food',
    'recorded_at' => '2025-01-01 12:00:00',
    'data' => json_encode(['notes' => 'Test Food'])
]);
$t->assertStatus($res, 200);

$id = $res['body']['id'];
echo "Created ID: $id\n";

// 2. Update Type to Drink
echo "Updating Type to Drink...\n";
$res = $t->request('POST', 'entry', [
    'id' => $id,
    'type' => 'drink',
    'recorded_at' => '2025-01-01 12:00:00',
    'data' => json_encode(['notes' => 'Converted to Drink', 'amount_liters' => 0.5])
]);
$t->assertStatus($res, 200);

// 3. Verify

echo "Verifying...\n";

$res = $t->request('GET', 'entries', ['id' => $id]);

$t->assertStatus($res, 200);



$entry = $res['body'];

$data = is_string($entry['data']) ? json_decode($entry['data'], true) : (array)$entry['data'];



if ($entry['type'] === 'drink' && $data['notes'] === 'Converted to Drink') {

    echo "SUCCESS: Entry type changed to Drink.\n";

} else {

    echo "FAILURE: Entry type is " . $entry['type'] . "\n";

    print_r($entry);

    exit(1);

}

?>
