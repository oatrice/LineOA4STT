#!/bin/sh

# Exit immediately if a command exits with a non-zero status.
set -e

# Check if the GOOGLE_CREDENTIALS_JSON environment variable is set
if [ -z "$GOOGLE_CREDENTIALS_JSON" ]; then
  echo "Error: GOOGLE_CREDENTIALS_JSON environment variable is not set."
  exit 1
fi

# Create the Google credentials file from the environment variable
echo "$GOOGLE_CREDENTIALS_JSON" > ./google-credentials.json
echo "Successfully created google-credentials.json"

# Execute the main command (passed as CMD in Dockerfile)
exec "$@"
