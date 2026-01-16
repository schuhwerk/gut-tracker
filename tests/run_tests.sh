#!/bin/bash

# Configuration
HOST="127.0.0.1"
PORT="8087"
URL="http://$HOST:$PORT"
PID_FILE="tests/server.pid"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}Preparing test environment...${NC}"

# 0. Run Unit Tests
echo -e "${GREEN}Running Unit Tests...${NC}"
for f in tests/unit/Test*.php; do
    echo "Running $f..."
    php "$f"
    if [ $? -ne 0 ]; then
        echo -e "${RED}Unit test $f failed!${NC}"
        exit 1
    fi
done
echo -e "${GREEN}Unit tests passed.${NC}"

# 1. Setup Test DB
export GUT_TRACKER_DB_PATH="$(pwd)/tests/test_gut_tracker.sqlite"
if [ -f "$GUT_TRACKER_DB_PATH" ]; then
    rm "$GUT_TRACKER_DB_PATH"
fi
echo "Using Test DB: $GUT_TRACKER_DB_PATH"

# 2. Dynamic Port Selection
ORIGINAL_PORT=$PORT
MAX_RETRIES=10
FOUND_PORT=""

echo "Searching for a free port..."

# Search for a free port
for ((i=0; i<=MAX_RETRIES; i++)); do
    NEXT_PORT=$((PORT + i))
    if ! lsof -Pi :$NEXT_PORT -sTCP:LISTEN -t >/dev/null ; then
        FOUND_PORT=$NEXT_PORT
        echo -e "${GREEN}Found free port: $FOUND_PORT${NC}"
        break
    fi
done

if [ -z "$FOUND_PORT" ]; then
    echo -e "${RED}Could not find a free port after $MAX_RETRIES attempts.${NC}"
    exit 1
fi

PORT=$FOUND_PORT
URL="http://$HOST:$PORT"
export TEST_BASE_URL="$URL/api.php"

# 3. Start Server
echo "Starting PHP server on $HOST:$PORT..."
php -S $HOST:$PORT router.php > /dev/null 2>&1 &
SERVER_PID=$!
echo $SERVER_PID > $PID_FILE

# Wait for server to be responsive
echo "Waiting for server to launch..."
for i in {1..20}; do
    if curl -s -I $URL/api.php > /dev/null; then
        echo -e "${GREEN}Server is UP!${NC}"
        break
    fi
    sleep 0.2
done

if ! curl -s -I $URL/api.php > /dev/null; then
    echo -e "${RED}Failed to start server on $PORT.${NC}"
    kill $SERVER_PID
    rm $PID_FILE
    exit 1
fi

# 4. Run Tests
echo -e "${GREEN}Running Test Suite...${NC}"
php tests/run_tests.php

TEST_EXIT_CODE=$?

# 5. Cleanup
if [ -f $PID_FILE ]; then
    read PID < $PID_FILE
    if [ -n "$PID" ]; then
        echo "Stopping test server (PID: $PID)..."
        kill $PID
    fi
    rm $PID_FILE
fi

# Remove Test DB
if [ -f "$GUT_TRACKER_DB_PATH" ]; then
    echo "Removing Test DB..."
    rm "$GUT_TRACKER_DB_PATH"
fi
# Remove potential journal files
if [ -f "$GUT_TRACKER_DB_PATH-wal" ]; then rm "$GUT_TRACKER_DB_PATH-wal"; fi
if [ -f "$GUT_TRACKER_DB_PATH-shm" ]; then rm "$GUT_TRACKER_DB_PATH-shm"; fi

# Exit with the test runner's exit code
exit $TEST_EXIT_CODE
