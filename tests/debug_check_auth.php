<?php
// tests/debug_check_auth.php

// Mock Environment
$_SERVER['REQUEST_METHOD'] = 'GET';
$_GET['endpoint'] = 'check_auth';
$_SERVER['HTTP_ORIGIN'] = 'http://localhost';

// Capture output
ob_start();
try {
    require __DIR__ . '/../api.php';
} catch (Throwable $e) {
    echo "\nCRITICAL ERROR CAUGHT: " . $e->getMessage() . "\n";
    echo $e->getTraceAsString();
}
$output = ob_get_clean();

echo "HTTP Response Code: " . http_response_code() . "\n";
echo "Output: " . $output . "\n";

