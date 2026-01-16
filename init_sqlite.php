<?php
// init_sqlite.php
if (php_sapi_name() !== 'cli') {
    die("CLI only");
}

putenv('DB_DRIVER=sqlite');
require_once 'db_config.php';
require_once 'services/DatabaseService.php';

echo "Initializing SQLite database...\n";

try {
    DatabaseService::initializeSchema($pdo);
    echo "Database initialized (schema & migrations).\n";
} catch (Exception $e) {
    echo "Error: " . $e->getMessage() . "\n";
}

echo "Use add_user.php to create accounts.\n";
?>