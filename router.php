<?php
// router.php - Security wrapper for PHP built-in server
$path = parse_url($_SERVER["REQUEST_URI"], PHP_URL_PATH);

// Block sensitive extensions and specific files
if (preg_match('/\.(sqlite|sqlite3|db|log|git)$/i', $path) || 
    preg_match('#^/(db_config\.php|init_sqlite\.php|add_user\.php|README\.md|tests/)#i', $path)) {
    error_log("Blocked access to $path");
    http_response_code(403);
    echo "Forbidden";
    exit;
}

// Block dotfiles
if (strpos($path, '/.') !== false) {
    http_response_code(403);
    echo "Forbidden";
    exit;
}

// Default behavior
return false;
?>
