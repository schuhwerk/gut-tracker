<?php

require_once __DIR__ . '/TestHelper.php';

$t = new TestHelper();

$data = [
    'username' => 'testuser_' . time(),
    'password' => 'password123'
];

$res = $t->request('POST', 'create_user', $data);

echo "HTTP Code: " . $res['code'] . "\n";
echo "Response: " . $res['raw'] . "\n";
?>
