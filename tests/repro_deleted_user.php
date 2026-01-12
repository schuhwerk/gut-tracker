<?php
require_once __DIR__ . '/TestHelper.php';

// Use correct port
$t = new TestHelper('http://localhost:8123/api.php');

// 1. Create unique user & Login
$username = 'del_' . uniqid();
$password = 'password';
$t->request('POST', 'create_user', ['username' => $username, 'password' => $password]);
$loginRes = $t->login($username, $password);
$userId = $loginRes['body']['user_id'];

echo "Logged in as ID: $userId\n";

// 2. Delete user directly from DB (simulating DB reset or manual deletion)
// We need to access DB directly.
require __DIR__ . '/../db_config.php';
$stmt = $pdo->prepare("DELETE FROM users WHERE id = ?");
$stmt->execute([$userId]);
echo "User deleted from DB.\n";

// 3. Call check_auth
echo "Calling check_auth...\n";
$res = $t->request('GET', 'check_auth');

echo "Status: " . $res['code'] . "\n";
echo "Body: " . print_r($res['body'], true) . "\n";
echo "Raw: " . $res['raw'] . "\n";

if ($res['code'] == 500) {
    echo "Reproduced 500 error (Deleted User scenario)!\n";
} else {
    echo "Did not reproduce 500 error.\n";
}
?>
