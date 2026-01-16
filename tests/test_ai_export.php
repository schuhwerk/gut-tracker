<?php
// tests/test_ai_export.php

require_once __DIR__ . '/TestHelper.php';

$t = new TestHelper();

echo "Starting AI Export Tests...\n";

// 1. Login
echo "\n--- Testing Login ---\n";
$res = $t->login('admin', 'admin');
$t->assertStatus($res, 200);

// 2. Clear existing entries to have a clean state for comparison
echo "\n--- Clearing old data ---\n";
$t->request('POST', 'delete_all');

// 3. Add entries of all types
echo "\n--- Adding test entries ---\n";

$entries = [
    [
        'type' => 'food',
        'recorded_at' => '2023-10-27 12:30:00',
        'data' => ['notes' => 'Oatmeal with berries']
    ],
    [
        'type' => 'drink',
        'recorded_at' => '2023-10-27 13:00:00',
        'data' => ['amount_liters' => 0.5, 'notes' => 'Green Tea']
    ],
    [
        'type' => 'stool',
        'recorded_at' => '2023-10-27 14:00:00',
        'data' => ['bristol_score' => 4, 'notes' => 'Perfect']
    ],
    [
        'type' => 'sleep',
        'recorded_at' => '2023-10-27 22:00:00',
        'data' => ['quality' => 5, 'duration_hours' => 8.0]
    ],
    [
        'type' => 'feeling',
        'recorded_at' => '2023-10-28 08:00:00',
        'data' => ['mood_score' => 4, 'notes' => 'Feeling energized']
    ],
    [
        'type' => 'symptom',
        'recorded_at' => '2023-10-28 08:30:00',
        'data' => ['severity' => 2, 'notes' => 'Mild bloating']
    ],
    [
        'type' => 'activity',
        'recorded_at' => '2023-10-28 09:00:00',
        'data' => ['duration_minutes' => 45, 'intensity' => 'Medium', 'notes' => 'Morning Jog']
    ]
];

foreach ($entries as $e) {
    $res = $t->request('POST', 'entry', [
        'type' => $e['type'],
        'recorded_at' => $e['recorded_at'],
        'data' => json_encode($e['data'])
    ], false);
    $t->assertStatus($res, 200);
}

// 4. Test AI Export endpoint
echo "\n--- Testing AI Export endpoint ---\n";
$res = $t->request('GET', 'ai_export');
$t->assertStatus($res, 200);

$output = $res['raw'];

echo "\n--- RECEIVED OUTPUT ---\n";
echo $output;
echo "\n--- END OUTPUT ---\n";

// 5. Verification
$t->assert(strpos($output, "GUT TRACKER EXPORT (FOR AI ANALYSIS)") !== false, "Headline missing");
$t->assert(strpos($output, "# 2023-10-27") !== false, "Day header missing");
$t->assert(strpos($output, "[Bristol:4]") !== false, "Bristol score missing or misformatted");
$t->assert(strpos($output, "[Mood:4/5]") !== false, "Mood score missing or misformatted");
$t->assert(strpos($output, "[Mood:2/5]") !== false, "Symptom severity (fallback to mood) missing");
$t->assert(strpos($output, "[45min, Medium]") !== false, "Activity metrics missing");

echo "\nAI Export Tests Passed!\n";
?>
