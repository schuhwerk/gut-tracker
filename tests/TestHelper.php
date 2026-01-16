<?php

class TestHelper {
    private $baseUrl;
    private $cookieFile;
    private $debug;

    public function __construct($baseUrl = null, $cookieFile = null) {
        if ($baseUrl === null) {
            $envUrl = getenv('TEST_BASE_URL');
            $this->baseUrl = $envUrl ?: 'http://127.0.0.1:8087/api.php';
        } else {
            $this->baseUrl = $baseUrl;
        }
        $this->cookieFile = $cookieFile ?? sys_get_temp_dir() . '/test_cookie_' . uniqid() . '.txt';
        $this->debug = getenv('DEBUG') === '1';
        
        // Ensure clean slate
        if (file_exists($this->cookieFile)) {
            unlink($this->cookieFile);
        }
    }

    public function __destruct() {
        if (file_exists($this->cookieFile)) {
            unlink($this->cookieFile);
        }
    }

    public function getCookieFile() {
        return $this->cookieFile;
    }

    public function login($username, $password) {
        if ($this->debug) echo "Logging in as $username...\n";
        return $this->request('POST', 'login', ['username' => $username, 'password' => $password]);
    }

    public function request($method, $endpoint, $data = [], $isJson = true, $headers = []) {
        $ch = curl_init();
        
        // Handle full URL or endpoint
        $url = strpos($endpoint, 'http') === 0 ? $endpoint : $this->baseUrl . '?endpoint=' . $endpoint;
        
        // Handle query params for GET
        if ($method === 'GET' && !empty($data)) {
            $url .= '&' . http_build_query($data);
        }

        curl_setopt($ch, CURLOPT_URL, $url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_COOKIEJAR, $this->cookieFile);
        curl_setopt($ch, CURLOPT_COOKIEFILE, $this->cookieFile);
        curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 2);
        curl_setopt($ch, CURLOPT_TIMEOUT, 30); // Generous timeout for AI/slow tests
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);

        if ($method === 'POST') {
            curl_setopt($ch, CURLOPT_POST, true);
            if ($isJson && is_array($data)) {
                $jsonData = json_encode($data);
                curl_setopt($ch, CURLOPT_POSTFIELDS, $jsonData);
                $headers[] = 'Content-Type: application/json';
            } elseif (!empty($data)) {
                // If data contains CURLFile, PHP handles multipart/form-data automatically 
                // when passing the array directly.
                curl_setopt($ch, CURLOPT_POSTFIELDS, $data);
            }
        }

        if (!empty($headers)) {
            curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
        }
        
        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        
        if (curl_errno($ch)) {
            $err = curl_error($ch);
            curl_close($ch);
            throw new Exception("cURL Error: $err");
        }
        
        curl_close($ch);
        
        $decoded = json_decode($response, true);
        
        return [
            'code' => $httpCode, 
            'body' => $decoded, 
            'raw' => $response
        ];
    }

    public function assert($condition, $message) {
        if ($condition) {
            echo "[PASS] $message\n";
        } else {
            echo "[FAIL] $message\n";
            // Check if we should exit or just print
            // For now, let's throw exception to stop test if critical?
            // Or just exit(1) to signal failure to runner
            exit(1);
        }
    }

    public function assertStatus($response, $expectedCode, $message = '') {
        $msg = $message ?: "Expected Status $expectedCode, got {" . $response['code'] . "}";
        if ($response['code'] !== $expectedCode) {
            echo "[FAIL] $msg. Body: " . substr($response['raw'], 0, 200) . "\n";
            exit(1);
        } else {
            echo "[PASS] Status $expectedCode received\n";
        }
    }
}
