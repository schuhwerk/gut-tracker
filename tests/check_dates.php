<?php
require 'db_config.php';
$stmt = $pdo->query("SELECT recorded_at, created_at FROM entries LIMIT 5");
while ($row = $stmt->fetch()) {
    echo "recorded_at: [" . $row['recorded_at'] . "] | created_at: [" . $row['created_at'] . "]\n";
}

