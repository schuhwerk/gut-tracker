<?php
require_once __DIR__ . '/TestHelper.php';

$t = new TestHelper();
$t->login('admin', 'admin');

$imagePath = __DIR__ . '/test_image.png';
if (!file_exists($imagePath)) {
    // Create a dummy image
    $im = imagecreatetruecolor(10, 10);
    imagepng($im, $imagePath);
    imagedestroy($im);
}

// 1. Test Normal Deletion
echo "--- Testing Normal Deletion ---
";
$file = new CURLFile($imagePath, 'image/png', 'test_image.png');
// Note: 'data' needs to be a string if we are mixing with file upload (multipart/form-data)
// because api.php does: $jsonData = json_decode($_POST['data'], true);
$res = $t->request('POST', 'entry', [
    'type' => 'test', 
    'image' => $file,
    'data' => json_encode(['test' => 'robust']) 
], false);

if ($res['code'] !== 200) {
    echo "FAIL: Failed to create entry. Body: " . print_r($res['body'], true) . "
";
    exit(1);
}

$id1 = $res['body']['id'];
$uploadedPath1 = $res['body']['image_path'];
echo "Entry created: $id1, Path: $uploadedPath1
";

if (!$uploadedPath1) {
    echo "FAIL: No image path returned.
";
    exit(1);
}

// Check file exists on server
$serverPath1 = dirname(__DIR__) . '/' . $uploadedPath1;
$t->assert(file_exists($serverPath1), "File should exist: $serverPath1");

// Delete
$res = $t->request('POST', 'delete', ['id' => $id1]);
$t->assertStatus($res, 200);

// Check file is gone
$t->assert(!file_exists($serverPath1), "File should be deleted from disk: $serverPath1");


// 2. Test Broken File Deletion
echo "--- Testing Broken File Deletion ---
";
$file = new CURLFile($imagePath, 'image/png', 'test_image.png');
$res = $t->request('POST', 'entry', [
    'type' => 'test', 
    'image' => $file,
    'data' => json_encode(['test' => 'robust'])
], false);

$t->assertStatus($res, 200);
$id2 = $res['body']['id'];
$uploadedPath2 = $res['body']['image_path'];
echo "Entry created: $id2, Path: $uploadedPath2
";

$serverPath2 = dirname(__DIR__) . '/' . $uploadedPath2;
$t->assert(file_exists($serverPath2), "File should exist: $serverPath2");

// SABOTAGE: Manually delete the file
echo "Sabotaging: Unlinking $serverPath2
";
unlink($serverPath2);
$t->assert(!file_exists($serverPath2), "File should be manually deleted: $serverPath2");

// Try to delete entry via API
$res = $t->request('POST', 'delete', ['id' => $id2]);
$t->assertStatus($res, 200); // Should succeed
echo "Deleted entry with broken link successfully.
";

// Check entry is gone from DB
$res = $t->request('POST', 'delete', ['id' => $id2]);
$t->assertStatus($res, 404, "Entry should be gone from DB (404 on second delete)");

echo "All robust delete tests passed.
";

