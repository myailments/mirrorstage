#!/bin/bash

# Exit on error
set -e

# Move to project root directory (one level up from scripts)
cd "$(dirname "$0")/.."

# Define paths relative to project root
MODELS_DIR="models"
LATENTSYNC_DIR="${MODELS_DIR}/latentsync"
VENV_DIR="${LATENTSYNC_DIR}/venv"

echo "Setting up LatentSync in Lambda GPU environment..."

# Create directories if they don't exist
mkdir -p "${LATENTSYNC_DIR}"

# Install system dependencies
echo "Installing system dependencies..."
sudo apt update -y
sudo apt install -y python3.10-venv ffmpeg libgl1

# Clone LatentSync repository if not already present
if [ ! -d "${LATENTSYNC_DIR}/.git" ]; then
    echo "Cloning LatentSync repository..."
    git clone https://github.com/ByteDance/LatentSync.git "${LATENTSYNC_DIR}"
fi

# Create and activate virtual environment
echo "Creating Python virtual environment..."
python3 -m venv "${VENV_DIR}"
source "${VENV_DIR}/bin/activate"

# Install dependencies
echo "Installing Python dependencies..."
pip install --upgrade pip
pip install flask gunicorn
pip install -r "${LATENTSYNC_DIR}/requirements.txt"

# Download checkpoints from HuggingFace
echo "Downloading model checkpoints..."
pip install huggingface-hub
huggingface-cli download ByteDance/LatentSync-1.5 --local-dir "${LATENTSYNC_DIR}/checkpoints" --exclude "*.git*" "README.md"

# Create soft links for auxiliary models
echo "Setting up auxiliary model links..."
mkdir -p ~/.cache/torch/hub/checkpoints
ln -sf "${LATENTSYNC_DIR}/checkpoints/auxiliary/2DFAN4-cd938726ad.zip" ~/.cache/torch/hub/checkpoints/2DFAN4-cd938726ad.zip
ln -sf "${LATENTSYNC_DIR}/checkpoints/auxiliary/s3fd-619a316812.pth" ~/.cache/torch/hub/checkpoints/s3fd-619a316812.pth
ln -sf "${LATENTSYNC_DIR}/checkpoints/auxiliary/vgg16-397923af.pth" ~/.cache/torch/hub/checkpoints/vgg16-397923af.pth

# Create server startup script
echo "Creating server startup script..."
cat > "${LATENTSYNC_DIR}/start_server.sh" << 'EOL'
#!/bin/bash
source venv/bin/activate
export FLASK_APP=server.py
export FLASK_ENV=production
gunicorn --bind 0.0.0.0:8002 server:app
EOL

chmod +x "${LATENTSYNC_DIR}/start_server.sh"

# Create systemd service file
echo "Creating systemd service file..."
sudo tee /etc/systemd/system/latentsync.service << EOL
[Unit]
Description=LatentSync Service
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=${PWD}/${LATENTSYNC_DIR}
ExecStart=${PWD}/${LATENTSYNC_DIR}/start_server.sh
Restart=always

[Install]
WantedBy=multi-user.target
EOL

# Reload systemd and start service
echo "Starting LatentSync service..."
sudo systemctl daemon-reload
sudo systemctl enable latentsync
sudo systemctl start latentsync

echo "LatentSync setup complete!"
echo "Service is running on port 8002"
echo "Check status with: sudo systemctl status latentsync"
