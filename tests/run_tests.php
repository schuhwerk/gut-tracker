<?php
/**
 * Unified Test Runner for Gut Tracker
 * 
 * This script runs all PHP tests in the tests/ directory.
 * It assumes a local PHP server is running at http://localhost:8085
 * 
 * To run a single test:
 * 1. Start server: php -S 127.0.0.1:8085 router.php
 * 2. Run test:    php tests/test_api.php (or any other test file)
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

$testDescriptions = [
    'test_ai.php' => 'Validation of AI parsing endpoint inputs',
    'test_ai_features.php' => 'Validation for multimodal AI endpoints (Vision, Voice)',
    'test_ai_live.php' => 'Live integration test with Gemini AI',
    'test_api.php' => 'Core API functionality (CRUD for entries)',
    'test_create_user_repro.php' => 'Reproduction for user creation edge cases',
    'test_dates.php' => 'Validation of date and time formatting',
    'test_delete.php' => 'Basic entry deletion',
    'test_delete_robust.php' => 'Advanced deletion scenarios and constraints',
    'test_entries_bug.php' => 'Regression test for specific entry fetch bug',
    'test_image_upload.php' => 'Image upload and attachment functionality',
    'test_session_db.php' => 'Session management and database persistence',
    'test_settings.php' => 'User settings (API Key) and Data Management',
    'test_type_change.php' => 'Regression for data type conversion issues',
    'test_update_bug.php' => 'Regression for entry update validation',
    'test_user_creation.php' => 'User registration and authentication logic'
];

foreach ($testFiles as $file) {
    $filename = basename($file);
    $description = $testDescriptions[$filename] ?? 'No description available';
    
    // Skip live AI test if no API key provided
    if ($filename === 'test_ai_live.php' && empty($apiKey)) {
        echo "[SKIP]    $filename ($description)\n";
        continue;
    }
    
    // Execute the test script and capture output
    $output = [];
    $returnCode = 0;
    
    $cmd = "php " . escapeshellarg($file);
    if ($filename === 'test_ai_live.php') {
        $cmd .= " " . escapeshellarg($apiKey);
    }
    
    exec($cmd, $output, $returnCode);
    
    if ($returnCode !== 0) {
        echo "\n" . implode("\n", $output) . "\n";
        echo "[ERROR]   $filename failed with exit code $returnCode\n";
        $allPassed = false;
    } else {
        echo sprintf("[SUCCESS] %-25s - %s\n", $filename, $description);
    }
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
