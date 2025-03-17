#!/bin/bash
# Setup script for Lambda Cloud

# Exit on error
set -e

echo "Setting up AI Video Pipeline on Lambda Cloud..."

# Install Node.js dependencies
echo "Installing Node.js dependencies..."
npm install

# Create necessary directories
echo "Creating directories..."
mkdir -p generated_videos logs assets

# Set up Python environments for models
echo "Setting up Python environments..."

# Set up Zonos TTS
cd models/zonos-tts
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
deactivate
cd ../..

# Set up LatentSync
cd models/latentsync
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
deactivate
cd ../..

# Install PM2 globally
echo "Installing PM2..."
npm install -g pm2

echo "Setup complete! Please place a base video in the assets directory."
echo "Then run 'cp .env.example .env' and edit the .env file with your configuration."
