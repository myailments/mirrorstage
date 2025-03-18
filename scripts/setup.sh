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

# Set up Python environments and services
echo "Setting up services..."

# Set up Zonos TTS
echo "Setting up Zonos TTS..."
./scripts/setup_zonos.sh

# Set up LatentSync
echo "Setting up LatentSync..."
./scripts/setup_latentsync.sh

# Install PM2 globally
echo "Installing PM2..."
npm install -g pm2

# Install ecosystem.config.js
echo "Installing ecosystem.config.js..."
cp ecosystem.config.js.example ecosystem.config.js

echo "Setup complete! Please place a base video in the assets directory."
echo "Then run 'cp .env.example .env' and edit the .env file with your configuration."
echo "Zonos TTS is running on port 8001"
echo "LatentSync is running on port 8002"
