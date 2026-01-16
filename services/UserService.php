<?php

class UserService {
    private $pdo;

    public function __construct(PDO $pdo) {
        $this->pdo = $pdo;
    }

    public function createUser($username, $password) {
        $stmt = $this->pdo->prepare("SELECT id FROM users WHERE username = ?");
        $stmt->execute([$username]);
        if ($stmt->fetch()) {
            throw new Exception("User already exists");
        }

        $hash = password_hash($password, PASSWORD_DEFAULT);
        $stmt = $this->pdo->prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)");
        return $stmt->execute([$username, $hash]);
    }

    public function verifyLogin($username, $password) {
        $stmt = $this->pdo->prepare("SELECT id, password_hash FROM users WHERE username = ?");
        $stmt->execute([$username]);
        $user = $stmt->fetch();

        if ($user && password_verify($password, $user['password_hash'])) {
            return $user['id'];
        }
        return false;
    }

    public function getApiKey($userId) {
        try {
            $stmt = $this->pdo->prepare("SELECT api_key FROM users WHERE id = ?");
            $stmt->execute([$userId]);
            $user = $stmt->fetch();
            return $user['api_key'] ?? '';
        } catch (PDOException $e) {
            if (strpos($e->getMessage(), 'no such column') !== false) {
                return '';
            }
            throw $e;
        }
    }

    public function updateSettings($userId, $apiKey, $debugMode, $aiConfig = null) {
        // Ensure aiConfig is a string or null
        if (is_array($aiConfig)) $aiConfig = json_encode($aiConfig);
        
        $stmt = $this->pdo->prepare("UPDATE users SET api_key = ?, debug_mode = ?, ai_config = ? WHERE id = ?");
        return $stmt->execute([$apiKey, $debugMode, $aiConfig, $userId]);
    }

    public function getUser($userId) {
        $stmt = $this->pdo->prepare("SELECT id, username, api_key, debug_mode, ai_config FROM users WHERE id = ?");
        $stmt->execute([$userId]);
        return $stmt->fetch(PDO::FETCH_ASSOC);
    }
}
