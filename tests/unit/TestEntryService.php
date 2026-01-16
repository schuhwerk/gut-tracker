<?php

require_once __DIR__ . '/../../services/EntryService.php';
require_once __DIR__ . '/../../services/DatabaseService.php';

function assertTest($condition, $message) {
    if ($condition) {
        echo "[PASS] $message\n";
    } else {
        echo "[FAIL] $message\n";
        exit(1);
    }
}

echo "Running EntryService Unit Tests...\n";

// Initialize in-memory DB
$pdo = new PDO('sqlite::memory:');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
DatabaseService::initializeSchema($pdo);

$service = new EntryService($pdo);
$userId = 1;

// Test 1: Save Entry
$data = ['notes' => 'Test food'];
$id = $service->saveEntry($userId, 'food', '2023-10-10 12:00:00', $data);
assertTest($id > 0, "Entry saved successfully");

// Test 2: Get Entry
$entry = $service->getEntry($userId, $id);
assertTest($entry['type'] === 'food', "Entry type correct");
assertTest($entry['data']['notes'] === 'Test food', "Entry data correct");

// Test 3: Get Entries
$entries = $service->getEntries($userId);
assertTest(count($entries) === 1, "Correct number of entries fetched");

// Test 4: Update Entry
$data['notes'] = 'Updated food';
$service->saveEntry($userId, 'food', '2023-10-10 12:00:00', $data, $id);
$entry = $service->getEntry($userId, $id);
assertTest($entry['data']['notes'] === 'Updated food', "Entry updated successfully");

// Test 5: Delete Entry
$service->deleteEntry($userId, $id);
$entry = $service->getEntry($userId, $id);
assertTest($entry === false, "Entry deleted successfully");

echo "All EntryService unit tests passed.\n";
