#!/bin/bash

# Exit on error
set -e

# Define paths
MODELS_DIR="models"
ZONOS_DIR="${MODELS_DIR}/zonos-tts"

echo "Setting up Zonos TTS in Lambda GPU environment..."

# Install system dependencies
echo "Installing system dependencies..."
sudo apt update -y
sudo apt install -y espeak-ng python3-pip python3-venv git

# Create directories if they don't exist
mkdir -p "${ZONOS_DIR}"
cd "${ZONOS_DIR}"

# Clear directory if not a git repository
if [ ! -d ".git" ]; then
    echo "Cleaning directory for fresh clone..."
    rm -rf * .[!.]*
    git clone https://github.com/Zyphra/Zonos.git .
fi

# Create and activate virtual environment
echo "Creating virtual environment..."
python3 -m venv venv
source venv/bin/activate

# Install UV package manager and Flask
echo "Installing UV package manager and dependencies..."
pip install -U uv
pip install flask gunicorn

# Install dependencies using UV
echo "Installing Zonos dependencies..."
uv sync
uv sync --extra compile
uv pip install -e .

# Create server startup script
echo "Creating server startup script..."
cat > start_server.sh << 'EOL'
#!/bin/bash
source venv/bin/activate
export FLASK_APP=server.py
export FLASK_ENV=production
# Using port 8001 to match .env configuration
gunicorn --bind 0.0.0.0:8001 server:app
EOL

chmod +x start_server.sh

# Create systemd service file
echo "Creating systemd service file..."
sudo tee /etc/systemd/system/zonos-tts.service << EOL
[Unit]
Description=Zonos TTS Service
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$(pwd)
ExecStart=$(pwd)/start_server.sh
Restart=always

[Install]
WantedBy=multi-user.target
EOL

# Reload systemd and start service
echo "Starting Zonos TTS service..."
sudo systemctl daemon-reload
sudo systemctl enable zonos-tts
sudo systemctl start zonos-tts

echo "Zonos TTS setup complete!"
echo "Service is running on port 8001"
echo "Check status with: sudo systemctl status zonos-tts"