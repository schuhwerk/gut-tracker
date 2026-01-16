<?php
require_once __DIR__ . '/TestHelper.php';

$t = new TestHelper();

// 1. Create unique user & Login (to populate session)
$username = 'repro_' . uniqid();
$password = 'password';
$t->request('POST', 'create_user', ['username' => $username, 'password' => $password]);
$t->login($username, $password);

// 2. Call check_auth
echo "Calling check_auth...\n";
$res = $t->request('GET', 'check_auth');

echo "Status: " . $res['code'] . "\n";
echo "Body: " . print_r($res['body'], true) . "\n";
echo "Raw: " . $res['raw'] . "\n";

if ($res['code'] == 500) {
    echo "Reproduced 500 error!\n";
} else {
    echo "Did not reproduce 500 error.\n";
}
?>
