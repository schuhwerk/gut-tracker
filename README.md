# Gut Health Tracker PWA 🧬

A modern, self-hosted Progressive Web App (PWA) designed to help you track your gut health, diet, and lifestyle with the power of AI.

## ✨ Features

### 📝 Comprehensive Tracking
*   **Food & Drink:** Log meals and hydration.
*   **Stool Quality:** Track bowel movements using the **Bristol Stool Scale** (Types 1-7).
*   **Sleep:** Monitor sleep duration and quality.
*   **Symptoms/Feelings:** Record pain, bloating, mood, or other symptoms with severity ratings.

### 🤖 AI-Powered Automation
*   **Magic Input:** Type natural sentences like *"Ate a burger and fries at 5pm"* and let AI parse it into structured data.
*   **Voice Entry:** Long-press the Magic Button to record audio entries. The AI transcribes and formats them automatically.
*   **Visual Food Analysis:** Take a photo of your meal, and the AI will analyze and describe it for you.
*   **Voice Dictation:** Use the microphone icon in any note field for speech-to-text.
*   *(Note: AI features require an OpenAI API Key)*

### 📊 Visualization & Analysis
*   **Timeline View:** See your daily history at a glance.
*   **Interactive Charts:**
    *   Compare **Sleep Duration vs. Stool Quality** over the last 30 days.
    *   Visualize **Symptom Intensity** with a bubble chart.
*   **Quick Stats:** Dashboard summary of recent averages.

### 💻 Technical Highlights
*   **No Build Step:** Built with Vanilla PHP and modern JavaScript.
*   **Zero-Config Database:** Uses **SQLite** for easy setup and portability.
*   **Responsive UI:** Mobile-first design with **Tailwind CSS** (Dark Mode by default).
*   **PWA Ready:** Installable on iOS and Android devices (manifest & service worker included).

## 🚀 Getting Started

### Prerequisites
*   **PHP 8.0+**
*   PHP Extensions: `sqlite3`, `curl`, `mbstring`
*   **OpenAI API Key** (Required only for AI features)

### Installation

1.  **Clone or Download** the repository.

2.  **Initialize the Database**:
    Run the initialization script to create the SQLite database file.
    ```bash
    php init_sqlite.php
    ```

3.  **Create a User Account**:
    Create your first login credentials.
    ```bash
    php add_user.php your_username
    ```
    *You will be prompted to enter a password.*

4.  **Start the Server**:
    For local development, use PHP's built-in server with the secure router:
    ```bash
    php -S localhost:8080 router.php
    ```

5.  **Launch the App**:
    Open `http://localhost:8080` in your browser and log in.

### Configuration

**Setting up AI Features:**
1.  Log in to the app.
2.  Go to **Settings** (Gear icon on the dashboard).
3.  Enter your **OpenAI API Key**.
4.  Save. The key is stored securely in your user account.

## 📱 Mobile Installation (PWA)

**iOS (Safari):**
1.  Open the app in Safari.
2.  Tap the **Share** button.
3.  Select **"Add to Home Screen"**.

**Android (Chrome):**
1.  Open the app in Chrome.
2.  Tap the menu (three dots).
3.  Select **"Install App"** or **"Add to Home Screen"**.

## 🛠️ Deployment Notes

*   **Root Directory:** Point your web server's document root to the project folder.
*   **Permissions:** Ensure the web server (e.g., `www-data`) has **write access** to:
    *   The `gut_tracker.sqlite` file in the project folder.
    *   The directory containing the database.
    *   `uploads/` (if enabled).

### 🔒 Security

*   **Apache:** An `.htaccess` file is included to block access to sensitive files (`.sqlite`, config scripts, etc.). Ensure `AllowOverride All` is enabled in your Apache config.
*   **Nginx:** Use the provided `nginx.conf.example` as a template. It explicitly denies access to sensitive files.
*   **CLI Scripts:** `add_user.php` and `init_sqlite.php` include checks to prevent execution via the web.
    *   Use HTTPS in production to ensure Service Workers and Secure Cookies function correctly.

## 🧪 Testing

The project includes a comprehensive test suite covering API functionality, authentication, and AI features.

### Full Test Suite
To run all tests (this automatically manages a temporary PHP test server on port 8085):
```bash
bash tests/run_tests.sh
```

### Individual Tests
You can run specific tests to focus on a particular feature.

1.  **Start the test server** in one terminal:
    ```bash
    php -S 127.0.0.1:8085 router.php
    ```

2.  **Run your chosen test** in another terminal:
    ```bash
    php tests/test_api.php
    php tests/test_image_upload.php
    # etc.
    ```

*Note: Individual tests expect the server to be running on `http://127.0.0.1:8085`. If you use a different port, you may need to update `tests/TestHelper.php`.*

### AI Integration Tests
To run tests that interact with the OpenAI API:
1.  Create a file named `tests/api_key.txt` containing your OpenAI API key.
2.  Or pass it directly to the runner: `bash tests/run_tests.sh YOUR_API_KEY`.
3.  `test_ai_live.php` will be skipped if no key is found.

## 📄 Credits & License

*   **Tailwind CSS** (via CDN) for styling.
*   **Chart.js** (via CDN) for data visualization.
*   No other npm dependencies or build tools required.

License: MIT



## Todo
- Test: Magic Entry Images
- AI: Describe Food well
- Test offline mode.
- Publish
- I want this to work as a github-page (static). Can i?