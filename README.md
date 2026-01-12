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
    For local development, you can use PHP's built-in server:
    ```bash
    php -S localhost:8080 -t public
    ```

5.  **Launch the App**:
    Open `http://localhost:8080` in your browser and log in.

### Configuration

**Setting up AI Features:**
1.  Log in to the app.
2.  Go to **Settings** (Gear icon on the dashboard).
3.  Enter your **OpenAI API Key**.
4.  Save. The key is stored securely in your user account (encrypted/hashed depending on implementation) or local session.

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

*   **Public Directory:** Point your web server's document root to the `public/` folder.
*   **Permissions:** Ensure the web server (e.g., `www-data`) has **write access** to:
    *   The `gut_tracker.sqlite` file in the root directory.
    *    The directory containing the database (so it can handle locking files).
    *   `public/uploads/` (if enabled for image storage).
*   **Security:**
    *   **Do not** expose `gut_tracker.sqlite`, `init_sqlite.php`, or `add_user.php` to the public web.
    *   Use HTTPS in production to ensure Service Workers and Secure Cookies function correctly.

## 🧪 Running Tests

To run the automated test suite (requires the server to be running on localhost:8080):

```bash
php tests/run_tests.php
```

Individual tests can also be run:
*   `php tests/test_api.php`: API endpoint validation.
*   `php tests/test_user_creation.php`: Auth flow validation.

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