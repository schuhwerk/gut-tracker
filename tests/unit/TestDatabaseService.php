<?php

require_once __DIR__ . '/../../services/DatabaseService.php';

function assertTest($condition, $message) {
    if ($condition) {
        echo "[PASS] $message\n";
    } else {
        echo "[FAIL] $message\n";
        exit(1);
    }
}

echo "Running DatabaseService Unit Tests...\n";

// Initialize in-memory DB
$pdo = new PDO('sqlite::memory:');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

DatabaseService::initializeSchema($pdo);

// Check if tables exist
$tables = $pdo->query("SELECT name FROM sqlite_master WHERE type='table'")->fetchAll(PDO::FETCH_COLUMN);

assertTest(in_array('users', $tables), "Table 'users' exists");
assertTest(in_array('entries', $tables), "Table 'entries' exists");
assertTest(in_array('sessions', $tables), "Table 'sessions' exists");
assertTest(in_array('logs', $tables), "Table 'logs' exists");

// Check if columns exist (migration check)
$columns = $pdo->query("PRAGMA table_info(users)")->fetchAll(PDO::FETCH_ASSOC);
$columnNames = array_column($columns, 'name');

assertTest(in_array('api_key', $columnNames), "Column 'api_key' exists in 'users'");
assertTest(in_array('debug_mode', $columnNames), "Column 'debug_mode' exists in 'users'");

echo "All DatabaseService unit tests passed.\n";

