<?php

class EntryService {
    private $pdo;

    public function __construct(PDO $pdo) {
        $this->pdo = $pdo;
    }

    public function getEntries($userId, $limit = 50, $days = null) {
        if ($days) {
            $date = date('Y-m-d H:i:s', strtotime("-$days days"));
            $stmt = $this->pdo->prepare("SELECT * FROM entries WHERE user_id = ? AND event_at >= ? ORDER BY event_at DESC, id DESC");
            $stmt->execute([$userId, $date]);
        } else {
            $stmt = $this->pdo->prepare("SELECT * FROM entries WHERE user_id = ? ORDER BY event_at DESC, id DESC LIMIT " . (int)$limit);
            $stmt->execute([$userId]);
        }

        $entries = $stmt->fetchAll();
        foreach ($entries as &$entry) {
            $entry['data'] = json_decode($entry['data'], true) ?: [];
        }
        return $entries;
    }

    public function getEntry($userId, $id) {
        $stmt = $this->pdo->prepare("SELECT * FROM entries WHERE user_id = ? AND id = ?");
        $stmt->execute([$userId, $id]);
        $entry = $stmt->fetch();
        if ($entry) {
            $entry['data'] = json_decode($entry['data'], true) ?: [];
        }
        return $entry;
    }

    public function saveEntry($userId, $type, $eventAt, $data, $id = null) {
        $jsonData = json_encode($data);
        if ($id) {
            $stmt = $this->pdo->prepare("UPDATE entries SET type = ?, event_at = ?, data = ? WHERE id = ? AND user_id = ?");
            $stmt->execute([$type, $eventAt, $jsonData, $id, $userId]);
            return $id;
        } else {
            $stmt = $this->pdo->prepare("INSERT INTO entries (user_id, type, event_at, data) VALUES (?, ?, ?, ?)");
            $stmt->execute([$userId, $type, $eventAt, $jsonData]);
            return $this->pdo->lastInsertId();
        }
    }

    public function deleteEntry($userId, $id, $baseDir = __DIR__ . '/../') {
        // Attempt to delete associated image
        $entry = $this->getEntry($userId, $id);
        if ($entry && !empty($entry['data']['image_path'])) {
            $imagePath = $entry['data']['image_path'];
            if (strpos($imagePath, 'uploads/') === 0 && strpos($imagePath, '..') === false) {
                $filePath = $baseDir . $imagePath;
                if (file_exists($filePath)) {
                    @unlink($filePath);
                }
            }
        }

        $stmt = $this->pdo->prepare("DELETE FROM entries WHERE id = ? AND user_id = ?");
        $stmt->execute([$id, $userId]);
        return $stmt->rowCount() > 0;
    }

    public function deleteAllEntries($userId) {
        $stmt = $this->pdo->prepare("DELETE FROM entries WHERE user_id = ?");
        return $stmt->execute([$userId]);
    }

    public function getEntriesForAiExport($userId) {
        $stmt = $this->pdo->prepare("SELECT * FROM entries WHERE user_id = ? ORDER BY event_at ASC");
        $stmt->execute([$userId]);
        return $stmt->fetchAll();
    }
}
