# <img src="icons/icon.png" width="48" height="48" valign="bottom" /> Gut Health Tracker

A modern, self-hosted PWA for tracking gut health, diet, and lifestyle with AI-assisted entry.
**No build step.** Only **Tailwind CSS** and **Chart.js** (via CDN) as dependencies.

## Features

*   **Tracking:** Food, hydration, sleep, and stool quality (Bristol Scale).
*   **AI-Assisted Entry:** Natural language input, voice entry, and food photo analysis.
*   **Visualization:** Interactive charts for correlations (e.g., Sleep vs. Digestion).
*   **PWA:** Installable on iOS/Android. Offline capable.

## Deployment Modes

### 1. Server Mode (Recommended)
Uses PHP and SQLite. Data is synced to the server and available across devices.
*   **Backend:** PHP 8.0+
*   **Database:** SQLite (Zero-config)

### 2. Local Mode (Client-Only)
Works entirely in the browser using IndexedDB. No server setup required.
*   **Note:** Data is stored on the device only and will not sync between devices.
*   **AI Features:** Make direct calls to OpenAI from the browser (requires API Key).

## Setup (Server Mode)

1.  **Clone** the repository.
2.  **Initialize DB:**
    ```bash
    php init_sqlite.php
    ```
3.  **Create User:**
    ```bash
    php add_user.php <username>
    ```
4.  **Run:**
    ```bash
    php -S localhost:8080 router.php
    ```
    Access at `http://localhost:8080`.

## Configuration

*   **AI Features:** Enter your OpenAI API Key in the app's **Settings** menu.
*   **HTTPS:** Required for Service Workers and PWA installation in production.
*   **Customization:** Edit `manifest.json` to change the app name or theme colors.
*   **PWA Icons:** The app expects `icon-192.png` and `icon-512.png` in the `/icons` directory.

## Security

Ensure your web server (Apache/Nginx) blocks access to these sensitive files:

*   `gut_tracker.sqlite` (and `.sqlite-wal`, `.sqlite-shm`)
*   `db_config.php`
*   `add_user.php`
*   `init_sqlite.php`

*An `.htaccess` file is included for Apache environments.*

## Credits

*   **Tailwind CSS** for the modern UI.
*   **Chart.js** for data visualizations.
*   **SQLite** for the lightweight database.

## License

MIT

## Todo

*   Test: Magic Entry Images
*   AI: Describe Food well
*   Test offline mode.
*   Bundle Tailwind, offline chart.js?