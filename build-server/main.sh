#!/bin/bash

export GIT_REPO_URL="$GIT_REPO_URL"

# Make the output directory
mkdir -p /home/app/output

# Execute the Node script immediately. 
# The Node script will handle cloning, error reporting, and building.
exec node script.js