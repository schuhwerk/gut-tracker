<?php

class AiService {
    private $apiKey;
    private $apiBaseUrl = 'https://api.openai.com/v1/';
    private $model = 'gpt-4o-mini';

    public function __construct($config) {
        if (is_array($config)) {
            $this->apiKey = $config['api_key'] ?? '';
            $baseUrl = trim($config['base_url'] ?? '');
            if (empty($baseUrl)) {
                $baseUrl = 'https://api.openai.com/v1/';
            }
            $this->apiBaseUrl = rtrim($baseUrl, '/') . '/';
            
            $model = trim($config['model'] ?? '');
            if (empty($model)) {
                $model = 'gpt-4o-mini';
            }
            $this->model = $model;
        } else {
            // Legacy: config is just the key
            $this->apiKey = $config;
        }
    }

    /**
     * Makes a request to the OpenAI API.
     * Can be overridden for testing.
     */
    protected function makeRequest($endpoint, $payload, $isMultipart = false) {
        $url = $this->apiBaseUrl . $endpoint;
        
        $ch = curl_init($url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
        
        $headers = ["Authorization: Bearer " . $this->apiKey];
        if (!$isMultipart) {
            $headers[] = "Content-Type: application/json";
            // Inject model if not present in payload (for chat completions)
            if (isset($payload['messages']) && !isset($payload['model'])) {
                $payload['model'] = $this->model;
            }
            $payload = json_encode($payload);
        } else {
             // For multipart, we need to handle model if supported by endpoint (whisper supports it)
             if (!isset($payload['model'])) {
                 $payload['model'] = 'whisper-1'; // Default for audio, usually not customizable via generic model field?
                 // Actually, if using a custom provider for Whisper, model name might matter.
                 // But most providers use 'whisper-1'.
                 // We will leave it hardcoded for audio unless specific requirement.
             }
        }

        curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
        curl_setopt($ch, CURLOPT_POSTFIELDS, $payload);
        
        $response = curl_exec($ch);
        if (curl_errno($ch)) {
            $error = curl_error($ch);
            curl_close($ch);
            throw new Exception('cURL Request Failed: ' . $error);
        }
        curl_close($ch);
        
        if (empty($response)) {
            throw new Exception('AI Provider returned an empty response');
        }

        $data = json_decode($response, true);
        if ($data === null && json_last_error() !== JSON_ERROR_NONE) {
            throw new Exception('AI Provider returned non-JSON: ' . substr($response, 0, 200));
        }

        if (isset($data['error'])) {
            $msg = $data['error']['message'] ?? 'Unknown OpenAI Error';
            $code = $data['error']['code'] ?? '';

            if (strpos($msg, 'api_key') !== false || $code === 'invalid_api_key') {
                 throw new Exception('INVALID_API_KEY: ' . $msg . ' [DEBUG: Key=' . $this->apiKey . ']');
            }
            throw new Exception('AI Provider Error: ' . $msg . ' [DEBUG: Key=' . $this->apiKey . ']');
        }
        return $data;
    }

    public function callOpenAI($endpoint, $payload, $isMultipart = false) {
        return $this->makeRequest($endpoint, $payload, $isMultipart);
    }

    /**
     * Verifies if the API key works by making a minimal request.
     */
    public function verifyKey() {
        return $this->callOpenAI('chat/completions', [
            'messages' => [['role' => 'user', 'content' => 'ping']],
            'max_tokens' => 1
        ]);
    }

    public function getMagicParsingSystemPrompt($currentDate, $offset = 0) {
        return "You are a health tracking assistant. 
    Current UTC time: $currentDate.
    User Timezone Offset (minutes): $offset. (Note: JS getTimezoneOffset format. -120 means UTC+2).
    
    Analyze the user's input and extract data into a JSON ARRAY of objects.
    
    CRITICAL: 
    1. ALL dates/times in the output JSON MUST be in UTC (YYYY-MM-DD HH:MM:SS).
    2. User inputs are in Local Time. Convert to UTC using: UTC_Time = User_Local_Time + (User_Timezone_Offset_Minutes).
       (Example: If User says '9am' and Offset is -120 (UTC+2), then 09:00 Local + (-120min) = 07:00 UTC).
    3. ALWAYS respond using the SAME LANGUAGE as the user's input for any text fields (like 'notes').

    Each object must match one of these schemas:
    
    1. Food: { \"type\": \"food\", \"event_at\": \"YYYY-MM-DD HH:MM:SS\", \"data\": { \"notes\": \"description of food\" } }
    2. Drink: { \"type\": \"drink\", \"event_at\": \"YYYY-MM-DD HH:MM:SS\", \"data\": { \"notes\": \"description of drink\", \"amount_liters\": float (ESTIMATE if not specified: cup=0.25, mug=0.35, glass=0.3, bottle=0.5, can=0.33, sip=0.05) } }
    3. Stool: { \"type\": \"stool\", \"event_at\": \"YYYY-MM-DD HH:MM:SS\", \"data\": { \"bristol_score\": 1-7 (int), \"notes\": \"optional details\" } }
    4. Sleep: { \"type\": \"sleep\", \"event_at\": \"YYYY-MM-DD HH:MM:SS\" (wake time), \"data\": { \"duration_hours\": float, \"quality\": 1-5 (int), \"bedtime\": \"YYYY-MM-DD HH:MM:SS\" (start time) } }
    5. Symptom: { \"type\": \"symptom\", \"event_at\": \"YYYY-MM-DD HH:MM:SS\", \"data\": { \"notes\": \"description of sensation/pain\", \"mood_score\": 1-5 (int, optional, 1=Bad, 5=Great) } }
    6. Activity: { \"type\": \"activity\", \"event_at\": \"YYYY-MM-DD HH:MM:SS\", \"data\": { \"duration_minutes\": int, \"intensity\": \"Low\" | \"Medium\" | \"High\", \"notes\": \"description\" } }
    
    Rules:
    - For 'Sleep', 'event_at' is the WAKE time. Calculate 'bedtime' by subtracting 'duration_hours' from 'event_at'. Ensure the date rolls back correctly (e.g. if waking up today, sleep started yesterday).
    - Return a valid JSON LIST.
    - Identify ALL distinct items.
    - Infer dates/times based on context.
    - Return ONLY the JSON string, no markdown.";
    }

    public function sanitizeAiResponse($items) {
        if (!is_array($items)) return $items;
        
        foreach ($items as &$item) {
            if (isset($item['type']) && $item['type'] === 'sleep' && isset($item['event_at']) && isset($item['data']['duration_hours'])) {
                try {
                    // event_at is WAKE time in UTC
                    $wakeTime = new DateTime($item['event_at'], new DateTimeZone('UTC'));
                    $duration = floatval($item['data']['duration_hours']);
                    
                    // Calculate bedtime: Wake Time - Duration
                    // We use seconds for precision
                    $bedtimeTimestamp = $wakeTime->getTimestamp() - ($duration * 3600);
                    $bedtime = new DateTime('@' . $bedtimeTimestamp);
                    $bedtime->setTimezone(new DateTimeZone('UTC')); // Ensure UTC
                    
                    // Enforce calculated bedtime
                    $item['data']['bedtime'] = $bedtime->format('Y-m-d H:i:s');
                    
                } catch (Exception $e) {
                    // Invalid date, ignore or log
                }
            }
        }
        return $items;
    }

    public function parseAiJsonContent($content) {
        $content = str_replace(['```json', '```'], '', $content);
        $parsed = json_decode(trim($content), true);
        if (!$parsed) {
            throw new Exception('Failed to parse AI response: ' . $content);
        }
        return $parsed;
    }
    
    public function parseText($text, $clientTime, $offset) {
        $systemPrompt = $this->getMagicParsingSystemPrompt($clientTime, $offset);
        
        // We use the configured model, injected by makeRequest if not present here
        $data = $this->callOpenAI('chat/completions', [
            "messages" => [
                ["role" => "system", "content" => $systemPrompt],
                ["role" => "user", "content" => $text]
            ],
            "temperature" => 0
        ]);
        
        $content = $data['choices'][0]['message']['content'] ?? '{}';
        $parsed = $this->parseAiJsonContent($content);
        return $this->sanitizeAiResponse($parsed);
    }
}
