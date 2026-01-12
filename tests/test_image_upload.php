<?php
// tests/test_image_upload.php

require_once __DIR__ . '/TestHelper.php';

$imagePath = __DIR__ . '/test_image.png';
if (!file_exists($imagePath)) {
    die("Test image not found at $imagePath\n");
}

$t = new TestHelper();

// 1. Login
echo "Logging in...\n";
$t->login('admin', 'admin');

// 2. Upload Image
echo "Uploading entry with image...\n";
$cfile = new CURLFile($imagePath, 'image/png', 'test_image.png');
$postData = [
    'type' => 'food',
    'image' => $cfile,
    'data' => json_encode(['notes' => 'Test Image Upload'])
];

$res = $t->request('POST', 'entry', $postData, false);

echo "Response Code: " . $res['code'] . "\n";
echo "Response Body: " . $res['raw'] . "\n";

if ($res['code'] === 200 && isset($res['body']['id'])) {
    echo "SUCCESS: Entry created with ID " . $res['body']['id'] . "\n";
} else {
    echo "FAILURE\n";
    exit(1);
}

// 3. Verify Image Path in DB (via Get Entries)
$createdId = $res['body']['id'];
$res = $t->request('GET', 'entries', ['limit' => 50]);
$found = false;

foreach ($res['body'] as $entry) {
    if ($entry['id'] == $createdId) {
        $found = true;
        if (isset($entry['data']['image_path']) && strpos($entry['data']['image_path'], 'uploads/') !== false) {
            echo "SUCCESS: Image path found: " . $entry['data']['image_path'] . "\n";
        } else {
            echo "FAILURE: Image path missing in entry data for ID $createdId.\n";
            print_r($entry);
            exit(1);
        }
        break;
    }
}

if (!$found) {
    echo "FAILURE: Created entry ID $createdId not found in entries list.\n";
    exit(1);
}
?>
