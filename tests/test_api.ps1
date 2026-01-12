$baseUrl = "http://localhost:8080/api.php"

Write-Host "1. Testing Login..."
$loginBody = @{
    username = "admin"
    password = "admin"
} | ConvertTo-Json

try {
    $loginResponse = Invoke-RestMethod -Uri "$baseUrl?endpoint=login" -Method Post -Body $loginBody -ContentType "application/json" -SessionVariable cookieJar
    Write-Host "Login Success: $($loginResponse.message)"
} catch {
    Write-Error "Login Failed: $_"
    exit 1
}

Write-Host "`n2. Testing Food Entry..."
$foodData = @{
    notes = "Test Apple"
}
$foodEntry = @{
    type = "food"
    data = ($foodData | ConvertTo-Json)
}
# Invoke-RestMethod with -Form sends multipart/form-data
try {
    $res = Invoke-RestMethod -Uri "$baseUrl?endpoint=entry" -Method Post -Form $foodEntry -WebSession $cookieJar
    Write-Host "Food Entry Saved: $($res.message)"
} catch {
    Write-Error "Food Entry Failed: $_"
}

Write-Host "`n3. Testing Stool Entry..."
$stoolData = @{
    bristol_score = 4
    notes = "Perfect"
}
$stoolEntry = @{
    type = "stool"
    data = ($stoolData | ConvertTo-Json)
}
try {
    $res = Invoke-RestMethod -Uri "$baseUrl?endpoint=entry" -Method Post -Form $stoolEntry -WebSession $cookieJar
    Write-Host "Stool Entry Saved: $($res.message)"
} catch {
    Write-Error "Stool Entry Failed: $_"
}

Write-Host "`n4. Fetching Entries..."
try {
    $entries = Invoke-RestMethod -Uri "$baseUrl?endpoint=entries" -Method Get -WebSession $cookieJar
    Write-Host "Fetched $($entries.Count) entries."
    if ($entries.Count -ge 2) {
        Write-Host "SUCCESS: Entries found."
    } else {
        Write-Error "FAILURE: Not enough entries found."
    }
} catch {
    Write-Error "Fetch Entries Failed: $_"
}

Write-Host "`n5. Testing Export..."
try {
    $export = Invoke-RestMethod -Uri "$baseUrl?endpoint=export" -Method Get -WebSession $cookieJar
    $json = $export | ConvertTo-Json -Depth 5
    Write-Host "Export retrieved successfully."
    # Write-Host $json
} catch {
    Write-Error "Export Failed: $_"
}
