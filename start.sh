#!/bin/bash
cd "$(dirname "$0")"
if [ ! -d node_modules ]; then
  echo "Installing dependencies, please wait..."
  npm install
fi
echo ""
echo "Starting the site on http://localhost:3000"
echo "Games dir host on http://localhost:4000"
echo "Press Ctrl+C to stop it."
echo ""
npm start
