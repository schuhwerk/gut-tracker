<?php
if (php_sapi_name() !== 'cli') {
    die("CLI only");
}
require_once 'db_config.php';

$username = $argv[1] ?? null;
if (!$username) {
    echo "Usage: php add_user.php <username>\n";
    exit(1);
}

echo "Enter Password for '$username': ";
$handle = fopen ("php://stdin","r");
$password = trim(fgets($handle));

if (!$password) { 
    echo "Password cannot be empty.\n";
    exit(1);
}

$hash = password_hash($password, PASSWORD_DEFAULT);

try {
    $stmt = $pdo->prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)");
    $stmt->execute([$username, $hash]);
    echo "User '$username' created successfully.\n";
} catch (PDOException $e) {
    echo "Error: User likely exists or DB error.\n";
}
?>
