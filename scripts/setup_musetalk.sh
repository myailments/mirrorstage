#!/bin/bash

# Exit on error
set -e

# Move to project root directory (one level up from scripts)
cd "$(dirname "$0")/.."

# Define paths relative to project root
MODELS_DIR="models"
MUSETALK_DIR="${MODELS_DIR}/musetalk"
VENV_DIR="${MUSETALK_DIR}/venv"
FFMPEG_DIR="${MUSETALK_DIR}/ffmpeg-4.4-amd64-static"

echo "Setting up MuseTalk in Lambda GPU environment..."

# Create directories if they don't exist
mkdir -p "${MUSETALK_DIR}"
# Install system dependencies
echo "Installing system dependencies..."
sudo apt update -y
sudo apt install -y python3.10-venv ffmpeg libgl1-mesa-glx libglib2.0-0 wget

# Handle MuseTalk repository setup
if [ ! -d "${MUSETALK_DIR}/.git" ]; then
    echo "Setting up MuseTalk repository..."
    # If directory exists but isn't a git repo, remove it
    if [ -d "${MUSETALK_DIR}" ]; then
        echo "Removing existing non-git directory..."
        rm -rf "${MUSETALK_DIR}"
    fi
    echo "Cloning MuseTalk repository..."
    git clone https://github.com/TMElyralab/MuseTalk.git "${MUSETALK_DIR}"

else
    echo "MuseTalk repository already exists, updating..."
    cd "${MUSETALK_DIR}"
    git pull
    cd -
fi

mkdir -p "${MUSETALK_DIR}/musetalk/models/musetalk"
mkdir -p "${MUSETALK_DIR}/musetalk/models/dwpose"
mkdir -p "${MUSETALK_DIR}/musetalk/models/face-parse-bisent"
mkdir -p "${MUSETALK_DIR}/musetalk/models/sd-vae-ft-mse"
mkdir -p "${MUSETALK_DIR}/musetalk/models/whisper"

# # Create and activate virtual environment
echo "Creating Python virtual environment..."
python3 -m venv "${VENV_DIR}"
source "${VENV_DIR}/bin/activate"

# # Install dependencies
echo "Installing Python dependencies..."
pip install --upgrade pip
pip install flask gunicorn gdown  

# # Install requirements from repo
cd "${MUSETALK_DIR}"
pip install -r requirements.txt

# # Install mmlab packages
echo "Installing mmlab packages..."
pip install --no-cache-dir -U openmim
mim install mmengine
mim install "mmcv>=2.0.1"
mim install "mmdet>=3.0.0,<3.3.0"
mim install "mmpose>=1.1.0"

# # Download ffmpeg-static if not exists
if [ ! -d "${FFMPEG_DIR}" ]; then
    echo "Downloading ffmpeg-static..."
    mkdir -p "${FFMPEG_DIR}"

    # Try primary source first (latest stable build)
    FFMPEG_URL="https://github.com/eugeneware/ffmpeg-static/releases/latest/download/linux-x64"

    # Try downloading from primary URL
    if ! wget -q --show-progress "${FFMPEG_URL}" -O "${FFMPEG_DIR}/ffmpeg"; then
        echo "Primary download failed, trying fallback sources..."

        # Direct download of ffmpeg binary from johnvansickle.com (known reliable source)
        FALLBACK_URL="https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz"

        if wget -q --show-progress "$FALLBACK_URL" -O "${MUSETALK_DIR}/ffmpeg.tar.xz"; then
            echo "Extracting ffmpeg..."
            mkdir -p "${MUSETALK_DIR}/ffmpeg-temp"
            tar -xf "${MUSETALK_DIR}/ffmpeg.tar.xz" -C "${MUSETALK_DIR}/ffmpeg-temp"

            # Find the ffmpeg binary in the extracted directory and move it
            find "${MUSETALK_DIR}/ffmpeg-temp" -name "ffmpeg" -type f -exec cp {} "${FFMPEG_DIR}/ffmpeg" \;

            # Clean up
            rm -rf "${MUSETALK_DIR}/ffmpeg-temp"
            rm -f "${MUSETALK_DIR}/ffmpeg.tar.xz"

            echo "Fallback ffmpeg downloaded and extracted successfully"
        else
            echo "Fallback download failed, attempting direct download..."
            # As a last resort, try direct download from GitHub
            DIRECT_URL="https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz"

            if wget -q --show-progress "$DIRECT_URL" -O "${MUSETALK_DIR}/ffmpeg.tar.xz"; then
                mkdir -p "${MUSETALK_DIR}/ffmpeg-temp"
                tar -xf "${MUSETALK_DIR}/ffmpeg.tar.xz" -C "${MUSETALK_DIR}/ffmpeg-temp"
                find "${MUSETALK_DIR}/ffmpeg-temp" -name "ffmpeg" -type f -exec cp {} "${FFMPEG_DIR}/ffmpeg" \;
                rm -rf "${MUSETALK_DIR}/ffmpeg-temp"
                rm -f "${MUSETALK_DIR}/ffmpeg.tar.xz"
            else
                echo "All download attempts failed. Installing system ffmpeg instead."
                # If all else fails, try to use the system ffmpeg
                if command -v ffmpeg >/dev/null 2>&1; then
                    cp $(which ffmpeg) "${FFMPEG_DIR}/ffmpeg"
                else
                    echo "Error: Failed to obtain ffmpeg from any source"
                    exit 1
                fi
            fi
        fi
    fi

    # Make ffmpeg executable
    if [ -f "${FFMPEG_DIR}/ffmpeg" ]; then
        chmod +x "${FFMPEG_DIR}/ffmpeg"
        echo "FFmpeg set up successfully"
    else
        echo "Error: Failed to set up FFmpeg"
        exit 1
    fi
fi

# # Set FFMPEG_PATH environment variable
echo "export FFMPEG_PATH=${FFMPEG_DIR}" >> "${MUSETALK_DIR}/.env"

# # Download MuseTalk main models
echo "Downloading MuseTalk model files from HuggingFace..."

# # Install huggingface-hub package
echo "Installing huggingface-hub..."
# pip install --upgrade "huggingface-hub"

# # Download the model files directly to their destination
# echo "Downloading model files..."
# echo "${MUSETALK_DIR}/models/musetalk"
# mkdir -p "${MUSETALK_DIR}/models/musetalk"

# # Download model files directly to their final location
huggingface-cli download TMElyralab/MuseTalk musetalk/musetalk.json --local-dir="${MUSETALK_DIR}/musetalk/models"
huggingface-cli download TMElyralab/MuseTalk musetalk/pytorch_model.bin --local-dir="${MUSETALK_DIR}/musetalk/models"

# # # Verify files were downloaded successfully
# # if [ ! -f "${MUSETALK_DIR}/models/musetalk/musetalk.json" ] || [ ! -f "${MUSETALK_DIR}/models/musetalk/pytorch_model.bin" ]; then
# #     echo "Some model files failed to download. Trying alternative paths..."

# #     # Try alternative download paths
# #     if [ ! -f "${MUSETALK_DIR}/models/musetalk/musetalk.json" ]; then
# #         huggingface-cli download TMElyralab/MuseTalk "musetalk.json" --local-dir "${MUSETALK_DIR}/models/musetalk" --force
# #     fi

# #     if [ ! -f "${MUSETALK_DIR}/models/musetalk/pytorch_model.bin" ]; then
# #         huggingface-cli download TMElyralab/MuseTalk "pytorch_model.bin" --local-dir "${MUSETALK_DIR}/models/musetalk" --force
# #     fi

# #     # Final verification
# #     if [ ! -f "${MUSETALK_DIR}/models/musetalk/musetalk.json" ] || [ ! -f "${MUSETALK_DIR}/models/musetalk/pytorch_model.bin" ]; then
# #         echo "ERROR: Failed to download model files. Please download manually from:"
# #         echo "https://huggingface.co/TMElyralab/MuseTalk"
# #         echo "and place 'musetalk.json' and 'pytorch_model.bin' in: ${MUSETALK_DIR}/models/musetalk/"
# #         exit 1
# # fi

echo "MuseTalk model files downloaded successfully!"

# # # Download supporting models
echo "Downloading supporting models..."

# # # DWPOSE
huggingface-cli download yzd-v/DWPose "dw-ll_ucoco_384.pth" --local-dir "${MUSETALK_DIR}/musetalk/models/dwpose"

# # # Face parse (bisenet and resnet18)
echo "Downloading face parsing models..."

# # # Use a more reliable direct download for face parsing models
FACE_PARSE_GOOGLE_DRIVE_ID=154JgKpzCPW82qINcVieuPH3fZ2e0P812
gdown https://drive.google.com/uc?id=${FACE_PARSE_GOOGLE_DRIVE_ID} -O "${MUSETALK_DIR}/musetalk/models/face-parse-bisent/79999_iter.pth"

RESNET18_URL="https://download.pytorch.org/models/resnet18-5c106cde.pth"

wget -O "${MUSETALK_DIR}/musetalk/models/face-parse-bisent/resnet18-5c106cde.pth" "$RESNET18_URL"


# # # Verify face parsing models were downloaded successfully
# # if [ ! -f "${MUSETALK_DIR}/models/face-parse-bisent/79999_iter.pth" ] || [ ! -f "${MUSETALK_DIR}/models/face-parse-bisent/resnet18-5c106cde.pth" ]; then
# #     echo "WARNING: Some face parsing model files may be missing. Script will continue but face parsing may not work."
# # fi

# # # SD VAE
# huggingface-cli download stabilityai/sd-vae-ft-mse "config.json" --local-dir "${MUSETALK_DIR}/musetalk/models/sd-vae-ft-mse"
# huggingface-cli download stabilityai/sd-vae-ft-mse "diffusion_pytorch_model.bin" --local-dir "${MUSETALK_DIR}/musetalk/models/sd-vae-ft-mse"

# # # Whisper
# echo "Downloading Whisper model..."
# # Ensure the whisper directory exists (might have been changed by git clone)

# # Define the full path for clarity
# WHISPER_MODEL_PATH="${MUSETALK_DIR}/musetalk/models/whisper/tiny.pt"
# WHISPER_URL="https://openaipublic.azureedge.net/main/whisper/models/65147644a518d12f04e32d6f3b26facc3f8dd46e5390956a9424a650c0ce22b9/tiny.pt"

# # echo "Downloading Whisper tiny.pt to ${WHISPER_MODEL_PATH}..."
# if ! wget --no-verbose -O "${WHISPER_MODEL_PATH}" "${WHISPER_URL}"; then
#     echo "Failed to download Whisper model with wget, trying curl..."
#     if command -v curl &> /dev/null; then
#         curl -L "${WHISPER_URL}" -o "${WHISPER_MODEL_PATH}"
#     else
#         echo "Installing Python requests for alternative download method..."
#         pip install requests --quiet

#         # Try to download with Python
#         python3 -c "
# import requests, os
# url = '${WHISPER_URL}'
# output = '${WHISPER_MODEL_PATH}'
# print(f'Downloading {url} to {output}')
# os.makedirs(os.path.dirname(output), exist_ok=True)
# r = requests.get(url, stream=True)
# # r.raise_for_status()
# # with open(output, 'wb') as f:
# #     for chunk in r.iter_content(chunk_size=8192):
# #         f.write(chunk)
# # print('Download complete')
# # "
#     fi
# fi

# # # Check if the download was successful
# if [ -f "${WHISPER_MODEL_PATH}" ]; then
#     echo "Whisper model downloaded successfully to ${WHISPER_MODEL_PATH}"
# else
#     echo "WARNING: Failed to download Whisper model. The script will continue, but speech recognition may not work."
# fi

# # # Verify directory structure
# echo "Verifying directory structure..."
# tree "${MUSETALK_DIR}/musetalk/models"

# # # Create Flask server file
# echo "Creating Flask server file..."
# mkdir -p "${MUSETALK_DIR}/reference"

# # # Create server.py in MuseTalk directory
# cat > "${MUSETALK_DIR}/server.py" << 'EOL'
# import os
# import logging
# import tempfile
# from flask import Flask, request, jsonify, send_file
# import subprocess
# import shutil
# from concurrent.futures import ThreadPoolExecutor
# import threading
# import torch

# # Set up logging
# logging.basicConfig(
#     level=logging.INFO,
#     format='%(asctime)s - %(levelname)s - %(message)s'
# )
# logger = logging.getLogger(__name__)

# app = Flask(__name__)

# # Configuration
# INFERENCE_SCRIPT = "scripts.realtime_inference"
# INFERENCE_CONFIG = "configs/inference/realtime.yaml"
# BBOX_SHIFT = 0  # Default value, can be adjusted

# # Configure parallel processing
# MAX_WORKERS = 2  # Adjust based on GPU memory and CPU cores
# executor = ThreadPoolExecutor(max_workers=MAX_WORKERS)
# gpu_semaphore = threading.Semaphore(1)  # Limit concurrent GPU operations

# # Optimize CUDA settings
# torch.backends.cudnn.benchmark = True
# if hasattr(torch.backends.cuda, 'matmul'):
#     torch.backends.cuda.matmul.allow_tf32 = True  # Enable TF32 for faster matrix multiplications
#     torch.backends.cudnn.allow_tf32 = True

# # Load environment variables from .env file
# if os.path.exists('.env'):
#     with open('.env', 'r') as f:
#         for line in f:
#             if line.strip() and not line.startswith('#'):
#                 key, value = line.strip().split('=', 1)
#                 os.environ[key] = value

# def process_video(video_path, audio_path, output_path):
#     with gpu_semaphore:
#         try:
#             # Clear GPU cache before processing
#             torch.cuda.empty_cache()

#             # Create a temporary config file with paths
#             temp_config = os.path.join(tempfile.gettempdir(), f"musetalk_config_{os.getpid()}.yaml")

#             with open(INFERENCE_CONFIG, 'r') as f:
#                 config_content = f.read()

#             # Modify config with specific paths
#             config_content = config_content.replace('preparation: True', 'preparation: True')  # Force preparation for API call
#             config_content = config_content.replace('video_path: data/videos/xinying_sun_1.mp4', f'video_path: {video_path}')

#             # Write temporary config
#             with open(temp_config, 'w') as f:
#                 f.write(config_content)

#             # First run with preparation enabled
#             prep_cmd = [
#                 "python", "-m", INFERENCE_SCRIPT,
#                 "--inference_config", temp_config,
#                 "--bbox_shift", str(BBOX_SHIFT)
#             ]

#             logger.info(f"Running preparation command: {' '.join(prep_cmd)}")
#             prep_process = subprocess.Popen(
#                 prep_cmd,
#                 stdout=subprocess.PIPE,
#                 stderr=subprocess.PIPE,
#                 env={**os.environ}
#             )
#             prep_stdout, prep_stderr = prep_process.communicate()

#             if prep_process.returncode != 0:
#                 logger.error(f"Preparation stdout: {prep_stdout.decode()}")
#                 logger.error(f"Preparation stderr: {prep_stderr.decode()}")
#                 raise Exception(f"Preparation failed: {prep_stderr.decode()}")

#             # Update config for inference
#             with open(temp_config, 'r') as f:
#                 config_content = f.read()

#             config_content = config_content.replace('preparation: True', 'preparation: False')

#             # Write updated config
#             with open(temp_config, 'w') as f:
#                 f.write(config_content)

#             # Run inference with audio
#             cmd = [
#                 "python", "-m", INFERENCE_SCRIPT,
#                 "--inference_config", temp_config,
#                 "--bbox_shift", str(BBOX_SHIFT),
#                 "--audio_path", audio_path,
#                 "--output_path", output_path
#             ]

#             logger.info(f"Running inference command: {' '.join(cmd)}")
#             process = subprocess.Popen(
#                 cmd,
#                 stdout=subprocess.PIPE,
#                 stderr=subprocess.PIPE,
#                 env={**os.environ}
#             )
#             stdout, stderr = process.communicate()

#             if process.returncode != 0:
#                 logger.error(f"Inference stdout: {stdout.decode()}")
#                 logger.error(f"Inference stderr: {stderr.decode()}")
#                 raise Exception(f"Inference failed: {stderr.decode()}")

#             return True
#         finally:
#             torch.cuda.empty_cache()
#             # Clean up temp config
#             if os.path.exists(temp_config):
#                 os.remove(temp_config)

# @app.route('/health', methods=['GET'])
# def health_check():
#     logger.info("Health check requested")
#     return jsonify({"status": "healthy"}), 200

# @app.route('/sync', methods=['POST'])
# def sync_video_audio():
#     try:
#         logger.info("Received video sync request")

#         if 'video' not in request.files or 'audio' not in request.files:
#             return jsonify({"error": "Both video and audio files are required"}), 400

#         video_file = request.files['video']
#         audio_file = request.files['audio']

#         # Create unique temporary directory for this request
#         temp_dir = tempfile.mkdtemp(prefix='musetalk_')

#         # Save uploaded files
#         video_path = os.path.join(temp_dir, f"input_video_{id(video_file)}.mp4")
#         audio_path = os.path.join(temp_dir, f"input_audio_{id(audio_file)}.wav")
#         output_path = os.path.join(temp_dir, f"output_video_{id(video_file)}.mp4")

#         video_file.save(video_path)
#         audio_file.save(audio_path)

#         logger.info(f"Files saved to {temp_dir}, submitting to thread pool")

#         # Process video without waiting for result
#         future = executor.submit(process_video, video_path, audio_path, output_path)

#         # Set up cleanup callback
#         def cleanup_callback(future):
#             try:
#                 shutil.rmtree(temp_dir, ignore_errors=True)
#             except Exception as e:
#                 logger.error(f"Error cleaning up temp dir: {str(e)}")

#         future.add_done_callback(cleanup_callback)

#         # Wait for processing to complete with timeout
#         try:
#             future.result(timeout=600)  # 10 minute timeout
#         except TimeoutError:
#             return jsonify({"error": "Processing timeout"}), 504

#         logger.info("Processing completed successfully")

#         return send_file(
#             output_path,
#             mimetype='video/mp4',
#             as_attachment=True,
#             download_name='synchronized_video.mp4'
#         )

#     except Exception as e:
#         logger.error(f"Error in video sync: {str(e)}", exc_info=True)
#         return jsonify({"error": str(e)}), 500

# if __name__ == '__main__':
#     logger.info("Starting MuseTalk server on port 8003...")
#     from werkzeug.serving import run_simple
#     run_simple('0.0.0.0', 8003, app, threaded=True, request_timeout=900)  # 15 minute timeout
# EOL

# # # Create server startup script
# echo "Creating server startup script..."
# cat > "${MUSETALK_DIR}/start_server.sh" << 'EOL'
# #!/bin/bash
# source venv/bin/activate
# # Load environment variables from .env file
# if [ -f .env ]; then
#     export $(grep -v '^#' .env | xargs)
# fi
# export FLASK_APP=server.py
# export FLASK_ENV=production
# gunicorn --bind 0.0.0.0:8003 --timeout 300 server:app
# EOL

# chmod +x "${MUSETALK_DIR}/start_server.sh"

# # # Create systemd service file
# echo "Creating systemd service file..."
# sudo tee /etc/systemd/system/musetalk.service << EOL
# [Unit]
# Description=MuseTalk Service
# After=network.target

# [Service]
# Type=simple
# User=$USER
# WorkingDirectory=${PWD}/${MUSETALK_DIR}
# ExecStart=${PWD}/${MUSETALK_DIR}/start_server.sh
# Restart=always

# [Install]
# WantedBy=multi-user.target
# EOL

# # Reload systemd and start service
# echo "Starting MuseTalk service..."
# sudo systemctl daemon-reload
# sudo systemctl enable musetalk
# sudo systemctl start musetalk

# echo "MuseTalk setup complete!"
# echo "Service is running on port 8003"
# echo "Check status with: sudo systemctl status musetalk"
