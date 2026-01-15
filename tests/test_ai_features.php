<?php
// tests/test_ai_features.php
require_once __DIR__ . '/TestHelper.php';

$t = new TestHelper();
$t->login('admin', 'admin');

echo "--- Testing AI Vision Validation ---
";
// 1. Missing Image
$res = $t->request('POST', 'ai_vision', ['api_key' => 'sk-fake']);
$t->assertStatus($res, 400);
$t->assert($res['body']['error'] === 'Missing image', 'Rejected missing image');

// 2. Missing API Key
$res = $t->request('POST', 'ai_vision', ['image_base64' => 'fake_base64']);
// Note: It might be 400 or 401 depending on logic order, usually NO_API_KEY is 400 in our api.php
$t->assertStatus($res, 400);
$t->assert($res['body']['error'] === 'NO_API_KEY', 'Rejected missing API key');


echo "\n--- Testing AI Transcribe Validation ---
";
// 1. Missing File
$res = $t->request('POST', 'ai_transcribe', ['api_key' => 'sk-fake'], false); // multipart=false/true handled by helper? usually true for file
// Actually TestHelper defaults to multipart if data isn't string, but we aren't sending file here
$res = $t->request('POST', 'ai_transcribe', ['api_key' => 'sk-fake']); 
$t->assertStatus($res, 400);
$t->assert($res['body']['error'] === 'Missing audio file', 'Rejected missing audio file');


echo "\n--- Testing AI Magic Voice Validation ---
";
// 1. Missing File
$res = $t->request('POST', 'ai_magic_voice', ['api_key' => 'sk-fake']);
$t->assertStatus($res, 400);
$t->assert($res['body']['error'] === 'Missing audio file', 'Rejected missing audio file');

echo "\nAI Feature Validation Tests Passed.
";
