<?php
require_once __DIR__ . '/TestHelper.php';

$t = new TestHelper();
$t->login('admin', 'admin');

echo "--- Testing Clone created_at Update ---
";

// 1. Create Original Entry
$res = $t->request('POST', 'entry', [
    'type' => 'food', 
    'data' => json_encode(['notes' => 'Original']) 
], false);

$t->assertStatus($res, 200);
$originalId = $res['body']['id'];

// Fetch original to get created_at
$res = $t->request('GET', 'entries', ['id' => $originalId]);
$original = $res['body'];
$originalCreatedAt = $original['created_at'];
echo "Original created_at: $originalCreatedAt
";

// Wait a bit to ensure a different timestamp if resolution is seconds
sleep(2);

// 2. Clone the entry
// Note: We simulate app.cloneEntry behavior:
// newEntry = { ...original, id: null, recorded_at: now, created_at: now }
// The test helper doesn't have cloneEntry, we do it via request.

$cloneData = [
    'type' => $original['type'],
    'recorded_at' => gmdate('Y-m-d H:i:s'),
    'data' => $original['data'], // This is already an array in the helper response? 
    // Wait, TestHelper's request body for GET entries is already decoded.
];

// Let's re-verify how TestHelper handles the body. 
// In the previous test, I saw it was an array.

// Re-encode data for the POST request
$postData = [
    'type' => $original['type'],
    'recorded_at' => gmdate('Y-m-d H:i:s'),
    'data' => json_encode($original['data'])
];

// CRITICAL: We want to see if the server sets a new created_at 
// OR if we send one, it accepts it.
// In app.js we added: created_at: utils.toUTC(new Date())
// So we should send it in 'data'? No, created_at is a top level column in entries table.
// Wait, api.php 'entry' endpoint handles:
// $stmt = $pdo->prepare("INSERT INTO entries (user_id, type, recorded_at, data) VALUES (?, ?, ?, ?)");
// It DOES NOT take created_at from input. The DB has DEFAULT CURRENT_TIMESTAMP.

// Re-read init_sqlite.php:
// "created_at TEXT DEFAULT CURRENT_TIMESTAMP"

// Re-read api.php INSERT:
// "INSERT INTO entries (user_id, type, recorded_at, data) VALUES (?, ?, ?, ?)"

// So the server AUTOMATICALLY sets created_at on INSERT.
// If I clone an entry, the server will naturally give it a new created_at because it's a new INSERT.

// However, my change in app.js was:
/*
            const newEntry = {
                ...originalEntry,
                id: null,
                recorded_at: utils.toUTC(new Date()),
                created_at: utils.toUTC(new Date()),
                synced: 0 
            };
*/
// This affects LOCAL saving (indexedDB) via DataService.saveEntry -> db.addEntry.
// Let's check db.addEntry in idb-store.js:
/*
            if (!entry.created_at && !entry.id) {
                entry.created_at = new Date().toISOString().replace('T', ' ').substring(0, 19);
            }
            return store.put(entry);
*/
// If I DON'T update created_at in cloneEntry, and I spread `...originalEntry`,
// then `newEntry` inherits the OLD `created_at`.
// Since `newEntry.created_at` IS set, `db.addEntry` WILL NOT overwrite it.
// So without my change, the CLONE would have the SAME `created_at` as original in the local DB.

// For the SERVER, it depends on whether we send created_at.
// DataService.saveEntry sends:
/*
                formData.append('type', entry.type);
                formData.append('recorded_at', entry.recorded_at);
                formData.append('data', JSON.stringify(entry.data));
*/
// It DOES NOT send `created_at`. So the server always uses `CURRENT_TIMESTAMP`.

// So the issue was mostly for LOCAL mode or for the local cache state before a refresh.
// And since I added `Created: ... (UTC)` to the UI, if the user clones and immediately edits, 
// they would see the OLD creation time if I didn't update it.

// Test: Verify that a new INSERT on server has a NEW created_at.
echo "Creating clone...
";
$res = $t->request('POST', 'entry', $postData, false);
$t->assertStatus($res, 200);
$cloneId = $res['body']['id'];

$res = $t->request('GET', 'entries', ['id' => $cloneId]);
$clone = $res['body'];
$cloneCreatedAt = $clone['created_at'];
echo "Clone created_at: $cloneCreatedAt
";

$t->assert($cloneCreatedAt !== $originalCreatedAt, "Clone should have different created_at");

echo "Clone created_at test passed.
";

