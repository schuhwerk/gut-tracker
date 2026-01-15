<?php
// api.php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: ' . ($_SERVER['HTTP_ORIGIN'] ?? '*'));
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');
header('Access-Control-Allow-Credentials: true');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit;
}

// Helper to send JSON response
function jsonResponse($data, $code = 200) {
    http_response_code($code);
    echo json_encode($data);
    exit;
}

$configFile = __DIR__ . '/../db_config.php';
if (!file_exists($configFile)) {
    // Fallback: Check if config is in the same directory (flat deployment)
    $configFile = __DIR__ . '/db_config.php';
}

if (!file_exists($configFile)) {
    jsonResponse(['error' => 'Configuration file (db_config.php) not found. Check deployment structure.'], 500);
}

try {
    require_once $configFile;
} catch (Exception $e) {
    error_log("DB Connect Error: " . $e->getMessage());
    $debugInfo = '';
    if (isset($dbPath) && $dbPath) {
        $debugInfo = " (Path: $dbPath)";
    } else {
        $debugInfo = " (Path: Unknown - Config: " . ($configFile ?? 'Not set') . ")";
    }
    jsonResponse(['error' => 'Database connection failed: ' . $e->getMessage() . $debugInfo], 500);
}

// Database Session Handler
class SQLiteSessionHandler implements SessionHandlerInterface {
    private $pdo;

    public function __construct($pdo) {
        $this->pdo = $pdo;
    }

    #[\ReturnTypeWillChange]
    public function open($savePath, $sessionName) {
        return true;
    }

    #[\ReturnTypeWillChange]
    public function close() {
        return true;
    }

    #[\ReturnTypeWillChange]
    public function read($id) {
        try {
            $stmt = $this->pdo->prepare("SELECT data FROM sessions WHERE id = :id AND access > :time");
            $stmt->execute([':id' => $id, ':time' => time() - (60 * 60 * 24 * 30)]);
            if ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
                return $row['data'];
            }
        } catch (Exception $e) {
            error_log("Session Read Error: " . $e->getMessage());
        }
        return '';
    }

    #[\ReturnTypeWillChange]
    public function write($id, $data) {
        try {
            $access = time();
            $stmt = $this->pdo->prepare("INSERT OR REPLACE INTO sessions (id, access, data) VALUES (:id, :access, :data)");
            return $stmt->execute([':id' => $id, ':access' => $access, ':data' => $data]);
        } catch (Exception $e) {
            error_log("Session Write Error: " . $e->getMessage());
            return false;
        }
    }

    #[\ReturnTypeWillChange]
    public function destroy($id) {
        try {
            $stmt = $this->pdo->prepare("DELETE FROM sessions WHERE id = :id");
            return $stmt->execute([':id' => $id]);
        } catch (Exception $e) {
            return false;
        }
    }

    #[\ReturnTypeWillChange]
    public function gc($max_lifetime) {
        try {
            $old = time() - $max_lifetime;
            $stmt = $this->pdo->prepare("DELETE FROM sessions WHERE access < :old");
            $stmt->execute([':old' => $old]);
            return $stmt->rowCount();
        } catch (Exception $e) {
            return false;
        }
    }
}

// Auto-initialize schema if needed
try {
    $pdo->exec("CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        api_key TEXT DEFAULT NULL
    )");
    
    // Attempt migration for existing users table
    try {
        $pdo->exec("ALTER TABLE users ADD COLUMN api_key TEXT DEFAULT NULL");
    } catch (Exception $e) {
        // Only ignore "duplicate column" error
        if (strpos($e->getMessage(), 'duplicate column') === false) {
             error_log("Migration Warning: " . $e->getMessage());
        }
    }

    $pdo->exec("CREATE TABLE IF NOT EXISTS entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        recorded_at TEXT NOT NULL,
        data TEXT DEFAULT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )");

    $pdo->exec("CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        access INTEGER,
        data TEXT
    )");
} catch (Exception $e) {
    // If schema creation fails (e.g. read-only DB), we'll catch it later or here
    error_log("Schema Init Error: " . $e->getMessage());
}

$session_lifetime = 60 * 60 * 24 * 30; // 30 days
ini_set('session.cookie_lifetime', $session_lifetime);
ini_set('session.gc_maxlifetime', $session_lifetime);

session_set_save_handler(new SQLiteSessionHandler($pdo), true);

session_set_cookie_params([
    'lifetime' => $session_lifetime,
    'path' => '/',
    'httponly' => true,
    'samesite' => 'Lax'
]);

if (isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on') {
    ini_set('session.cookie_secure', 1);
}
session_start();

// basic auth check middleware for protected routes
function requireAuth() {
    if (!isset($_SESSION['user_id'])) {
        jsonResponse(['error' => 'Unauthorized'], 401);
    }
}

function getUserApiKey($pdo, $userId) {
    try {
        $stmt = $pdo->prepare("SELECT api_key FROM users WHERE id = ?");
        $stmt->execute([$userId]);
        $user = $stmt->fetch();
        if (!$user) return '';
        return $user['api_key'] ?? '';
    } catch (PDOException $e) {
        // If column is missing (migration failed), return empty key
        if (strpos($e->getMessage(), 'no such column') !== false) {
            return '';
        }
        throw $e;
    }
}

function callOpenAI($endpoint, $payload, $apiKey, $isMultipart = false) {
    $ch = curl_init('https://api.openai.com/v1/' . $endpoint);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    
    $headers = ["Authorization: Bearer $apiKey"];
    if (!$isMultipart) {
        $headers[] = "Content-Type: application/json";
        $payload = json_encode($payload);
    }

    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    curl_setopt($ch, CURLOPT_POSTFIELDS, $payload);
    
    $response = curl_exec($ch);
    if (curl_errno($ch)) {
        throw new Exception('Request Failed: ' . curl_error($ch));
    }
    curl_close($ch);
    
    $data = json_decode($response, true);
    if (isset($data['error'])) {
        error_log("OpenAI API Error: " . json_encode($data['error']));
        $msg = $data['error']['message'] ?? 'Unknown OpenAI Error';
        $code = $data['error']['code'] ?? '';

        if (strpos($msg, 'api_key') !== false || $code === 'invalid_api_key') {
             jsonResponse(['error' => 'INVALID_API_KEY', 'message' => 'Invalid API Key provided.'], 401);
        }
        throw new Exception('OpenAI Error: ' . $msg);
    }
    return $data;
}

function getMagicParsingSystemPrompt($currentDate, $offset = 0) {
    return "You are a health tracking assistant. 
    Current UTC time: $currentDate.
    User Timezone Offset (minutes): $offset. (Note: JS getTimezoneOffset format. -120 means UTC+2).
    
    Analyze the user's input and extract data into a JSON ARRAY of objects.
    
    CRITICAL: 
    1. ALL dates/times in the output JSON MUST be in UTC (YYYY-MM-DD HH:MM:SS).
    2. Convert user's relative time (e.g. '10am', 'last night') using the provided User Timezone Offset relative to Current UTC time.
    3. ALWAYS respond using the SAME LANGUAGE as the user's input for any text fields (like 'notes').

    Each object must match one of these schemas:
    
    1. Food: { \"type\": \"food\", \"recorded_at\": \"YYYY-MM-DD HH:MM:SS\", \"data\": { \"notes\": \"description of food\" } }
    2. Drink: { \"type\": \"drink\", \"recorded_at\": \"YYYY-MM-DD HH:MM:SS\", \"data\": { \"notes\": \"description of drink\", \"amount_liters\": float (ESTIMATE if not specified: cup=0.25, mug=0.35, glass=0.3, bottle=0.5, can=0.33, sip=0.05) } }
    3. Stool: { \"type\": \"stool\", \"recorded_at\": \"YYYY-MM-DD HH:MM:SS\", \"data\": { \"bristol_score\": 1-7 (int), \"notes\": \"optional details\" } }
    4. Sleep: { \"type\": \"sleep\", \"recorded_at\": \"YYYY-MM-DD HH:MM:SS\" (wake time), \"data\": { \"duration_hours\": float, \"quality\": 1-5 (int), \"bedtime\": \"YYYY-MM-DD HH:MM:SS\" (start time) } }
    5. Symptom: { \"type\": \"symptom\", \"recorded_at\": \"YYYY-MM-DD HH:MM:SS\", \"data\": { \"notes\": \"description of sensation/pain\", \"severity\": 1-5 (int, optional) } }
    6. Activity: { \"type\": \"activity\", \"recorded_at\": \"YYYY-MM-DD HH:MM:SS\", \"data\": { \"duration_minutes\": int, \"intensity\": \"Low\" | \"Medium\" | \"High\", \"notes\": \"description\" } }
    
    Rules:
    - Return a valid JSON LIST.
    - Identify ALL distinct items.
    - Infer dates/times based on context.
    - Return ONLY the JSON string, no markdown.";
}

function parseAiJsonContent($content) {
    $content = str_replace(['```json', '```'], '', $content);
    $parsed = json_decode(trim($content), true);
    if (!$parsed) {
        throw new Exception('Failed to parse AI response: ' . $content);
    }
    return $parsed;
}

// Global Exception Handler for API Logic
try {

$method = $_SERVER['REQUEST_METHOD'];
$path = isset($_SERVER['PATH_INFO']) ? $_SERVER['PATH_INFO'] : (isset($_GET['path']) ? $_GET['path'] : '/');

// Handle routing manually since we might not have rewrite rules
// We will look at a query param 'action' or the path if configured.
// For simplicity in a no-build setup, let's assume we call api.php?endpoint=login
$endpoint = $_GET['endpoint'] ?? '';

// Allow JSON body
$inputJSON = file_get_contents('php://input');
$input = json_decode($inputJSON, true);

if (!is_array($input)) {
    $input = [];
}

// Merge with $_POST to handle both application/json and application/x-www-form-urlencoded/multipart
$input = array_merge($_POST, $input);

if ($method === 'POST' && $endpoint === 'create_user') {
    $username = $input['username'] ?? '';
    $password = $input['password'] ?? '';

    if (!$username || !$password) {
        jsonResponse(['error' => 'Missing credentials'], 400);
    }

    $stmt = $pdo->prepare("SELECT id FROM users WHERE username = ?");
    $stmt->execute([$username]);
    if ($stmt->fetch()) {
        jsonResponse(['error' => 'User already exists'], 400);
    }

    $hash = password_hash($password, PASSWORD_DEFAULT);
    $stmt = $pdo->prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)");
    if ($stmt->execute([$username, $hash])) {
        jsonResponse(['message' => 'User created']);
    } else {
        jsonResponse(['error' => 'Database error'], 500);
    }
}

if ($method === 'POST' && $endpoint === 'login') {
    // Simple login - in real app, verify hash
    $username = $input['username'] ?? '';
    $password = $input['password'] ?? '';

    if (!$username || !$password) {
        jsonResponse(['error' => 'Missing credentials'], 400);
    }

    $stmt = $pdo->prepare("SELECT id, password_hash FROM users WHERE username = ?");
    $stmt->execute([$username]);
    $user = $stmt->fetch();

    if ($user && password_verify($password, $user['password_hash'])) {
        $_SESSION['user_id'] = $user['id'];
        jsonResponse(['message' => 'Login successful', 'user_id' => $user['id']]);
    } else {
        jsonResponse(['error' => 'Invalid credentials'], 401);
    }
}

if ($method === 'POST' && $endpoint === 'logout') {
    session_destroy();
    jsonResponse(['message' => 'Logged out']);
}

if ($method === 'POST' && $endpoint === 'delete_all') {
    requireAuth();
    $userId = $_SESSION['user_id'];
    
    // Safety check just in case
    if (!$userId) jsonResponse(['error' => 'Unauthorized'], 401);

    $stmt = $pdo->prepare("DELETE FROM entries WHERE user_id = ?");
    $stmt->execute([$userId]);
    
    jsonResponse(['message' => 'All entries deleted']);
}

if ($method === 'POST' && $endpoint === 'update_settings') {
    requireAuth();
    $userId = $_SESSION['user_id'];
    $apiKey = $input['api_key'] ?? ''; // Can be empty to clear it

    $stmt = $pdo->prepare("UPDATE users SET api_key = ? WHERE id = ?");
    if ($stmt->execute([$apiKey, $userId])) {
        jsonResponse(['message' => 'Settings updated']);
    } else {
        jsonResponse(['error' => 'Failed to update settings'], 500);
    }
}

if ($method === 'POST' && $endpoint === 'entry') {
    requireAuth();
    $userId = $_SESSION['user_id'];
    
    // Handle file upload if present
    $uploadedImage = null;
    if (!empty($_FILES['image']['name'])) {
        $targetDir = __DIR__ . "/uploads/";

        // Auto-create uploads directory
        if (!file_exists($targetDir)) {
            if (!mkdir($targetDir, 0755, true)) {
                error_log("Failed to create uploads directory: " . $targetDir);
                jsonResponse(['error' => 'Server configuration error: Could not create uploads directory'], 500);
            }
        }

        // Check for specific upload errors
        if ($_FILES['image']['error'] !== UPLOAD_ERR_OK) {
            $uploadError = $_FILES['image']['error'];
            error_log("File upload error code: " . $uploadError);
            jsonResponse(['error' => 'File upload failed (Code: ' . $uploadError . ')'], 400);
        }
        
        $finfo = new finfo(FILEINFO_MIME_TYPE);
        $mimeType = $finfo->file($_FILES['image']['tmp_name']);
        
        $allowedMimes = [
            'image/jpeg' => 'jpg',
            'image/png' => 'png', 
            'image/gif' => 'gif',
            'image/webp' => 'webp'
        ];
        
        if (!array_key_exists($mimeType, $allowedMimes)) {
            jsonResponse(['error' => 'Invalid file type. Only JPG, PNG, GIF, and WEBP are allowed.'], 400);
        }
        
        $extension = $allowedMimes[$mimeType];
        $fileName = uniqid('img_', true) . '.' . $extension;
        $targetFilePath = $targetDir . $fileName;
        
        if (move_uploaded_file($_FILES["image"]["tmp_name"], $targetFilePath)) {
            $uploadedImage = "uploads/" . $fileName;
        } else {
            error_log("move_uploaded_file failed for: " . $targetFilePath);
            jsonResponse(['error' => 'Failed to save uploaded image file'], 500);
        }
    }
    
    $type = $_POST['type'] ?? $input['type'] ?? null;
    $recordedAt = $_POST['recorded_at'] ?? $input['recorded_at'] ?? date('Y-m-d H:i:s');
    $recordedAt = str_replace('T', ' ', $recordedAt);
    if (strlen($recordedAt) === 16) $recordedAt .= ':00';
    $entryId = $_POST['id'] ?? $input['id'] ?? null;
    
    $jsonData = [];
    if (isset($_POST['data'])) {
        $jsonData = json_decode($_POST['data'], true);
    } elseif (isset($input['data'])) {
        $jsonData = $input['data'];
    }
    
    if ($uploadedImage) {
        $jsonData['image_path'] = $uploadedImage;
    } elseif ($entryId) {
        // Keep existing image if updating and no new image uploaded
        // We need to fetch the existing data to preserve the image path
        $stmt = $pdo->prepare("SELECT data FROM entries WHERE id = ? AND user_id = ?");
        $stmt->execute([$entryId, $userId]);
        $existing = $stmt->fetch();
        if ($existing && !empty($existing['data'])) {
            $existingData = json_decode($existing['data'], true);
            if (is_array($existingData) && isset($existingData['image_path'])) {
                $jsonData['image_path'] = $existingData['image_path'];
            }
        }
    }
    
    if (!$type) {
        jsonResponse(['error' => 'Type is required'], 400);
    }

    if ($entryId) {
        // UPDATE
        $stmt = $pdo->prepare("UPDATE entries SET type = ?, recorded_at = ?, data = ? WHERE id = ? AND user_id = ?");
        $result = $stmt->execute([$type, $recordedAt, json_encode($jsonData), $entryId, $userId]);
        if ($stmt->rowCount() === 0) {
             // Check if it failed because ID didn't exist or permissions
             // For now just assume success if no error, but rowCount 0 means no change or not found.
        }
        jsonResponse(['message' => 'Entry updated', 'id' => $entryId, 'image_path' => $jsonData['image_path'] ?? null]);
    } else {
        // INSERT
        $stmt = $pdo->prepare("INSERT INTO entries (user_id, type, recorded_at, data) VALUES (?, ?, ?, ?)");
        $stmt->execute([$userId, $type, $recordedAt, json_encode($jsonData)]);
        jsonResponse(['message' => 'Entry saved', 'id' => $pdo->lastInsertId(), 'image_path' => $jsonData['image_path'] ?? null]);
    }
}

if ($method === 'GET' && $endpoint === 'entries') {
    requireAuth();
    $userId = $_SESSION['user_id'];
    $limit = $_GET['limit'] ?? 50;
    $days = $_GET['days'] ?? null;
    $id = $_GET['id'] ?? null;
    
    if ($id) {
        $stmt = $pdo->prepare("SELECT * FROM entries WHERE user_id = ? AND id = ?");
        $stmt->execute([$userId, $id]);
        $entry = $stmt->fetch();
        
        if ($entry) {
            $decoded = json_decode($entry['data']);
            $entry['data'] = $decoded ?: new stdClass();
            jsonResponse($entry);
        } else {
            jsonResponse(['error' => 'Entry not found'], 404);
        }
    }

    if ($days) {
        $date = date('Y-m-d H:i:s', strtotime("-$days days"));
        $stmt = $pdo->prepare("SELECT * FROM entries WHERE user_id = ? AND recorded_at >= ? ORDER BY recorded_at DESC, id DESC");
        $stmt->execute([$userId, $date]);
    } else {
        $stmt = $pdo->prepare("SELECT * FROM entries WHERE user_id = ? ORDER BY recorded_at DESC, id DESC LIMIT " . (int)$limit);
        $stmt->execute([$userId]);
    }

    $entries = $stmt->fetchAll();
    
    // Decode JSON data for frontend
    foreach ($entries as &$entry) {
        $decoded = json_decode($entry['data']);
        $entry['data'] = $decoded ?: new stdClass();
    }
    
    jsonResponse($entries);
}

if ($method === 'GET' && $endpoint === 'export') {
    requireAuth();
    $userId = $_SESSION['user_id'];
    
    $stmt = $pdo->prepare("SELECT * FROM entries WHERE user_id = ? ORDER BY recorded_at DESC, id DESC");
    $stmt->execute([$userId]);
    $entries = $stmt->fetchAll();
    
    foreach ($entries as &$entry) {
        $entry['data'] = json_decode($entry['data']);
    }
    
    header('Content-Type: application/json');
    header('Content-Disposition: attachment; filename="gut_tracker_export.json"');
    echo json_encode($entries, JSON_PRETTY_PRINT);
    exit;
}

if ($method === 'POST' && $endpoint === 'ai_parse') {
    requireAuth();
    $text = $input['text'] ?? '';
    $userId = $_SESSION['user_id'];
    $apiKey = $input['api_key'] ?? getUserApiKey($pdo, $userId);

    if (!$text) jsonResponse(['error' => 'Missing text'], 400);
    if (!$apiKey) jsonResponse(['error' => 'NO_API_KEY', 'message' => 'Missing API key'], 400);

    $currentDate = $input['client_time'] ?? date('Y-m-d H:i:s');
    $offset = $input['client_timezone_offset'] ?? 0;
    
    try {
        $data = callOpenAI('chat/completions', [
            "model" => "gpt-4o-mini",
            "messages" => [
                ["role" => "system", "content" => getMagicParsingSystemPrompt($currentDate, $offset)],
                ["role" => "user", "content" => $text]
            ],
            "temperature" => 0
        ], $apiKey);
        
        $content = $data['choices'][0]['message']['content'] ?? '{}';
        jsonResponse(parseAiJsonContent($content));
    } catch (Exception $e) {
        jsonResponse(['error' => $e->getMessage()], 400);
    }
}

if ($method === 'POST' && $endpoint === 'delete') {
    requireAuth();
    $entryId = $input['id'] ?? $_POST['id'] ?? $_GET['id'] ?? null;
    $userId = $_SESSION['user_id'];
    
    if (!$entryId) {
        jsonResponse(['error' => 'Missing ID'], 400);
    }
    
    $stmt = $pdo->prepare("DELETE FROM entries WHERE id = ? AND user_id = ?");
    $stmt->execute([$entryId, $userId]);
    
    if ($stmt->rowCount() > 0) {
        jsonResponse(['message' => 'Entry deleted']);
    } else {
        jsonResponse(['error' => 'Entry not found or unauthorized'], 404);
    }
}

if ($method === 'POST' && $endpoint === 'ai_vision') {
    requireAuth();
    $imageBase64 = $input['image_base64'] ?? '';
    $userId = $_SESSION['user_id'];
    $apiKey = $input['api_key'] ?? getUserApiKey($pdo, $userId);

    if (!$imageBase64) jsonResponse(['error' => 'Missing image'], 400);
    if (!$apiKey) jsonResponse(['error' => 'NO_API_KEY', 'message' => 'Missing API key'], 400);

    $currentDate = $input['client_time'] ?? date('Y-m-d H:i:s');
    $offset = $input['client_timezone_offset'] ?? 0;

    try {
        $data = callOpenAI('chat/completions', [
            "model" => "gpt-4o-mini",
            "messages" => [
                ["role" => "system", "content" => getMagicParsingSystemPrompt($currentDate, $offset)],
                ["role" => "user", "content" => [
                    ["type" => "text", "text" => "Analyze this image and extract health tracking data. Identify if it is food, drink, a stool sample (Bristol scale), or related to sleep/symptoms. Return the JSON list."],
                    ["type" => "image_url", "image_url" => ["url" => $imageBase64]]
                ]]
            ],
            "max_tokens" => 500
        ], $apiKey);

        $content = $data['choices'][0]['message']['content'] ?? '[]';
        jsonResponse(parseAiJsonContent($content));
    } catch (Exception $e) {
        jsonResponse(['error' => $e->getMessage()], 400);
    }
}

if ($method === 'POST' && $endpoint === 'ai_transcribe') {
    requireAuth();
    $userId = $_SESSION['user_id'];
    $apiKey = $input['api_key'] ?? $_POST['api_key'] ?? getUserApiKey($pdo, $userId);

    if (empty($_FILES['audio_file'])) jsonResponse(['error' => 'Missing audio file'], 400);
    if (!$apiKey) jsonResponse(['error' => 'NO_API_KEY', 'message' => 'Missing API key'], 400);

    try {
        $cfile = new CURLFile($_FILES['audio_file']['tmp_name'], $_FILES['audio_file']['type'], 'audio.webm');
        $data = callOpenAI('audio/transcriptions', [
            'file' => $cfile,
            'model' => 'whisper-1'
        ], $apiKey, true);
        
        jsonResponse(['text' => $data['text'] ?? '']);
    } catch (Exception $e) {
        jsonResponse(['error' => $e->getMessage()], 400);
    }
}

if ($method === 'POST' && $endpoint === 'ai_magic_voice') {
    requireAuth();
    $userId = $_SESSION['user_id'];
    $apiKey = $input['api_key'] ?? $_POST['api_key'] ?? getUserApiKey($pdo, $userId);

    if (empty($_FILES['audio_file'])) jsonResponse(['error' => 'Missing audio file'], 400);
    if (!$apiKey) jsonResponse(['error' => 'NO_API_KEY', 'message' => 'Missing API key'], 400);

    try {
        // 1. Transcribe
        $cfile = new CURLFile($_FILES['audio_file']['tmp_name'], $_FILES['audio_file']['type'], 'audio.webm');
        $transcribeData = callOpenAI('audio/transcriptions', [
            'file' => $cfile,
            'model' => 'whisper-1'
        ], $apiKey, true);

        $text = $transcribeData['text'] ?? '';
        if (!$text) jsonResponse(['error' => 'No speech detected'], 400);

        // 2. Parse Text
        $currentDate = $_POST['client_time'] ?? date('Y-m-d H:i:s');
        $offset = $_POST['client_timezone_offset'] ?? 0;
        
        $data = callOpenAI('chat/completions', [
            "model" => "gpt-4o-mini",
            "messages" => [
                ["role" => "system", "content" => getMagicParsingSystemPrompt($currentDate, $offset)],
                ["role" => "user", "content" => $text]
            ],
            "temperature" => 0
        ], $apiKey);
        
        $content = $data['choices'][0]['message']['content'] ?? '{}';
        jsonResponse(parseAiJsonContent($content));
    } catch (Exception $e) {
        jsonResponse(['error' => $e->getMessage()], 400);
    }
}

if ($method === 'GET' && $endpoint === 'check_auth') {
     if (isset($_SESSION['user_id'])) {
         $apiKey = getUserApiKey($pdo, $_SESSION['user_id']);
         jsonResponse([
             'authenticated' => true, 
             'user_id' => $_SESSION['user_id'],
             'api_key' => $apiKey // Return DB key so frontend can sync
         ]);
     } else {
         jsonResponse(['authenticated' => false]);
     }
}

// Fallback
jsonResponse(['error' => 'Endpoint not found', 'endpoint' => $endpoint], 404);

} catch (Exception $e) {
    error_log("API Error: " . $e->getMessage());
    jsonResponse(['error' => 'Server Error: ' . $e->getMessage()], 500);
}
?>
