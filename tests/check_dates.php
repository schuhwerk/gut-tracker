<?php
require 'db_config.php';
$stmt = $pdo->query("SELECT event_at, created_at FROM entries LIMIT 5");
while ($row = $stmt->fetch()) {
    echo "event_at: [" . $row['event_at'] . "] | created_at: [" . $row['created_at'] . "]\n";
}

