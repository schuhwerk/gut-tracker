<?php
require_once __DIR__ . '/TestHelper.php';

$t = new TestHelper();
$t->login('admin', 'admin');

$imagePath = __DIR__ . '/test_image_remove.png';
if (!file_exists($imagePath)) {
    // Create a dummy small PNG without GD
    $png = base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==');
    file_put_contents($imagePath, $png);
}

echo "--- Testing Image Removal via Update ---
";

// 1. Create Entry with Image
$file = new CURLFile($imagePath, 'image/png', 'test_image_remove.png');
$res = $t->request('POST', 'entry', [
    'type' => 'food',
    'image' => $file,
    'data' => json_encode(['notes' => 'Has Image'])
], false);

$t->assertStatus($res, 200);
$id = $res['body']['id'];
$uploadedPath = $res['body']['image_path'];
echo "Entry created: $id, Path: $uploadedPath
";

$serverPath = dirname(__DIR__) . '/' . $uploadedPath;
$t->assert(file_exists($serverPath), "File should exist: $serverPath");

// 2. Update Entry to REMOVE Image (image_path: null)
// We simulate what the frontend sends: JSON data with image_path: null
// Note: We use Multipart/Form-data because that's what the frontend uses for updates usually, 
// but here we can use JSON if the endpoint supports it.
// The frontend uses DataService which constructs FormData.
// But api.php handles both if setup correctly, but let's stick to FormData style as per app usage.
// Actually, for UPDATE without file upload, frontend sends 'data' json string.

$updateData = [
    'id' => $id,
    'type' => 'food',
    'event_at' => gmdate('Y-m-d H:i:s'),
    'data' => json_encode(['notes' => 'Image Removed', 'image_path' => null])
];

$res = $t->request('POST', 'entry', $updateData, false);
$t->assertStatus($res, 200);
$updatedPath = $res['body']['image_path'];
echo "Update response image_path: " . var_export($updatedPath, true) . "
";

$t->assert($updatedPath === null, "Image path should be null in response");

// 3. Verify File Deletion
$t->assert(!file_exists($serverPath), "File should be deleted from disk: $serverPath");

// 4. Verify DB
$res = $t->request('GET', 'entries', ['id' => $id]);
if (empty($res['body']) || isset($res['body']['error'])) {
    echo "FAIL: Could not fetch entry $id. Body: " . print_r($res['body'], true) . "\n";
    exit(1);
}
// Single object returned when ID is provided
$entry = $res['body'];
$data = $entry['data']; // Already decoded
$t->assert(!isset($data['image_path']) || $data['image_path'] === null, "DB should not have image_path");

echo "Image removal test passed.
";

if (file_exists($imagePath)) unlink($imagePath);

