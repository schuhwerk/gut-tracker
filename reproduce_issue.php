<?php
// Simulate a GET request to entries
$_SERVER['REQUEST_METHOD'] = 'GET';
$_SERVER['PATH_INFO'] = '/entries'; // Depending on how api.php reads path
$_GET['endpoint'] = 'entries'; // api.php uses this
$_SERVER['HTTP_ORIGIN'] = 'http://localhost';

// Mock session
session_start();
$_SESSION['user_id'] = 1;

// Capture output
ob_start();
require 'api.php';
$output = ob_get_clean();

echo "Output length: " . strlen($output) . "\n";
echo "Output start: " . substr($output, 0, 100) . "\n";

if (empty($output)) {
    echo "ERROR: No output produced.\n";
}

