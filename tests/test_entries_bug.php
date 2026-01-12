<?php
// Test script to reproduce "Error loading entries"

require_once __DIR__ . '/TestHelper.php';

$t = new TestHelper();

// 1. Login first to get a session
$username = 'testuser_' . uniqid();
$password = 'testpassword';

// Create user first just in case
$t->request('POST', 'create_user', ['username' => $username, 'password' => $password]);

// Now Login
echo "Logging in...\n";
$res = $t->login($username, $password);
echo "Login Response: " . $res['raw'] . "\n";

// 2. Fetch Entries
echo "Fetching entries...\n";
$res = $t->request('GET', 'entries');

echo "HTTP Code: " . $res['code'] . "\n";
echo "Response: " . $res['raw'] . "\n";

if ($res['code'] !== 200) {
    echo "FAILURE: API returned status " . $res['code'] . "\n";
} else {
    if (is_array($res['body'])) {
        echo "SUCCESS: Valid JSON received\n";
    } else {
        echo "FAILURE: Invalid JSON received\n";
    }
}
?>
