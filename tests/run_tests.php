<?php
/**
 * Unified Test Runner for Gut Tracker
 * 
 * This script runs all PHP tests in the tests/ directory.
 * It assumes a local PHP server is running at http://localhost:8080
 */

$testFiles = glob(__DIR__ . '/test_*.php');
$allPassed = true;

$apiKey = $argv[1] ?? '';
if (empty($apiKey) && file_exists(__DIR__ . '/api_key.txt')) {
    $apiKey = trim(file_get_contents(__DIR__ . '/api_key.txt'));
}

echo "====================================\n";
echo "   Gut Tracker - Test Suite\n";
echo "====================================\n";

// Ensure test user 'admin' exists
require_once __DIR__ . '/../db_config.php';
$stmt = $pdo->prepare("SELECT id FROM users WHERE username = 'admin'");
$stmt->execute();
if (!$stmt->fetch()) {
    echo "Creating 'admin' test user...\n";
    $hash = password_hash('admin', PASSWORD_DEFAULT);
    $pdo->prepare("INSERT INTO users (username, password_hash) VALUES ('admin', ?)")->execute([$hash]);
}
$stmt = null;
$pdo = null;

foreach ($testFiles as $file) {
    $filename = basename($file);
    
    // Skip live AI test if no API key provided
    if ($filename === 'test_ai_live.php' && empty($apiKey)) {
        echo "\n>>> Skipping $filename (No API key provided)...\n";
        continue;
    }
    
    echo "\n>>> Running $filename...\n";
    
    // Execute the test script and capture output
    $output = [];
    $returnCode = 0;
    
    $cmd = "php " . escapeshellarg($file);
    if ($filename === 'test_ai_live.php') {
        $cmd .= " " . escapeshellarg($apiKey);
    }
    
    exec($cmd, $output, $returnCode);
    
    echo implode("\n", $output) . "\n";
    
    if ($returnCode !== 0) {
        echo "\n[ERROR] $filename failed with exit code $returnCode\n";
        $allPassed = false;
    } else {
        echo "\n[SUCCESS] $filename finished successfully\n";
    }
    echo "------------------------------------\n";
    sleep(1);
}

echo "\n====================================\n";
if ($allPassed) {
    echo "   ALL TESTS PASSED! 🎉\n";
    exit(0);
} else {
    echo "   SOME TESTS FAILED. ❌\n";
    exit(1);
}
echo "====================================\n";
