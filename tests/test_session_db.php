<?php
// tests/test_session_db.php
require_once __DIR__ . '/../db_config.php';

echo "Testing Session Database Storage...\n";

// 1. Verify table exists
try {
    $result = $pdo->query("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'");
    if ($result->fetch()) {
        echo "[OK] 'sessions' table exists.\n";
    } else {
        echo "[ERROR] 'sessions' table NOT found.\n";
        exit(1);
    }
} catch (Exception $e) {
    echo "[ERROR] Database error: " . $e->getMessage() . "\n";
    exit(1);
}

// 2. Simulate the Session Handler logic
$testId = 'test_session_' . uniqid();
$testData = 'user_id|i:1;username|s:5:"admin";';
$access = time();

echo "Simulating session write...\n";
$stmt = $pdo->prepare("INSERT OR REPLACE INTO sessions (id, access, data) VALUES (:id, :access, :data)");
$stmt->execute([':id' => $testId, ':access' => $access, ':data' => $testData]);

// 3. Verify it was written
$stmt = $pdo->prepare("SELECT * FROM sessions WHERE id = :id");
$stmt->execute([':id' => $testId]);
$row = $stmt->fetch();

if ($row && $row['data'] === $testData) {
    echo "[OK] Session data successfully written and verified in DB.\n";
    
    // Cleanup
    $pdo->prepare("DELETE FROM sessions WHERE id = :id")->execute([':id' => $testId]);
    echo "[OK] Cleanup successful.\n";
} else {
    echo "[ERROR] Session data could not be verified.\n";
    exit(1);
}

echo "\nVerification complete. The system is ready to handle persistent sessions.\n";

