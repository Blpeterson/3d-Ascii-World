"""Friendly terminal launcher for Endless City."""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from functools import partial
import shutil
import socket
import subprocess

HOST, PORT = "0.0.0.0", 8000
ROOT = Path(__file__).resolve().parent


def lan_ip():
    probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        probe.connect(("8.8.8.8", 80))
        return probe.getsockname()[0]
    except OSError:
        try:
            return socket.gethostbyname(socket.gethostname())
        except OSError:
            return "YOUR-COMPUTER-IP"
    finally:
        probe.close()


if __name__ == "__main__":
    address = lan_ip()
    print("\nENDLESS//CITY")
    print(f"  Play on this computer: http://127.0.0.1:{PORT}")
    print(f"  Friends on your Wi-Fi/LAN join: http://{address}:{PORT}")
    print("  Keep this terminal open while playing. Press Ctrl+C to stop.\n")

    node = shutil.which("node")
    if node:
        print("Starting the multiplayer server through Node.js...\n")
        try:
            raise SystemExit(subprocess.call([node, str(ROOT / "server.mjs")], cwd=ROOT))
        except KeyboardInterrupt:
            raise SystemExit(0)

    print("Node.js was not found; starting a static single-player fallback.")
    print("Install Node.js and run this script again to enable shared multiplayer.\n")
    try:
        handler = partial(SimpleHTTPRequestHandler, directory=ROOT)
        ThreadingHTTPServer((HOST, PORT), handler).serve_forever()
    except KeyboardInterrupt:
        print("\nENDLESS//CITY stopped.")
