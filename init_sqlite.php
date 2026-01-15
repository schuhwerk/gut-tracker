<?php
// init_sqlite.php
if (php_sapi_name() !== 'cli') {
    die("CLI only");
}

putenv('DB_DRIVER=sqlite');
require_once 'db_config.php';

echo "Initializing SQLite database...\n";

$commands = [
    "CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        password_hash TEXT NOT NULL
    )",
    "CREATE TABLE IF NOT EXISTS entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        recorded_at TEXT NOT NULL,
        data TEXT DEFAULT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )",
    "CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        access INTEGER,
        data TEXT
    )"
];

foreach ($commands as $cmd) {
    $pdo->exec($cmd);
}

echo "Database initialized (schema only). Use add_user.php to create accounts.\n";
?>
