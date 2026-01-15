#!/bin/bash

NEW_VERSION=$1

if [ -z "$NEW_VERSION" ]; then
  echo "Usage: ./update_version.sh <version>"
  echo "Example: ./update_version.sh 1.9"
  exit 1
fi

echo "Updating app to version $NEW_VERSION..."

# 1. Update manifest.json
sed -i "s/\"version\": \".*\"/\"version\": \"$NEW_VERSION\"/" manifest.json
echo "- Updated manifest.json"

# 2. Update sw.js Cache Name (Auto-increment integer)
# Finds 'gut-tracker-v10' -> becomes 'gut-tracker-v11'
CURRENT_CACHE_LINE=$(grep "const CACHE_NAME =" sw.js)
CURRENT_NUM=$(echo "$CURRENT_CACHE_LINE" | grep -oE "v[0-9]+" | tr -d 'v')

if [ ! -z "$CURRENT_NUM" ]; then
    NEXT_NUM=$((CURRENT_NUM + 1))
    sed -i "s/const CACHE_NAME = 'gut-tracker-v[0-9]*';/const CACHE_NAME = 'gut-tracker-v$NEXT_NUM';/" sw.js
    echo "- Updated sw.js cache to v$NEXT_NUM"
else
    echo "Warning: Could not find/update cache version in sw.js"
fi

# 3. Update index.html Display Version
sed -i "s/<span id=\"app-version\" class=\"text-\[10px\] text-gray-600 font-mono\">v.*<\/span>/<span id=\"app-version\" class=\"text-[10px] text-gray-600 font-mono\">v$NEW_VERSION<\/span>/" index.html
echo "- Updated visual version in index.html"

# 4. Update index.html CSS Asset Version
sed -i "s/href=\"style.css?v=.*\"/href=\"style.css?v=$NEW_VERSION\"/" index.html
echo "- Updated asset query string in index.html"

echo "✅ Update complete!"
