<?php

class MigrationService {
    
    // Define migrations here. Key is version/ID, Value is the SQL or Closure.
    private static function getMigrations() {
        return [
            '20240101_001_legacy_columns' => function($pdo) {
                // Safely add api_key and debug_mode if they don't exist
                $cols = self::getTableColumns($pdo, 'users');
                
                if (!in_array('api_key', $cols)) {
                    $pdo->exec("ALTER TABLE users ADD COLUMN api_key TEXT DEFAULT NULL");
                }
                if (!in_array('debug_mode', $cols)) {
                    $pdo->exec("ALTER TABLE users ADD COLUMN debug_mode INTEGER DEFAULT 0");
                }
            },
            '20240116_001_add_ai_config' => function($pdo) {
                $cols = self::getTableColumns($pdo, 'users');
                if (!in_array('ai_config', $cols)) {
                    $pdo->exec("ALTER TABLE users ADD COLUMN ai_config TEXT DEFAULT NULL");
                }
            }
        ];
    }
    
    private static function getTableColumns($pdo, $table) {
        $stmt = $pdo->query("PRAGMA table_info($table)");
        return $stmt->fetchAll(PDO::FETCH_COLUMN, 1);
    }

    public static function migrate(PDO $pdo) {
        // 1. Ensure migrations table exists
        $pdo->exec("CREATE TABLE IF NOT EXISTS migrations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            version TEXT UNIQUE NOT NULL,
            executed_at TEXT DEFAULT CURRENT_TIMESTAMP
        )");

        // 2. Get executed migrations
        $stmt = $pdo->query("SELECT version FROM migrations");
        $executed = $stmt->fetchAll(PDO::FETCH_COLUMN, 0);

        // 3. Run pending
        $migrations = self::getMigrations();
        
        foreach ($migrations as $version => $migration) {
            if (!in_array($version, $executed)) {
                try {
                    if (is_callable($migration)) {
                        $migration($pdo);
                    } else {
                        $pdo->exec($migration);
                    }
                    
                    $stmt = $pdo->prepare("INSERT INTO migrations (version) VALUES (?)");
                    $stmt->execute([$version]);
                    
                    if (php_sapi_name() === 'cli') {
                        echo "Applied migration: $version\n";
                    }
                } catch (Exception $e) {
                    // Log but don't crash if it's just a column exists error that slipped through
                    error_log("Migration Failed ($version): " . $e->getMessage());
                    throw new Exception("Migration Failed: $version. " . $e->getMessage());
                }
            }
        }
    }
}