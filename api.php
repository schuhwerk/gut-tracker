<?php
// api.php
ob_start();
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
    $output = ob_get_clean();
    if (!empty($output)) {
        error_log("Unexpected output before jsonResponse: " . $output);
    }
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
    require_once __DIR__ . '/services/AiService.php';
    require_once __DIR__ . '/services/DatabaseService.php';
    require_once __DIR__ . '/services/UserService.php';
    require_once __DIR__ . '/services/EntryService.php';

    $userService = new UserService($pdo);
    $entryService = new EntryService($pdo);
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
    DatabaseService::initializeSchema($pdo);
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

// Global error handler to catch notices/warnings
set_error_handler(function($errno, $errstr, $errfile, $errline) {
    if (!(error_reporting() & $errno)) return false;
    throw new ErrorException($errstr, 0, $errno, $errfile, $errline);
});

// Helper to get AI Config for current user
function getAiConfig($userService, $userId, $inputApiKey = null) {
    // If client provided specific key (e.g. from local storage override), use it as legacy config
    if ($inputApiKey) return $inputApiKey;
    
    $user = $userService->getUser($userId);
    if (!$user) return '';

    if (!empty($user['ai_config'])) {
        return json_decode($user['ai_config'], true);
    }
    // Fallback to legacy column
    return $user['api_key'] ?? '';
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

    try {
        if ($userService->createUser($username, $password)) {
            jsonResponse(['message' => 'User created']);
        } else {
            jsonResponse(['error' => 'Database error'], 500);
        }
    } catch (Exception $e) {
        jsonResponse(['error' => $e->getMessage()], 400);
    }
}

if ($method === 'POST' && $endpoint === 'login') {
    $username = $input['username'] ?? '';
    $password = $input['password'] ?? '';

    if (!$username || !$password) {
        jsonResponse(['error' => 'Missing credentials'], 400);
    }

    $userId = $userService->verifyLogin($username, $password);
    if ($userId) {
        $_SESSION['user_id'] = $userId;
        jsonResponse(['message' => 'Login successful', 'user_id' => $userId]);
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
    $entryService->deleteAllEntries($userId);
    jsonResponse(['message' => 'All entries deleted']);
}

if ($method === 'POST' && $endpoint === 'update_settings') {
    requireAuth();
    $userId = $_SESSION['user_id'];
    $apiKey = $input['api_key'] ?? ''; 
    $debugMode = isset($input['debug_mode']) ? (int)$input['debug_mode'] : 0;
    $aiConfig = $input['ai_config'] ?? null;

    if ($userService->updateSettings($userId, $apiKey, $debugMode, $aiConfig)) {
        jsonResponse(['message' => 'Settings updated']);
    } else {
        jsonResponse(['error' => 'Failed to update settings'], 500);
    }
}

if ($method === 'POST' && $endpoint === 'test_api_key') {
    requireAuth();
    $userId = $_SESSION['user_id'];
    $config = getAiConfig($userService, $userId, $input['api_key'] ?? $input['ai_config'] ?? null);
    
    // If ai_config was passed as object, use it
    if (isset($input['ai_config']) && is_array($input['ai_config'])) {
        $config = $input['ai_config'];
    }

    if (!$config) jsonResponse(['error' => 'NO_API_KEY', 'message' => 'Missing API configuration'], 400);

    try {
        $ai = new AiService($config);
        $ai->verifyKey();
        jsonResponse(['message' => 'API Key is valid and working']);
    } catch (Exception $e) {
        if (strpos($e->getMessage(), 'INVALID_API_KEY') !== false) {
             jsonResponse(['error' => 'INVALID_API_KEY', 'message' => $e->getMessage()], 401);
        }
        jsonResponse(['error' => 'Verification failed: ' . $e->getMessage()], 400);
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
    $recordedAt = $_POST['event_at'] ?? $input['event_at'] ?? gmdate('Y-m-d H:i:s');
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
    }

    if ($entryId) {
        // Fetch existing data to handle image cleanup/preservation
        $existing = $entryService->getEntry($userId, $entryId);
        
        if ($existing && !empty($existing['data'])) {
            $existingData = $existing['data'];
            
            if (is_array($existingData) && !empty($existingData['image_path'])) {
                $oldPath = $existingData['image_path'];
                
                // If client explicitly sent image_path (null or new) OR we uploaded a new one above
                if (array_key_exists('image_path', $jsonData)) {
                    $newPath = $jsonData['image_path'] ?? null;
                    
                    // Cleanup old file if it's being replaced or removed
                    if ($oldPath !== $newPath) {
                        if (strpos($oldPath, 'uploads/') === 0 && strpos($oldPath, '..') === false) {
                            $f = __DIR__ . '/' . $oldPath;
                            if (file_exists($f)) @unlink($f);
                        }
                    }
                } else {
                    // Client sent no instruction regarding image, preserve existing
                    $jsonData['image_path'] = $oldPath;
                }
            }
        }
    }
    
    if (!$type) {
        jsonResponse(['error' => 'Type is required'], 400);
    }

    $savedId = $entryService->saveEntry($userId, $type, $recordedAt, $jsonData, $entryId);
    jsonResponse([
        'message' => $entryId ? 'Entry updated' : 'Entry saved', 
        'id' => $savedId, 
        'image_path' => $jsonData['image_path'] ?? null
    ]);
}

if ($method === 'GET' && $endpoint === 'entries') {
    requireAuth();
    $userId = $_SESSION['user_id'];
    $limit = $_GET['limit'] ?? 50;
    $days = $_GET['days'] ?? null;
    $id = $_GET['id'] ?? null;
    
    if ($id) {
        $entry = $entryService->getEntry($userId, $id);
        if ($entry) {
            jsonResponse($entry);
        } else {
            jsonResponse(['error' => 'Entry not found'], 404);
        }
    }

    $entries = $entryService->getEntries($userId, $limit, $days);
    jsonResponse($entries);
}

if ($method === 'GET' && $endpoint === 'export') {
    requireAuth();
    $userId = $_SESSION['user_id'];
    $entries = $entryService->getEntries($userId, 10000); // High limit for export
    
    header('Content-Type: application/json');
    header('Content-Disposition: attachment; filename="gut_tracker_export.json"');
    echo json_encode($entries, JSON_PRETTY_PRINT);
    exit;
}


if ($method === 'POST' && $endpoint === 'ai_chat_proxy') {
    requireAuth();
    $userId = $_SESSION['user_id'];
    $config = getAiConfig($userService, $userId, $input['api_key'] ?? null);

    if (!$config) jsonResponse(['error' => 'NO_API_KEY', 'message' => 'Missing API configuration'], 400);

    // Filter Payload for OpenAI
    $allowedKeys = ['messages', 'model', 'temperature', 'response_format', 'max_tokens', 'frequency_penalty', 'presence_penalty', 'stop', 'stream'];
    $openAiPayload = array_filter($input, function($k) use ($allowedKeys) {
        return in_array($k, $allowedKeys);
    }, ARRAY_FILTER_USE_KEY);
    
    if (empty($openAiPayload['messages'])) {
        jsonResponse(['error' => 'Missing messages'], 400);
    }

    try {
        $ai = new AiService($config);
        $response = $ai->request('chat/completions', $openAiPayload);
        
        $content = $response['choices'][0]['message']['content'] ?? '';
        if (empty(trim($content))) {
            throw new Exception('AI returned an empty response.');
        }

        // Log if debug mode is on
        $user = $userService->getUser($userId);
        if ($user && $user['debug_mode']) {
             $lastMsg = end($openAiPayload['messages']);
             $promptText = $lastMsg['content'] ?? 'Unknown';
             if (is_array($promptText)) $promptText = 'Complex Content (Vision)';
             
             $responseText = $response['choices'][0]['message']['content'] ?? json_encode($response);

             $logStmt = $pdo->prepare("INSERT INTO logs (user_id, type, message, context) VALUES (?, ?, ?, ?)");
             $logStmt->execute([
                $userId, 
                'ai_proxy', 
                'AI Request', 
                json_encode(['prompt' => $promptText, 'response' => $responseText])
             ]);
             
             // Cleanup logs
             $pdo->prepare("DELETE FROM logs WHERE user_id = ? AND id NOT IN (SELECT id FROM logs WHERE user_id = ? ORDER BY id DESC LIMIT 500)")->execute([$userId, $userId]);
        }
        
        jsonResponse($response);
    } catch (Exception $e) {
        if (strpos($e->getMessage(), 'INVALID_API_KEY') !== false) {
             jsonResponse(['error' => 'INVALID_API_KEY', 'message' => $e->getMessage()], 401);
        }
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

    if ($entryService->deleteEntry($userId, $entryId, __DIR__ . '/')) {
        jsonResponse(['message' => 'Entry deleted']);
    } else {
        jsonResponse(['error' => 'Entry not found or unauthorized'], 404);
    }
}

if ($method === 'POST' && $endpoint === 'ai_transcribe') {
    requireAuth();
    $userId = $_SESSION['user_id'];
    $config = getAiConfig($userService, $userId, $input['api_key'] ?? $_POST['api_key'] ?? null);

    if (empty($_FILES['audio_file'])) jsonResponse(['error' => 'Missing audio file'], 400);
    if (!$config) jsonResponse(['error' => 'NO_API_KEY', 'message' => 'Missing API configuration'], 400);

    try {
        $ai = new AiService($config);
        $cfile = new CURLFile($_FILES['audio_file']['tmp_name'], $_FILES['audio_file']['type'], 'audio.webm');
        $data = $ai->request('audio/transcriptions', [
            'file' => $cfile,
            'model' => 'whisper-1'
        ], true);
        
        $text = $data['text'] ?? '';
        if (empty(trim($text))) {
            throw new Exception('No speech detected in recording.');
        }

        jsonResponse(['text' => $text]);
    } catch (Exception $e) {
        if (strpos($e->getMessage(), 'INVALID_API_KEY') !== false) {
             jsonResponse(['error' => 'INVALID_API_KEY', 'message' => $e->getMessage()], 401);
        }
        jsonResponse(['error' => $e->getMessage()], 400);
    }
}

if ($method === 'GET' && $endpoint === 'get_logs') {
    requireAuth();
    $userId = $_SESSION['user_id'];
    
    $stmt = $pdo->prepare("SELECT * FROM logs WHERE user_id = ? ORDER BY id DESC LIMIT 20");
    $stmt->execute([$userId]);
    jsonResponse(['logs' => $stmt->fetchAll(PDO::FETCH_ASSOC)]);
}

if ($method === 'GET' && $endpoint === 'check_auth') {
     if (isset($_SESSION['user_id'])) {
         $user = $userService->getUser($_SESSION['user_id']);
         
         $aiConfig = null;
         if (!empty($user['ai_config'])) {
             $aiConfig = json_decode($user['ai_config'], true);
         }
         
         jsonResponse([
             'authenticated' => true, 
             'user_id' => $_SESSION['user_id'],
             'username' => $user['username'] ?? 'user',
             'api_key' => $user['api_key'] ?? '',
             'ai_config' => $aiConfig,
             'debug_mode' => (int)($user['debug_mode'] ?? 0)
         ]);
     } else {
         jsonResponse(['authenticated' => false]);
     }
}

// Fallback
jsonResponse(['error' => 'Endpoint not found', 'endpoint' => $endpoint], 404);

} catch (Throwable $e) {
    $errorMsg = $e->getMessage() . " in " . basename($e->getFile()) . ":" . $e->getLine();
    error_log("API Error: " . $errorMsg);
    jsonResponse(['error' => 'Server Error: ' . $errorMsg], 500);
}
?>
