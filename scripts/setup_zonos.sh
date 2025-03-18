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

# Create server.py file
echo "Creating server.py file..."
cat > server.py << 'EOL'
import torch
import torchaudio
import logging
from flask import Flask, request, jsonify, send_file
from zonos.model import Zonos
from zonos.conditioning import make_cond_dict
from zonos.utils import DEFAULT_DEVICE as device

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

app = Flask(__name__)

# Initialize model globally
logger.info("Loading Zonos model...")
model = Zonos.from_pretrained("Zyphra/Zonos-v0.1-transformer", device=device)

# Load default speaker embedding
logger.info("Loading default speaker embedding...")
default_wav, default_sampling_rate = torchaudio.load("assets/exampleaudio.mp3")
default_speaker = model.make_speaker_embedding(default_wav, default_sampling_rate)

@app.route('/health', methods=['GET'])
def health_check():
    logger.info("Health check requested")
    return jsonify({"status": "healthy"}), 200

@app.route('/tts', methods=['POST'])
def text_to_speech():
    try:
        logger.info("Received TTS request")
        data = request.get_json()
        text = data.get('text', '')
        logger.info(f"Processing text: {text[:50]}...")
        
        # Create conditioning dictionary
        logger.info("Creating conditioning dictionary...")
        cond_dict = make_cond_dict(
            text=text,
            speaker=default_speaker,
            language="en-us"
        )
        conditioning = model.prepare_conditioning(cond_dict)

        # Generate audio
        logger.info("Generating audio...")
        codes = model.generate(conditioning)
        logger.info("Decoding audio...")
        wavs = model.autoencoder.decode(codes).cpu()
        
        # Save temporarily and return
        output_path = "temp_output.wav"
        logger.info(f"Saving audio to {output_path}")
        torchaudio.save(output_path, wavs[0], model.autoencoder.sampling_rate)
        
        logger.info("Sending response")
        return send_file(output_path, mimetype="audio/wav")
    
    except Exception as e:
        logger.error(f"Error in TTS generation: {str(e)}", exc_info=True)
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    logger.info("Starting server on port 8001...")
    from werkzeug.serving import run_simple
    run_simple('0.0.0.0', 8001, app, threaded=True, request_timeout=300)
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