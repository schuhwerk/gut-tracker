<?php
// db_config.php - Database Configuration (SQLite Only)

$dbPath = getenv('GUT_TRACKER_DB_PATH') ?: __DIR__ . '/gut_tracker.sqlite';

if ($dbPath !== ':memory:') {
    // Try to resolve realpath if file exists
    if (file_exists($dbPath)) {
        $realPath = realpath($dbPath);
        if ($realPath) {
            $dbPath = $realPath;
        }
    }

    $dbDir = dirname($dbPath);

    // Check Directory Permissions
    if (!is_dir($dbDir)) {
        throw new Exception("SQLite Error: Directory '$dbDir' does not exist.");
    }
    if (!is_writable($dbDir)) {
        $user = function_exists('posix_getpwuid') ? posix_getpwuid(posix_geteuid())['name'] : get_current_user();
        $msg = "SQLite Error: Directory '$dbDir' is not writable by user '$user'. Run: chmod 775 $dbDir && chown :www-data $dbDir";
        error_log($msg);
        throw new Exception($msg);
    }

    // Check File Permissions (if exists)
    if (file_exists($dbPath) && !is_writable($dbPath)) {
        $user = function_exists('posix_getpwuid') ? posix_getpwuid(posix_geteuid())['name'] : get_current_user();
        $msg = "SQLite Error: File '$dbPath' is not writable by user '$user'. Run: chmod 664 $dbPath";
        error_log($msg);
        throw new Exception($msg);
    }

    // Check for WAL/Journal companion files permissions
    foreach (['-wal', '-shm', '-journal'] as $suffix) {
        $companion = $dbPath . $suffix;
        if (file_exists($companion) && !is_writable($companion)) {
            $user = function_exists('posix_getpwuid') ? posix_getpwuid(posix_geteuid())['name'] : get_current_user();
            $msg = "SQLite Error: Companion file '$companion' is not writable by user '$user'. This often causes 'unable to open database file'. Run: chown $user '$companion' or delete it if safe.";
            error_log($msg);
            throw new Exception($msg);
        }
    }
}

$dsn = "sqlite:$dbPath"; 

$options = [
    PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    PDO::ATTR_EMULATE_PREPARES   => false,
];

try {
    $pdo = new PDO($dsn, null, null, $options);
    // Enable WAL mode for better concurrency and fewer "database locked" errors
    // Skip WAL for :memory: as it doesn't apply
    if ($dbPath !== ':memory:') {
        $pdo->exec('PRAGMA journal_mode=WAL;');
    }
} catch (\PDOException $e) {
    // Attempt to give more context on the error
    $msg = $e->getMessage();
    if ($dbPath !== ':memory:' && strpos($msg, 'unable to open database file') !== false) {
         $msg .= " (Path: $dbPath - Checked Dir: " . (is_writable($dbDir) ? 'Writable' : 'Not Writable') . ")";
    }
    throw new \PDOException($msg, (int)$e->getCode());
}