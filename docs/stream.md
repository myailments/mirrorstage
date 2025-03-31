# Viewing the Video Stream with FFplay

## 1. Direct Command
The simplest way to view the stream:
```bash
ffplay -f mpegts udp://127.0.0.1:1234
```

## 2. Enhanced Viewing Options
For better viewing experience:
```bash
ffplay \
  -f mpegts \
  -i udp://127.0.0.1:1234 \
  -window_title "AI Response System" \
  -noborder \
  -alwaysontop \
  -x 800 \
  -y 600
```

### Command Options Explained:
- `-f mpegts`: Specifies the input format as MPEG transport stream
- `-i udp://127.0.0.1:1234`: The UDP stream address
- `-window_title`: Sets the window title
- `-noborder`: Removes window border
- `-alwaysontop`: Keeps window on top
- `-x 800 -y 600`: Sets window size to 800x600 pixels

## 3. Troubleshooting

If you can't see the stream:
1. Verify the server is running
2. Check FFmpeg/FFplay installation:
```bash
ffplay -version
```
3. Ensure port 1234 is not blocked:
```bash
# Linux/macOS
sudo lsof -i :1234

# Windows
netstat -ano | findstr :1234
```
4. Try different network interface:
```bash
ffplay -f mpegts udp://0.0.0.0:1234
```

## 4. Additional FFplay Options

For debugging:
```bash
ffplay -f mpegts udp://127.0.0.1:1234 -loglevel debug
```

For lower latency:
```bash
ffplay -f mpegts udp://127.0.0.1:1234 -fflags nobuffer
```

For full screen:
```bash
ffplay -f mpegts udp://127.0.0.1:1234 -fs
```
```

Would you like me to provide more specific options or troubleshooting steps?