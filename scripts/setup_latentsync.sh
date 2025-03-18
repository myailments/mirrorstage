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

# Create server.py
echo "Creating server.py..."
cat > "${LATENTSYNC_DIR}/server.py" << 'EOL'
import os
import logging
import tempfile
from flask import Flask, request, jsonify, send_file
import subprocess
import shutil

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

app = Flask(__name__)

# Configuration
INFERENCE_SCRIPT = "scripts.inference"
UNET_CONFIG = "configs/unet/stage2.yaml"
CHECKPOINT_PATH = "checkpoints/latentsync_unet.pt"
INFERENCE_STEPS = 20
GUIDANCE_SCALE = 1.5

@app.route('/health', methods=['GET'])
def health_check():
    logger.info("Health check requested")
    return jsonify({"status": "healthy"}), 200

@app.route('/sync', methods=['POST'])
def sync_video_audio():
    try:
        logger.info("Received video sync request")
        
        # Check if files are in the request
        if 'video' not in request.files or 'audio' not in request.files:
            return jsonify({"error": "Both video and audio files are required"}), 400

        video_file = request.files['video']
        audio_file = request.files['audio']

        # Create temporary directory for processing
        with tempfile.TemporaryDirectory() as temp_dir:
            # Save uploaded files
            video_path = os.path.join(temp_dir, "input_video.mp4")
            audio_path = os.path.join(temp_dir, "input_audio.wav")
            output_path = os.path.join(temp_dir, "output_video.mp4")

            video_file.save(video_path)
            audio_file.save(audio_path)

            logger.info("Files saved, starting inference")

            # Prepare command
            cmd = [
                "python", "-m", INFERENCE_SCRIPT,
                "--unet_config_path", UNET_CONFIG,
                "--inference_ckpt_path", CHECKPOINT_PATH,
                "--inference_steps", str(INFERENCE_STEPS),
                "--guidance_scale", str(GUIDANCE_SCALE),
                "--video_path", video_path,
                "--audio_path", audio_path,
                "--video_out_path", output_path
            ]

            # Run inference
            logger.info("Running inference command")
            process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE
            )
            stdout, stderr = process.communicate()

            if process.returncode != 0:
                logger.error(f"Inference failed: {stderr.decode()}")
                return jsonify({"error": "Video processing failed"}), 500

            logger.info("Inference completed successfully")

            # Return the processed video
            return send_file(
                output_path,
                mimetype='video/mp4',
                as_attachment=True,
                download_name='synchronized_video.mp4'
            )

    except Exception as e:
        logger.error(f"Error in video sync: {str(e)}", exc_info=True)
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    logger.info("Starting LatentSync server on port 8002...")
    app.run(host='0.0.0.0', port=8002, threaded=True)
EOL

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
