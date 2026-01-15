#!/bin/bash

# Configuration
HOST="127.0.0.1"
PORT="8085"
URL="http://$HOST:$PORT"
PID_FILE="tests/server.pid"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}Preparing test environment...${NC}"

# 1. Check if port is already in use
if lsof -Pi :$PORT -sTCP:LISTEN -t >/dev/null ; then
    echo -e "${RED}Port $PORT is already in use.${NC}"
    echo "Please stop the process running on port $PORT or check if a test server is already running."
    # Optional: Check if it's our server from a previous run (leftover)
    # But for safety, let's just warn and exit or try to use it?
    # If we assume it's the correct server, we can try running tests against it.
    echo "Attempting to run tests against existing server..."
else
    # 2. Start PHP Server in background
    echo "Starting PHP server on $HOST:$PORT..."
    php -S $HOST:$PORT router.php > /dev/null 2>&1 &
    SERVER_PID=$!
    echo $SERVER_PID > $PID_FILE
    
    # Wait for server to be responsive
    echo "Waiting for server to launch..."
    for i in {1..10}; do
        if curl -s -I $URL/api.php > /dev/null; then
            echo -e "${GREEN}Server is UP!${NC}"
            break
        fi
        sleep 0.5
    done
    
    if ! curl -s -I $URL/api.php > /dev/null; then
        echo -e "${RED}Failed to start server.${NC}"
        kill $SERVER_PID
        rm $PID_FILE
        exit 1
    fi
fi

# 3. Run Tests
echo -e "${GREEN}Running Test Suite...${NC}"
php tests/run_tests.php

TEST_EXIT_CODE=$?

# 4. Cleanup (Only if we started the server)
if [ -f $PID_FILE ]; then
    read PID < $PID_FILE
    if [ -n "$PID" ]; then
        echo "Stopping test server (PID: $PID)..."
        kill $PID
    fi
    rm $PID_FILE
fi

# Exit with the test runner's exit code
exit $TEST_EXIT_CODE
