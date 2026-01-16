<?php

require_once __DIR__ . '/MigrationService.php';

class DatabaseService {
    public static function initializeSchema(PDO $pdo) {
        $pdo->exec("CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            api_key TEXT DEFAULT NULL,
            debug_mode INTEGER DEFAULT 0
        )");
        
        // Attempt migrations
        try {
            MigrationService::migrate($pdo);
        } catch (Exception $e) {
            error_log("Schema Init / Migration Error: " . $e->getMessage());
        }

        $pdo->exec("CREATE TABLE IF NOT EXISTS entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            type TEXT NOT NULL,
            event_at TEXT NOT NULL,
            data TEXT DEFAULT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )");

        $pdo->exec("CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            access INTEGER,
            data TEXT
        )");

        $pdo->exec("CREATE TABLE IF NOT EXISTS logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            type TEXT NOT NULL,
            message TEXT NOT NULL,
            context TEXT DEFAULT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )");
    }
}
