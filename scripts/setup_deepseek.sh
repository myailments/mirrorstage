#!/bin/bash

# Exit on error
set -e

# Define paths
MODELS_DIR="models"
DEEPSEEK_DIR="${MODELS_DIR}/deepseek"

echo "Setting up Deepseek-v3 with vLLM in Lambda GPU environment..."

# Install system dependencies
echo "Installing system dependencies..."
sudo apt update -y
sudo apt install -y python3-pip python3-venv git

# Create directories if they don't exist
mkdir -p "${DEEPSEEK_DIR}"
cd "${DEEPSEEK_DIR}"

# Create and activate virtual environment
echo "Creating virtual environment..."
python3 -m venv venv
source venv/bin/activate

# Install dependencies
echo "Installing dependencies..."
pip install --upgrade pip
pip install vllm>=0.3.0
pip install flask>=2.0.0 gunicorn>=20.1.0

# Create server script with Flask and vLLM
echo "Creating server script..."
cat > server.py << 'EOL'
from flask import Flask, request, jsonify
import json
import time
import asyncio
import threading
from typing import List, Dict, Any, Optional

# Import vLLM components
from vllm.engine.arg_utils import AsyncEngineArgs
from vllm.engine.async_llm_engine import AsyncLLMEngine
from vllm.sampling_params import SamplingParams
from vllm.utils import random_uuid

app = Flask(__name__)

# Model configuration
MODEL_ID = "deepseek-ai/deepseek-coder-v3-7b"
DEFAULT_MAX_TOKENS = 150

# Initialize vLLM engine in a separate thread
engine = None
engine_ready = threading.Event()

def init_engine():
    global engine
    
    print(f"Initializing vLLM engine with model: {MODEL_ID}")
    # Set up engine arguments
    engine_args = AsyncEngineArgs(
        model=MODEL_ID,
        dtype="auto",
        trust_remote_code=True,
        gpu_memory_utilization=0.95,
    )
    
    # Create engine
    engine = AsyncLLMEngine.from_engine_args(engine_args)
    print("vLLM engine initialization complete")
    engine_ready.set()

# Start engine initialization in a separate thread
init_thread = threading.Thread(target=init_engine)
init_thread.daemon = True
init_thread.start()

# Get event loop for async operations
def get_event_loop():
    try:
        return asyncio.get_event_loop()
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        return loop

# Health check endpoint
@app.route('/health', methods=['GET'])
def health_check():
    if engine_ready.is_set():
        return jsonify({"status": "healthy", "model": MODEL_ID}), 200
    else:
        return jsonify({"status": "initializing", "model": MODEL_ID}), 503

# OpenAI-compatible models endpoint
@app.route('/v1/models', methods=['GET'])
def list_models():
    return jsonify({
        "object": "list",
        "data": [
            {
                "id": "deepseek-coder-v3",
                "object": "model",
                "created": int(time.time()),
                "owned_by": "deepseek-ai"
            }
        ]
    })

# OpenAI-compatible chat completions endpoint
@app.route('/v1/chat/completions', methods=['POST'])
def chat_completions():
    # Check if engine is ready
    if not engine_ready.is_set():
        return jsonify({
            "error": {
                "message": "Model is still initializing, please try again in a few minutes",
                "type": "server_error"
            }
        }), 503
    
    try:
        # Parse request
        data = request.get_json(silent=True)
        if not data:
            return jsonify({"error": {"message": "Invalid JSON"}}), 400
        
        # Extract parameters
        messages = data.get('messages', [])
        if not messages:
            return jsonify({"error": {"message": "No messages provided"}}), 400
            
        model = data.get('model', 'deepseek-coder-v3')
        max_tokens = data.get('max_tokens', DEFAULT_MAX_TOKENS)
        temperature = data.get('temperature', 0.7)
        top_p = data.get('top_p', 1.0)
        
        # Create sampling parameters
        sampling_params = SamplingParams(
            temperature=temperature,
            top_p=top_p,
            max_tokens=max_tokens,
        )
        
        # Generate response (run async function in sync context)
        loop = get_event_loop()
        response = loop.run_until_complete(
            generate_completion(messages, sampling_params)
        )
        
        return jsonify(response)
        
    except Exception as e:
        return jsonify({
            "error": {
                "message": str(e),
                "type": "server_error"
            }
        }), 500

async def generate_completion(messages: List[Dict[str, str]], sampling_params: SamplingParams) -> Dict[str, Any]:
    # Generate a request ID
    request_id = random_uuid()
    
    try:
        # Send request to vLLM engine
        results_generator = await engine.generate(
            prompt=None,
            sampling_params=sampling_params,
            request_id=request_id,
            prompt_params={"messages": messages}
        )
        
        # Get the results - vLLM generates one result per prompt
        results = [r for r in results_generator]
        
        if not results:
            raise ValueError("No results from model")
            
        result = results[0]
        
        # Format response in OpenAI compatible format
        return {
            "id": f"chatcmpl-{request_id}",
            "object": "chat.completion",
            "created": int(time.time()),
            "model": "deepseek-coder-v3",
            "choices": [
                {
                    "index": 0,
                    "message": {
                        "role": "assistant",
                        "content": result.outputs[0].text
                    },
                    "finish_reason": "stop" if result.finished else "length"
                }
            ],
            "usage": {
                "prompt_tokens": result.prompt_token_ids.shape[0],
                "completion_tokens": len(result.outputs[0].token_ids),
                "total_tokens": result.prompt_token_ids.shape[0] + len(result.outputs[0].token_ids)
            }
        }
    except Exception as e:
        print(f"Error during generation: {str(e)}")
        raise

if __name__ == '__main__':
    # Use port 8000 as specified in the config
    app.run(host='0.0.0.0', port=8000, debug=False)
EOL

# Create server startup script
echo "Creating server startup script..."
cat > start_server.sh << 'EOL'
#!/bin/bash
source venv/bin/activate
export FLASK_APP=server.py
export FLASK_ENV=production
# Using port 8000 to match config
gunicorn --bind 0.0.0.0:8000 --timeout 300 --workers 1 server:app
EOL

chmod +x start_server.sh

# Create systemd service file
echo "Creating systemd service file..."
sudo tee /etc/systemd/system/deepseek.service << EOL
[Unit]
Description=Deepseek Coder v3 Service with vLLM
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$(pwd)
ExecStart=$(pwd)/start_server.sh
Restart=always
# Increase timeout for model loading
TimeoutStartSec=600

[Install]
WantedBy=multi-user.target
EOL

# Reload systemd and start service
echo "Starting Deepseek service..."
sudo systemctl daemon-reload
sudo systemctl enable deepseek
sudo systemctl start deepseek

# Add environment variables to .env
echo "Adding environment variables to .env file..."
ENV_FILE="../../.env"
if [ -f "$ENV_FILE" ]; then
    # Check if variables already exist before adding
    if ! grep -q "USE_DEEPSEEK_LOCAL" "$ENV_FILE"; then
        echo "# Deepseek configuration" >> "$ENV_FILE"
        echo "USE_DEEPSEEK_LOCAL=true" >> "$ENV_FILE"
        echo "DEEPSEEK_ENDPOINT=/v1" >> "$ENV_FILE"
        echo "DEEPSEEK_PORT=8000" >> "$ENV_FILE"
    fi
else
    # Create new .env file with Deepseek variables
    echo "# Deepseek configuration" > "$ENV_FILE"
    echo "USE_DEEPSEEK_LOCAL=true" >> "$ENV_FILE"
    echo "DEEPSEEK_ENDPOINT=/v1" >> "$ENV_FILE"
    echo "DEEPSEEK_PORT=8000" >> "$ENV_FILE"
fi

echo "Deepseek setup complete!"
echo "Service is running on port 8000"
echo "Check status with: sudo systemctl status deepseek"
echo "View logs with: sudo journalctl -u deepseek -f"