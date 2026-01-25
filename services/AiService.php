<?php

class AiService {
    private $apiKey;
    private $apiBaseUrl;
    private $model;

    public function __construct($config) {
        $config = is_array($config) ? $config : ['api_key' => $config];
        $this->apiKey = $config['api_key'] ?? '';
        $this->apiBaseUrl = rtrim($config['base_url'] ?? 'https://api.openai.com/v1/', '/') . '/';
        $this->model = $config['model'] ?? 'gpt-4o-mini';
    }

    /**
     * Standardized API Request Handler
     * Replaces callOpenAI.
     */
    public function request($endpoint, $payload, $isMultipart = false) {
        $ch = curl_init($this->apiBaseUrl . $endpoint);
        
        $headers = [
            "Authorization: Bearer " . $this->apiKey
        ];
        
        if (!$isMultipart) {
            $headers[] = "Content-Type: application/json";
            // Inject default model if missing
            if (!isset($payload['model'])) {
                $payload['model'] = $this->model;
            }
            $postFields = json_encode($payload);
        } else {
            // For multipart (Whisper), don't set Content-Type header manually
            $postFields = $payload;
        }

        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST => true,
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_POSTFIELDS => $postFields,
            CURLOPT_TIMEOUT => 30
        ]);
        
        $response = curl_exec($ch);
        
        if (curl_errno($ch)) {
            $err = curl_error($ch);
            throw new Exception('Request Failed: ' . $err);
        }
        
        $data = json_decode($response, true);
        
        if (isset($data['error'])) {
            $msg = $data['error']['message'] ?? 'Unknown API Error';
            throw new Exception('AI Provider Error: ' . $msg);
        }
        
        return $data;
    }

    /**
     * Verifies if the API Key is valid by making a small request.
     */
    public function verifyKey() {
        return $this->request('chat/completions', [
            'messages' => [['role' => 'user', 'content' => 'hi']],
            'max_tokens' => 1
        ]);
    }
}